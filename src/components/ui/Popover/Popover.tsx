import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../Button';
import { useOverlayHost } from '../overlay';
import styles from './Popover.module.css';
export function Popover({ label, children }: { label: string; children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null),
		popup = useRef<HTMLDivElement>(null);
	const host = useOverlayHost(trigger),
		id = useId();
	const [position, setPosition] = useState({ left: 8, top: 8, width: 340, maxHeight: 500 });
	function close(restore = false) {
		setOpen(false);
		if (restore) trigger.current?.focus({ preventScroll: true });
	}
	useEffect(() => {
		if (!open) return;
		const outside = (event: PointerEvent) => {
			if (
				!document.querySelector('dialog[open]') &&
				!trigger.current?.contains(event.target as Node) &&
				!popup.current?.contains(event.target as Node)
			)
				close();
		};
		const escape = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open]')) {
				event.preventDefault();
				close(true);
			}
		};
		document.addEventListener('pointerdown', outside);
		document.addEventListener('keydown', escape);
		return () => {
			document.removeEventListener('pointerdown', outside);
			document.removeEventListener('keydown', escape);
		};
	}, [open]);
	useLayoutEffect(() => {
		if (!open) return;
		const place = () => {
			const box = trigger.current?.getBoundingClientRect();
			if (!box) return;
			const width = Math.min(340, window.innerWidth - 16);
			const below = window.innerHeight - box.bottom - 14,
				above = box.top - 14;
			const height = popup.current?.scrollHeight ?? 500;
			const flip = below < Math.min(height, 240) && above > below;
			const maxHeight = Math.max(64, flip ? above : below);
			setPosition({
				width,
				left: Math.max(8, Math.min(box.right - width, window.innerWidth - width - 8)),
				top: flip ? Math.max(8, box.top - Math.min(height, maxHeight) - 6) : box.bottom + 6,
				maxHeight,
			});
		};
		place();
		const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
		if (trigger.current) observer?.observe(trigger.current);
		if (popup.current) observer?.observe(popup.current);
		window.addEventListener('resize', place);
		window.addEventListener('scroll', place, true);
		return () => {
			observer?.disconnect();
			window.removeEventListener('resize', place);
			window.removeEventListener('scroll', place, true);
		};
	}, [open, host]);
	return (
		<>
			<Button
				ref={trigger}
				size='sm'
				aria-label={label}
				aria-expanded={open}
				aria-controls={open ? id : undefined}
				onClick={() => setOpen(value => !value)}
				onKeyDown={event => {
					if (event.key === 'ArrowDown') {
						event.preventDefault();
						setOpen(true);
						requestAnimationFrame(() =>
							popup.current?.querySelector<HTMLElement>('button, input')?.focus({ preventScroll: true }),
						);
					}
				}}
			>
				Settings
			</Button>
			{createPortal(
				<div
					ref={popup}
					id={id}
					className={styles.panel}
					style={position}
					data-ui-overlay
					hidden={!open}
					inert={!open}
					aria-hidden={!open}
					role='region'
					aria-label={label}
					onBlur={event => {
						if (
							!document.querySelector('dialog[open]') &&
							event.relatedTarget &&
							!event.currentTarget.contains(event.relatedTarget as Node) &&
							!trigger.current?.contains(event.relatedTarget as Node)
						)
							close();
					}}
				>
					{children}
				</div>,
				host,
			)}
		</>
	);
}
