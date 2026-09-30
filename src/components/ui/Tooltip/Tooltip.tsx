import { cloneElement, useEffect, useId, useRef, useState, type HTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { useOverlayHost } from '../overlay';
import styles from './Tooltip.module.css';
import type { TooltipProps } from './types';
export function Tooltip({ content, children, className = '', delayMs = 320 }: TooltipProps) {
	const id = useId();
	const root = useRef<HTMLSpanElement>(null);
	const host = useOverlayHost(root);
	const tip = useRef<HTMLSpanElement>(null);
	const [position, setPosition] = useState({ left: 8, top: 8 });
	const [visible, setVisible] = useState(false);
	const original = children as React.ReactElement<HTMLAttributes<HTMLElement>>;
	const child = cloneElement(original, {
		'aria-describedby': [original.props['aria-describedby'], id].filter(Boolean).join(' '),
	});
	function place() {
		const box = root.current?.getBoundingClientRect();
		const width = Math.min(220, window.innerWidth - 16),
			height = tip.current?.getBoundingClientRect().height || 36;
		if (box)
			setPosition({
				left: Math.max(8, Math.min(box.left + box.width / 2 - width / 2, window.innerWidth - width - 8)),
				top: Math.max(
					8,
					Math.min(
						box.top > height + 16 ? box.top - height - 8 : box.bottom + 8,
						window.innerHeight - height - 8,
					),
				),
			});
	}
	function show() {
		place();
		setVisible(true);
	}
	useEffect(() => {
		if (!visible) return;
		place();
		window.addEventListener('resize', place);
		window.addEventListener('scroll', place, true);
		return () => {
			window.removeEventListener('resize', place);
			window.removeEventListener('scroll', place, true);
		};
	}, [visible, content, host]);
	return (
		<span
			ref={root}
			className={`${styles.root} ${className}`}
			onMouseEnter={show}
			onPointerDown={() => setVisible(false)}
			onMouseLeave={() => setVisible(false)}
			onFocus={show}
			onBlur={() => setVisible(false)}
			onKeyDown={event => {
				if (event.key === 'Escape') setVisible(false);
			}}
		>
			{child}
			{createPortal(
				<span
					id={id}
					ref={tip}
					role='tooltip'
					aria-hidden={!visible}
					className={`${styles.tip} ${visible ? styles.visible : ''}`}
					style={{ ...position, transitionDelay: visible ? `${delayMs}ms` : '0ms' }}
				>
					{content}
				</span>,
				host,
			)}
		</span>
	);
}
