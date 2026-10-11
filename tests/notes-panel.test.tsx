import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import type { Annotation, Highlight } from '../src/domain/highlight';
import NotesPanel from '../src/features/highlights/NotesPanel';
import { highlightAtPoint } from '../src/features/highlights/hitTest';
const item: Highlight = {
	id: 'a',
	docId: 'paper',
	page: 2,
	color: 'yellow',
	createdAt: 1,
	rects: [[0.1, 0.7, 0.2, 0.05]],
	anchor: { quote: 'First argument', prefix: '', suffix: '' },
};
const later: Highlight = {
	...item,
	id: 'b',
	page: 5,
	createdAt: 2,
	anchor: { ...item.anchor, quote: 'Second result' },
};
const note: Annotation = {
	id: 'note-a',
	highlightId: 'a',
	docId: 'paper',
	page: 2,
	text: 'A local thought فارسی',
	createdAt: 1,
};
function setup() {
	const actions = {
		onColor: vi.fn(async () => {}),
		onRemove: vi.fn(async () => {}),
		onAddNote: vi.fn(async () => {}),
		onUpdateNote: vi.fn(async () => {}),
		onRemoveNote: vi.fn(async () => {}),
		onAsk: vi.fn(),
		onExplain: vi.fn(),
		onJump: vi.fn(),
		onClose: vi.fn(),
	};
	function Fixture() {
		const [activeId, onSelect] = useState<string | null>(null);
		return (
			<NotesPanel
				open
				items={[later, item]}
				notes={[note]}
				activeId={activeId}
				onSelect={onSelect}
				{...actions}
			/>
		);
	}
	const ui = render(<Fixture />);
	return { ...ui, ...actions };
}
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	localStorage.clear();
});

test('searches both quotes and notes, orders by page or newest, and does not invoke AI on opening', () => {
	const ui = setup();
	const cards = () => screen.getAllByRole('button', { name: /Open highlight on page/ });
	expect(cards()[0].textContent).toBe('First argument');
	fireEvent.click(screen.getByRole('combobox', { name: 'Sort highlights' }));
	fireEvent.click(screen.getByRole('option', { name: 'Newest first' }));
	expect(cards()[0].textContent).toBe('Second result');
	fireEvent.change(screen.getByLabelText('Search highlights and notes'), { target: { value: 'فارسی' } });
	expect(cards()).toHaveLength(1);
	fireEvent.click(cards()[0]);
	expect(ui.onAsk).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
	expect(ui.onExplain).toHaveBeenCalledExactlyOnceWith(item);
	expect(ui.onAsk).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
	expect(ui.onAsk).toHaveBeenCalledExactlyOnceWith(item);
	fireEvent.click(screen.getByRole('button', { name: 'Go to highlight on page 2' }));
	expect(ui.onJump).toHaveBeenCalledExactlyOnceWith(item);
});

test('edits a note inline, deletes it without a confirmation (undo lives in the toast), and keeps a failed draft', async () => {
	const ui = setup();
	fireEvent.click(screen.getByRole('button', { name: /Open highlight on page 2/ }));
	fireEvent.click(screen.getByRole('button', { name: 'Edit note' }));
	fireEvent.change(screen.getByLabelText('Edit note for page 2'), { target: { value: 'Revised note' } });
	fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
	await waitFor(() => expect(ui.onUpdateNote).toHaveBeenCalledExactlyOnceWith('note-a', 'Revised note'));
	await waitFor(() => expect(screen.queryByLabelText('Edit note for page 2')).toBeNull());
	fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
	await waitFor(() => expect(ui.onRemoveNote).toHaveBeenCalledExactlyOnceWith('note-a'));
	expect(ui.onRemove).not.toHaveBeenCalled();
	await waitFor(() => expect(screen.queryByText('Saving…')).toBeNull());
	ui.onAddNote.mockRejectedValueOnce(new Error('Storage unavailable'));
	fireEvent.change(screen.getByLabelText('Note for page 2'), { target: { value: 'Keep this draft' } });
	fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
	await screen.findByText('Storage unavailable');
	expect((screen.getByLabelText('Note for page 2') as HTMLTextAreaElement).value).toBe('Keep this draft');
});

