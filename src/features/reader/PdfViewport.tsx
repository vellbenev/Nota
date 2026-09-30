import { useVirtualizer } from '@tanstack/react-virtual';
import { liveQuery } from 'dexie';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { Button, ScrollArea } from '../../components/ui';
import { normalizeView, type ReaderView } from '../../domain/document.ts';
import type { Annotation, Highlight, HighlightColor } from '../../domain/highlight';
import { highlights } from '../../infrastructure/db/highlights';
import { projectRect, type PageGeometry } from '../../infrastructure/pdf/geometry';
import type { SelectedSnip } from '../../infrastructure/pdf/snip';
import HighlightOverlay from '../highlights/HighlightOverlay';
import { highlightAtPoint } from '../highlights/hitTest';
import NotesPanel from '../highlights/NotesPanel';
import { useHighlightCreation } from '../highlights/useHighlightCreation';
import { downloadFile, libraryTransfer } from '../library/transfer';
import {
	DEFAULT_PAGE,
	fitPageWidth,
	offsetForView,
	pageLayout,
	viewAtOffset,
	type PageDimensions,
} from './geometry.ts';
import viewport from './PdfViewport.module.css';
import ReaderToolbar from './ReaderToolbar';
import type { TextSelection } from './selection.ts';
import SnipOverlay from './SnipOverlay';
import TextSelectionMenu, { type SelectionAction } from './TextSelectionMenu';
import { usePdfSelection } from './usePdfSelection';

// Vite resolves this asset URL in both dev and production, using the local worker
// from the same PDF.js package as React-PDF.
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

const DOCUMENT_LOAD_TIMEOUT_MS = 45_000;
const failureMessage = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));

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
	const pointerStart = useRef<{ x: number; y: number } | null>(null);
	const jumpSequence = useRef(0);
	useEffect(
		() => () => {
			jumpSequence.current++;
		},
		[],
	);
	const [highlightColor, setHighlightColor] = useState<HighlightColor>('yellow');
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
	const creation = useHighlightCreation(saved);
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
	function openHighlight(item: Highlight) {
		dismiss(true);
		setActiveHighlight(item.id);
		setNotesOpen(true);
	}
	useEffect(() => {
		if (activeHighlight && !saved.some(item => item.id === activeHighlight)) setActiveHighlight(null);
	}, [saved, activeHighlight]);

	function selectionAction(action: SelectionAction) {
		if (!selected) return;
		if (action === 'highlight' && docId && selected.rects && selected.anchor) {
			creation.create({
				docId,
				page: selected.page,
				rotation: selected.rotation,
				rects: selected.rects,
				anchor: selected.anchor,
				color: highlightColor,
			});
			dismiss(true);
		} else if (action !== 'highlight') {
			const passage = selected;
			dismiss(true);
			onAssistantAction?.(passage, action);
		}
	}
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
					onColor={setHighlightColor}
				/>
			)}
			{creation.notice && (
				<div className={viewport.highlightNotice}>
					<span role={creation.notice.phase === 'error' ? 'alert' : 'status'}>{creation.notice.message}</span>
					{creation.canUndo && (
						<Button size='sm' variant='ghost' onClick={() => void creation.undo()}>
							Undo highlight
						</Button>
					)}
					<Button
						size='sm'
						variant='ghost'
						aria-label='Dismiss highlight notification'
						onClick={creation.dismissNotice}
					>
						×
					</Button>
				</div>
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
													saved.filter(h => h.page === item.index + 1),
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
													items={creation.items.filter(h => h.page === item.index + 1)}
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
					items={saved}
					notes={notes}
					activeId={activeHighlight}
					onClose={() => {
						setNotesOpen(false);
						const root = controlsHost ?? scrollRef.current?.closest('.pdf-document');
						root?.querySelector<HTMLElement>('[aria-controls="highlight-notes-panel"]')?.focus({
							preventScroll: true,
						});
					}}
					onSelect={setActiveHighlight}
					onJump={item => void jumpToHighlight(item)}
					onColor={highlights.color}
					onRemove={highlights.remove}
					onAddNote={highlights.addNote}
					onUpdateNote={highlights.updateNote}
					onRemoveNote={highlights.removeNote}
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
