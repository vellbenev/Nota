import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import type { DocumentSummary } from '../src/domain/document';
import MascotView from '../src/features/mascot/MascotView';
import DataControls from '../src/features/settings/DataControls';
vi.mock('../src/features/mascot/RiveMascot', () => ({
	default: ({ src, onFailure, onReady }: { src: string; onFailure: () => void; onReady: () => void }) => {
		useEffect(() => {
			if (src.includes('broken')) onFailure();
			else onReady();
		}, []);
		return <span data-testid='rive-view' />;
	},
}));
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
test('SVG mascot responds to state and honors reduced motion without loading Rive', () => {
	vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
	const ui = render(<MascotView status='queued' asset='/mascot/nota.riv' />);
	expect(screen.getByRole('status').textContent).toBe('Pondering');
	expect(ui.container.querySelector('.reduced-motion svg')).not.toBeNull();
	expect(screen.queryByTestId('rive-view')).toBeNull();
	ui.rerender(<MascotView status='streaming' />);
	expect(screen.getByText('Explaining')).toBeTruthy();
	ui.rerender(<MascotView status='error' />);
	expect(screen.getByText('Needs attention')).toBeTruthy();
});
test('optional Rive load failure leaves a visible accessible SVG fallback', async () => {
	const ui = render(<MascotView status='idle' asset='/mascot/broken.riv' />);
	await waitFor(() => expect(ui.container.querySelector('.nota-mascot')).not.toBeNull());
	await waitFor(() => expect(screen.queryByTestId('rive-view')).toBeNull());
	expect(screen.getByText('Ready to help')).toBeTruthy();
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
	fireEvent.click(screen.getByRole('combobox', { name: 'Document to delete' }));
	fireEvent.click(screen.getByRole('option', { name: 'مقاله English.pdf' }));
	fireEvent.click(screen.getByText('Delete document data'));
	expect(onDelete).not.toHaveBeenCalled();
	expect(document.activeElement?.textContent).toBe('Cancel');
	fireEvent(ui.container.querySelector('dialog')!, new Event('cancel'));
	expect(onDelete).not.toHaveBeenCalled();
	fireEvent.click(screen.getByText('Delete document data'));
	fireEvent.click(screen.getByText('Confirm deletion'));
	await waitFor(() => expect(onDelete).toHaveBeenCalledWith('a'));
	await waitFor(() => expect(ui.container.querySelector('dialog')?.open).toBe(false));
	fireEvent.click(screen.getByText('Reset all Nota data'));
	fireEvent.click(screen.getByText('Confirm deletion'));
	await waitFor(() => expect(onDelete).toHaveBeenCalledWith(undefined));
});

