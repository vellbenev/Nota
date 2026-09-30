import { useState } from 'react';
import { Button, Dropdown, Textarea } from '../../components/ui';
import type { Annotation, Highlight, HighlightColor } from '../../domain/highlight';
import styles from './NotesPanel.module.css';
export interface HighlightActions {
	onColor: (id: string, color: HighlightColor) => Promise<void>;
	onRemove: (id: string) => Promise<void>;
	onAddNote: (id: string, text: string) => Promise<void>;
	onUpdateNote: (id: string, text: string) => Promise<void>;
	onRemoveNote: (id: string) => Promise<void>;
	onAsk: (item: Highlight) => void;
	onExplain: (item: Highlight) => void;
}
export default function HighlightEditor({
	item,
	notes,
	draft,
	onDraft,
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
	draft: string;
	onDraft: (text: string) => void;
}) {
	const [busy, setBusy] = useState(false),
		[error, setError] = useState('');
	const [editing, setEditing] = useState<string | null>(null),
		[editText, setEditText] = useState('');
	const [deleting, setDeleting] = useState<string | null>(null);
	async function run(action: () => Promise<void>) {
		if (busy) return;
		setBusy(true);
		setError('');
		try {
			await action();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setBusy(false);
		}
	}
	return (
		<div className={styles.editor}>
			<div className={styles.actions}>
				<Dropdown
					label={`Highlight color for page ${item.page}`}
					value={item.color}
					disabled={busy}
					onChange={color => void run(() => onColor(item.id, color as HighlightColor))}
					options={(['yellow', 'green', 'blue'] as const).map(color => ({
						value: color,
						label: color[0].toUpperCase() + color.slice(1),
						icon: '●',
					}))}
				/>
				<Button size='sm' variant='ghost' disabled={busy} onClick={() => onExplain(item)}>
					Explain
				</Button>
				<Button size='sm' variant='ghost' disabled={busy} onClick={() => onAsk(item)}>
					Ask
				</Button>
				<Button size='sm' variant='ghost' disabled={busy} onClick={() => setDeleting('highlight')}>
					Remove highlight
				</Button>
			</div>
			{deleting === 'highlight' && (
				<div className={styles.confirm} role='group' aria-label='Confirm highlight removal'>
					<p>
						Remove this highlight and its {notes.length} note{notes.length === 1 ? '' : 's'}?
					</p>
					<Button
						size='sm'
						variant='danger'
						disabled={busy}
						onClick={() => void run(() => onRemove(item.id))}
					>
						Confirm removal
					</Button>
					<Button size='sm' variant='ghost' disabled={busy} onClick={() => setDeleting(null)}>
						Cancel removal
					</Button>
				</div>
			)}
			{notes.map(note => (
				<div key={note.id} className={styles.note}>
					{editing === note.id ? (
						<form
							onSubmit={event => {
								event.preventDefault();
								void run(async () => {
									await onUpdateNote(note.id, editText);
									setEditing(null);
								});
							}}
						>
							<Textarea
								aria-label={`Edit note for page ${item.page}`}
								dir='auto'
								value={editText}
								maxLength={10000}
								onChange={event => setEditText(event.target.value)}
								disabled={busy}
								required
							/>
							<div className={styles.formActions}>
								<Button size='sm' type='submit' disabled={busy || !editText.trim()}>
									Save note
								</Button>
								<Button size='sm' variant='ghost' disabled={busy} onClick={() => setEditing(null)}>
									Cancel edit
								</Button>
							</div>
						</form>
					) : (
						<>
							<p dir='auto'>{note.text}</p>
							<div className={styles.noteActions}>
								<Button
									size='sm'
									variant='ghost'
									disabled={busy}
									onClick={() => {
										setEditing(note.id);
										setEditText(note.text);
									}}
								>
									Edit note
								</Button>
								<Button size='sm' variant='ghost' disabled={busy} onClick={() => setDeleting(note.id)}>
									Delete note
								</Button>
							</div>
						</>
					)}
					{deleting === note.id && (
						<div className={styles.confirm} role='group' aria-label='Confirm note deletion'>
							<p>Delete this note? The highlight will remain.</p>
							<Button
								size='sm'
								variant='danger'
								disabled={busy}
								onClick={() =>
									void run(async () => {
										await onRemoveNote(note.id);
										setDeleting(null);
									})
								}
							>
								Confirm note deletion
							</Button>
							<Button size='sm' variant='ghost' disabled={busy} onClick={() => setDeleting(null)}>
								Cancel deletion
							</Button>
						</div>
					)}
				</div>
			))}
			<form
				onSubmit={event => {
					event.preventDefault();
					void run(async () => {
						await onAddNote(item.id, draft);
						onDraft('');
					});
				}}
			>
				<label className={styles.label} htmlFor={`note-${item.id}`}>
					Add a local note
				</label>
				<Textarea
					id={`note-${item.id}`}
					aria-label={`Note for page ${item.page}`}
					value={draft}
					onChange={event => onDraft(event.target.value)}
					dir='auto'
					placeholder='Your thoughts on this passage…'
					maxLength={10000}
					disabled={busy}
					required
				/>
				<Button size='sm' type='submit' disabled={busy || !draft.trim()}>
					Add note
				</Button>
			</form>
			{busy && <p role='status'>Saving changes…</p>}
			{error && (
				<p className={styles.error} role='alert'>
					{error}
				</p>
			)}
		</div>
	);
}
