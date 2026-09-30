import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import PdfViewport from '../src/features/reader/PdfViewport';
import { database } from '../src/infrastructure/db/database';
import { createDocumentRepository } from '../src/infrastructure/db/documents';

const pdfLoad = vi.hoisted(() => ({ hang: false, fail: false }));

// Keep the actual viewport + TanStack Virtual lifecycle. PDF.js canvas drawing
// is replaced with a counted canvas so jsdom can verify the mounted page window.
vi.mock('react-pdf', () => ({
	pdfjs: { GlobalWorkerOptions: {} },
	Document: ({
		children,
		loading,
		onLoadSuccess,
		onLoadError,
		suspense,
	}: {
		children: ReactNode;
		loading: ReactNode;
		onLoadSuccess: (pdf: object) => void;
		onLoadError: (error: Error) => void;
		suspense: boolean;
	}) => {
		useEffect(() => {
			if (pdfLoad.fail) onLoadError(new Error('Worker could not start'));
			else if (!pdfLoad.hang) onLoadSuccess({ numPages: 120 });
		}, []);
		return (
			<div className='react-pdf__Document' data-suspense={String(suspense)}>
				{pdfLoad.hang ? loading : children}
			</div>
		);
	},
	Page: ({
		pageNumber,
		width,
		onLoadSuccess,
	}: {
		pageNumber: number;
		width: number;
		onLoadSuccess: (page: object) => void;
	}) => {
		useEffect(() => {
			onLoadSuccess({
				pageNumber,
				view: [0, 0, 612, 792],
				getViewport: () => ({ width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] }),
			});
		}, [pageNumber]);
		return (
			<div>
				<canvas data-page={pageNumber} width={width} height={(width * 792) / 612} />
				<div className='react-pdf__Page__textContent'>
					<span>Before English فارسی after</span>
				</div>
			</div>
		);
	},
}));

let viewportWidth = 800;
const callbacks = new Set<ResizeObserverCallback>();
class ResizeObserverStub {
	callback: ResizeObserverCallback;
	constructor(callback: ResizeObserverCallback) {
		this.callback = callback;
	}
	observe() {
		callbacks.add(this.callback);
	}
	unobserve() {
		callbacks.delete(this.callback);
	}
	disconnect() {
		callbacks.delete(this.callback);
	}
}

