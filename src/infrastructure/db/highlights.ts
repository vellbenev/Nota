import { isHighlightColor, type Annotation, type Highlight, type HighlightColor } from '../../domain/highlight.ts';
import { database, type NotaDatabase } from './database.ts';

/** The records a change touched, before and after it. Undo/redo replays these. */
export interface Snapshot {
	highlights: Highlight[];
	notes: Annotation[];
}
export interface Change {
	before: Snapshot;
	after: Snapshot;
}
export class ChangeConflictError extends Error {
	constructor() {
		super('This highlight changed after that action, so it was left as it is.');
		this.name = 'ChangeConflictError';
	}
}
const empty = (): Snapshot => ({ highlights: [], notes: [] });

function stable(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stable);
	if (value && typeof value === 'object')
		return Object.fromEntries(
			Object.keys(value as object)
				.sort()
				.map(key => [key, stable((value as Record<string, unknown>)[key])]),
		);
	return value;
}
/** Structural equality that ignores property order (records round-trip through IndexedDB). */
export const sameRecord = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

export function validateHighlight(value: Omit<Highlight, 'id' | 'createdAt'>) {
	if (
		!Number.isInteger(value.page) ||
		value.page < 1 ||
		!value.anchor.quote.trim() ||
		!isHighlightColor(value.color) ||
		!value.rects.length ||
		value.rects.some(
			r =>
				r.length !== 4 ||
				r.some(n => !Number.isFinite(n) || n < 0 || n > 1) ||
				r[2] <= 0 ||
				r[3] <= 0 ||
				r[0] + r[2] > 1.000001 ||
				r[1] + r[3] > 1.000001,
		) ||
		(value.range !== undefined &&
			!(
				Number.isInteger(value.range.start) &&
				Number.isInteger(value.range.end) &&
				value.range.start >= 0 &&
				value.range.end > value.range.start
			))
	)
		throw new Error('Invalid highlight geometry.');
}
const validateNote = (text: string) => {
	if (text.length > 10_000) throw new Error('Notes must be at most 10,000 characters.');
	if (!text.trim()) throw new Error('Enter a note first.');
};

