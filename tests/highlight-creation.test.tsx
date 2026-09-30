import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { Highlight } from '../src/domain/highlight';
import { useHighlightCreation } from '../src/features/highlights/useHighlightCreation';
import { highlights } from '../src/infrastructure/db/highlights';

const value: Omit<Highlight, 'id' | 'createdAt'> = {
	docId: 'paper',
	page: 1,
	rects: [[0.1, 0.2, 0.4, 0.03]],
	anchor: { quote: 'A selected passage', prefix: '', suffix: '' },
	color: 'green',
};
function fixture() {
	let resolve!: (record: Highlight) => void, reject!: (error: Error) => void;
	const write = new Promise<Highlight>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	const save = vi.fn(() => write),
		remove = vi.fn(async () => {});
	const repo = { ...highlights, save, remove };
	const ui = renderHook(({ saved }: { saved: Highlight[] }) => useHighlightCreation(saved, repo), {
		initialProps: { saved: [] as Highlight[] },
	});
	return { ...ui, save, remove, resolve, reject };
}
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

test('shows color immediately, keeps it until the live query catches up, and never duplicates the saved overlay', async () => {
	const ui = fixture();
	act(() => ui.result.current.create(value));
	const optimistic = ui.result.current.items[0];
	expect(optimistic.color).toBe('green');
	expect(ui.result.current.notice?.phase).toBe('saving');
	expect(ui.save.mock.calls[0][1]).toBe(optimistic.id);
	await act(async () => ui.resolve(optimistic));
	expect(ui.result.current.items).toHaveLength(1);
	expect(ui.result.current.notice?.phase).toBe('saved');
	ui.rerender({ saved: [optimistic] });
	expect(ui.result.current.items).toHaveLength(1);
});

test('Undo before persistence removes the overlay immediately and removes the eventual record', async () => {
	const ui = fixture();
	act(() => ui.result.current.create(value));
	const optimistic = ui.result.current.items[0];
	let undo!: Promise<void>;
	act(() => {
		undo = ui.result.current.undo();
	});
	expect(ui.result.current.items).toHaveLength(0);
	expect(ui.remove).not.toHaveBeenCalled();
	ui.rerender({ saved: [optimistic] });
	expect(ui.result.current.items).toHaveLength(0);
	await act(async () => {
		ui.resolve(optimistic);
		await undo;
	});
	expect(ui.remove).toHaveBeenCalledExactlyOnceWith(optimistic.id);
	expect(ui.result.current.notice?.phase).toBe('undone');
	expect(ui.result.current.canUndo).toBe(false);
});

test('a failed write rolls back the optimistic mark and reports failure instead of claiming it was saved', async () => {
	const ui = fixture();
	act(() => ui.result.current.create(value));
	await act(async () => ui.reject(new Error('Quota exceeded')));
	expect(ui.result.current.items).toHaveLength(0);
	expect(ui.result.current.notice?.message).toContain('Quota exceeded');
	expect(ui.result.current.canUndo).toBe(false);
});

test('failed Undo restores the visible record and supports retry', async () => {
	const ui = fixture();
	act(() => ui.result.current.create(value));
	const item = ui.result.current.items[0];
	await act(async () => ui.resolve(item));
	ui.rerender({ saved: [item] });
	ui.remove.mockRejectedValueOnce(new Error('Database busy'));
	await act(async () => ui.result.current.undo());
	expect(ui.result.current.items).toEqual([item]);
	expect(ui.result.current.canUndo).toBe(true);
	await act(async () => ui.result.current.undo());
	expect(ui.result.current.items).toHaveLength(0);
	expect(ui.remove).toHaveBeenCalledTimes(2);
});

test('a failed earlier write is reported even if a newer highlight saves successfully', async () => {
	const ui = fixture();
	act(() => ui.result.current.create(value));
	ui.save.mockImplementationOnce(async (next, id) => ({ ...next, id, createdAt: Date.now() }));
	await act(async () => ui.result.current.create({ ...value, color: 'blue' }));
	await act(async () => ui.reject(new Error('First write failed')));
	expect(ui.result.current.items).toHaveLength(1);
	expect(ui.result.current.items[0].color).toBe('blue');
	expect(ui.result.current.notice?.message).toContain('First write failed');
	expect(ui.result.current.canUndo).toBe(true);
});
