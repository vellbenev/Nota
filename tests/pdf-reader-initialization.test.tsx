import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import PdfReaderBoundary from '../src/features/reader/PdfReaderBoundary';
import { withTimeout } from '../src/features/reader/loadPdfViewport';

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

test('lazy viewer initialization rejects after its deadline and logs the failure', async () => {
	vi.useFakeTimers();
	const pending = new Promise<string>(() => {});
	const loading = withTimeout(pending, 30_000, 'Viewer timed out');
	const result = expect(loading).rejects.toThrow('Viewer timed out');
	await vi.advanceTimersByTimeAsync(30_000);
	await result;
});

test('reader boundary displays and logs a viewer initialization error', () => {
	const log = vi.spyOn(console, 'error').mockImplementation(() => {});
	function BrokenViewer(): never {
		throw new Error('Worker registration failed');
	}
	render(
		<PdfReaderBoundary>
			<BrokenViewer />
		</PdfReaderBoundary>,
	);
	expect(screen.getByRole('alert').textContent).toMatch(/Worker registration failed/);
	expect(log).toHaveBeenCalledWith('PDF reader initialization failed', expect.any(Error), expect.any(String));
});

