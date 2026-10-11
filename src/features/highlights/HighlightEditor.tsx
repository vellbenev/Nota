import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button, Textarea } from '../../components/ui';
import { HIGHLIGHT_COLORS, type Annotation, type Highlight, type HighlightColor } from '../../domain/highlight';
import styles from './NotesPanel.module.css';
import { hasStoredDraft, useStoredDraft } from './useStoredDraft';
export interface HighlightActions {
	onColor: (id: string, color: HighlightColor) => Promise<unknown>;
	onRemove: (id: string) => Promise<unknown>;
	onAddNote: (id: string, text: string) => Promise<unknown>;
	onUpdateNote: (id: string, text: string) => Promise<unknown>;
	onRemoveNote: (id: string) => Promise<unknown>;
	onAsk: (item: Highlight) => void;
	onExplain: (item: Highlight) => void;
}
const title = (color: string) => color[0].toUpperCase() + color.slice(1);
const message = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));
const submitShortcut = (event: KeyboardEvent<HTMLTextAreaElement>) =>
	event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing;

/** Run one write at a time and surface its failure next to the control that caused it. */
function useAction() {
	const [busy, setBusy] = useState(false),
		[error, setError] = useState('');
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true; // StrictMode re-runs effects after a simulated unmount.
		return () => {
			mounted.current = false;
		};
	}, []);
	async function run(action: () => Promise<unknown>) {
		if (busy) return false;
		setBusy(true);
		setError('');
		try {
			await action();
			return true;
		} catch (failure) {
			if (mounted.current) setError(message(failure));
			return false;
		} finally {
			if (mounted.current) setBusy(false);
		}
	}
	/** For writes the history queue already orders: report failures, never block the UI. */
	function fire(action: () => Promise<unknown>) {
		setError('');
		action().catch(failure => {
			if (mounted.current) setError(message(failure));
		});
	}
	return { busy, error, run, fire };
}

function NoteItem({
	note,
	page,
	onUpdate,
	onRemove,
}: {
	note: Annotation;
	page: number;
	onUpdate: HighlightActions['onUpdateNote'];
	onRemove: HighlightActions['onRemoveNote'];
}) {
	const key = `edit:${note.id}`;
	const [editing, setEditing] = useState(() => hasStoredDraft(key));
	const [text, setText, discard] = useStoredDraft(key, note.text);
	const { busy, error, run, fire } = useAction();
	const field = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		if (editing) field.current?.focus({ preventScroll: true });
	}, [editing]);
	async function save() {
		if (text.trim() === note.text) {
			discard();
			setEditing(false);
			return;
		}
		if (await run(() => onUpdate(note.id, text))) {
			discard();
			setEditing(false);
		}
	}
	if (editing)
		return (
			<form
				className={styles.note}
				onSubmit={event => {
					event.preventDefault();
					void save();
				}}
			>
				<Textarea
					ref={field}
					aria-label={`Edit note for page ${page}`}
					dir='auto'
					value={text}
					maxLength={10000}
					onChange={event => setText(event.target.value)}
					onKeyDown={event => {
						if (submitShortcut(event)) {
							event.preventDefault();
							void save();
						} else if (event.key === 'Escape') {
							event.preventDefault();
							event.stopPropagation();
							discard();
							setEditing(false);
						}
					}}
					readOnly={busy}
					required
				/>
				<div className={styles.formActions}>
					<Button size='sm' type='submit' variant='primary' disabled={busy || !text.trim()}>
						Save note
					</Button>
					<Button
						size='sm'
						variant='ghost'
						disabled={busy}
						onClick={() => {
							discard();
							setEditing(false);
						}}
					>
						Cancel edit
					</Button>
					<span className={styles.hint}>⌘/Ctrl ↵ saves · Esc cancels</span>
				</div>
				{error && (
					<p className={styles.error} role='alert'>
						{error}
					</p>
				)}
			</form>
		);
	return (
		<div className={styles.note}>
			<p dir='auto' onDoubleClick={() => setEditing(true)}>
				{note.text}
			</p>
			<div className={styles.noteActions}>
				<Button size='sm' variant='ghost' disabled={busy} onClick={() => setEditing(true)}>
					Edit note
				</Button>
				<Button size='sm' variant='ghost' disabled={busy} onClick={() => fire(() => onRemove(note.id))}>
					Delete note
				</Button>
			</div>
			{error && (
				<p className={styles.error} role='alert'>
					{error}
				</p>
			)}
		</div>
	);
}