export function createHighlightRepository(db: NotaDatabase = database) {
	const notesOf = (ids: string[]) => (ids.length ? db.annotations.where('highlightId').anyOf(ids).toArray() : []);
	const repository = {
		list: (docId: string) => db.highlights.where('docId').equals(docId).sortBy('createdAt'),
		notes: (docId: string) => db.annotations.where('docId').equals(docId).sortBy('createdAt'),

		/** Create a highlight. Undoable through the returned change. */
		async create(
			value: Omit<Highlight, 'id' | 'createdAt'>,
			id: string = crypto.randomUUID(),
			createdAt = Date.now(),
		): Promise<Change> {
			validateHighlight(value);
			return db.transaction('rw', db.documents, db.highlights, async () => {
				if (!(await db.documents.get(value.docId))) throw new Error('Save the document before highlighting.');
				const highlight: Highlight = { ...value, id, createdAt };
				await db.highlights.add(highlight);
				return { before: empty(), after: { highlights: [highlight], notes: [] } };
			});
		},
		async save(value: Omit<Highlight, 'id' | 'createdAt'>, id: string = crypto.randomUUID()) {
			return (await repository.create(value, id)).after.highlights[0];
		},

		/**
		 * Replace `survivor`'s text, geometry and color, and fold the `absorbed`
		 * highlights into it. Their notes move to the survivor; nothing is lost.
		 */
		async merge(survivor: Highlight, absorbed: string[]): Promise<Change> {
			validateHighlight(survivor);
			return db.transaction('rw', db.highlights, db.annotations, async () => {
				const ids = [survivor.id, ...absorbed.filter(id => id !== survivor.id)];
				const current = await db.highlights.bulkGet(ids);
				if (!current[0]) throw new Error('This highlight no longer exists.');
				const before: Snapshot = {
					highlights: current.filter((item): item is Highlight => !!item),
					notes: await notesOf(ids.slice(1)),
				};
				if (before.highlights.some(item => item.docId !== survivor.docId || item.page !== survivor.page))
					throw new Error('Only highlights on the same page can be combined.');
				const next: Highlight = { ...survivor, createdAt: current[0].createdAt };
				const moved = before.notes.map(note => ({ ...note, highlightId: survivor.id }));
				await db.highlights.bulkDelete(ids.slice(1));
				await db.highlights.put(next);
				await db.annotations.bulkPut(moved);
				return { before, after: { highlights: [next], notes: moved } };
			});
		},

		async recolor(ids: string[], color: HighlightColor): Promise<Change> {
			if (!isHighlightColor(color)) throw new Error('Invalid highlight color.');
			return db.transaction('rw', db.highlights, async () => {
				const current = await db.highlights.bulkGet(ids);
				if (!current.length || current.some(item => !item)) throw new Error('This highlight no longer exists.');
				const before = current as Highlight[];
				const after = before.map(item => ({ ...item, color }));
				await db.highlights.bulkPut(after);
				return { before: { highlights: before, notes: [] }, after: { highlights: after, notes: [] } };
			});
		},
		async color(id: string, color: HighlightColor) {
			await repository.recolor([id], color);
		},

		/** Remove highlights together with their notes, in one transaction. */
		async removeHighlights(ids: string[]): Promise<Change> {
			return db.transaction('rw', db.highlights, db.annotations, async () => {
				const highlights = (await db.highlights.bulkGet(ids)).filter((item): item is Highlight => !!item);
				const notes = await notesOf(ids);
				await db.annotations.bulkDelete(notes.map(note => note.id));
				await db.highlights.bulkDelete(ids);
				return { before: { highlights, notes }, after: empty() };
			});
		},
		async remove(id: string) {
			await repository.removeHighlights([id]);
		},

		async addNote(id: string, text: string) {
			validateNote(text);
			return db.transaction('rw', db.highlights, db.annotations, async () => {
				const highlight = await db.highlights.get(id);
				if (!highlight) throw new Error('This highlight no longer exists.');
				const note: Annotation = {
					id: crypto.randomUUID(),
					highlightId: id,
					docId: highlight.docId,
					page: highlight.page,
					text: text.trim(),
					createdAt: Date.now(),
				};
				await db.annotations.add(note);
				return note;
			});
		},
		async updateNote(id: string, text: string) {
			validateNote(text);
			await db.transaction('rw', db.annotations, db.highlights, async () => {
				const note = await db.annotations.get(id);
				if (!note || !(await db.highlights.get(note.highlightId)))
					throw new Error('This note no longer exists.');
				await db.annotations.update(id, { text: text.trim() });
			});
		},
		async deleteNote(id: string): Promise<Change> {
			return db.transaction('rw', db.annotations, async () => {
				const note = await db.annotations.get(id);
				await db.annotations.delete(id);
				return { before: { highlights: [], notes: note ? [note] : [] }, after: empty() };
			});
		},
		async removeNote(id: string) {
			await repository.deleteNote(id);
		},

		/**
		 * Move records from snapshot `from` to snapshot `to` (undo: after → before;
		 * redo: before → after). Refuses with ChangeConflictError, writing nothing,
		 * if anything involved changed since, including notes added to a highlight
		 * that would be removed.
		 */
		async apply(from: Snapshot, to: Snapshot) {
			await db.transaction('rw', db.documents, db.highlights, db.annotations, async () => {
				const keepHighlights = new Set(to.highlights.map(item => item.id));
				const keepNotes = new Set(to.notes.map(item => item.id));
				const known = new Set(from.notes.map(item => item.id));
				const current = await db.highlights.bulkGet(from.highlights.map(item => item.id));
				if (current.some((item, index) => !sameRecord(item, from.highlights[index])))
					throw new ChangeConflictError();
				const currentNotes = await db.annotations.bulkGet(from.notes.map(item => item.id));
				if (currentNotes.some((item, index) => !sameRecord(item, from.notes[index])))
					throw new ChangeConflictError();
				const fromHighlights = new Set(from.highlights.map(item => item.id));
				const added = to.highlights.filter(item => !fromHighlights.has(item.id));
				if ((await db.highlights.bulkGet(added.map(item => item.id))).some(Boolean))
					throw new ChangeConflictError();
				const addedNotes = to.notes.filter(item => !known.has(item.id));
				if ((await db.annotations.bulkGet(addedNotes.map(item => item.id))).some(Boolean))
					throw new ChangeConflictError();
				for (const docId of new Set(added.map(item => item.docId)))
					if (!(await db.documents.get(docId)))
						throw new Error('This document is no longer in your library.');
				const removed = from.highlights.filter(item => !keepHighlights.has(item.id)).map(item => item.id);
				// Every restored note needs its highlight, either restored too or still present.
				for (const highlightId of new Set(to.notes.map(note => note.highlightId)))
					if (!keepHighlights.has(highlightId) && !(await db.highlights.get(highlightId)))
						throw new ChangeConflictError();
				const attached = await notesOf(removed);
				if (attached.some(note => !known.has(note.id) && !keepNotes.has(note.id)))
					throw new ChangeConflictError();
				await db.annotations.bulkDelete(
					from.notes.filter(item => !keepNotes.has(item.id)).map(item => item.id),
				);
				await db.highlights.bulkDelete(removed);
				await db.highlights.bulkPut(to.highlights);
				await db.annotations.bulkPut(to.notes);
			});
		},
	};
	return repository;
}
export const highlights = createHighlightRepository();
export type HighlightRepository = ReturnType<typeof createHighlightRepository>;
