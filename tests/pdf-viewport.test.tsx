import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import PdfViewport from '../src/features/reader/PdfViewport';
import { database } from '../src/infrastructure/db/database';
import { createDocumentRepository } from '../src/infrastructure/db/documents';
import { highlights } from '../src/infrastructure/db/highlights';

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
			else if (!pdfLoad.hang)
				onLoadSuccess({
					numPages: 120,
					getPage: async (pageNumber: number) => ({
						pageNumber,
						view: [0, 0, 612, 792],
						getViewport: () => ({ width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] }),
					}),
				});
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
let viewportHeight = 600;
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
	vi.stubGlobal('PointerEvent', MouseEvent);
	pdfLoad.hang = false;
	pdfLoad.fail = false;
	viewportWidth = 800;
	viewportHeight = 600;
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
	vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => viewportHeight);
	vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => viewportHeight);
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
	fireEvent.click(await screen.findByRole('button', { name: 'Green highlight' }));
	fireEvent.click(screen.getByRole('button', { name: 'Highlight', exact: true }));
	// The chosen color is visible before the IndexedDB/live-query round trip.
	expect(ui.container.querySelectorAll('.highlight-mark.green')).toHaveLength(1);
	await screen.findByText('Highlight saved');
	fireEvent.click(screen.getByRole('button', { name: 'Undo highlight' }));
	expect(ui.container.querySelectorAll('.highlight-mark')).toHaveLength(0);
	await screen.findByText('Highlight undone');
	expect(await database.highlights.where('docId').equals(docId).count()).toBe(0);
	window.getSelection()!.addRange(range);
	fireEvent.pointerUp(screen.getByLabelText('PDF pages'));
	fireEvent.click(await screen.findByRole('button', { name: 'Highlight', exact: true }));
	await screen.findByText('Highlight saved');
	fireEvent.click(await screen.findByRole('button', { name: /Open saved highlight on page 1/ }));
	await screen.findByRole('combobox', { name: /Highlight color/ });
	fireEvent.change(screen.getByLabelText('Note for page 1'), { target: { value: 'My local note' } });
	fireEvent.submit(screen.getByLabelText('Note for page 1').closest('form')!);
	await screen.findByText('My local note');
	const editNote = await screen.findByRole('button', { name: 'Edit note' });
	await waitFor(() => expect(editNote.hasAttribute('disabled')).toBe(false));
	fireEvent.click(editNote);
	fireEvent.change(screen.getByLabelText('Edit note for page 1'), { target: { value: 'Revised local note' } });
	fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
	await waitFor(() => expect(screen.queryByLabelText('Edit note for page 1')).toBeNull());
	await screen.findByText('Revised local note');
	expect(onAssistantAction).not.toHaveBeenCalled();
	expect(fetchSpy).not.toHaveBeenCalled();
	ui.rerender(<PdfViewport key={other} docId={other} {...props} />);
	await waitFor(() => expect(ui.container.querySelectorAll('.highlight-mark')).toHaveLength(0));
	ui.rerender(<PdfViewport key={docId} docId={docId} {...props} />);
	await waitFor(() => expect(ui.container.querySelectorAll('.highlight-mark.green')).toHaveLength(1));
	const annotated = ui.container.querySelector('.annotated-page')!;
	vi.spyOn(annotated, 'getBoundingClientRect').mockReturnValue({
		left: 0,
		top: 0,
		width: 612,
		height: 792,
	} as DOMRect);
	// A drag over a saved mark must not open its editor.
	fireEvent.pointerDown(annotated, { clientX: 80, clientY: 105 });
	fireEvent.click(annotated, { clientX: 200, clientY: 105, detail: 1 });
	expect(screen.queryByRole('combobox', { name: /Highlight color/ })).toBeNull();
	// A normal pointer click opens the same editor as the keyboard target.
	fireEvent.pointerDown(annotated, { clientX: 80, clientY: 105 });
	fireEvent.click(annotated, { clientX: 80, clientY: 105, detail: 1 });
	expect(await screen.findByText('Revised local note')).toBeTruthy();
	fireEvent.click(screen.getByRole('combobox', { name: /Highlight color/ }));
	fireEvent.click(screen.getByRole('option', { name: 'Blue' }));
	await waitFor(() => expect(ui.container.querySelectorAll('.highlight-mark.blue')).toHaveLength(1));
	fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
	const stored = (await highlights.list(docId))[0];
	expect(onAssistantAction).toHaveBeenCalledExactlyOnceWith(
		{
			text: stored.anchor.quote,
			page: stored.page,
			rects: stored.rects,
			anchor: stored.anchor,
			rotation: stored.rotation,
		},
		'ask',
	);
	fireEvent.click(screen.getByText('Remove highlight'));
	fireEvent.click(screen.getByText('Confirm removal'));
	await waitFor(() => expect(ui.container.querySelectorAll('.highlight-mark')).toHaveLength(0));
	expect(await database.annotations.count()).toBe(0);
	expect(fetchSpy).not.toHaveBeenCalled();
	ui.unmount();
	await database.delete();
});

