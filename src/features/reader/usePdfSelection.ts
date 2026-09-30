import { useEffect, useRef, useState, type RefObject } from 'react';
import type { PageGeometry } from '../../infrastructure/pdf/geometry';
import { capturePdfSelection, type TextSelection } from './selection';

/** Keep a completed selection stable while the floating toolbar takes focus. */
export function usePdfSelection({
	root,
	geometries,
	enabled,
	onSelection,
	onError,
	onEscape,
}: {
	root: RefObject<HTMLDivElement | null>;
	geometries: RefObject<Map<number, PageGeometry>>;
	enabled: boolean;
	onSelection: (selection: TextSelection | null) => void;
	onError: (message: string) => void;
	onEscape: () => void;
}) {
	const [selected, setSelected] = useState<TextSelection | null>(null);
	const callbacks = useRef({ enabled, onSelection, onError, onEscape });
	callbacks.current = { enabled, onSelection, onError, onEscape };
	const range = useRef<Range | null>(null);
	const cancelPending = useRef<() => void>(() => {});
	function dismiss(clearNative = false) {
		cancelPending.current();
		const hadSelection = range.current !== null;
		range.current = null;
		setSelected(null);
		if (hadSelection) callbacks.current.onSelection(null);
		if (clearNative) window.getSelection()?.removeAllRanges();
	}
	const dismissRef = useRef(dismiss);
	dismissRef.current = dismiss;

	useEffect(() => {
		let dragging = false,
			timer = 0,
			frame = 0;
		const inMenu = (target: EventTarget | null) =>
			target instanceof Element && !!target.closest('[data-selection-menu]');
		const cancel = () => {
			clearTimeout(timer);
			cancelAnimationFrame(frame);
		};
		cancelPending.current = cancel;
		function capture() {
			if (dragging || !callbacks.current.enabled || !root.current) return;
			const native = window.getSelection();
			const result = capturePdfSelection(root.current, native, geometries.current);
			if (typeof result === 'string') {
				dismissRef.current();
				callbacks.current.onError(result);
			} else if (result) {
				range.current = native!.getRangeAt(0).cloneRange();
				setSelected(result);
				callbacks.current.onSelection(result);
				callbacks.current.onError('');
			} else if (!inMenu(document.activeElement)) {
				dismissRef.current();
			}
		}
		function schedule(delay: number) {
			cancel();
			timer = window.setTimeout(capture, delay);
		}
		const down = (event: PointerEvent) => {
			if (inMenu(event.target)) return;
			if (event.button === 0 && event.target instanceof Element && root.current?.contains(event.target)) {
				dragging = true;
				dismissRef.current();
			} else dismissRef.current();
		};
		const up = (event: PointerEvent) => {
			const wasDragging = dragging;
			dragging = false;
			if (wasDragging || (event.target instanceof Node && root.current?.contains(event.target))) schedule(0);
		};
		const changed = () => {
			if (!dragging && !inMenu(document.activeElement)) schedule(100);
		};
		const keyup = (event: KeyboardEvent) => {
			if (event.target instanceof Node && root.current?.contains(event.target)) schedule(0);
		};
		const keydown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				dragging = false;
				dismissRef.current(true);
				callbacks.current.onEscape();
			}
		};
		const cancelled = () => {
			dragging = false;
			dismissRef.current(true);
		};
		const reposition = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const current = range.current,
					element = root.current;
				if (!current || !element) return;
				if (!current.startContainer.isConnected || !element.contains(current.startContainer)) {
					dismissRef.current();
					return;
				}
				const box = current.getBoundingClientRect(),
					clip = element.getBoundingClientRect();
				if (box.bottom < clip.top || box.top > clip.bottom || box.right < clip.left || box.left > clip.right) {
					dismissRef.current();
					return;
				}
				setSelected(previous =>
					previous
						? {
								...previous,
								position: {
									left: Math.max(box.left, clip.left),
									top: Math.max(box.top, clip.top),
									bottom: Math.min(box.bottom, clip.bottom),
								},
							}
						: null,
				);
			});
		};
		document.addEventListener('pointerdown', down);
		document.addEventListener('pointerup', up);
		document.addEventListener('pointercancel', cancelled);
		document.addEventListener('selectionchange', changed);
		document.addEventListener('keyup', keyup);
		document.addEventListener('keydown', keydown);
		let size: { width: number; height: number } | undefined;
		const observer =
			typeof ResizeObserver === 'undefined'
				? null
				: new ResizeObserver(() => {
						const box = root.current?.getBoundingClientRect();
						if (!box) return;
						if (size && (size.width !== box.width || size.height !== box.height)) dismissRef.current(true);
						size = { width: box.width, height: box.height };
					});
		if (root.current) {
			const box = root.current.getBoundingClientRect();
			size = { width: box.width, height: box.height };
			observer?.observe(root.current);
		}
		window.addEventListener('scroll', reposition, true);
		window.addEventListener('resize', reposition);
		return () => {
			cancel();
			observer?.disconnect();
			document.removeEventListener('pointerdown', down);
			document.removeEventListener('pointerup', up);
			document.removeEventListener('pointercancel', cancelled);
			document.removeEventListener('selectionchange', changed);
			document.removeEventListener('keyup', keyup);
			document.removeEventListener('keydown', keydown);
			window.removeEventListener('scroll', reposition, true);
			window.removeEventListener('resize', reposition);
		};
	}, [root, geometries]);
	useEffect(() => {
		if (!enabled) dismissRef.current(true);
	}, [enabled]);
	return { selected, dismiss };
}
