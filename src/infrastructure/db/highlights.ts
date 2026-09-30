import type { Highlight, HighlightColor } from '../../domain/highlight.ts';
import { database, type NotaDatabase } from './database.ts';
export function createHighlightRepository(db: NotaDatabase = database) {
	return {
		list: (docId: string) => db.highlights.where('docId').equals(docId).sortBy('createdAt'),
		notes: (docId: string) => db.annotations.where('docId').equals(docId).sortBy('createdAt'),
		async save(value: Omit<Highlight, 'id' | 'createdAt'>) {
			if (
				!Number.isInteger(value.page) ||
				value.page < 1 ||
				!value.anchor.quote.trim() ||
				!value.rects.length ||
				value.rects.some(
					r =>
						r.length !== 4 ||
						r.some(n => !Number.isFinite(n) || n < 0 || n > 1) ||
						r[2] <= 0 ||
						r[3] <= 0 ||
						r[0] + r[2] > 1.000001 ||
						r[1] + r[3] > 1.000001,
				)
			)
				throw new Error('Invalid highlight geometry.');
			return db.transaction('rw', db.documents, db.highlights, async () => {
				if (!(await db.documents.get(value.docId))) throw new Error('Save the document before highlighting.');
				const highlight: Highlight = { ...value, id: crypto.randomUUID(), createdAt: Date.now() };
				await db.highlights.add(highlight);
				return highlight;
			});
		},
		async color(id: string, color: HighlightColor) {
			await db.highlights.update(id, { color });
		},
		async remove(id: string) {
			await db.transaction('rw', db.highlights, db.annotations, async () => {
				await db.annotations.where('highlightId').equals(id).delete();
				await db.highlights.delete(id);
			});
		},
		async addNote(id: string, text: string) {
			if (!text.trim()) throw new Error('Enter a note first.');
			await db.transaction('rw', db.highlights, db.annotations, async () => {
				const highlight = await db.highlights.get(id);
				if (!highlight) throw new Error('This highlight no longer exists.');
				await db.annotations.add({
					id: crypto.randomUUID(),
					highlightId: id,
					docId: highlight.docId,
					page: highlight.page,
					text: text.trim(),
					createdAt: Date.now(),
				});
			});
		},
	};
}
export const highlights = createHighlightRepository();

