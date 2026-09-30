import { Suspense, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Button, Dropdown } from '../../components/ui';
import type { DocumentRepository } from '../../infrastructure/db/documents.ts';
import type { SelectedSnip } from '../../infrastructure/pdf/snip';
import { libraryTransfer } from '../library/transfer';
import { useDocumentLibrary } from '../library/useDocumentLibrary.ts';
import DataControls from '../settings/DataControls';
import PdfReaderBoundary from './PdfReaderBoundary.tsx';
import styles from './ReaderWorkspace.module.css';
import { PdfViewport } from './loadPdfViewport.ts';
import type { TextSelection } from './selection.ts';

interface Props {
	inputRef: RefObject<HTMLInputElement | null>;
	onDocumentChange: () => void;
	onSelection: (selection: TextSelection | null) => void;
	onSelectionError: (message: string) => void;
	onAssistantAction?: (selection: TextSelection, action: 'translate' | 'explain' | 'ask') => void;
	onSnip?: (snip: SelectedSnip) => void;
	onDataDeleted?: (docId?: string) => void;
	repository?: DocumentRepository;
	workspaceControls?: ReactNode;
}

export default function ReaderWorkspace({
	inputRef,
	onDocumentChange,
	onSelection,
	onSelectionError,
	onAssistantAction,
	onSnip,
	onDataDeleted,
	repository,
	workspaceControls,
}: Props) {
	const reader = useDocumentLibrary(onDocumentChange, repository);
	const [dragging, setDragging] = useState(false);
	const [controlsHost, setControlsHost] = useState<HTMLDivElement | null>(null);
	const dragDepth = useRef(0);
	const [sampleError, setSampleError] = useState('');
	const active = reader.active;

	async function openSample(language: 'english' | 'persian') {
		setSampleError('');
		try {
			const response = await fetch(`/samples/${language}.pdf`);
			if (!response.ok) throw new Error('Could not load the bundled sample.');
			const blob = await response.blob();
			await reader.importFile(new File([blob], `${language}-sample.pdf`, { type: 'application/pdf' }));
		} catch (failure) {
			setSampleError(failure instanceof Error ? failure.message : String(failure));
		}
	}

	return (
		<section
			className={`reader-pane ${styles.pane} ${dragging ? styles.isDragging : ''}`}
			aria-label='PDF reader'
			onDragEnter={event => {
				if (event.dataTransfer.types.includes('Files')) {
					event.preventDefault();
					dragDepth.current += 1;
					setDragging(true);
				}
			}}
			onDragOver={event => {
				if (event.dataTransfer.types.includes('Files')) {
					event.preventDefault();
					event.dataTransfer.dropEffect = 'copy';
				}
			}}
			onDragLeave={() => {
				dragDepth.current = Math.max(0, dragDepth.current - 1);
				if (!dragDepth.current) setDragging(false);
			}}
			onDrop={event => {
				event.preventDefault();
				dragDepth.current = 0;
				setDragging(false);
				void reader.importFile(event.dataTransfer.files[0]);
			}}
		>
			<input
				id='pdf-input'
				ref={inputRef}
				className='visually-hidden'
				type='file'
				tabIndex={-1}
				aria-label='Import PDF'
				accept='application/pdf,.pdf'
				onChange={event => {
					const file = event.currentTarget.files?.[0];
					event.currentTarget.value = ''; // Selecting the same file again still triggers import.
					void reader.importFile(file);
				}}
			/>
			<header className={`reader-topbar ${styles.topbar}`}>
				<img
					className={`reader-brand ${styles.brand}`}
					src='/brand/logo.svg'
					alt='Nota'
					width={28}
					height={28}
				/>
				<h1 className={`document-title ${styles.title}`} title={active?.document.name}>
					<bdi>{active?.document.name || 'Nota'}</bdi>
				</h1>
				<Dropdown
					id='document-library'
					className={`library-dropdown ${styles.library}`}
					label='Saved papers'
					value={active?.persistent ? active.document.docId : ''}
					placeholder={reader.library.length ? 'Saved papers…' : 'No saved papers yet'}
					searchable
					options={reader.library.map(item => ({
						value: item.docId,
						label: item.name,
						icon: '▤',
						badge: item.pageCount
							? `${item.pageCount} ${item.pageCount === 1 ? 'page' : 'pages'}`
							: undefined,
					}))}
					onChange={docId => {
						if (docId) void reader.reopen(docId);
					}}
				/>
				<div className={`reader-controls-host ${styles.controlsHost}`} ref={setControlsHost} />
				<Button
					className={`reader-open ${styles.openButton}`}
					variant='primary'
					size='sm'
					onClick={() => inputRef.current?.click()}
				>
					Open PDF
				</Button>
				{active && !active.persistent && (
					<span className={`session-badge ${styles.sessionBadge}`}>Session only</span>
				)}
				<div className={styles.workspaceControls}>{workspaceControls}</div>
				<DataControls
					documents={reader.library}
					activeDocId={active?.persistent ? active.document.docId : undefined}
					transfer={{
						markdown: libraryTransfer.markdown,
						backup: async () => {
							await reader.flushPendingView();
							return libraryTransfer.backup();
						},
						restore: async value => {
							const added = await libraryTransfer.restore(value);
							await reader.refreshLibrary();
							return added;
						},
					}}
					busy={reader.deleting}
					onDelete={async docId => {
						onDataDeleted?.(docId);
						return reader.deleteData(docId);
					}}
				/>
			</header>
			{reader.status && (
				<div className={`reader-toast ${styles.toast}`} role='status'>
					{reader.status}
				</div>
			)}
			{reader.notice.startsWith('Already in your library') && (
				<div className={`reader-toast ${styles.toast}`} role='status'>
					{reader.notice}
				</div>
			)}
			{reader.saveStatus === 'error' && (
				<div className={`reader-toast ${styles.toast}`} role='alert'>
					Reading position not saved.
				</div>
			)}
			{(reader.error || sampleError) && (
				<div className={`storage-error reader-toast ${styles.toast} ${styles.toastError}`} role='alert'>
					<p>{reader.error || sampleError}</p>
					{reader.fallback && (
						<Button size='sm' onClick={() => void reader.readForSession()}>
							Read for this session
						</Button>
					)}
					{reader.error && (
						<Button size='sm' onClick={() => void reader.retryStorage()}>
							Retry storage
						</Button>
					)}
				</div>
			)}
			{active ? (
				<PdfReaderBoundary key={active.document.docId}>
					<Suspense fallback={<p role='status'>Loading PDF reader…</p>}>
						<PdfViewport
							onSnip={snip =>
								onSnip?.({ ...snip, docId: active.document.docId, documentName: active.document.name })
							}
							docId={active.document.docId}
							persistent={active.persistent}
							onAssistantAction={(passage, action) =>
								onAssistantAction?.(
									{ ...passage, docId: active.document.docId, documentName: active.document.name },
									action,
								)
							}
							key={active.document.docId}
							blob={active.document.pdfBlob}
							initialView={active.document.view}
							controlsHost={controlsHost}
							onPageCount={reader.updatePageCount}
							onViewChange={reader.updateView}
							onSelection={passage =>
								onSelection(
									passage
										? {
												...passage,
												docId: active.document.docId,
												documentName: active.document.name,
											}
										: null,
								)
							}
							onSelectionError={onSelectionError}
						/>
					</Suspense>
				</PdfReaderBoundary>
			) : (
				<div className={`reader-empty-area ${styles.emptyArea}`}>
					<div className={`empty-reader ${styles.emptyCard}`}>
						<div className={`empty-icon ${styles.emptyIcon}`} aria-hidden='true'>
							<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.3'>
								<path d='M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6' />
							</svg>
						</div>
						<h2>A little clarity. A deeper read.</h2>
						<p>
							Bring your next paper. Highlight an idea, explore a passage, and make room for
							understanding.
						</p>
						<Button variant='primary' onClick={() => inputRef.current?.click()}>
							Choose a PDF
						</Button>
						<div className={`sample-actions ${styles.sampleRow}`}>
							<Button variant='ghost' size='sm' onClick={() => void openSample('english')}>
								Try English sample
							</Button>
							<Button variant='ghost' size='sm' onClick={() => void openSample('persian')}>
								Try Persian sample
							</Button>
						</div>
					</div>
				</div>
			)}
			{dragging && (
				<div className={`drop-overlay ${styles.dropOverlay}`}>Drop a PDF to add it to your library</div>
			)}
		</section>
	);
}

