import type { PDFPageProxy } from 'pdfjs-dist';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Input, Tooltip } from '../../components/ui';
import { useOverlayHost } from '../../components/ui/overlay';
import { cropFromPoints, renderSnip, type SnipImage, type SnipRect } from '../../infrastructure/pdf/snip';
import styles from './SnipOverlay.module.css';
interface Props {
	page: number;
	width: number;
	activePage: number | null;
	onActivate: () => void;
	onCancel: () => void;
	getPage: () => Promise<PDFPageProxy>;
	onExplain: (page: number, image: SnipImage, question: string) => void;
}
export default function SnipOverlay({ page, width, activePage, onActivate, onCancel, getPage, onExplain }: Props) {
	const root = useRef<HTMLDivElement>(null);
	const actions = useRef<HTMLDivElement>(null);
	const host = useOverlayHost();
	const [position, setPosition] = useState({ left: 8, top: 8, width: 300, maxHeight: 500 });
	const drag = useRef<{ x: number; y: number; pointerId: number } | null>(null);
	const controller = useRef<AbortController | null>(null);
	const [rect, setRect] = useState<SnipRect | null>(null),
		[question, setQuestion] = useState(''),
		[error, setError] = useState(''),
		[busy, setBusy] = useState(false);
	useEffect(() => {
		setRect(null);
		drag.current = null;
		controller.current?.abort();
		setBusy(false);
	}, [width]);
	useEffect(() => {
		if (activePage !== page) {
			setRect(null);
			drag.current = null;
			controller.current?.abort();
			setBusy(false);
		}
	}, [activePage, page]);
	useEffect(() => () => controller.current?.abort(), []);
	useLayoutEffect(() => {
		if (!rect || activePage !== page) return;
		const place = () => {
			const box = root.current?.getBoundingClientRect();
			if (!box) return;
			const visible = root.current?.closest('.pdf-scroll')?.getBoundingClientRect();
			const leftEdge = Math.max(8, (visible?.left ?? 0) + 8),
				rightEdge = Math.min(window.innerWidth - 8, (visible?.right ?? window.innerWidth) - 8);
			const topEdge = Math.max(8, (visible?.top ?? 0) + 8),
				bottomEdge = Math.min(window.innerHeight - 8, (visible?.bottom ?? window.innerHeight) - 8);
			const panelWidth = Math.min(300, Math.max(80, rightEdge - leftEdge));
			const height = actions.current?.getBoundingClientRect().height ?? 116;
			const top = box.top + rect[1] * box.height,
				bottom = top + rect[3] * box.height;
			setPosition({
				width: panelWidth,
				maxHeight: Math.max(64, bottomEdge - topEdge),
				left: Math.max(leftEdge, Math.min(box.left + rect[0] * box.width, rightEdge - panelWidth)),
				top: Math.max(
					topEdge,
					Math.min(top - height - 8 >= topEdge ? top - height - 8 : bottom + 8, bottomEdge - height),
				),
			});
		};
		place();
		const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
		if (root.current) observer?.observe(root.current);
		if (actions.current) observer?.observe(actions.current);
		window.addEventListener('resize', place);
		window.addEventListener('scroll', place, true);
		return () => {
			observer?.disconnect();
			window.removeEventListener('resize', place);
			window.removeEventListener('scroll', place, true);
		};
	}, [rect, activePage, page, host]);
	async function explain() {
		if (!rect || busy || !root.current) return;
		const abort = new AbortController();
		controller.current = abort;
		setBusy(true);
		setError('');
		try {
			const pdfPage = await getPage();
			abort.signal.throwIfAborted();
			const source = root.current?.parentElement?.querySelector('canvas') ?? null;
			const image = await renderSnip(pdfPage, rect, width, source, abort.signal);
			if (!abort.signal.aborted) onExplain(page, image, question);
		} catch (failure) {
			if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			if (controller.current === abort) {
				controller.current = null;
				setBusy(false);
			}
		}
	}
	return (
		<div
			ref={root}
			className={`snip-overlay ${styles.overlay}`}
			tabIndex={0}
			role='region'
			aria-label={`Snip area on page ${page}`}
			onKeyDown={event => {
				if (event.key === 'Enter' && event.target === event.currentTarget) {
					event.preventDefault();
					onActivate();
					setRect([0.25, 0.25, 0.5, 0.5]);
				}
			}}
			onPointerDown={event => {
				if (event.button !== 0 || event.target !== event.currentTarget || busy) return;
				event.preventDefault();
				onActivate();
				setRect(null);
				setError('');
				drag.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
				event.currentTarget.setPointerCapture(event.pointerId);
			}}
			onPointerMove={event => {
				if (drag.current?.pointerId === event.pointerId) {
					setRect(
						cropFromPoints(
							drag.current,
							{ x: event.clientX, y: event.clientY },
							event.currentTarget.getBoundingClientRect(),
						),
					);
				}
			}}
			onPointerUp={event => {
				if (drag.current?.pointerId === event.pointerId) {
					const result = cropFromPoints(
						drag.current,
						{ x: event.clientX, y: event.clientY },
						event.currentTarget.getBoundingClientRect(),
					);
					setRect(result);
					drag.current = null;
					if (event.currentTarget.hasPointerCapture(event.pointerId))
						event.currentTarget.releasePointerCapture(event.pointerId);
					if (!result) setError('Drag an area at least 8 pixels wide and tall.');
				}
			}}
			onPointerCancel={() => {
				drag.current = null;
				setRect(null);
			}}
		>
			{!rect && (
				<span className={`snip-hint ${styles.hint}`}>Drag to crop · Enter selects center · Esc exits</span>
			)}
			{rect && activePage === page && (
				<>
					<div
						className={`snip-box ${styles.box}`}
						style={{
							left: `${rect[0] * 100}%`,
							top: `${rect[1] * 100}%`,
							width: `${rect[2] * 100}%`,
							height: `${rect[3] * 100}%`,
						}}
					/>
					{createPortal(
						<div
							ref={actions}
							className={`snip-actions ${styles.actions}`}
							role='toolbar'
							aria-label='Snip actions'
							style={position}
							data-ui-overlay
							onPointerDown={event => event.stopPropagation()}
						>
							<Input
								aria-label='Snip question (optional)'
								value={question}
								onChange={event => setQuestion(event.target.value)}
								placeholder='Question (optional)'
								maxLength={2000}
								dir='auto'
							/>
							{error && (
								<p role='alert' className={styles.actionError}>
									{error}
								</p>
							)}
							<div className={styles.actionRow}>
								<Tooltip content='Explain this image crop'>
									<Button variant='primary' size='sm' loading={busy} onClick={() => void explain()}>
										{busy ? 'Preparing crop…' : 'Explain snip'}
									</Button>
								</Tooltip>
								<Button
									variant='ghost'
									size='sm'
									onClick={() => {
										controller.current?.abort();
										onCancel();
									}}
								>
									Cancel
								</Button>
							</div>
						</div>,
						host,
					)}
				</>
			)}
			{error && !rect && (
				<p className={`snip-error ${styles.inlineError}`} role='alert'>
					{error}
				</p>
			)}
		</div>
	);
}
