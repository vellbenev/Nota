import { useRef, useState } from 'react';
import { Button, Dialog, Dropdown, Popover } from '../../components/ui';
import type { DocumentSummary } from '../../domain/document';
import TransferControls, { type TransferActions } from '../library/TransferControls';
import ThemeControl from '../workspace/ThemeControl';
import styles from './DataControls.module.css';
export default function DataControls({
	documents,
	busy: deleting,
	onDelete,
	transfer,
	activeDocId,
}: {
	documents: DocumentSummary[];
	busy: boolean;
	onDelete: (docId?: string) => Promise<boolean>;
	transfer?: TransferActions;
	activeDocId?: string;
}) {
	const [transferring, setTransferring] = useState(false);
	const busy = deleting || transferring;
	const [target, setTarget] = useState(''),
		[confirm, setConfirm] = useState<string | null>(null);
	const cancel = useRef<HTMLButtonElement>(null);
	const name = documents.find(d => d.docId === confirm)?.name;
	return (
		<>
			<Popover label='Data & privacy'>
				<div className={`data-menu ${styles.content}`}>
					<ThemeControl />
					{transfer && (
						<TransferControls
							documents={documents}
							activeDocId={activeDocId}
							disabled={deleting}
							actions={transfer}
							onBusyChange={setTransferring}
						/>
					)}
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
			</Popover>
			<Dialog
				open={confirm !== null}
				busy={busy}
				onDismiss={() => setConfirm(null)}
				initialFocus={cancel}
				labelledBy='delete-title'
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
			</Dialog>
		</>
	);
}
