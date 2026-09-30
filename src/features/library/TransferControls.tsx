import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Dropdown } from '../../components/ui';
import type { DocumentSummary } from '../../domain/document';
import styles from '../settings/DataControls.module.css';
import { downloadFile, prepareBackup, type PreparedBackup } from './transfer';
export interface TransferActions {
	markdown: (docId?: string) => Promise<Blob>;
	backup: () => Promise<Blob>;
	restore: (backup: PreparedBackup) => Promise<{ documents: number; highlights: number; notes: number }>;
}
export default function TransferControls({
	documents,
	activeDocId,
	disabled,
	actions,
	onBusyChange,
}: {
	documents: DocumentSummary[];
	activeDocId?: string;
	disabled: boolean;
	actions: TransferActions;
	onBusyChange: (busy: boolean) => void;
}) {
	const [paper, setPaper] = useState(activeDocId ?? '');
	const [working, setWorking] = useState(false),
		[message, setMessage] = useState(''),
		[error, setError] = useState('');
	const [pending, setPending] = useState<PreparedBackup | null>(null);
	const input = useRef<HTMLInputElement>(null);
	const cancel = useRef<HTMLButtonElement>(null);
	const lock = useRef(false);
	useEffect(() => setPaper(activeDocId ?? ''), [activeDocId]);
	async function perform(action: () => Promise<void>) {
		if (disabled || lock.current) return;
		lock.current = true;
		setWorking(true);
		onBusyChange(true);
		setMessage('');
		setError('');
		try {
			await action();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			lock.current = false;
			setWorking(false);
			onBusyChange(false);
		}
	}
	return (
		<section className={styles.transfer} aria-label='Export and backup'>
			<h3>Keep your research</h3>
			<Dropdown
				label='Paper to export'
				value={paper}
				onChange={setPaper}
				disabled={working || disabled}
				options={[
					{ value: '', label: 'All saved papers' },
					...documents.map(doc => ({ value: doc.docId, label: doc.name })),
				]}
			/>
			<Button
				size='sm'
				disabled={working || disabled || !documents.length}
				onClick={() =>
					void perform(async () => {
						downloadFile(await actions.markdown(paper || undefined), 'nota-research-notes.md');
						setMessage('Markdown export downloaded.');
					})
				}
			>
				Export notes · Markdown
			</Button>
			<Button
				size='sm'
				disabled={working || disabled || !documents.length}
				onClick={() =>
					void perform(async () => {
						downloadFile(
							await actions.backup(),
							`nota-library-${new Date().toISOString().slice(0, 10)}.json`,
						);
						setMessage('Library backup downloaded.');
					})
				}
			>
				Back up library
			</Button>
			<Button size='sm' disabled={working || disabled} onClick={() => input.current?.click()}>
				Import backup
			</Button>
			<input
				ref={input}
				type='file'
				tabIndex={-1}
				accept='.json,application/json'
				className='visually-hidden'
				aria-label='Nota backup file'
				onChange={event => {
					const file = event.currentTarget.files?.[0];
					event.currentTarget.value = '';
					if (file) void perform(async () => setPending(await prepareBackup(file)));
				}}
			/>
			<p>
				Backup includes PDFs, reading positions, highlights and notes. Keep the downloaded file private. Maximum
				size: 256 MiB.
			</p>
			{working && <p role='status'>Preparing your research…</p>}
			{message && <p role='status'>{message}</p>}
			{error && !pending && <p role='alert'>{error}</p>}
			<Dialog
				open={pending !== null}
				busy={working}
				onDismiss={() => setPending(null)}
				initialFocus={cancel}
				labelledBy='restore-title'
			>
				<h2 id='restore-title'>Restore a Nota library</h2>
				{pending && (
					<p>
						{pending.documents.length} PDFs · {pending.highlights.length} highlights ·{' '}
						{pending.notes.length} notes
					</p>
				)}
				<p>
					Adds missing items. Existing notes, highlights and reading positions stay unchanged. Importing the
					same backup again adds no duplicates.
				</p>
				<p>Cached AI responses and session conversations are not included.</p>
				<div className={styles.dialogActions}>
					<Button ref={cancel} disabled={working} onClick={() => setPending(null)}>
						Cancel import
					</Button>
					<Button
						variant='primary'
						loading={working}
						onClick={() =>
							void perform(async () => {
								if (!pending) return;
								const added = await actions.restore(pending);
								setPending(null);
								setMessage(
									`Imported ${added.documents} PDFs, ${added.highlights} highlights and ${added.notes} notes. Choose a paper from Saved papers.`,
								);
							})
						}
					>
						Restore library
					</Button>
				</div>
				{error && <p role='alert'>{error}</p>}
			</Dialog>
		</section>
	);
}
