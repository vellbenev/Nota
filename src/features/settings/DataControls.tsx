import { useEffect, useRef, useState } from 'react';
import { Button, Dropdown } from '../../components/ui';
import type { DocumentSummary } from '../../domain/document';
import styles from './DataControls.module.css';
export default function DataControls({
	documents,
	busy,
	onDelete,
}: {
	documents: DocumentSummary[];
	busy: boolean;
	onDelete: (docId?: string) => Promise<boolean>;
}) {
	const [target, setTarget] = useState(''),
		[confirm, setConfirm] = useState<string | null>(null);
	const dialog = useRef<HTMLDialogElement>(null),
		cancel = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (confirm !== null) {
			dialog.current?.showModal();
			cancel.current?.focus();
		} else if (dialog.current?.open) dialog.current.close();
	}, [confirm]);
	const name = documents.find(d => d.docId === confirm)?.name;
	return (
		<details className={`data-controls ${styles.root}`}>
			<summary className={styles.trigger} aria-label='Data & privacy'>
				Settings
			</summary>
			<div className={`data-menu ${styles.menu}`}>
				<p>Stored only in this browser. Deletion cannot be undone; your original files are unaffected.</p>
				<div className='data-dropdown'>
					<span className={`field-label ${styles.menuLabel}`}>Document to delete</span>
					<Dropdown
						label='Document to delete'
						value={target}
						onChange={setTarget}
						disabled={busy}
						searchable
						placeholder='Choose a document…'
						options={documents.map(doc => ({ value: doc.docId, label: doc.name, icon: '▤' }))}
					/>
				</div>
				<Button size='sm' disabled={!target || busy} onClick={() => setConfirm(target)}>
					Delete document data
				</Button>
				<Button variant='danger' size='sm' disabled={busy} onClick={() => setConfirm('')}>
					Reset all Nota data
				</Button>
			</div>
			<dialog
				ref={dialog}
				className={styles.dialog}
				aria-labelledby='delete-title'
				onCancel={e => {
					if (busy) e.preventDefault();
					else setConfirm(null);
				}}
			>
				<h2 id='delete-title'>{confirm === '' ? 'Reset all Nota data?' : 'Delete this document?'}</h2>
				<p>
					{confirm === '' ? 'All saved PDFs' : <bdi>{name}</bdi>}, highlights, notes, cached answers and
					session conversation history will be permanently removed.
				</p>
				<div className={`dialog-actions ${styles.dialogActions}`}>
					<Button ref={cancel} disabled={busy} onClick={() => setConfirm(null)}>
						Cancel
					</Button>
					<Button
						variant='danger'
						loading={busy}
						onClick={() =>
							void (async () => {
								const ok = await onDelete(confirm || undefined);
								if (ok) setTarget('');
								setConfirm(null);
							})()
						}
					>
						Confirm deletion
					</Button>
				</div>
			</dialog>
		</details>
	);
}

