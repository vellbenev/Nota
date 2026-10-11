import { useVirtualizer } from '@tanstack/react-virtual';
import { liveQuery } from 'dexie';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { ScrollArea } from '../../components/ui';
import { normalizeView, type ReaderView } from '../../domain/document.ts';
import { isHighlightColor, type Annotation, type Highlight, type HighlightColor } from '../../domain/highlight';
import { highlights } from '../../infrastructure/db/highlights';
import { normalizeClientRects, projectRect, type PageGeometry } from '../../infrastructure/pdf/geometry';
import type { SelectedSnip } from '../../infrastructure/pdf/snip';
import HighlightOverlay from '../highlights/HighlightOverlay';
import { highlightAtPoint } from '../highlights/hitTest';
import HighlightToast from '../highlights/HighlightToast';
import NotesPanel from '../highlights/NotesPanel';
import { overlappingHighlights, planHighlight, type Layout } from '../highlights/planning';
import { useHighlightHistory, type Overlay } from '../highlights/useHighlightHistory';
import { downloadFile, libraryTransfer } from '../library/transfer';
import {
	DEFAULT_PAGE,
	fitPageWidth,
	offsetForView,
	pageLayout,
	viewAtOffset,
	type PageDimensions,
} from './geometry.ts';
import { anchorFor, domRange, pageText, rangeContains, TEXT_LAYER } from './pageText';
import viewport from './PdfViewport.module.css';
import ReaderToolbar from './ReaderToolbar';
import type { TextSelection } from './selection.ts';
import SnipOverlay from './SnipOverlay';
import TextSelectionMenu, { type SelectionAction } from './TextSelectionMenu';
import { usePdfSelection } from './usePdfSelection';

// Vite resolves this asset URL in both dev and production, using the local worker
// from the same PDF.js package and version as React-PDF. The legacy worker build carries
// its own polyfills, so PDFs open in browsers without the newest built-ins.
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

const DOCUMENT_LOAD_TIMEOUT_MS = 45_000;
const failureMessage = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));
const COLOR_KEY = 'nota:highlight-color';
function storedColor(): HighlightColor {
	try {
		const value = window.localStorage.getItem(COLOR_KEY);
		return isHighlightColor(value) ? value : 'yellow';
	} catch {
		return 'yellow';
	}
}
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
const isEditable = (target: EventTarget | null) =>
	target instanceof Element &&
	!!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');

interface Props {
	onSnip?: (snip: Omit<SelectedSnip, 'docId'>) => void;
	docId?: string;
	persistent?: boolean;
	onAssistantAction?: (selection: TextSelection, action: 'translate' | 'explain' | 'ask') => void;
	blob: Blob;
	initialView: ReaderView;
	onViewChange: (view: ReaderView) => void;
	onPageCount: (count: number) => void;
	onSelection: (selection: TextSelection | null) => void;
	onSelectionError: (message: string) => void;
	controlsHost?: HTMLElement | null;
}

export default function PdfViewport(props: Props) {
	const [url, setUrl] = useState<string>();
	const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
	const [error, setError] = useState('');

	const fail = useCallback((message: string, failure?: unknown) => {
		console.error(message, failure);
		setError(message);
	}, []);

	useEffect(() => {
		try {
			const objectUrl = URL.createObjectURL(props.blob);
			setUrl(objectUrl);
			setPdf(null);
			setError('');
			return () => URL.revokeObjectURL(objectUrl);
		} catch (failure) {
			fail(`Could not prepare this PDF: ${failureMessage(failure)}`, failure);
		}
	}, [props.blob, fail]);

	useEffect(() => {
		if (!url || pdf || error) return;
		const timer = window.setTimeout(
			() => fail('Opening this PDF took too long. Please reload and try again.'),
			DOCUMENT_LOAD_TIMEOUT_MS,
		);
		return () => window.clearTimeout(timer);
	}, [url, pdf, error, fail]);

	return (
		<div className={`pdf-document ${viewport.document}`}>
			{error && (
				<p className={`reader-error ${viewport.inlineError}`} role='alert'>
					{error}
				</p>
			)}
			{url && !error && (
				<Document
					file={url}
					suspense={false}
					onLoadSuccess={loaded => {
						setPdf(loaded);
						props.onPageCount(loaded.numPages);
						setError('');
					}}
					onSourceError={failure =>
						fail(`Could not read this PDF: ${failureMessage(failure)}. Try another file.`, failure)
					}
					onLoadError={failure =>
						fail(`Could not open this PDF: ${failureMessage(failure)}. Try another file.`, failure)
					}
					onPassword={() => fail('This PDF requires a password. Open an unlocked copy to read it in Nota.')}
					loading={
						<p className='reader-message' role='status'>
							Opening PDF…
						</p>
					}
					error={null}
				>
					{pdf && <VirtualPages {...props} pdf={pdf} />}
				</Document>
			)}
		</div>
	);
}

