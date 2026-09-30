import { useEffect, useRef, useState } from 'react';
import type { Highlight } from '../../domain/highlight';
import { highlights } from '../../infrastructure/db/highlights';

type Operation = { id: string; write: Promise<Highlight>; undone: boolean };
type Notice = { phase: 'saving' | 'saved' | 'undoing' | 'undone' | 'error'; message: string };

/** Optimistic creation with stable IDs; Undo waits for a pending write before removing it. */
export function useHighlightCreation(saved: Highlight[], repository = highlights) {
	const [optimistic, setOptimistic] = useState<Highlight[]>([]);
	const [hidden, setHidden] = useState<string[]>([]);
	const [notice, setNotice] = useState<Notice | null>(null);
	const last = useRef<Operation | null>(null);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	useEffect(() => {
		setOptimistic(items =>
			items.some(item => saved.some(s => s.id === item.id))
				? items.filter(item => !saved.some(s => s.id === item.id))
				: items,
		);
	}, [saved]);
	function create(value: Omit<Highlight, 'id' | 'createdAt'>) {
		const id = crypto.randomUUID();
		setOptimistic(items => [...items, { ...value, id, createdAt: Date.now() }]);
		setNotice({ phase: 'saving', message: 'Saving highlight…' });
		const operation: Operation = { id, write: repository.save(value, id), undone: false };
		last.current = operation;
		void operation.write.then(
			() => {
				if (mounted.current && last.current === operation && !operation.undone)
					setNotice(current =>
						current?.phase === 'error' ? current : { phase: 'saved', message: 'Highlight saved' },
					);
			},
			error => {
				if (!mounted.current) return;
				setOptimistic(items => items.filter(item => item.id !== id));
				if (!operation.undone) {
					if (last.current === operation) last.current = null;
					setNotice({
						phase: 'error',
						message: `Highlight was not saved. Select the passage to retry. ${String(error)}`,
					});
				}
			},
		);
	}
	async function undo() {
		const operation = last.current;
		if (!operation || operation.undone) return;
		operation.undone = true;
		setHidden(ids => [...ids, operation.id]);
		setOptimistic(items => items.filter(item => item.id !== operation.id));
		setNotice({ phase: 'undoing', message: 'Undoing highlight…' });
		try {
			// If creation failed there is no record to remove.
			const written = await operation.write.catch(() => null);
			if (written) await repository.remove(operation.id);
			if (mounted.current && last.current === operation) {
				last.current = null;
				setNotice({ phase: 'undone', message: 'Highlight undone' });
			}
		} catch (error) {
			operation.undone = false;
			if (mounted.current) {
				setHidden(ids => ids.filter(id => id !== operation.id));
				if (last.current === operation)
					setNotice({
						phase: 'error',
						message: `Could not undo highlight. Try Undo again. ${String(error)}`,
					});
			}
		}
	}
	const items = [...saved, ...optimistic.filter(item => !saved.some(s => s.id === item.id))].filter(
		item => !hidden.includes(item.id),
	);
	function dismissNotice() {
		last.current = null;
		setNotice(null);
	}
	return { items, create, undo, notice, dismissNotice, canUndo: !!last.current && !last.current.undone };
}
