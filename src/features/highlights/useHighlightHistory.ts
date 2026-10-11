import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Highlight } from '../../domain/highlight';
import {
	ChangeConflictError,
	highlights,
	sameRecord,
	type Change,
	type HighlightRepository,
} from '../../infrastructure/db/highlights';

/** Pending visual state shown while IndexedDB writes and the live query catch up. */
export interface Overlay {
	show: Highlight[];
	hide: string[];
	/** Records to show again if this change is undone before the live query settles. */
	restore: Highlight[];
}
export interface HistoryNotice {
	phase: 'saving' | 'saved' | 'undoing' | 'undone' | 'redone' | 'error';
	message: string;
}
interface Entry {
	change: Promise<Change>;
	overlay?: Overlay;
	done: string;
	undone: string;
}
interface Pending {
	key: number;
	overlay: Overlay;
	settled: boolean;
}
type Repository = Pick<HighlightRepository, 'apply'>;
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

function reflected(overlay: Overlay, saved: Highlight[]) {
	const byId = new Map(saved.map(item => [item.id, item]));
	return (
		overlay.hide.every(id => !byId.has(id) || overlay.show.some(item => item.id === id)) &&
		overlay.show.every(item => sameRecord(byId.get(item.id), item))
	);
}
export function applyOverlays(saved: Highlight[], overlays: Overlay[]) {
	let items = saved;
	for (const { show, hide } of overlays) {
		const replaced = new Set([...hide, ...show.map(item => item.id)]);
		items = [...items.filter(item => !replaced.has(item.id)), ...show];
	}
	return items;
}

/**
 * One linear, per-document history of highlight changes (create, combine,
 * recolor, remove, delete note). Writes run strictly in order, so Undo waits
 * for a write still in progress and a refresh can never resurrect an undone
 * change. Undo/redo replay repository snapshots and refuse, without writing,
 * when the records changed in the meantime.
 */
export function useHighlightHistory(saved: Highlight[], repository: Repository = highlights) {
	const [pending, setPending] = useState<Pending[]>([]);
	const [notice, setNotice] = useState<HistoryNotice | null>(null);
	const [, rerender] = useReducer((value: number) => value + 1, 0);
	const undoStack = useRef<Entry[]>([]);
	const redoStack = useRef<Entry[]>([]);
	const queue = useRef<Promise<unknown>>(Promise.resolve());
	const sequence = useRef(0);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	useEffect(() => {
		setPending(list => {
			const next = list.filter(entry => !entry.settled && !reflected(entry.overlay, saved));
			return next.length === list.length ? list : next;
		});
	}, [saved]);

	function show(overlay: Overlay | undefined) {
		if (!overlay) return () => {};
		const key = ++sequence.current;
		setPending(list => [...list, { key, overlay, settled: false }]);
		return (failed: boolean) => {
			if (!mounted.current) return;
			setPending(list =>
				failed
					? list.filter(entry => entry.key !== key)
					: list.map(entry => (entry.key === key ? { ...entry, settled: true } : entry)),
			);
			// The live query normally reflects the write first; never leave a stale overlay behind.
			if (!failed)
				setTimeout(() => {
					if (mounted.current) setPending(list => list.filter(entry => entry.key !== key));
				}, 1500);
		};
	}
	function enqueue<T>(work: () => Promise<T>) {
		const result = queue.current.then(work);
		queue.current = result.catch(() => undefined);
		return result;
	}

	function run(
		perform: () => Promise<Change>,
		{ overlay, saving, done, undone }: { overlay?: Overlay; saving: string; done: string; undone: string },
	) {
		const settle = show(overlay);
		const entry: Entry = { change: enqueue(perform), overlay, done, undone };
		redoStack.current = [];
		undoStack.current.push(entry);
		setNotice({ phase: 'saving', message: saving });
		rerender();
		entry.change.then(
			() => {
				settle(false);
				if (mounted.current && undoStack.current.at(-1) === entry) setNotice({ phase: 'saved', message: done });
			},
			error => {
				settle(true);
				undoStack.current = undoStack.current.filter(item => item !== entry);
				if (!mounted.current) return;
				rerender();
				setNotice({ phase: 'error', message: `${done.replace(/\.$/, '')} failed: ${reason(error)}` });
			},
		);
		return entry.change;
	}

	async function step(direction: 'undo' | 'redo') {
		const from = direction === 'undo' ? undoStack.current : redoStack.current;
		const to = direction === 'undo' ? redoStack.current : undoStack.current;
		const entry = from.pop();
		if (!entry) return;
		rerender();
		const overlay = entry.overlay && {
			show: direction === 'undo' ? entry.overlay.restore : entry.overlay.show,
			hide:
				direction === 'undo'
					? entry.overlay.show.map(item => item.id)
					: [...entry.overlay.hide, ...entry.overlay.restore.map(item => item.id)],
			restore: [],
		};
		const settle = show(overlay);
		setNotice({
			phase: direction === 'undo' ? 'undoing' : 'saving',
			message: direction === 'undo' ? 'Undoing…' : 'Redoing…',
		});
		try {
			await enqueue(async () => {
				// A change whose write failed has nothing to revert.
				const change = await entry.change.catch(() => null);
				if (!change) return;
				if (direction === 'undo') await repository.apply(change.after, change.before);
				else await repository.apply(change.before, change.after);
			});
			settle(false);
			to.push(entry);
			if (!mounted.current) return;
			rerender();
			setNotice({
				phase: direction === 'undo' ? 'undone' : 'redone',
				message: direction === 'undo' ? entry.undone : entry.done,
			});
		} catch (error) {
			settle(true);
			if (!mounted.current) return;
			// A conflict is permanent; any other failure can be retried.
			if (!(error instanceof ChangeConflictError)) from.push(entry);
			rerender();
			setNotice({
				phase: 'error',
				message:
					error instanceof ChangeConflictError
						? `Couldn't ${direction}: ${error.message}`
						: `Couldn't ${direction}. Try again. ${reason(error)}`,
			});
		}
	}

	const items = useMemo(
		() =>
			applyOverlays(
				saved,
				pending.map(entry => entry.overlay),
			),
		[saved, pending],
	);
	return {
		items,
		run,
		undo: () => step('undo'),
		redo: () => step('redo'),
		canUndo: undoStack.current.length > 0,
		canRedo: redoStack.current.length > 0,
		notice,
		dismissNotice: () => setNotice(null),
		/** Resolves once every queued highlight write has finished (successfully or not). */
		idle: () => queue.current.then(() => undefined),
	};
}