test('Cmd/Ctrl+Enter saves; Escape cancels an edit without closing the panel', async () => {
	const ui = setup();
	fireEvent.click(screen.getByRole('button', { name: /Open highlight on page 2/ }));
	const composer = screen.getByLabelText('Note for page 2');
	composer.focus();
	fireEvent.change(composer, { target: { value: 'Quick thought' } });
	fireEvent.keyDown(composer, { key: 'Enter', ctrlKey: true });
	await waitFor(() => expect(ui.onAddNote).toHaveBeenCalledExactlyOnceWith('a', 'Quick thought'));
	await waitFor(() => expect((screen.getByLabelText('Note for page 2') as HTMLTextAreaElement).value).toBe(''));
	// Saving never drops focus, so the next thought can be typed straight away.
	expect(document.activeElement).toBe(screen.getByLabelText('Note for page 2'));
	expect(screen.getByLabelText('Note for page 2').hasAttribute('disabled')).toBe(false);
	fireEvent.click(screen.getByRole('button', { name: 'Edit note' }));
	const editor = screen.getByLabelText('Edit note for page 2');
	fireEvent.change(editor, { target: { value: 'Abandoned edit' } });
	fireEvent.keyDown(editor, { key: 'Escape' });
	expect(screen.queryByLabelText('Edit note for page 2')).toBeNull();
	expect(ui.onClose).not.toHaveBeenCalled();
	expect(ui.onUpdateNote).not.toHaveBeenCalled();
	expect(screen.getByText('A local thought فارسی')).toBeTruthy();
});

test('note drafts survive switching highlights and remounting the panel', () => {
	const first = setup();
	fireEvent.click(screen.getByRole('button', { name: /Open highlight on page 2/ }));
	fireEvent.change(screen.getByLabelText('Note for page 2'), { target: { value: 'Unsent idea' } });
	fireEvent.click(screen.getByRole('button', { name: 'Edit note' }));
	fireEvent.change(screen.getByLabelText('Edit note for page 2'), { target: { value: 'Half-edited' } });
	fireEvent.click(screen.getByRole('button', { name: /Open highlight on page 5/ }));
	expect(screen.queryByLabelText('Note for page 2')).toBeNull();
	first.unmount();
	setup();
	fireEvent.click(screen.getByRole('button', { name: /Open highlight on page 2/ }));
	expect((screen.getByLabelText('Note for page 2') as HTMLTextAreaElement).value).toBe('Unsent idea');
	expect((screen.getByLabelText('Edit note for page 2') as HTMLTextAreaElement).value).toBe('Half-edited');
	fireEvent.click(screen.getByRole('button', { name: 'Cancel edit' }));
	expect(screen.getByText('A local thought فارسی')).toBeTruthy();
});

test('removing a highlight and changing its color are single actions', async () => {
	const ui = setup();
	fireEvent.click(screen.getByRole('button', { name: /Open highlight on page 2/ }));
	expect(screen.getByRole('button', { name: 'Yellow' }).getAttribute('aria-pressed')).toBe('true');
	fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
	await waitFor(() => expect(ui.onColor).toHaveBeenCalledExactlyOnceWith('a', 'blue'));
	fireEvent.click(screen.getByRole('button', { name: 'Remove highlight' }));
	await waitFor(() => expect(ui.onRemove).toHaveBeenCalledExactlyOnceWith('a'));
});

test('counts are pluralized and the empty state explains how to start', () => {
	render(
		<NotesPanel
			open
			items={[]}
			notes={[]}
			activeId={null}
			onSelect={vi.fn()}
			onJump={vi.fn()}
			onClose={vi.fn()}
			onColor={vi.fn()}
			onRemove={vi.fn()}
			onAddNote={vi.fn()}
			onUpdateNote={vi.fn()}
			onRemoveNote={vi.fn()}
			onAsk={vi.fn()}
			onExplain={vi.fn()}
		/>,
	);
	expect(screen.getByText('0 highlights · 0 notes')).toBeTruthy();
	expect(screen.getByText('No highlights yet.')).toBeTruthy();
	cleanup();
	setup();
	expect(screen.getByText('2 highlights · 1 note')).toBeTruthy();
	expect(screen.getByText('1 note')).toBeTruthy();
});

test('hit testing uses transformed page geometry, respects gaps, and prefers the latest overlapping highlight', () => {
	const geometry = { box: [0, 0, 100, 100], transform: [1, 0, 0, -1, 0, 100], width: 100, height: 100 };
	const box = { left: 100, top: 200, width: 200, height: 200 };
	expect(highlightAtPoint([item], geometry, box, 130, 255)?.id).toBe('a');
	expect(highlightAtPoint([item], geometry, box, 180, 255)).toBeUndefined();
	expect(highlightAtPoint([item, later], geometry, box, 130, 255)?.id).toBe('b');
});
