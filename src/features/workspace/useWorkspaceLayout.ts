import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
export const LAYOUT_KEY = 'nota.workspace.v1';
export function readLayout(storage?: Pick<Storage, 'getItem'>): { share: number; assistantOpen: boolean } {
	try {
		const value = JSON.parse(storage?.getItem(LAYOUT_KEY) ?? 'null');
		return {
			share:
				typeof value?.share === 'number' && Number.isFinite(value.share)
					? Math.max(30, Math.min(85, value.share))
					: 69,
			assistantOpen: typeof value?.assistantOpen === 'boolean' ? value.assistantOpen : true,
		};
	} catch {
		return { share: 69, assistantOpen: true };
	}
}
export function useWorkspaceLayout() {
	const [saved] = useState(() => {
		try {
			return readLayout(localStorage);
		} catch {
			return readLayout();
		}
	});
	const [share, setShare] = useState(saved.share),
		[assistantOpen, setAssistantOpen] = useState(saved.assistantOpen);
	const [fullscreen, setFullscreen] = useState(false),
		[error, setError] = useState('');
	const [mobile, setMobile] = useState(() => window.matchMedia?.('(max-width: 760px)').matches ?? false);
	const [resizing, setResizing] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	const drag = useRef<{ position: number; share: number; size: number } | null>(null);
	useEffect(() => {
		try {
			localStorage.setItem(LAYOUT_KEY, JSON.stringify({ share, assistantOpen }));
		} catch {
			/* Session-only layout when storage is blocked. */
		}
	}, [share, assistantOpen]);
	useEffect(() => {
		const query = window.matchMedia?.('(max-width: 760px)');
		if (!query) return;
		const update = () => setMobile(query.matches);
		query.addEventListener('change', update);
		return () => query.removeEventListener('change', update);
	}, []);
	useEffect(() => {
		const changed = () => setFullscreen(document.fullscreenElement === root.current);
		document.addEventListener('fullscreenchange', changed);
		const shortcut = (event: globalThis.KeyboardEvent) => {
			if (event.altKey && event.code === 'Backslash' && !event.repeat) {
				event.preventDefault();
				setAssistantOpen(open => !open);
			}
		};
		window.addEventListener('keydown', shortcut);
		return () => {
			document.removeEventListener('fullscreenchange', changed);
			window.removeEventListener('keydown', shortcut);
		};
	}, []);
	function clamp(next: number, size: number) {
		const minimum = mobile ? 160 : 280,
			companion = mobile ? 160 : 240;
		const min = Math.max(30, Math.min(60, (minimum / Math.max(1, size)) * 100));
		const max = Math.max(min, Math.min(85, (1 - companion / Math.max(1, size)) * 100));
		return Math.max(min, Math.min(max, Math.round(next * 10) / 10));
	}
	useEffect(() => {
		if (!assistantOpen && document.activeElement?.closest('#nota-assistant'))
			root.current?.querySelector<HTMLElement>('[aria-label="Show assistant"]')?.focus({ preventScroll: true });
	}, [assistantOpen]);
	useEffect(() => {
		const resized = () => setShare(previous => clamp(previous, axisSize()));
		resized();
		window.addEventListener('resize', resized);
		return () => window.removeEventListener('resize', resized);
	}, [mobile]);
	function axisSize() {
		const box = root.current?.getBoundingClientRect();
		return (mobile ? box?.height : box?.width) || (mobile ? window.innerHeight : window.innerWidth);
	}
	function startDrag(event: PointerEvent<HTMLDivElement>) {
		if (event.button !== 0 || !assistantOpen) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture?.(event.pointerId);
		drag.current = { position: mobile ? event.clientY : event.clientX, share, size: axisSize() };
		setResizing(true);
	}
	function moveDrag(event: PointerEvent<HTMLDivElement>) {
		const value = drag.current;
		if (!value) return;
		const rtl = !mobile && getComputedStyle(document.documentElement).direction === 'rtl';
		const delta = ((mobile ? event.clientY : event.clientX) - value.position) * (rtl ? -1 : 1);
		setShare(clamp(value.share + (delta / value.size) * 100, value.size));
	}
	function stopDrag() {
		drag.current = null;
		setResizing(false);
	}
	function dividerKey(event: KeyboardEvent<HTMLDivElement>) {
		const rtl = !mobile && getComputedStyle(document.documentElement).direction === 'rtl';
		const increase = mobile ? 'ArrowDown' : rtl ? 'ArrowLeft' : 'ArrowRight';
		const decrease = mobile ? 'ArrowUp' : rtl ? 'ArrowRight' : 'ArrowLeft';
		if (event.key === increase || event.key === decrease || event.key === 'Home') {
			event.preventDefault();
			setShare(previous =>
				clamp(event.key === 'Home' ? 69 : previous + (event.key === increase ? 2 : -2), axisSize()),
			);
		}
	}
	async function toggleFullscreen() {
		setError('');
		try {
			if (document.fullscreenElement === root.current) await document.exitFullscreen();
			else if (root.current?.requestFullscreen) await root.current.requestFullscreen();
			else throw new Error('Fullscreen is unavailable in this browser.');
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : 'Could not enter fullscreen.');
		}
	}
	return {
		root,
		share,
		assistantOpen,
		fullscreen,
		mobile,
		resizing,
		error,
		showAssistant: () => setAssistantOpen(true),
		hideAssistant: () => setAssistantOpen(false),
		toggleAssistant: () => setAssistantOpen(open => !open),
		toggleFullscreen,
		startDrag,
		moveDrag,
		stopDrag,
		dividerKey,
	};
}