test('notes navigate to the exact highlight fraction on a virtualized, previously unmounted page', async () => {
	await database.open();
	const docId = 'e'.repeat(64);
	await createDocumentRepository(database).importDocument(new File(['pdf'], 'jump.pdf'), docId);
	await highlights.save({
		docId,
		page: 115,
		color: 'yellow',
		rects: [[0.1, 0.1, 0.4, 0.03]],
		anchor: { quote: 'Far down the paper', prefix: '', suffix: '' },
	});
	const onViewChange = vi.fn();
	const ui = render(
		<PdfViewport
			docId={docId}
			persistent
			blob={new Blob(['pdf'])}
			initialView={{ page: 1, offset: 0, zoom: 1 }}
			onViewChange={onViewChange}
			onPageCount={vi.fn()}
			onSelection={vi.fn()}
			onSelectionError={vi.fn()}
		/>,
	);
	await waitFor(() => expect(ui.container.querySelector('canvas[data-page="1"]')).not.toBeNull());
	fireEvent.click(screen.getByRole('button', { name: 'Highlights and notes' }));
	fireEvent.click(await screen.findByRole('button', { name: 'Go to highlight on page 115' }));
	await waitFor(() => expect(ui.container.querySelector('canvas[data-page="115"]')).not.toBeNull());
	await waitFor(() => expect(onViewChange.mock.lastCall?.[0].page).toBe(115));
	expect(onViewChange.mock.lastCall?.[0].offset).toBeCloseTo(0.79, 2);
	expect(ui.container.querySelector('.active-highlight')).not.toBeNull();
	const viewport = screen.getByLabelText('PDF pages');
	const scrollTop = viewport.scrollTop;
	fireEvent.change(screen.getByLabelText('Note for page 115'), { target: { value: 'A note far into the PDF' } });
	fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
	const edit = await screen.findByRole('button', { name: 'Edit note' });
	await waitFor(() => expect(edit.hasAttribute('disabled')).toBe(false));
	expect(viewport.scrollTop).toBe(scrollTop);
	expect(viewport.dataset.currentPage).toBe('115');
	fireEvent.click(edit);
	fireEvent.change(screen.getByLabelText('Edit note for page 115'), { target: { value: 'Revised deep-page note' } });
	fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
	await waitFor(() => expect(screen.queryByLabelText('Edit note for page 115')).toBeNull());
	expect(viewport.scrollTop).toBe(scrollTop);
	fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
	fireEvent.click(screen.getByRole('button', { name: 'Confirm note deletion' }));
	await waitFor(() => expect(screen.queryByText('Revised deep-page note')).toBeNull());
	expect(viewport.scrollTop).toBe(scrollTop);
	expect(viewport.dataset.currentPage).toBe('115');
	ui.unmount();
	await database.delete();
});

