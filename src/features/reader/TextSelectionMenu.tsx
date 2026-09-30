import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Tooltip } from '../../components/ui';
import type { TextSelection } from './selection';
import styles from './TextSelectionMenu.module.css';
export type SelectionAction = 'highlight' | 'translate' | 'ask';
// Viewport-clamped floating toolbar: prefers above the selection, falls below
// near the top edge, and never clips outside the window. Purely presentational;
// selection geometry and callbacks are unchanged.
export default function TextSelectionMenu({
	selection,
	onAction,
	persistent,
}: {
	selection: TextSelection;
	onAction: (action: SelectionAction) => void;
	persistent: boolean;
}) {
	const menuRef = useRef<HTMLDivElement>(null);
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
			const top = Math.max(8, Math.min(fitsAbove ? above : anchor!.top + gap + 8, vh - height - 8));
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
	}, [selection]);
	if (!selection.position) return null;
	return createPortal(
		<div
			ref={menuRef}
			className={`selection-menu ${styles.menu}`}
			role='toolbar'
			aria-label='Selection actions'
			data-placement={position.below ? 'below' : 'above'}
			style={{ left: position.left, top: position.top }}
			onPointerDown={event => event.preventDefault()}
		>
			<Tooltip content={persistent ? 'Save highlight locally' : 'Save this document first'}>
				<Button size='sm' variant='ghost' disabled={!persistent} onClick={() => onAction('highlight')}>
					Highlight
				</Button>
			</Tooltip>
			<Tooltip content='Translate or clarify selected text'>
				<Button size='sm' variant='ghost' onClick={() => onAction('translate')}>
					Translate / Clarify
				</Button>
			</Tooltip>
			<Tooltip content='Ask about the selection'>
				<Button size='sm' variant='ghost' onClick={() => onAction('ask')}>
					Ask Nota
				</Button>
			</Tooltip>
		</div>,
		document.body,
	);
}

