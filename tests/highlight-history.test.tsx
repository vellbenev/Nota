import 'fake-indexeddb/auto';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Highlight } from '../src/domain/highlight';
import { applyOverlays, useHighlightHistory } from '../src/features/highlights/useHighlightHistory';
import { NotaDatabase } from '../src/infrastructure/db/database';
import { ChangeConflictError, createHighlightRepository } from '../src/infrastructure/db/highlights';

const docId = 'a'.repeat(64);
const value: Omit<Highlight, 'id' | 'createdAt'> = {
	docId,
	page: 1,
	rects: [[0.1, 0.2, 0.4, 0.03]],
	anchor: { quote: 'A selected passage', prefix: '', suffix: '' },
	range: { start: 10, end: 28 },
	color: 'green',
};
let db: NotaDatabase;
let repo: ReturnType<typeof createHighlightRepository>;
beforeEach(async () => {
	db = new NotaDatabase(`history-${crypto.randomUUID()}`);
	repo = createHighlightRepository(db);
	await db.documents.put({
		docId,
		name: 'paper.pdf',
		size: 3,
		mime: 'application/pdf',
		pageCount: 1,
		createdAt: 1,
		lastOpenedAt: 1,
		pdfBlob: new Blob(['pdf']),
		view: { page: 1, offset: 0, zoom: 1 },
	});
});
afterEach(async () => {
	cleanup();
	vi.restoreAllMocks();
	db.close();
	await db.delete();
});

/** Render the hook with `saved` fed from the database, like the live query does. */
function mount(repository: Pick<typeof repo, 'apply'> = repo) {
	const ui = renderHook(({ saved }: { saved: Highlight[] }) => useHighlightHistory(saved, repository), {
		initialProps: { saved: [] as Highlight[] },
	});
	const sync = async () => {
		const saved = await repo.list(docId);
		ui.rerender({ saved });
		return saved;
	};
	return { ...ui, sync };
}
function create(ui: ReturnType<typeof mount>, write = () => repo.create(value, 'h1', 1000)) {
	const optimistic: Highlight = { ...value, id: 'h1', createdAt: 1000 };
	let change!: Promise<unknown>;
	act(() => {
		change = ui.result.current
			.run(write, {
				overlay: { show: [optimistic], hide: [], restore: [] },
				saving: 'Saving highlight…',
				done: 'Highlight saved',
				undone: 'Highlight undone',
			})
			.catch(() => undefined);
	});
	return { optimistic, change };
}

test('a new highlight shows immediately, keeps its color until the live query catches up, and never duplicates', async () => {
	const ui = mount();
	const { change } = create(ui);
	expect(ui.result.current.items).toHaveLength(1);
	expect(ui.result.current.items[0].color).toBe('green');
	expect(ui.result.current.notice?.phase).toBe('saving');
	await act(async () => void (await change));
	expect(ui.result.current.notice).toEqual({ phase: 'saved', message: 'Highlight saved' });
	await act(async () => void (await ui.sync()));
	expect(ui.result.current.items).toHaveLength(1);
	expect(ui.result.current.canUndo).toBe(true);
});

test('Undo issued before the write finishes hides the mark at once and leaves nothing behind in storage', async () => {
	const ui = mount();
	let finish!: () => void;
	const gate = new Promise<void>(resolve => (finish = resolve));
	const { change } = create(ui, async () => {
		await gate;
		return repo.create(value, 'h1', 1000);
	});
	let undo!: Promise<void>;
	act(() => {
		undo = ui.result.current.undo();
	});
	expect(ui.result.current.items).toHaveLength(0);
	await act(async () => {
		finish();
		await change;
		await undo;
	});
	expect(await repo.list(docId)).toEqual([]);
	expect(ui.result.current.notice?.phase).toBe('undone');
	expect(ui.result.current.canUndo).toBe(false);
	expect(ui.result.current.canRedo).toBe(true);
	await act(async () => void (await ui.result.current.redo()));
	expect((await repo.list(docId)).map(item => item.id)).toEqual(['h1']);
});

test('a failed write rolls back the optimistic mark and says so instead of claiming success', async () => {
	const ui = mount();
	const { change } = create(ui, () => Promise.reject(new Error('Quota exceeded')));
	await act(async () => void (await change));
	expect(ui.result.current.items).toHaveLength(0);
	expect(ui.result.current.notice?.phase).toBe('error');
	expect(ui.result.current.notice?.message).toContain('Quota exceeded');
	expect(ui.result.current.canUndo).toBe(false);
});

