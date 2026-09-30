import {
	DEFAULT_VIEW,
	normalizeView,
	type DocumentSummary,
	type ReaderView,
	type StoredDocument,
} from '../../domain/document.ts';
import { database, type NotaDatabase } from './database.ts';

export function createDocumentRepository(db: NotaDatabase = database) {
	return {
		async deleteDocument(docId: string) {
			await db.transaction('rw', db.tables, async () => {
				await db.highlights.where('docId').equals(docId).delete();
				await db.annotations.where('docId').equals(docId).delete();
				await db.responseCache.where('docId').equals(docId).delete();
				await db.documents.delete(docId);
			});
		},
		async wipeData() {
			await db.delete();
			await db.open(); // Recreate an empty schema so reading can resume immediately.
		},
		async importDocument(file: File, docId: string) {
			if (!/^[a-f0-9]{64}$/.test(docId)) throw new Error('Invalid document SHA-256.');
			// Atomic lookup + insert also deduplicates concurrent imports and tabs.
			return db.transaction('rw', db.documents, async () => {
				const existing = await db.documents.get(docId);
				const now = Date.now();
				if (existing) {
					// A metadata record can survive an interrupted/manual storage edit.
					// Reimport must repair missing bytes rather than keep an unreadable entry.
					const repair = !existing.pdfBlob ? { pdfBlob: file.slice(0, file.size, 'application/pdf') } : {};
					await db.documents.update(docId, { lastOpenedAt: now, ...repair });
					return { document: { ...existing, ...repair, lastOpenedAt: now }, isExisting: true };
				}
				const document: StoredDocument = {
					docId,
					name: file.name,
					size: file.size,
					mime: 'application/pdf',
					pageCount: 0,
					createdAt: now,
					lastOpenedAt: now,
					pdfBlob: file.slice(0, file.size, 'application/pdf'),
					view: { ...DEFAULT_VIEW },
				};
				await db.documents.add(document);
				return { document, isExisting: false };
			});
		},

		async listDocuments(): Promise<DocumentSummary[]> {
			const rows = await db.documents.orderBy('lastOpenedAt').reverse().toArray();
			return rows.map(({ pdfBlob: _pdfBlob, ...summary }) => summary);
		},

		async reopenDocument(docId: string): Promise<StoredDocument> {
			return db.transaction('rw', db.documents, async () => {
				const document = await db.documents.get(docId);
				if (!document?.pdfBlob)
					throw new Error('This saved PDF is no longer available. Import the original file again.');
				const lastOpenedAt = Date.now();
				await db.documents.update(docId, { lastOpenedAt });
				return { ...document, lastOpenedAt, view: normalizeView(document.view, document.pageCount) };
			});
		},

		async saveView(docId: string, view: ReaderView) {
			return db.transaction('rw', db.documents, async () => {
				const document = await db.documents.get(docId);
				if (!document) throw new Error('This PDF was removed from browser storage.');
				await db.documents.update(docId, { view: normalizeView(view, document.pageCount) });
			});
		},

		async updatePageCount(docId: string, pageCount: number) {
			if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error('Invalid PDF page count.');
			const changed = await db.documents.update(docId, { pageCount });
			if (!changed) throw new Error('This PDF was removed from browser storage.');
		},
	};
}

export const documents = createDocumentRepository();
export type DocumentRepository = ReturnType<typeof createDocumentRepository>;

