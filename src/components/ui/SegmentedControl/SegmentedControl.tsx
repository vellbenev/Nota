import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import styles from './SegmentedControl.module.css';
import type { SegmentedControlProps } from './types';
export function SegmentedControl<T extends string>({
	label,
	value,
	options,
	onChange,
	className = '',
}: SegmentedControlProps<T>) {
	const root = useRef<HTMLDivElement>(null);
	const refs = useRef<(HTMLButtonElement | null)[]>([]);
	const [thumb, setThumb] = useState<{ start: number; width: number } | null>(null);
	function onKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
		const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
		const delta =
			event.key === 'ArrowRight' || event.key === 'ArrowDown'
				? event.key === 'ArrowRight' && rtl
					? -1
					: 1
				: event.key === 'ArrowLeft' || event.key === 'ArrowUp'
					? event.key === 'ArrowLeft' && rtl
						? 1
						: -1
					: 0;
		if (!delta && event.key !== 'Home' && event.key !== 'End') return;
		event.preventDefault();
		let next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : index;
		for (let count = 0; count < options.length; count++) {
			if (delta) next = (next + delta + options.length) % options.length;
			else if (count) next = (next + (event.key === 'Home' ? 1 : -1) + options.length) % options.length;
			if (!options[next].disabled) {
				onChange(options[next].value);
				refs.current[next]?.focus();
				break;
			}
		}
	}
	// Sliding pill: measure the selected segment relative to the padded root.
	// Falls back gracefully (no thumb) when layout is unavailable, e.g. jsdom.
	useLayoutEffect(() => {
		function measure() {
			try {
				const host = root.current;
				if (!host || typeof host.querySelector !== 'function') return;
				const escaped =
					typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
						? CSS.escape(value)
						: value.replace(/["\\]/g, '\\$&');
				const selected = host.querySelector<HTMLElement>(`[data-value="${escaped}"]`);
				if (!selected) {
					setThumb(null);
					return;
				}
				const hostBox = host.getBoundingClientRect();
				const box = selected.getBoundingClientRect();
				if (!hostBox.width || !box.width) {
					setThumb(null);
					return;
				}
				const rtl = typeof getComputedStyle === 'function' && getComputedStyle(host).direction === 'rtl';
				const start = rtl ? hostBox.right - box.right : box.left - hostBox.left;
				setThumb({ start, width: box.width });
			} catch {
				setThumb(null);
			}
		}
		measure();
		const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
		if (root.current) observer?.observe(root.current);
		window.addEventListener('resize', measure);
		return () => {
			observer?.disconnect();
			window.removeEventListener('resize', measure);
		};
	}, [value, options]);
	return (
		<div ref={root} role='group' aria-label={label} className={`${styles.root} ${className}`}>
			{thumb && (
				<span
					aria-hidden='true'
					className={styles.thumb}
					style={{ insetInlineStart: thumb.start, width: thumb.width }}
				/>
			)}
			{options.map((option, index) => (
				<button
					key={option.value}
					ref={node => {
						refs.current[index] = node;
					}}
					type='button'
					data-value={option.value}
					aria-pressed={option.value === value}
					disabled={option.disabled}
					className={`${styles.segment} ${option.value === value ? styles.selected : ''}`}
					onClick={() => onChange(option.value)}
					onKeyDown={event => onKey(event, index)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