test('a transient Undo failure keeps the change undoable; a conflict is reported and not retried', async () => {
	const flaky = { apply: vi.fn(repo.apply) };
	const ui = mount(flaky);
	const { change } = create(ui);
	await act(async () => void (await change));
	await act(async () => void (await ui.sync()));
	flaky.apply.mockRejectedValueOnce(new Error('Database busy'));
	await act(async () => void (await ui.result.current.undo()));
	expect(ui.result.current.notice?.message).toContain('Database busy');
	expect(ui.result.current.canUndo).toBe(true);
	expect(ui.result.current.items).toHaveLength(1);
	// Someone adds a note meanwhile: undoing the creation would silently delete it.
	await repo.addNote('h1', 'Written after highlighting');
	await act(async () => void (await ui.result.current.undo()));
	expect(ui.result.current.notice?.message).toMatch(/Couldn't undo: This highlight changed/);
	expect(ui.result.current.canUndo).toBe(false);
	expect((await repo.list(docId)).map(item => item.id)).toEqual(['h1']);
	expect(await repo.notes(docId)).toHaveLength(1);
});

test('Undo of an earlier failed write is reported even when a newer highlight saves', async () => {
	const ui = mount();
	const first = create(ui, () => Promise.reject(new Error('First write failed')));
	let second!: Promise<unknown>;
	act(() => {
		second = ui.result.current.run(() => repo.create({ ...value, color: 'blue' }, 'h2', 2000), {
			overlay: { show: [{ ...value, color: 'blue', id: 'h2', createdAt: 2000 }], hide: [], restore: [] },
			saving: 'Saving highlight…',
			done: 'Highlight saved',
			undone: 'Highlight undone',
		});
	});
	await act(async () => {
		await first.change;
		await second;
	});
	expect(ui.result.current.items.map(item => item.color)).toEqual(['blue']);
	expect(ui.result.current.canUndo).toBe(true);
});

test('overlays replace and hide records in order', () => {
	const a: Highlight = { ...value, id: 'a', createdAt: 1 },
		b: Highlight = { ...value, id: 'b', createdAt: 2 };
	expect(
		applyOverlays(
			[a, b],
			[
				{ show: [{ ...a, color: 'blue' }], hide: ['b'], restore: [] },
				{ show: [], hide: ['a'], restore: [] },
			],
		),
	).toEqual([]);
	expect(applyOverlays([a], [{ show: [{ ...a, color: 'blue' }], hide: [], restore: [] }])[0].color).toBe('blue');
});

test('repository merge folds notes into the survivor; undo restores every record exactly', async () => {
	await repo.create({ ...value, color: 'yellow' }, 'old', 1);
	await repo.create(
		{ ...value, range: { start: 20, end: 40 }, anchor: { ...value.anchor, quote: 'later' } },
		'new',
		2,
	);
	await repo.addNote('new', 'Note on the later highlight');
	const before = { highlights: await repo.list(docId), notes: await repo.notes(docId) };
	const survivor: Highlight = { ...before.highlights[0], range: { start: 10, end: 40 }, color: 'blue' };
	const change = await repo.merge(survivor, ['new']);
	const merged = await repo.list(docId);
	expect(merged.map(item => [item.id, item.color, item.createdAt])).toEqual([['old', 'blue', 1]]);
	expect((await repo.notes(docId)).map(note => note.highlightId)).toEqual(['old']);
	await repo.apply(change.after, change.before);
	expect(await repo.list(docId)).toEqual(before.highlights);
	expect(await repo.notes(docId)).toEqual(before.notes);
	await expect(repo.apply(change.after, change.before)).rejects.toBeInstanceOf(ChangeConflictError);
});

test('restoring a deleted note is refused once its highlight is gone, so no orphan notes appear', async () => {
	await repo.create(value, 'h1', 1);
	const note = await repo.addNote('h1', 'Keep me');
	const deletion = await repo.deleteNote(note.id);
	await repo.removeHighlights(['h1']);
	await expect(repo.apply(deletion.after, deletion.before)).rejects.toBeInstanceOf(ChangeConflictError);
	expect(await repo.notes(docId)).toEqual([]);
});