beforeEach(() => {
	pdfLoad.hang = false;
	pdfLoad.fail = false;
	viewportWidth = 800;
	vi.stubGlobal('ResizeObserver', ResizeObserverStub);
	vi.stubGlobal(
		'URL',
		class extends URL {
			static createObjectURL = vi.fn(() => 'blob:test-pdf');
			static revokeObjectURL = vi.fn();
		},
	);
	vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => viewportWidth);
	vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => viewportWidth);
	vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
	vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
	vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function () {
		return Number.parseFloat((this.querySelector('.virtual-pages') as HTMLElement | null)?.style.height || '600');
	});
	HTMLElement.prototype.scrollTo = function (options: ScrollToOptions | number) {
		if (typeof options !== 'number')
			this.scrollTop = Math.floor(Math.min(this.scrollHeight - this.clientHeight, options.top || 0));
		queueMicrotask(() => this.dispatchEvent(new Event('scroll')));
	};
});
afterEach(() => {
	cleanup();
	callbacks.clear();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

test('a stalled PDF engine shows a bounded error instead of loading forever', () => {
	pdfLoad.hang = true;
	const log = vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.useFakeTimers();
	render(
		<PdfViewport
			blob={new Blob(['pdf'])}
			initialView={{ page: 1, offset: 0, zoom: 1 }}
			onViewChange={vi.fn()}
			onPageCount={vi.fn()}
			onSelection={vi.fn()}
			onSelectionError={vi.fn()}
		/>,
	);
	expect(screen.getByText('Opening PDF…')).toBeTruthy();
	expect(document.querySelector('.react-pdf__Document')?.getAttribute('data-suspense')).toBe('false');
	act(() => {
		vi.advanceTimersByTime(45_000);
	});
	expect(screen.getByRole('alert').textContent).toMatch(/Opening this PDF took too long/);
	expect(screen.queryByText('Opening PDF…')).toBeNull();
	expect(log).toHaveBeenCalled();
});

test('a rejected PDF worker load appears in the reader and console', () => {
	pdfLoad.fail = true;
	const log = vi.spyOn(console, 'error').mockImplementation(() => {});
	render(
		<PdfViewport
			blob={new Blob(['pdf'])}
			initialView={{ page: 1, offset: 0, zoom: 1 }}
			onViewChange={vi.fn()}
			onPageCount={vi.fn()}
			onSelection={vi.fn()}
			onSelectionError={vi.fn()}
		/>,
	);
	expect(screen.getByRole('alert').textContent).toMatch(/Worker could not start/);
	expect(log).toHaveBeenCalledWith(expect.stringContaining('Worker could not start'), expect.any(Error));
});

test('120 pages mount only nearby canvases, restore a deep page, and preserve zoom/resize anchor', async () => {
	const onViewChange = vi.fn();
	const { container, unmount } = render(
		<PdfViewport
			blob={new Blob(['pdf'])}
			initialView={{ page: 80, offset: 0.37, zoom: 1 }}
			onViewChange={onViewChange}
			onPageCount={vi.fn()}
			onSelection={vi.fn()}
			onSelectionError={vi.fn()}
		/>,
	);
	const viewport = await screen.findByLabelText('PDF pages');
	await waitFor(() => expect(container.querySelector('canvas[data-page="80"]')).not.toBeNull());
	await waitFor(() => expect(onViewChange).toHaveBeenCalled());
	expect(container.querySelectorAll('canvas').length).toBeLessThanOrEqual(5);
	expect(viewport.dataset.currentPage).toBe('80');
	fireEvent.click(screen.getByRole('combobox', { name: 'Zoom' }));
	fireEvent.click(screen.getByRole('option', { name: '150%' }));
	await waitFor(() => expect(onViewChange.mock.lastCall?.[0].zoom).toBe(1.5));
	expect(onViewChange.mock.lastCall?.[0].page).toBe(80);
	expect(onViewChange.mock.lastCall?.[0].offset).toBeCloseTo(0.37, 2);
	await act(async () => {
		viewportWidth = 640;
		callbacks.forEach(callback => callback([], {} as ResizeObserver));
	});
	await waitFor(() => expect(container.querySelector('canvas')?.width).toBe(888));
	expect(onViewChange.mock.lastCall?.[0].page).toBe(80);
	expect(onViewChange.mock.lastCall?.[0].offset).toBeCloseTo(0.37, 2);
	fireEvent.change(screen.getByLabelText('Page'), { target: { value: '115' } });
	fireEvent.submit(screen.getByLabelText('Page').closest('form')!);
	await waitFor(() => expect(container.querySelector('canvas[data-page="115"]')).not.toBeNull());
	expect(viewport.dataset.currentPage).toBe('115');
	expect(container.querySelector('canvas[data-page="80"]')).toBeNull();
	expect(container.querySelectorAll('canvas').length).toBeLessThanOrEqual(5);
	unmount();
	expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-pdf');
	expect(container.querySelectorAll('canvas')).toHaveLength(0);
});

test('selection → highlight → local note → switch and remount persists, with no fetch', async () => {
	const docId = 'c'.repeat(64),
		other = 'd'.repeat(64);
	const docs = createDocumentRepository(database);
	await docs.importDocument(new File(['pdf'], 'paper.pdf'), docId);
	await docs.importDocument(new File(['other'], 'other.pdf'), other);
	const fetchSpy = vi.fn(() => {
		throw new Error('Unexpected network request');
	});
	vi.stubGlobal('fetch', fetchSpy);
	const onAssistantAction = vi.fn();
	const props = {
		blob: new Blob(['pdf']),
		persistent: true,
		initialView: { page: 1, offset: 0, zoom: 1 },
		onViewChange: vi.fn(),
		onPageCount: vi.fn(),
		onSelection: vi.fn(),
		onSelectionError: vi.fn(),
		onAssistantAction,
	};
	const ui = render(<PdfViewport key={docId} docId={docId} {...props} />);
	await waitFor(() => expect(ui.container.querySelector('.react-pdf__Page__textContent span')).not.toBeNull());
	await act(async () => {
		await new Promise(resolve => requestAnimationFrame(resolve));
	});
	const layer = ui.container.querySelector('.react-pdf__Page__textContent')!;
	vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 612, height: 792 } as DOMRect);
	const range = document.createRange();
	range.setStart(layer.firstChild!.firstChild!, 7);
	range.setEnd(layer.firstChild!.firstChild!, 20);
	Object.defineProperty(Range.prototype, 'getClientRects', {
		configurable: true,
		value: () => [{ left: 70, top: 100, width: 120, height: 14 }],
	});
	Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
		configurable: true,
		value: () => ({ left: 70, top: 100, width: 120, height: 14 }),
	});
	window.getSelection()!.removeAllRanges();
	window.getSelection()!.addRange(range);
	fireEvent.pointerUp(screen.getByLabelText('PDF pages'));
	fireEvent.click(await screen.findByRole('button', { name: 'Highlight', exact: true }));
	await waitFor(() => expect(ui.container.querySelectorAll('.highlight-mark')).toHaveLength(1));
	fireEvent.click(screen.getByRole('combobox', { name: /Highlight color/ }));
	fireEvent.click(screen.getByRole('option', { name: 'Green' }));
	fireEvent.change(screen.getByLabelText('Note for page 1'), { target: { value: 'My local note' } });
	fireEvent.submit(screen.getByLabelText('Note for page 1').closest('form')!);
	await screen.findByText('My local note');
	expect(onAssistantAction).not.toHaveBeenCalled();
	expect(fetchSpy).not.toHaveBeenCalled();
	ui.rerender(<PdfViewport key={other} docId={other} {...props} />);
	await waitFor(() => expect(ui.container.querySelectorAll('.highlight-mark')).toHaveLength(0));
	ui.rerender(<PdfViewport key={docId} docId={docId} {...props} />);
	await waitFor(() => expect(ui.container.querySelectorAll('.highlight-mark.green')).toHaveLength(1));
	expect(screen.getByText('My local note')).toBeTruthy();
	fireEvent.click(screen.getByText('Remove highlight'));
	await waitFor(() => expect(ui.container.querySelectorAll('.highlight-mark')).toHaveLength(0));
	expect(await database.annotations.count()).toBe(0);
	expect(fetchSpy).not.toHaveBeenCalled();
	ui.unmount();
	await database.delete();
});

