import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Input } from '../../components/ui';
import type { Annotation, Highlight } from '../../domain/highlight';
import HighlightEditor, { type HighlightActions } from './HighlightEditor';
import styles from './NotesPanel.module.css';
/** PDF line breaks are layout, not meaning: show the passage as running text. */
const readableQuote = (quote: string) => quote.replace(/\s*\n\s*/g, ' ');
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
export default function NotesPanel({
	open,
	items,
	notes,
	activeId,
	onClose,
	onSelect,
	onJump,
	onExport,
	composeRequest,
	...actions
}: HighlightActions & {
	open: boolean;
	items: Highlight[];
	notes: Annotation[];
	activeId: string | null;
	onClose: () => void;
	onSelect: (id: string) => void;
	onJump: (item: Highlight) => void;
	onExport?: () => void;
	/** Focus the note composer of this highlight; `nonce` repeats the request. */
	composeRequest?: { id: string; nonce: number } | null;
}) {
	const [query, setQuery] = useState(''),
		[sort, setSort] = useState('page');
	const list = useRef<HTMLDivElement>(null);
	const [focusTarget, setFocusTarget] = useState<string | null>(null);
	const indexed = useMemo(() => {
		const result = new Map<string, Annotation[]>();
		for (const note of notes) result.set(note.highlightId, [...(result.get(note.highlightId) ?? []), note]);
		return result;
	}, [notes]);
	const filtered = useMemo(() => {
		const needle = query.normalize('NFKC').toLocaleLowerCase().trim();
		return items
			.filter(
				item =>
					!needle ||
					[item.anchor.quote, ...(indexed.get(item.id) ?? []).map(note => note.text)].some(text =>
						text.normalize('NFKC').toLocaleLowerCase().includes(needle),
					),
			)
			.sort((a, b) =>
				sort === 'newest'
					? b.createdAt - a.createdAt
					: a.page - b.page ||
						Math.min(...a.rects.map(r => 1 - r[1] - r[3])) -
							Math.min(...b.rects.map(r => 1 - r[1] - r[3])) ||
						a.createdAt - b.createdAt,
			);
	}, [items, indexed, query, sort]);
	useEffect(() => {
		if (!open || !activeId) return;
		if (!filtered.some(item => item.id === activeId)) setQuery('');
		setFocusTarget(activeId);
	}, [open, activeId]);
	useEffect(() => {
		if (!open || !focusTarget) return;
		const card = Array.from(list.current?.querySelectorAll<HTMLElement>('[data-note-card]') ?? []).find(
			element => element.dataset.noteCard === focusTarget,
		);
		const container = list.current;
		if (card && container) {
			const bounds = container.getBoundingClientRect(),
				target = card.getBoundingClientRect();
			if (target.top < bounds.top) container.scrollTop += target.top - bounds.top;
			else if (target.bottom > bounds.bottom) container.scrollTop += target.bottom - bounds.bottom;
		}
		if (composeRequest?.id !== focusTarget) card?.focus({ preventScroll: true });
		if (card) setFocusTarget(null);
	}, [open, focusTarget, filtered, composeRequest]);
	return (
		<aside
			id='highlight-notes-panel'
			className={styles.panel}
			hidden={!open}
			aria-label='Highlights and notes'
			onKeyDown={event => {
				if (event.key === 'Escape') {
					event.stopPropagation();
					onClose();
				}
			}}
		>
			<header className={styles.header}>
				<div>
					<h2>Highlights & notes</h2>
					<p>
						{plural(items.length, 'highlight')} · {plural(notes.length, 'note')}
					</p>
				</div>
				<div className={styles.headerActions}>
					{onExport && (
						<Button
							size='sm'
							variant='ghost'
							aria-label="Export this paper's notes"
							disabled={!items.length}
							onClick={onExport}
						>
							Export
						</Button>
					)}
					<Button size='icon' variant='ghost' aria-label='Close notes panel' onClick={onClose}>
						×
					</Button>
				</div>
			</header>
			<div className={styles.filters}>
				<Input
					type='search'
					aria-label='Search highlights and notes'
					placeholder='Search passages and notes…'
					value={query}
					onChange={event => setQuery(event.target.value)}
				/>
				<div className={styles.sortRow}>
					<span className={styles.label}>Sort by</span>
					<Dropdown
						label='Sort highlights'
						value={sort}
						onChange={setSort}
						options={[
							{ value: 'page', label: 'Page order' },
							{ value: 'newest', label: 'Newest first' },
						]}
					/>
				</div>
				{query && (
					<Button size='sm' variant='ghost' onClick={() => setQuery('')}>
						Clear search
					</Button>
				)}
			</div>
			<div ref={list} className={styles.list}>
				{!items.length ? (
					<div className={styles.empty}>
						<p>No highlights yet.</p>
						<p>
							Select text in the paper, then pick a color — or press <kbd>H</kbd>. Choose <b>Note</b> to
							write a thought right away.
						</p>
					</div>
				) : !filtered.length ? (
					<p className={styles.empty} role='status'>
						No matching highlights or notes.
					</p>
				) : (
					filtered.map(item => (
						<article
							tabIndex={-1}
							key={item.id}
							data-note-card={item.id}
							className={`${styles.card} ${activeId === item.id ? styles.active : ''}`}
						>
							<div className={styles.cardHeader}>
								<span
									className={`${styles.dot} ${styles[item.color]}`}
									aria-label={`${item.color} highlight`}
								/>
								<Button
									size='sm'
									variant='ghost'
									onClick={() => onJump(item)}
									aria-label={`Go to highlight on page ${item.page}`}
								>
									Page {item.page} ↗
								</Button>
								<span>
									{(indexed.get(item.id) ?? []).length
										? plural((indexed.get(item.id) ?? []).length, 'note')
										: ''}
								</span>
							</div>
							<button
								type='button'
								className={styles.quote}
								dir='auto'
								aria-expanded={activeId === item.id}
								aria-label={`Open highlight on page ${item.page}: ${item.anchor.quote.slice(0, 80)}`}
								onClick={() => onSelect(item.id)}
							>
								{readableQuote(item.anchor.quote)}
							</button>
							{activeId === item.id ? (
								<HighlightEditor
									key={item.id}
									item={item}
									notes={indexed.get(item.id) ?? []}
									focusComposer={composeRequest?.id === item.id ? composeRequest.nonce : undefined}
									{...actions}
								/>
							) : (
								(indexed.get(item.id) ?? []).map(note => (
									<p key={note.id} className={styles.preview} dir='auto'>
										{note.text}
									</p>
								))
							)}
						</article>
					))
				)}
			</div>
		</aside>
	);
}
