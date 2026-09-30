import { useVirtualizer } from '@tanstack/react-virtual';
import { liveQuery } from 'dexie';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { Button, Dropdown, ScrollArea } from '../../components/ui';
import { normalizeView, type ReaderView } from '../../domain/document.ts';
import type { Annotation, Highlight } from '../../domain/highlight';
import { highlights } from '../../infrastructure/db/highlights';
import type { PageGeometry } from '../../infrastructure/pdf/geometry';
import type { SelectedSnip } from '../../infrastructure/pdf/snip';
import HighlightOverlay from '../highlights/HighlightOverlay';
import { DEFAULT_PAGE, offsetForView, pageLayout, viewAtOffset, type PageDimensions } from './geometry.ts';
import viewport from './PdfViewport.module.css';
import ReaderToolbar from './ReaderToolbar';
import { capturePdfSelection, type TextSelection } from './selection.ts';
import SnipOverlay from './SnipOverlay';
import TextSelectionMenu, { type SelectionAction } from './TextSelectionMenu';

// Vite resolves this asset URL in both dev and production, using the local worker
// from the same PDF.js package as React-PDF.
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

const DOCUMENT_LOAD_TIMEOUT_MS = 45_000;
const failureMessage = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));

interface Props {
	onSnip?: (snip: Omit<SelectedSnip, 'docId'>) => void;
	docId?: string;
	persistent?: boolean;
	onAssistantAction?: (selection: TextSelection, action: 'translate' | 'ask') => void;
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
	const [selected, setSelected] = useState<TextSelection | null>(null);
	const geometries = useRef(new Map<number, PageGeometry>());
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
	async function localAction(action: () => Promise<unknown>) {
		try {
			await action();
			setLocalError('');
		} catch (error) {
			setLocalError(error instanceof Error ? error.message : String(error));
		}
	}
	function selectionAction(action: SelectionAction) {
		if (!selected) return;
		if (action === 'highlight' && docId && selected.rects && selected.anchor) {
			void localAction(async () => {
				await highlights.save({
					docId,
					page: selected.page,
					rotation: selected.rotation,
					rects: selected.rects!,
					anchor: selected.anchor!,
					color: 'yellow',
				});
				setSelected(null);
				window.getSelection()?.removeAllRanges();
			});
		} else if (action !== 'highlight') {
			onAssistantAction?.(selected, action);
			setSelected(null);
			window.getSelection()?.removeAllRanges();
		}
	}
	const scrollRef = useRef<HTMLDivElement>(null);
	const [dimensions, setDimensions] = useState<PageDimensions[]>(() =>
		Array.from({ length: pdf.numPages }, () => DEFAULT_PAGE),
	);
	const [fitWidth, setFitWidth] = useState(620);
	const [zoom, setZoom] = useState(() => normalizeView(initialView).zoom);
	const [currentPage, setCurrentPage] = useState(() => normalizeView(initialView, pdf.numPages).page);
	const [pageDraft, setPageDraft] = useState(String(currentPage));
	const anchor = useRef(normalizeView(initialView, pdf.numPages));
	const restoring = useRef(true);
	const restoreFrame = useRef(0);
	const width = Math.round(fitWidth * zoom);
	const rows = useMemo(() => pageLayout(dimensions, width), [dimensions, width]);
	const totalSize = rows.length ? rows.at(-1)!.start + rows.at(-1)!.size : 0;
	const rowsRef = useRef(rows);
	const zoomRef = useRef(zoom);
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
		const observer = new ResizeObserver(() => {
			const available = Math.max(160, Math.min(900, element.clientWidth - 48));
			setFitWidth(available);
		});
		observer.observe(element);
		setFitWidth(Math.max(160, Math.min(900, element.clientWidth - 48)));
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
			const view = viewAtOffset(rows, element.scrollTop, zoom);
			anchor.current = view;
			setCurrentPage(view.page);
			onViewChange(view);
		});
		return () => cancelAnimationFrame(restoreFrame.current);
	}, [rows, zoom, virtualizer, onViewChange]);

	useEffect(() => setPageDraft(String(currentPage)), [currentPage]);

	const measurePage = useCallback((page: PDFPageProxy) => {
		const viewport = page.getViewport({ scale: 1 });
		if (page.view && viewport.transform)
			geometries.current.set(page.pageNumber, {
				rotation: page.rotate,
				box: page.view,
				transform: viewport.transform,
				width: viewport.width,
				height: viewport.height,
			});
		setDimensions(previous => {
			const index = page.pageNumber - 1;
			if (previous[index].width === viewport.width && previous[index].height === viewport.height)
				return [...previous];
			const next = [...previous];
			next[index] = { width: viewport.width, height: viewport.height };
			return next;
		});
	}, []);

	function onScroll() {
		setSelected(null);
		if (restoring.current || !scrollRef.current) return;
		const view = viewAtOffset(rowsRef.current, scrollRef.current.scrollTop, zoomRef.current);
		anchor.current = view;
		setCurrentPage(view.page);
		onViewChange(view);
	}

	function changeZoom(next: number) {
		if (scrollRef.current && !restoring.current) {
			anchor.current = viewAtOffset(rows, scrollRef.current.scrollTop, zoom);
		}
		setSelected(null);
		setZoom(Math.max(0.5, Math.min(2, next)));
	}

	function jumpToPage() {
		const page = Number(pageDraft);
		if (!Number.isInteger(page) || page < 1 || page > pdf.numPages) {
			setPageDraft(String(currentPage));
			return;
		}
		anchor.current = { page, offset: 0, zoom };
		setCurrentPage(page);
		virtualizer.scrollToOffset(offsetForView(rows, anchor.current), { align: 'start' });
		onViewChange(anchor.current);
	}

	function captureSelection() {
		if (snipMode) return;
		if (!scrollRef.current) return;
		const result = capturePdfSelection(scrollRef.current, window.getSelection(), geometries.current);
		if (typeof result === 'string') {
			setSelected(null);
			onSelection(null);
			onSelectionError(result);
		} else {
			setSelected(result);
			if (result) {
				onSelection(result);
				onSelectionError('');
			}
		}
	}

	useEffect(() => {
		let frame = 0;
		const changed = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(captureSelection);
		};
		const dismiss = () => setSelected(null);
		const escape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				dismiss();
				window.getSelection()?.removeAllRanges();
				setSnipMode(false);
				setSnipPage(null);
			}
		};
		document.addEventListener('keydown', escape);
		window.addEventListener('resize', dismiss);
		document.addEventListener('selectionchange', changed);
		return () => {
			document.removeEventListener('selectionchange', changed);
			document.removeEventListener('keydown', escape);
			window.removeEventListener('resize', dismiss);
			cancelAnimationFrame(frame);
		};
	});

	const controls = (
		<ReaderToolbar
			pageDraft={pageDraft}
			pageCount={pdf.numPages}
			zoom={zoom}
			snipMode={snipMode}
			onPageDraft={setPageDraft}
			onPageJump={jumpToPage}
			onZoom={changeZoom}
			onSnipToggle={() => {
				setSnipMode(!snipMode);
				setSnipPage(null);
				setSelected(null);
				window.getSelection()?.removeAllRanges();
			}}
		/>
	);

	return (
		<>
			{selected && <TextSelectionMenu selection={selected} persistent={persistent} onAction={selectionAction} />}
			{localError && (
				<p role='alert' className={`reader-error ${viewport.inlineError}`}>
					{localError}
				</p>
			)}
			{(saved.length > 0 || notes.length > 0) && (
				<details className={`local-notes ${viewport.localNotes}`}>
					<summary>Notes ({saved.length})</summary>
					{saved.map(item => (
						<article key={item.id}>
							<p dir='auto'>
								p. {item.page} — {item.anchor.quote}
							</p>
							<Dropdown
								label={`Highlight color ${item.id}`}
								value={item.color}
								onChange={color =>
									void localAction(() => highlights.color(item.id, color as Highlight['color']))
								}
								options={['yellow', 'green', 'blue'].map(color => ({
									value: color,
									label: color[0].toUpperCase() + color.slice(1),
									icon: '●',
								}))}
							/>
							<Button
								size='sm'
								variant='ghost'
								onClick={() => void localAction(() => highlights.remove(item.id))}
							>
								Remove highlight
							</Button>
							{notes
								.filter(note => note.highlightId === item.id)
								.map(note => (
									<p key={note.id} dir='auto'>
										{note.text}
									</p>
								))}
							<form
								onSubmit={event => {
									event.preventDefault();
									const form = event.currentTarget;
									const text = String(new FormData(form).get('note') || '');
									void localAction(async () => {
										await highlights.addNote(item.id, text);
										form.reset();
									});
								}}
							>
								<input
									name='note'
									aria-label={`Note for page ${item.page}`}
									dir='auto'
									maxLength={10000}
									placeholder='Quick local note'
									required
								/>
								<Button type='submit' size='sm'>
									Add note
								</Button>
							</form>
						</article>
					))}
				</details>
			)}
			{controlsHost ? createPortal(controls, controlsHost) : controls}
			<ScrollArea
				className={`pdf-scroll ${viewport.scroll}${snipMode ? ` ${viewport.snipping}` : ''}`}
				ref={scrollRef}
				onScroll={onScroll}
				onPointerUp={captureSelection}
				onKeyUp={captureSelection}
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
									<div className={`annotated-page ${viewport.annotatedPage}`}>
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
												items={saved.filter(h => h.page === item.index + 1)}
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
		</>
	);
}