test('fit modes preserve deep reading position, respond to height, and return to manual zoom', async () => {
	const onViewChange = vi.fn();
	const { container } = render(
		<PdfViewport
			docId='fit-test'
			blob={new Blob(['pdf'])}
			initialView={{ page: 40, offset: 0.25, zoom: 1 }}
			onViewChange={onViewChange}
			onPageCount={vi.fn()}
			onSelection={vi.fn()}
			onSelectionError={vi.fn()}
		/>,
	);
	await waitFor(() => expect(container.querySelector('canvas[data-page="40"]')).not.toBeNull());
	fireEvent.click(screen.getByRole('combobox', { name: 'Zoom' }));
	fireEvent.click(screen.getByRole('option', { name: 'Fit page' }));
	await waitFor(() => expect(container.querySelector('canvas')?.width).toBe(426));
	await waitFor(() => expect(onViewChange.mock.lastCall?.[0]).toMatchObject({ page: 40, fit: 'page' }));
	expect(onViewChange.mock.lastCall?.[0].offset).toBeCloseTo(0.25, 2);
	await act(async () => {
		viewportHeight = 1000;
		callbacks.forEach(callback => callback([], {} as ResizeObserver));
	});
	await waitFor(() => expect(container.querySelector('canvas')?.width).toBe(735));
	fireEvent.click(screen.getByRole('combobox', { name: 'Zoom' }));
	fireEvent.click(screen.getByRole('option', { name: 'Fit width' }));
	await waitFor(() => expect(container.querySelector('canvas')?.width).toBe(752));
	await waitFor(() => expect(onViewChange.mock.lastCall?.[0].fit).toBe('width'));
	fireEvent.click(screen.getByRole('combobox', { name: 'Zoom' }));
	fireEvent.click(screen.getByRole('option', { name: '75%' }));
	await waitFor(() => expect(container.querySelector('canvas')?.width).toBe(564));
	await waitFor(() => expect(onViewChange.mock.lastCall?.[0]).toMatchObject({ page: 40, zoom: 0.75 }));
	expect(onViewChange.mock.lastCall?.[0].fit).toBeUndefined();
	expect(onViewChange.mock.lastCall?.[0].offset).toBeCloseTo(0.25, 2);
});

test('horizontal panning at high zoom preserves the page anchor and survives a viewport rerender', async () => {
	const onViewChange = vi.fn();
	const props = {
		docId: 'horizontal-test',
		blob: new Blob(['pdf']),
		initialView: { page: 80, offset: 0.37, zoom: 2 },
		onViewChange,
		onPageCount: vi.fn(),
		onSelection: vi.fn(),
		onSelectionError: vi.fn(),
	};
	const ui = render(<PdfViewport {...props} />);
	const scroll = await screen.findByLabelText('PDF pages');
	await waitFor(() => expect(onViewChange.mock.lastCall?.[0].page).toBe(80));
	scroll.scrollLeft = 700;
	fireEvent.scroll(scroll);
	expect(onViewChange.mock.lastCall?.[0].page).toBe(80);
	expect(onViewChange.mock.lastCall?.[0].offset).toBeCloseTo(0.37, 2);
	ui.rerender(<PdfViewport {...props} onViewChange={view => onViewChange(view)} />);
	expect(scroll.scrollLeft).toBe(700);
	fireEvent.change(screen.getByLabelText('Page'), { target: { value: '90' } });
	fireEvent.submit(screen.getByLabelText('Page').closest('form')!);
	await waitFor(() => expect(scroll.dataset.currentPage).toBe('90'));
	expect(scroll.scrollLeft).toBe(700);
	scroll.scrollLeft = 0;
	fireEvent.scroll(scroll);
	expect(onViewChange.mock.lastCall?.[0].page).toBe(90);
});
