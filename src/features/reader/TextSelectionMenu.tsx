import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Tooltip } from '../../components/ui';
import { useOverlayHost } from '../../components/ui/overlay';
import { HIGHLIGHT_COLORS, type HighlightColor } from '../../domain/highlight';
import type { TextSelection } from './selection';
import styles from './TextSelectionMenu.module.css';
export type SelectionAction = 'highlight' | 'note' | 'remove' | 'translate' | 'explain' | 'ask';
const title = (color: string) => color[0].toUpperCase() + color.slice(1);
// Viewport-clamped floating toolbar: prefers above the selection, falls below
// near the top edge, and never clips outside the window.
export default function TextSelectionMenu({
	selection,
	onAction,
	persistent,
	color,
	currentColor,
	highlighted,
}: {
	selection: TextSelection;
	onAction: (action: SelectionAction, color?: HighlightColor) => void;
	persistent: boolean;
	/** The color H and Note use: the last one chosen. */
	color: HighlightColor;
	/** Color of the highlight the selection lies within, if any. */
	currentColor?: HighlightColor;
	/** Whether the selection overlaps saved highlights. */
	highlighted: boolean;
}) {
	const menuRef = useRef<HTMLDivElement>(null);
	const host = useOverlayHost();
	const [position, setPosition] = useState({ left: 8, top: 8, below: false });
	useLayoutEffect(() => {
		const anchor = selection.position;
		if (!anchor) return;
		function place() {
			const box = menuRef.current?.getBoundingClientRect();
			const width = box?.width || 330,
				height = box?.height || 40,
				gap = 10;
			const vw = window.innerWidth,
				vh = window.innerHeight;
			const left = Math.max(8, Math.min(anchor!.left, vw - width - 8));
			const above = anchor!.top - height - gap;
			const fitsAbove = above >= 8;
			const top = Math.max(
				8,
				Math.min(fitsAbove ? above : (anchor!.bottom ?? anchor!.top) + gap, vh - height - 8),
			);
			setPosition({ left, top, below: !fitsAbove });
		}
		place();
		const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
		if (menuRef.current) observer?.observe(menuRef.current);
		window.addEventListener('resize', place);
		return () => {
			observer?.disconnect();
			window.removeEventListener('resize', place);
		};
	}, [selection, host]);
	if (!selection.position) return null;
	const locked = 'Save this paper to your library to highlight';
	return createPortal(
		<div
			ref={menuRef}
			className={`selection-menu ${styles.menu}`}
			role='toolbar'
			aria-label='Selection actions'
			data-selection-menu
			data-placement={position.below ? 'below' : 'above'}
			style={{ left: position.left, top: position.top }}
			onPointerDown={event => event.preventDefault()}
		>
			<div className={styles.colors} role='group' aria-label='Highlight'>
				{HIGHLIGHT_COLORS.map(value => (
					<Tooltip
						key={value}
						content={
							!persistent
								? locked
								: currentColor === value
									? `Already ${value}`
									: `Highlight ${value}${value === color ? ' · H' : ''}`
						}
					>
						<button
							type='button'
							className={`${styles.swatch} ${styles[value]}`}
							aria-label={`Highlight ${title(value)}`}
							aria-pressed={currentColor === value}
							data-default={value === color || undefined}
							disabled={!persistent}
							onClick={() => onAction('highlight', value)}
						>
							{currentColor === value && <span aria-hidden='true'>✓</span>}
						</button>
					</Tooltip>
				))}
			</div>
			<Tooltip content={persistent ? 'Highlight and write a note · N' : locked}>
				<Button size='sm' variant='ghost' disabled={!persistent} onClick={() => onAction('note')}>
					Note
				</Button>
			</Tooltip>
			{highlighted && (
				<Tooltip content='Remove the highlight here'>
					<Button size='sm' variant='ghost' onClick={() => onAction('remove')}>
						Remove
					</Button>
				</Tooltip>
			)}
			<span className={styles.divider} aria-hidden='true' />
			<Tooltip content='Translate or clarify selected text'>
				<Button size='sm' variant='ghost' onClick={() => onAction('translate')}>
					Translate / Clarify
				</Button>
			</Tooltip>
			<Tooltip content='Explain the selected passage now'>
				<Button size='sm' variant='ghost' onClick={() => onAction('explain')}>
					Explain
				</Button>
			</Tooltip>
			<Tooltip content='Write a question about the selection'>
				<Button size='sm' variant='ghost' onClick={() => onAction('ask')}>
					Ask
				</Button>
			</Tooltip>
		</div>,
		host,
	);
}
