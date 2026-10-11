import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui';
import type { HistoryNotice } from './useHighlightHistory';

const SETTLED_MS = 5000;
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const undoShortcut = isMac ? '⌘Z' : 'Ctrl+Z';

/**
 * Quiet confirmation for highlight changes. Successful changes fade after a few
 * seconds (paused while hovered or focused); errors stay until dismissed.
 */
export default function HighlightToast({
	notice,
	className,
	canUndo,
	canRedo,
	onUndo,
	onRedo,
	onDismiss,
}: {
	notice: HistoryNotice;
	className: string;
	canUndo: boolean;
	canRedo: boolean;
	onUndo: () => void;
	onRedo: () => void;
	onDismiss: () => void;
}) {
	const [held, setHeld] = useState(false);
	const dismiss = useRef(onDismiss);
	dismiss.current = onDismiss;
	const settled = notice.phase === 'saved' || notice.phase === 'undone' || notice.phase === 'redone';
	useEffect(() => {
		if (!settled || held) return;
		const timer = window.setTimeout(() => dismiss.current(), SETTLED_MS);
		return () => window.clearTimeout(timer);
	}, [notice, settled, held]);
	const showUndo = canUndo && (notice.phase === 'saved' || notice.phase === 'saving' || notice.phase === 'redone');
	const showRedo = canRedo && notice.phase === 'undone';
	return (
		<div
			className={className}
			onPointerEnter={() => setHeld(true)}
			onPointerLeave={() => setHeld(false)}
			onFocus={() => setHeld(true)}
			onBlur={() => setHeld(false)}
		>
			<span role={notice.phase === 'error' ? 'alert' : 'status'}>{notice.message}</span>
			{showUndo && (
				<Button size='sm' variant='ghost' onClick={onUndo} title={`Undo · ${undoShortcut}`}>
					Undo
				</Button>
			)}
			{showRedo && (
				<Button size='sm' variant='ghost' onClick={onRedo}>
					Redo
				</Button>
			)}
			<Button size='sm' variant='ghost' aria-label='Dismiss notification' onClick={onDismiss}>
				×
			</Button>
		</div>
	);
}
