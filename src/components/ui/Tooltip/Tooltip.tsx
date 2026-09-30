import { cloneElement, useId, useRef, useState, type HTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import styles from './Tooltip.module.css';
import type { TooltipProps } from './types';
export function Tooltip({ content, children, className = '', delayMs = 320 }: TooltipProps) {
	const id = useId();
	const root = useRef<HTMLSpanElement>(null);
	const [position, setPosition] = useState({ left: 8, top: 8 });
	const [visible, setVisible] = useState(false);
	const original = children as React.ReactElement<HTMLAttributes<HTMLElement>>;
	const child = cloneElement(original, {
		'aria-describedby': [original.props['aria-describedby'], id].filter(Boolean).join(' '),
	});
	function show() {
		const box = root.current?.getBoundingClientRect();
		if (box)
			setPosition({
				left: Math.max(8, Math.min(box.left + box.width / 2 - 110, window.innerWidth - 228)),
				top: box.top > 58 ? box.top - 48 : box.bottom + 8,
			});
		setVisible(true);
	}
	return (
		<span
			ref={root}
			className={`${styles.root} ${className}`}
			onMouseEnter={show}
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
					role='tooltip'
					className={`${styles.tip} ${visible ? styles.visible : ''}`}
					style={{ ...position, transitionDelay: visible ? `${delayMs}ms` : '0ms' }}
				>
					{content}
				</span>,
				document.body,
			)}
		</span>
	);
}