export default function HighlightEditor({
	item,
	notes,
	focusComposer,
	onColor,
	onRemove,
	onAddNote,
	onUpdateNote,
	onRemoveNote,
	onAsk,
	onExplain,
}: HighlightActions & {
	item: Highlight;
	notes: Annotation[];
	/** Changes when the composer should take focus (e.g. after "Note" in the selection menu). */
	focusComposer?: number;
}) {
	const [draft, setDraft, clearDraft] = useStoredDraft(`note:${item.id}`);
	const { busy, error, run, fire } = useAction();
	const composer = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		if (focusComposer) composer.current?.focus({ preventScroll: false });
	}, [focusComposer]);
	async function add() {
		if (!draft.trim()) return;
		if (await run(() => onAddNote(item.id, draft))) {
			clearDraft();
			composer.current?.focus({ preventScroll: true });
		}
	}
	return (
		<div className={styles.editor}>
			{notes.map(note => (
				<NoteItem key={note.id} note={note} page={item.page} onUpdate={onUpdateNote} onRemove={onRemoveNote} />
			))}
			<form
				className={styles.composer}
				onSubmit={event => {
					event.preventDefault();
					void add();
				}}
			>
				<Textarea
					ref={composer}
					id={`note-${item.id}`}
					aria-label={`Note for page ${item.page}`}
					value={draft}
					onChange={event => setDraft(event.target.value)}
					onKeyDown={event => {
						if (submitShortcut(event)) {
							event.preventDefault();
							void add();
						}
					}}
					dir='auto'
					placeholder={notes.length ? 'Add another note…' : 'Write a note…'}
					maxLength={10000}
					readOnly={busy}
					rows={draft ? 3 : 2}
				/>
				{draft.trim() && (
					<div className={styles.formActions}>
						<Button size='sm' type='submit' variant='primary' disabled={busy}>
							Add note
						</Button>
						<span className={styles.hint}>⌘/Ctrl ↵</span>
					</div>
				)}
			</form>
			<div className={styles.actions}>
				<div className={styles.swatches} role='group' aria-label={`Highlight color for page ${item.page}`}>
					{HIGHLIGHT_COLORS.map(color => (
						<button
							key={color}
							type='button'
							className={`${styles.swatch} ${styles[color]}`}
							aria-label={title(color)}
							aria-pressed={item.color === color}
							title={`${title(color)} highlight`}
							onClick={() => {
								if (item.color !== color) fire(() => onColor(item.id, color));
							}}
						/>
					))}
				</div>
				<Button size='sm' variant='ghost' onClick={() => onExplain(item)}>
					Explain
				</Button>
				<Button size='sm' variant='ghost' onClick={() => onAsk(item)}>
					Ask
				</Button>
				<Button
					size='sm'
					variant='ghost'
					className={styles.remove}
					aria-label='Remove highlight'
					title={
						notes.length ? 'Remove this highlight and its notes (you can undo)' : 'Remove this highlight'
					}
					onClick={() => fire(() => onRemove(item.id))}
				>
					Remove
				</Button>
			</div>
			{busy && (
				<p className={styles.hint} role='status'>
					Saving…
				</p>
			)}
			{error && (
				<p className={styles.error} role='alert'>
					{error}
				</p>
			)}
		</div>
	);
}
