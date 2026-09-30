import { normalizeView, type StoredDocument } from '../../domain/document.ts';
import type { Annotation, Highlight } from '../../domain/highlight.ts';
import { database, type NotaDatabase } from '../../infrastructure/db/database.ts';
import { hashBlob } from '../../infrastructure/pdf/hashDigest.ts';

export const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
const MAX_RECORDS = 100_000;
interface BackupDocument extends Omit<StoredDocument, 'pdfBlob'> {
	pdfBase64: string;
}
interface LibraryBackup {
	format: 'nota-library';
	version: 1;
	exportedAt: string;
	documents: BackupDocument[];
	highlights: Highlight[];
	notes: Annotation[];
}
export interface PreparedBackup {
	documents: StoredDocument[];
	highlights: Highlight[];
	notes: Annotation[];
}
const invalid = () => new Error('Invalid Nota backup. Nothing was imported.');
function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
	return value as Record<string, unknown>;
}
function text(value: unknown, max: number, allowEmpty = false): string {
	if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) throw invalid();
	return value;
}
function number(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER, integer = false): number {
	if (
		typeof value !== 'number' ||
		!Number.isFinite(value) ||
		value < min ||
		value > max ||
		(integer && !Number.isInteger(value))
	)
		throw invalid();
	return value;
}
function array(value: unknown): unknown[] {
	if (!Array.isArray(value) || value.length > MAX_RECORDS) throw invalid();
	return value;
}
function unique<T extends { id: string }>(items: T[]) {
	if (new Set(items.map(item => item.id)).size !== items.length) throw invalid();
}
async function encode(blob: Blob): Promise<string> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	const parts: string[] = [];
	for (let i = 0; i < bytes.length; i += 24_576)
		parts.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 24_576))));
	return parts.join(''); // Chunk sizes are multiples of three: no intermediate padding.
}
function decode(value: unknown): Blob {
	const base64 = text(value, MAX_BACKUP_BYTES);
	if (base64.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw invalid();
	const parts: Uint8Array<ArrayBuffer>[] = [];
	for (let i = 0; i < base64.length; i += 32_768) {
		const part = atob(base64.slice(i, i + 32_768));
		parts.push(Uint8Array.from(part, char => char.charCodeAt(0)));
	}
	return new Blob(parts, { type: 'application/pdf' });
}

/** Validate everything, including PDF hashes, before opening a write transaction. */
export async function prepareBackup(file: Blob): Promise<PreparedBackup> {
	if (!file.size || file.size > MAX_BACKUP_BYTES) throw new Error('Choose a Nota JSON backup smaller than 256 MiB.');
	let value: Record<string, unknown>;
	try {
		value = record(JSON.parse(await file.text()));
	} catch {
		throw invalid();
	}
	if (value.format !== 'nota-library' || value.version !== 1)
		throw new Error('This backup format or version is not supported. Nothing was imported.');
	const documents: StoredDocument[] = [];
	const ids = new Map<string, StoredDocument>();
	for (const entry of array(value.documents)) {
		const item = record(entry),
			docId = text(item.docId, 64);
		if (!/^[a-f0-9]{64}$/.test(docId) || ids.has(docId)) throw invalid();
		const pdfBlob = decode(item.pdfBase64);
		if (
			pdfBlob.size !== number(item.size, 1, MAX_BACKUP_BYTES, true) ||
			!new TextDecoder().decode(await pdfBlob.slice(0, 1024).arrayBuffer()).includes('%PDF-') ||
			(await hashBlob(pdfBlob)) !== docId
		)
			throw new Error('A PDF in this backup is damaged or has a mismatched fingerprint. Nothing was imported.');
		const view = record(item.view);
		number(view.page, 1, Number.MAX_SAFE_INTEGER, true);
		number(view.offset, 0, 1);
		number(view.zoom, 0.5, 2);
		if (view.fit !== undefined && (typeof view.fit !== 'string' || !['manual', 'width', 'page'].includes(view.fit)))
			throw invalid();
		const document: StoredDocument = {
			docId,
			name: text(item.name, 1024),
			size: pdfBlob.size,
			mime: 'application/pdf',
			pdfBlob,
			pageCount: number(item.pageCount, 0, Number.MAX_SAFE_INTEGER, true),
			createdAt: number(item.createdAt),
			lastOpenedAt: number(item.lastOpenedAt),
			view: normalizeView({
				page: view.page as number,
				offset: view.offset as number,
				zoom: view.zoom as number,
				...(view.fit !== undefined ? { fit: view.fit as StoredDocument['view']['fit'] } : {}),
			}),
		};
		ids.set(docId, document);
		documents.push(document);
	}
	const highlights = array(value.highlights).map(entry => {
		const item = record(entry),
			anchor = record(item.anchor);
		const docId = text(item.docId, 64),
			page = number(item.page, 1, Number.MAX_SAFE_INTEGER, true);
		const doc = ids.get(docId);
		if (
			!doc ||
			(doc.pageCount && page > doc.pageCount) ||
			!['yellow', 'green', 'blue'].includes(text(item.color, 16))
		)
			throw invalid();
		const rects = array(item.rects).map(value => {
			if (!Array.isArray(value) || value.length !== 4) throw invalid();
			const r = value.map(n => number(n, 0, 1)) as [number, number, number, number];
			if (!r[2] || !r[3] || r[0] + r[2] > 1.000001 || r[1] + r[3] > 1.000001) throw invalid();
			return r;
		});
		if (!rects.length) throw invalid();
		return {
			id: text(item.id, 200),
			docId,
			page,
			rects,
			color: item.color as Highlight['color'],
			createdAt: number(item.createdAt),
			...(item.rotation !== undefined ? { rotation: number(item.rotation, -360, 360, true) } : {}),
			anchor: {
				quote: text(anchor.quote, 6000),
				prefix: text(anchor.prefix, 6000, true),
				suffix: text(anchor.suffix, 6000, true),
			},
		};
	});
	unique(highlights);
	const parents = new Map(highlights.map(item => [item.id, item]));
	const notes = array(value.notes).map(entry => {
		const item = record(entry),
			highlightId = text(item.highlightId, 200);
		const parent = parents.get(highlightId);
		if (!parent || item.docId !== parent.docId || item.page !== parent.page) throw invalid();
		return {
			id: text(item.id, 200),
			highlightId,
			docId: parent.docId,
			page: parent.page,
			text: text(item.text, 10_000),
			createdAt: number(item.createdAt),
		};
	});
	unique(notes);
	return { documents, highlights, notes };
}

const escapeMarkdown = (value: string) => value.replace(/[\\`*_{}\[\]<>#+!|]/g, '\\$&');
export function researchMarkdown(documents: StoredDocument[], highlights: Highlight[], notes: Annotation[]): string {
	const lines = ['# Nota research notes', ''];
	const notesByHighlight = new Map<string, Annotation[]>();
	for (const note of [...notes].sort((a, b) => a.createdAt - b.createdAt)) {
		const group = notesByHighlight.get(note.highlightId) ?? [];
		group.push(note);
		notesByHighlight.set(note.highlightId, group);
	}
	for (const document of documents) {
		lines.push(`## ${escapeMarkdown(document.name)}`, '', `PDF fingerprint: \`${document.docId}\``, '');
		const marks = highlights
			.filter(item => item.docId === document.docId)
			.sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
		if (!marks.length) lines.push('_No highlights or notes._', '');
		for (const mark of marks) {
			lines.push(
				`### Page ${mark.page} · ${mark.color} highlight`,
				'',
				...mark.anchor.quote.split(/\r?\n/).map(line => `> ${escapeMarkdown(line)}`),
				'',
			);
			for (const note of notesByHighlight.get(mark.id) ?? [])
				lines.push('**Note**', '', escapeMarkdown(note.text), '');
		}
	}
	return lines.join('\n');
}
export function createLibraryTransfer(db: NotaDatabase = database) {
	async function snapshot() {
		return db.transaction('r', db.documents, db.highlights, db.annotations, async () => ({
			documents: await db.documents.toArray(),
			highlights: await db.highlights.toArray(),
			notes: await db.annotations.toArray(),
		}));
	}
	return {
		async markdown(docId?: string) {
			const value = await snapshot();
			const selected = docId ? value.documents.filter(doc => doc.docId === docId) : value.documents;
			if (!selected.length) throw new Error('Save a PDF before exporting notes.');
			return new Blob([researchMarkdown(selected, value.highlights, value.notes)], {
				type: 'text/markdown;charset=utf-8',
			});
		},
		async backup() {
			const value = await snapshot();
			if (!value.documents.length) throw new Error('Your saved library is empty.');
			const size = value.documents.reduce((size, doc) => size + Math.ceil(doc.pdfBlob.size / 3) * 4, 0);
			if (size > MAX_BACKUP_BYTES) throw new Error('This library exceeds the 256 MiB backup limit.');
			const documents: BackupDocument[] = [];
			for (const { pdfBlob, ...doc } of value.documents)
				documents.push({ ...doc, pdfBase64: await encode(pdfBlob) });
			const backup: LibraryBackup = {
				format: 'nota-library',
				version: 1,
				exportedAt: new Date().toISOString(),
				documents,
				highlights: value.highlights,
				notes: value.notes,
			};
			const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
			if (blob.size > MAX_BACKUP_BYTES) throw new Error('This library exceeds the 256 MiB backup limit.');
			return blob;
		},
		async restore(value: PreparedBackup) {
			return db.transaction('rw', db.documents, db.highlights, db.annotations, async () => {
				const added = { documents: 0, highlights: 0, notes: 0 };
				for (const doc of value.documents) {
					const current = await db.documents.get(doc.docId);
					if (!current) {
						await db.documents.add(doc);
						added.documents++;
					} else if (!current.pdfBlob)
						await db.documents.update(doc.docId, { pdfBlob: doc.pdfBlob, size: doc.size });
				}
				for (const mark of value.highlights) {
					const current = await db.highlights.get(mark.id);
					if (current && (current.docId !== mark.docId || current.page !== mark.page))
						throw new Error('Conflicting highlight identifiers. Nothing was imported.');
					if (!current) {
						await db.highlights.add(mark);
						added.highlights++;
					}
				}
				for (const note of value.notes) {
					const current = await db.annotations.get(note.id);
					if (current && (current.docId !== note.docId || current.highlightId !== note.highlightId))
						throw new Error('Conflicting note identifiers. Nothing was imported.');
					if (!current) {
						await db.annotations.add(note);
						added.notes++;
					}
				}
				return added;
			});
		},
	};
}
export const libraryTransfer = createLibraryTransfer();
export function downloadFile(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob),
		link = document.createElement('a');
	link.href = url;
	link.download = filename;
	link.click();
	// Give the browser time to begin its download before revoking the object URL.
	setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
