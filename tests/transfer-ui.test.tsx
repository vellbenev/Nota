import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { DocumentSummary } from '../src/domain/document';
import TransferControls from '../src/features/library/TransferControls';
const boundary = vi.hoisted(() => ({ prepare: vi.fn(), download: vi.fn() }));
vi.mock('../src/features/library/transfer', async importOriginal => ({
	...(await importOriginal<object>()),
	prepareBackup: boundary.prepare,
	downloadFile: boundary.download,
}));
const prepared = { documents: [{}], highlights: [{}, {}], notes: [{}] };
const docs = [{ docId: 'paper', name: 'Research.pdf' }] as DocumentSummary[];
beforeEach(() => {
	boundary.prepare.mockReset().mockResolvedValue(prepared);
	boundary.download.mockReset();
	Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
		configurable: true,
		value: function (this: HTMLDialogElement) {
			this.setAttribute('open', '');
		},
	});
	Object.defineProperty(HTMLDialogElement.prototype, 'close', {
		configurable: true,
		value: function (this: HTMLDialogElement) {
			this.removeAttribute('open');
		},
	});
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});
function fixture() {
	const actions = {
		markdown: vi.fn(async () => new Blob(['notes'])),
		backup: vi.fn(async () => new Blob(['backup'])),
		restore: vi.fn(async () => ({ documents: 1, highlights: 2, notes: 1 })),
	};
	const busy = vi.fn();
	render(
		<TransferControls
			documents={docs}
			activeDocId='paper'
			disabled={false}
			actions={actions}
			onBusyChange={busy}
		/>,
	);
	return { actions, busy };
}
test('exports the selected paper or all papers and downloads the library separately', async () => {
	const { actions } = fixture();
	fireEvent.click(screen.getByRole('button', { name: 'Export notes · Markdown' }));
	await screen.findByText('Markdown export downloaded.');
	expect(actions.markdown).toHaveBeenCalledWith('paper');
	fireEvent.click(screen.getByRole('combobox', { name: 'Paper to export' }));
	fireEvent.click(screen.getByRole('option', { name: 'All saved papers' }));
	fireEvent.click(screen.getByRole('button', { name: 'Export notes · Markdown' }));
	await waitFor(() => expect(actions.markdown).toHaveBeenLastCalledWith(undefined));
	await waitFor(() =>
		expect(screen.getByRole('button', { name: 'Back up library' }).hasAttribute('disabled')).toBe(false),
	);
	fireEvent.click(screen.getByRole('button', { name: 'Back up library' }));
	await screen.findByText('Library backup downloaded.');
	expect(actions.backup).toHaveBeenCalledTimes(1);
	expect(boundary.download.mock.calls.map(call => call[1])).toEqual([
		'nota-research-notes.md',
		'nota-research-notes.md',
		expect.stringMatching(/^nota-library-.*\.json$/),
	]);
});
test('validates and previews before restore; cancelling writes nothing and repeat clicks submit once', async () => {
	const { actions } = fixture();
	const input = screen.getByLabelText('Nota backup file');
	fireEvent.change(input, { target: { files: [new File(['backup'], 'library.json')] } });
	await screen.findByText('1 PDFs · 2 highlights · 1 notes');
	expect(actions.restore).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
	expect(screen.queryByRole('dialog')).toBeNull();
	expect(actions.restore).not.toHaveBeenCalled();
	fireEvent.change(input, { target: { files: [new File(['backup'], 'library.json')] } });
	await screen.findByRole('dialog');
	await act(async () => {
		fireEvent.click(screen.getByRole('button', { name: 'Restore library' }));
		fireEvent.click(screen.getByRole('button', { name: /Restore library/ }));
	});
	expect(actions.restore).toHaveBeenCalledTimes(1);
	expect(actions.restore).toHaveBeenCalledWith(prepared);
	await screen.findByText(/Imported 1 PDFs, 2 highlights and 1 notes/);
});
test('invalid backups report an error without a restore preview or write', async () => {
	boundary.prepare.mockRejectedValueOnce(new Error('Damaged PDF. Nothing was imported.'));
	const { actions, busy } = fixture();
	fireEvent.change(screen.getByLabelText('Nota backup file'), {
		target: { files: [new File(['bad'], 'library.json')] },
	});
	await screen.findByRole('alert');
	expect(actions.restore).not.toHaveBeenCalled();
	expect(screen.queryByRole('dialog')).toBeNull();
	expect(busy.mock.calls.map(call => call[0])).toEqual([true, false]);
});