function VirtualPages({
	pdf,
	onSnip,
	docId,
	persistent = false,
	onAssistantAction,
	initialView,
	onViewChange,
	onSelection,
	onSelectionError,
	controlsHost,
}: Props & { pdf: PDFDocumentProxy }) {
	const [snipMode, setSnipMode] = useState(false);
	const [snipPage, setSnipPage] = useState<number | null>(null);
	const [saved, setSaved] = useState<Highlight[]>([]);
	const [notes, setNotes] = useState<Annotation[]>([]);
	const [localError, setLocalError] = useState('');
	const [notesOpen, setNotesOpen] = useState(false);
	const [activeHighlight, setActiveHighlight] = useState<string | null>(null);
	const [composeRequest, setComposeRequest] = useState<{ id: string; nonce: number } | null>(null);
	const pointerStart = useRef<{ x: number; y: number } | null>(null);
	const jumpSequence = useRef(0);
	useEffect(
		() => () => {
			jumpSequence.current++;
		},
		[],
	);
	const [highlightColor, setHighlightColorState] = useState<HighlightColor>(storedColor);
	const setHighlightColor = (color: HighlightColor) => {
		setHighlightColorState(color);
		try {
			window.localStorage.setItem(COLOR_KEY, color);
		} catch {
			// Remembering the last color is a convenience only.
		}
	};
	const geometries = useRef(new Map<number, PageGeometry>());
	const [, setGeometryRevision] = useState(0);
	const scrollRef = useRef<HTMLDivElement>(null);
	const { selected, dismiss } = usePdfSelection({
		root: scrollRef,
		geometries,
		enabled: !snipMode,
		onSelection,
		onError: onSelectionError,
		onEscape: () => {
			setSnipMode(false);
			setSnipPage(null);
		},
	});
	const history = useHighlightHistory(saved);
	useEffect(() => {
		if (!docId || !persistent) return;
		const subscription = liveQuery(async () => ({
			items: await highlights.list(docId),
			notes: await highlights.notes(docId),
		})).subscribe({
			next: value => {
				setSaved(value.items);
				setNotes(value.notes);
			},
			error: error => setLocalError(String(error)),
		});
		return () => subscription.unsubscribe();
	}, [docId, persistent]);
	function openHighlight(item: Highlight, compose = false) {
		dismiss(true);
		setActiveHighlight(item.id);
		setNotesOpen(true);
		if (compose) setComposeRequest(previous => ({ id: item.id, nonce: (previous?.nonce ?? 0) + 1 }));
	}
	useEffect(() => {
		if (activeHighlight && !history.items.some(item => item.id === activeHighlight)) setActiveHighlight(null);
	}, [history.items, activeHighlight]);

	/** The page's live text layer: its readable text and a way to lay out any range of it. */
	function pageContext(page: number) {
		const layer = scrollRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${page}"] ${TEXT_LAYER}`);
		const geometry = geometries.current.get(page);
		const text = layer ? pageText(layer) : null;
		const layout: Layout = range => {
			if (!layer || !geometry || text === null) return null;
			const dom = domRange(layer, range);
			if (!dom) return null;
			const rects = normalizeClientRects(
				Array.from(dom.getClientRects()),
				layer.getBoundingClientRect(),
				geometry,
			);
			return rects.length ? { rects, anchor: anchorFor(text, range) } : null;
		};
		return { text, layout };
	}
	const selectionState = useMemo(() => {
		if (!selected?.range) return { overlaps: [], currentColor: undefined };
		const overlaps = overlappingHighlights(selected, history.items, pageContext(selected.page).text);
		const inside = overlaps.length === 1 && rangeContains(overlaps[0].range, selected.range);
		return { overlaps, currentColor: inside ? overlaps[0].item.color : undefined };
	}, [selected, history.items]);

	const notesFor = (ids: string[]) => notes.filter(note => ids.includes(note.highlightId)).length;
	function removeHighlights(items: Highlight[]) {
		const ids = items.map(item => item.id);
		const count = notesFor(ids);
		return history.run(() => highlights.removeHighlights(ids), {
			overlay: { show: [], hide: ids, restore: items },
			saving: 'Removing highlight…',
			done: count ? `Highlight and ${plural(count, 'note')} removed` : 'Highlight removed',
			undone: 'Highlight restored',
		});
	}
	function recolor(items: Highlight[], color: HighlightColor) {
		return history.run(
			() =>
				highlights.recolor(
					items.map(item => item.id),
					color,
				),
			{
				overlay: { show: items.map(item => ({ ...item, color })), hide: [], restore: items },
				saving: 'Changing color…',
				done: `Changed to ${color}`,
				undone: 'Color restored',
			},
		);
	}

	/** Highlight the current selection; returns the highlight that now covers it. */
	function highlightSelection(color: HighlightColor, keepColor = false): Highlight | undefined {
		if (!selected || !docId || !persistent || !selected.rects || !selected.anchor) return;
		const { text, layout } = pageContext(selected.page);
		const plan = planHighlight(
			{ ...selected, docId, rects: selected.rects, anchor: selected.anchor },
			color,
			history.items,
			text,
			layout,
		);
		if (plan.kind === 'none') return plan.item;
		if (plan.kind === 'recolor') {
			if (keepColor) return plan.items[0];
			void recolor(plan.items, color).catch(() => undefined);
			return { ...plan.items[0], color };
		}
		if (plan.kind === 'merge') {
			const { survivor, absorbed } = plan;
			const original = history.items.find(item => item.id === survivor.id)!;
			const overlay: Overlay = {
				show: [survivor],
				hide: absorbed.map(item => item.id),
				restore: [original, ...absorbed],
			};
			void history
				.run(
					() =>
						highlights.merge(
							survivor,
							absorbed.map(item => item.id),
						),
					{
						overlay,
						saving: 'Saving highlight…',
						done: 'Highlights combined',
						undone: 'Highlights restored',
					},
				)
				.catch(() => undefined);
			return survivor;
		}
		const created: Highlight = { ...plan.value, id: crypto.randomUUID(), createdAt: Date.now() };
		void history
			.run(() => highlights.create(plan.value, created.id, created.createdAt), {
				overlay: { show: [created], hide: [], restore: [] },
				saving: 'Saving highlight…',
				done: 'Highlight saved',
				undone: 'Highlight undone',
			})
			.catch(() => undefined);
		return created;
	}

	function selectionAction(action: SelectionAction, color?: HighlightColor) {
		if (!selected) return;
		if (action === 'highlight') {
			const chosen = color ?? highlightColor;
			setHighlightColor(chosen);
			if (highlightSelection(chosen)) dismiss(true);
		} else if (action === 'note') {
			const item = highlightSelection(highlightColor, true);
			if (item) openHighlight(item, true);
		} else if (action === 'remove') {
			const items = selectionState.overlaps.map(entry => entry.item);
			dismiss(true);
			if (items.length) void removeHighlights(items).catch(() => undefined);
		} else {
			const passage = selected;
			dismiss(true);
			onAssistantAction?.(passage, action);
		}
	}
	const shortcuts = useRef({ selectionAction, history, selected, persistent });
	shortcuts.current = { selectionAction, history, selected, persistent };
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.defaultPrevented || event.isComposing || isEditable(event.target)) return;
			if (document.querySelector('dialog[open]')) return;
			const { selectionAction, history, selected, persistent } = shortcuts.current;
			const key = event.key.toLowerCase(),
				mod = event.metaKey || event.ctrlKey;
			if (event.altKey && !mod && event.code === 'KeyN' && !event.repeat) {
				event.preventDefault();
				setNotesOpen(open => !open);
			} else if (mod && !event.altKey && (key === 'z' || (key === 'y' && event.ctrlKey && !event.metaKey))) {
				const redo = key === 'y' || event.shiftKey;
				if (redo ? !history.canRedo : !history.canUndo) return;
				event.preventDefault();
				void (redo ? history.redo() : history.undo());
			} else if (
				!mod &&
				!event.altKey &&
				!event.shiftKey &&
				selected &&
				persistent &&
				(key === 'h' || key === 'n')
			) {
				event.preventDefault();
				selectionAction(key === 'h' ? 'highlight' : 'note');
			}
		}
		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, []);
	const [dimensions, setDimensions] = useState<PageDimensions[]>(() =>
		Array.from({ length: pdf.numPages }, () => DEFAULT_PAGE),
	);
	const [viewportSize, setViewportSize] = useState({ width: 668, height: 840 });
	const [fitMode, setFitMode] = useState<'manual' | 'width' | 'page'>(() => initialView.fit ?? 'manual');
	const [zoom, setZoom] = useState(() => normalizeView(initialView).zoom);
	const [currentPage, setCurrentPage] = useState(() => normalizeView(initialView, pdf.numPages).page);
	const [pageDraft, setPageDraft] = useState(String(currentPage));
	const anchor = useRef(normalizeView(initialView, pdf.numPages));
	const restoring = useRef(true);
	const restoreFrame = useRef(0);
	const manualWidth = Math.max(160, Math.min(900, viewportSize.width - 48));
	const fitWidth =
		fitMode === 'page'
			? fitPageWidth(viewportSize.width, viewportSize.height, dimensions[currentPage - 1])
			: fitMode === 'width'
				? Math.max(160, viewportSize.width - 48)
				: manualWidth;
	const width = Math.max(1, Math.round(fitWidth * zoom));
	const rows = useMemo(() => pageLayout(dimensions, width), [dimensions, width]);
	const totalSize = rows.length ? rows.at(-1)!.start + rows.at(-1)!.size : 0;
	const viewCallback = useRef(onViewChange);
	viewCallback.current = onViewChange;
	const rowsRef = useRef(rows);
	const zoomRef = useRef(zoom);
	const fitRef = useRef(fitMode);
	fitRef.current = fitMode;
	rowsRef.current = rows;
	zoomRef.current = zoom;

	const virtualizer = useVirtualizer({
		count: pdf.numPages,
		getScrollElement: () => scrollRef.current,
		estimateSize: index => rows[index].size,
		overscan: 1,
		initialOffset: () => offsetForView(rows, anchor.current),
	});

	useLayoutEffect(() => {
		const element = scrollRef.current;
		if (!element) return;
		const measure = () => {
			const width = element.clientWidth,
				height = element.clientHeight;
			setViewportSize(previous =>
				previous.width === width && previous.height === height ? previous : { width, height },
			);
		};
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		measure();
		return () => observer.disconnect();
	}, []);

	// Preserve the page point at the top of the viewport through zoom, pane
	// resizing and newly discovered page dimensions. PDF pixels are never saved.
	useLayoutEffect(() => {
		const element = scrollRef.current;
		if (!element) return;
		restoring.current = true;
		cancelAnimationFrame(restoreFrame.current);
		virtualizer.measure();
		const target = offsetForView(rows, anchor.current);
		element.scrollTop = target;
		virtualizer.scrollToOffset(target, { align: 'start' });
		restoreFrame.current = requestAnimationFrame(() => {
			restoring.current = false;
			const view = {
				...viewAtOffset(rows, element.scrollTop, zoom),
				...(fitRef.current !== 'manual' ? { fit: fitRef.current } : {}),
			};
			anchor.current = view;
			setCurrentPage(view.page);
			viewCallback.current(view);
		});
		return () => cancelAnimationFrame(restoreFrame.current);
	}, [rows, zoom, virtualizer, fitMode]);

	useEffect(() => setPageDraft(String(currentPage)), [currentPage]);

	const measurePage = useCallback((page: PDFPageProxy) => {
		const viewport = page.getViewport({ scale: 1 });
		if (page.view && viewport.transform) {
			const previous = geometries.current.get(page.pageNumber);
			const geometry = {
				rotation: page.rotate,
				box: page.view,
				transform: viewport.transform,
				width: viewport.width,
				height: viewport.height,
			};
			geometries.current.set(page.pageNumber, geometry);
			if (JSON.stringify(previous) !== JSON.stringify(geometry)) setGeometryRevision(value => value + 1);
		}
		setDimensions(previous => {
			const index = page.pageNumber - 1;
			if (previous[index].width === viewport.width && previous[index].height === viewport.height) return previous;
			const next = [...previous];
			next[index] = { width: viewport.width, height: viewport.height };
			return next;
		});
	}, []);

	function onScroll() {
		if (restoring.current || !scrollRef.current) return;
		const view = {
			...viewAtOffset(rowsRef.current, scrollRef.current.scrollTop, zoomRef.current),
			...(fitRef.current !== 'manual' ? { fit: fitRef.current } : {}),
		};
		anchor.current = view;
		setCurrentPage(view.page);
		onViewChange(view);
	}

	function changeZoom(next: number) {
		jumpSequence.current++;
		if (scrollRef.current && !restoring.current) {
			anchor.current = viewAtOffset(rows, scrollRef.current.scrollTop, zoom);
		}
		dismiss(true);
		setFitMode('manual');
		setZoom(Math.max(0.5, Math.min(2, next)));
	}

	function changeFit(next: 'width' | 'page') {
		jumpSequence.current++;
		if (scrollRef.current && !restoring.current)
			anchor.current = viewAtOffset(rows, scrollRef.current.scrollTop, zoom);
		dismiss(true);
		setFitMode(next);
		setZoom(1);
	}

	function jumpToPage() {
		jumpSequence.current++;
		const page = Number(pageDraft);
		if (!Number.isInteger(page) || page < 1 || page > pdf.numPages) {
			setPageDraft(String(currentPage));
			return;
		}
		anchor.current = { page, offset: 0, zoom, ...(fitMode !== 'manual' ? { fit: fitMode } : {}) };
		setCurrentPage(page);
		virtualizer.scrollToOffset(offsetForView(rows, anchor.current), { align: 'start' });
		onViewChange(anchor.current);
	}

	async function jumpToHighlight(item: Highlight) {
		const sequence = ++jumpSequence.current;
		dismiss(true);
		try {
			const page = await pdf.getPage(item.page);
			if (sequence !== jumpSequence.current) return;
			measurePage(page);
			const geometry = geometries.current.get(item.page);
			const top = geometry ? Math.min(...item.rects.map(rect => projectRect(rect, geometry)[1])) : 0;
			anchor.current = {
				page: item.page,
				offset: Math.max(0, top - 0.08),
				zoom,
				...(fitMode !== 'manual' ? { fit: fitMode } : {}),
			};
			setCurrentPage(item.page);
			setActiveHighlight(item.id);
			virtualizer.scrollToOffset(offsetForView(rowsRef.current, anchor.current), { align: 'start' });
			onViewChange(anchor.current);
			setLocalError('');
		} catch (failure) {
			if (sequence !== jumpSequence.current) return;
			setLocalError(`Could not jump to this highlight: ${failureMessage(failure)}`);
		}
	}

	const controls = (
		<ReaderToolbar
			pageDraft={pageDraft}
			pageCount={pdf.numPages}
			zoom={fitMode === 'manual' ? zoom : width / manualWidth}
			fitMode={fitMode}
			onFit={changeFit}
			notesOpen={notesOpen}
			highlightCount={saved.length}
			onNotesToggle={() => setNotesOpen(open => !open)}
			snipMode={snipMode}
			onPageDraft={setPageDraft}
			onPageJump={jumpToPage}
			onZoom={changeZoom}
			onSnipToggle={() => {
				setSnipMode(!snipMode);
				setSnipPage(null);
				dismiss(true);
			}}
		/>
	);

	return (
		<>
			{selected && (
				<TextSelectionMenu
					selection={selected}
					persistent={persistent}
					onAction={selectionAction}
					color={highlightColor}
					currentColor={selectionState.currentColor}
					highlighted={selectionState.overlaps.length > 0}
				/>
			)}
			{history.notice && (
				<HighlightToast
					className={viewport.highlightNotice}
					notice={history.notice}
					canUndo={history.canUndo}
					canRedo={history.canRedo}
					onUndo={() => void history.undo()}
					onRedo={() => void history.redo()}
					onDismiss={history.dismissNotice}
				/>
			)}
			{localError && (
				<p role='alert' className={`reader-error ${viewport.inlineError}`}>
					{localError}
				</p>
			)}
			{controlsHost ? createPortal(controls, controlsHost) : controls}
			<div className={viewport.readingBody}>
				<ScrollArea
					className={`pdf-scroll ${viewport.scroll}${snipMode ? ` ${viewport.snipping}` : ''}`}
					ref={scrollRef}
					onScroll={onScroll}
					tabIndex={0}
					aria-label='PDF pages'
					data-page-count={pdf.numPages}
					data-current-page={currentPage}
				>
					<div
						className={`virtual-pages ${viewport.virtualPages}`}
						style={{ height: totalSize, minWidth: width + 48 }}
					>
						{virtualizer.getVirtualItems().map(item => {
							const row = rows[item.index];
							// Bound canvas memory even on high-DPI displays and at maximum zoom.
							const pixelRatio = Math.min(
								window.devicePixelRatio || 1,
								2,
								Math.sqrt(12_000_000 / (width * row.pageHeight)),
							);
							return (
								<div
									className={`virtual-page ${viewport.virtualPage}`}
									key={item.key}
									data-pdf-page={item.index + 1}
									style={{ transform: `translateY(${row.start}px)`, height: row.size }}
								>
									<div className={`page-content ${viewport.pageContent}`} style={{ width }}>
										<div className={`page-label ${viewport.pageLabel}`}>PAGE {item.index + 1}</div>
										<div
											className={`annotated-page ${viewport.annotatedPage}`}
											onPointerDown={event => {
												pointerStart.current = { x: event.clientX, y: event.clientY };
											}}
											onClick={event => {
												const start = pointerStart.current;
												pointerStart.current = null;
												if (
													snipMode ||
													event.detail !== 1 ||
													event.button !== 0 ||
													!start ||
													Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5 ||
													!window.getSelection()?.isCollapsed
												)
													return;
												const geometry = geometries.current.get(item.index + 1);
												if (!geometry) return;
												const target = highlightAtPoint(
													history.items.filter(h => h.page === item.index + 1),
													geometry,
													event.currentTarget.getBoundingClientRect(),
													event.clientX,
													event.clientY,
												);
												if (target) openHighlight(target);
											}}
										>
											<Page
												pageNumber={item.index + 1}
												width={width}
												devicePixelRatio={pixelRatio}
												onLoadSuccess={measurePage}
												renderTextLayer
												renderAnnotationLayer
												loading={
													<div
														className={`page-loading ${viewport.pageLoading}`}
														style={{ height: row.pageHeight }}
													>
														Rendering page {item.index + 1}…
													</div>
												}
												error={
													<p className={`reader-error ${viewport.inlineError}`}>
														Could not render page {item.index + 1}.
													</p>
												}
											/>
											{geometries.current.get(item.index + 1) && (
												<HighlightOverlay
													items={history.items.filter(h => h.page === item.index + 1)}
													activeId={notesOpen ? activeHighlight : null}
													onActivate={
														snipMode
															? undefined
															: item => {
																	if (saved.some(s => s.id === item.id))
																		openHighlight(item);
																}
													}
													geometry={geometries.current.get(item.index + 1)!}
												/>
											)}
											{snipMode && (
												<SnipOverlay
													page={item.index + 1}
													width={width}
													activePage={snipPage}
													onActivate={() => setSnipPage(item.index + 1)}
													onCancel={() => {
														setSnipMode(false);
														setSnipPage(null);
													}}
													getPage={() => pdf.getPage(item.index + 1)}
													onExplain={(page, image, question) => {
														setSnipMode(false);
														setSnipPage(null);
														onSnip?.({ page, image, question });
													}}
												/>
											)}
										</div>
									</div>
								</div>
							);
						})}
					</div>
				</ScrollArea>
				<NotesPanel
					onExport={
						persistent && docId
							? () => {
									void libraryTransfer
										.markdown(docId)
										.then(blob => downloadFile(blob, 'nota-research-notes.md'))
										.catch(failure =>
											setLocalError(`Could not export notes: ${failureMessage(failure)}`),
										);
								}
							: undefined
					}
					open={notesOpen}
					items={history.items}
					notes={notes}
					activeId={activeHighlight}
					composeRequest={composeRequest}
					onClose={() => {
						setNotesOpen(false);
						const root = controlsHost ?? scrollRef.current?.closest('.pdf-document');
						root?.querySelector<HTMLElement>('[aria-controls="highlight-notes-panel"]')?.focus({
							preventScroll: true,
						});
					}}
					onSelect={id => setActiveHighlight(current => (current === id ? null : id))}
					onJump={item => void jumpToHighlight(item)}
					onColor={(id, color) => {
						const item = history.items.find(entry => entry.id === id);
						return item
							? recolor([item], color)
							: Promise.reject(new Error('This highlight no longer exists.'));
					}}
					onRemove={id => {
						const item = history.items.find(entry => entry.id === id);
						return item ? removeHighlights([item]) : Promise.resolve();
					}}
					// Note writes wait for pending highlight writes, e.g. a highlight created by "Note".
					onAddNote={async (id, text) => {
						await history.idle();
						await highlights.addNote(id, text);
						// The highlight now carries a note; an Undo offer for creating it would only conflict.
						if (history.notice?.phase === 'saved') history.dismissNotice();
					}}
					onUpdateNote={(id, text) => history.idle().then(() => highlights.updateNote(id, text))}
					onRemoveNote={id =>
						history.run(() => highlights.deleteNote(id), {
							saving: 'Deleting note…',
							done: 'Note deleted',
							undone: 'Note restored',
						})
					}
					onExplain={item => {
						dismiss(true);
						onAssistantAction?.(
							{
								text: item.anchor.quote,
								page: item.page,
								rects: item.rects,
								anchor: item.anchor,
								rotation: item.rotation,
							},
							'explain',
						);
					}}
					onAsk={item => {
						dismiss(true);
						onAssistantAction?.(
							{
								text: item.anchor.quote,
								page: item.page,
								rects: item.rects,
								anchor: item.anchor,
								rotation: item.rotation,
							},
							'ask',
						);
					}}
				/>
			</div>
		</>
	);
}
