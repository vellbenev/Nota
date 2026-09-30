import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import type { DocumentSummary } from '../src/domain/document';
import MascotView from '../src/features/mascot/MascotView';
import DataControls from '../src/features/settings/DataControls';
const mascotLoad = vi.hoisted(() => ({ recover: false }));
vi.mock('../src/features/mascot/RiveMascot', () => ({
	default: ({ src, onFailure, onReady }: { src: string; onFailure: () => void; onReady: () => void }) => {
		useEffect(() => {
			if (src.includes('broken') && !mascotLoad.recover) onFailure();
			else if (!src.includes('pending')) onReady();
		}, []);
		return <span data-testid='rive-view' />;
	},
}));
afterEach(() => {
	cleanup();
	mascotLoad.recover = false;
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
test('reduced motion uses a neutral placeholder without loading a static character or Rive', () => {
	vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
	const ui = render(<MascotView status='queued' asset='/mascot/nota.riv' />);
	expect(screen.getByRole('status').textContent).toBe('Pondering');
	expect(ui.container.querySelector('svg')).toBeNull();
	expect(screen.getByText('Animation paused')).toBeTruthy();
	expect(screen.queryByTestId('rive-view')).toBeNull();
	ui.rerender(<MascotView status='streaming' />);
	expect(screen.getByText('Explaining')).toBeTruthy();
	ui.rerender(<MascotView status='error' />);
	expect(screen.getByText('Needs attention')).toBeTruthy();
});
test('Rive load failure shows a minimal retry control and never the retired character', async () => {
	const ui = render(<MascotView status='idle' asset='/mascot/broken.riv' />);
	await screen.findByRole('button', { name: 'Retry mascot animation' });
	expect(ui.container.querySelector('svg')).toBeNull();
	expect(screen.getByText('Animation unavailable')).toBeTruthy();
	await waitFor(() => expect(screen.queryByTestId('rive-view')).toBeNull());
	expect(screen.getByText('Ready to help')).toBeTruthy();
	mascotLoad.recover = true;
	fireEvent.click(screen.getByRole('button', { name: 'Retry mascot animation' }));
	await screen.findByText('Companion ready');
	expect(screen.queryByRole('button', { name: 'Retry mascot animation' })).toBeNull();
});
test('pending animation keeps a minimal loader until ready without flashing a static mascot', async () => {
	const ui = render(<MascotView status='idle' asset='/mascot/pending.riv' />);
	await screen.findByTestId('rive-view');
	expect(screen.getByText('Loading companion…')).toBeTruthy();
	expect(ui.container.querySelector('svg')).toBeNull();
	ui.rerender(<MascotView status='idle' asset='/mascot/nota.riv' />);
	await screen.findByText('Companion ready');
	expect(screen.queryByText('Loading companion…')).toBeNull();
});

test('data controls require explicit confirmation and Cancel/Escape do not delete', async () => {
	HTMLDialogElement.prototype.showModal = function () {
		this.open = true;
	};
	HTMLDialogElement.prototype.close = function () {
		this.open = false;
	};
	const onDelete = vi.fn(async () => true);
	const ui = render(
		<DataControls
			documents={[{ docId: 'a', name: 'مقاله English.pdf' } as DocumentSummary]}
			busy={false}
			onDelete={onDelete}
		/>,
	);
	fireEvent.click(screen.getByRole('button', { name: 'Data & privacy' }));
	fireEvent.click(screen.getByRole('combobox', { name: 'Document to delete' }));
	fireEvent.click(screen.getByRole('option', { name: 'مقاله English.pdf' }));
	fireEvent.click(screen.getByText('Delete document data'));
	expect(onDelete).not.toHaveBeenCalled();
	expect(document.activeElement?.textContent).toBe('Cancel');
	fireEvent(document.querySelector('dialog')!, new Event('cancel'));
	expect(onDelete).not.toHaveBeenCalled();
	fireEvent.click(screen.getByText('Delete document data'));
	fireEvent.click(screen.getByText('Confirm deletion'));
	await waitFor(() => expect(onDelete).toHaveBeenCalledWith('a'));
	await waitFor(() => expect(document.querySelector('dialog')?.open).toBe(false));
	fireEvent.click(screen.getByText('Reset all Nota data'));
	fireEvent.click(screen.getByText('Confirm deletion'));
	await waitFor(() => expect(onDelete).toHaveBeenCalledWith(undefined));
});
