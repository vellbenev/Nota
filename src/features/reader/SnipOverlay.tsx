import type { PDFPageProxy } from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'react';
import { Button, Tooltip } from '../../components/ui';
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
					<div
						className={`snip-actions ${styles.actions}`}
						role='toolbar'
						aria-label='Snip actions'
						style={{ top: `${Math.max(0, rect[1] * 100)}%`, left: `${Math.min(rect[0] * 100, 45)}%` }}
						onPointerDown={event => event.stopPropagation()}
					>
						<input
							aria-label='Snip question (optional)'
							value={question}
							onChange={event => setQuestion(event.target.value)}
							placeholder='Question (optional)'
							maxLength={2000}
							dir='auto'
						/>
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
					</div>
				</>
			)}
			{error && (
				<p className={`snip-error ${styles.inlineError}`} role='alert'>
					{error}
				</p>
			)}
		</div>
	);
}

