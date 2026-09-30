import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_VIEW, type DocumentSummary, type OpenDocument, type ReaderView } from '../../domain/document.ts';
import { documents, type DocumentRepository } from '../../infrastructure/db/documents.ts';
import { hashFile } from '../../infrastructure/pdf/hashFile.ts';
import { validatePdf } from '../../infrastructure/pdf/validatePdf.ts';

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function useDocumentLibrary(onBeforeOpen: () => void, repository: DocumentRepository = documents) {
	const [active, setActive] = useState<OpenDocument | null>(null);
	const [library, setLibrary] = useState<DocumentSummary[]>([]);
	const [status, setStatus] = useState('Opening saved library…');
	const [notice, setNotice] = useState('');
	const [error, setError] = useState('');
	const [fallback, setFallback] = useState<File | null>(null);
	const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
	const [deleting, setDeleting] = useState(false);
	const deletingRef = useRef(false);
	const importWrite = useRef<Promise<unknown>>(Promise.resolve());
	const activeRef = useRef<OpenDocument | null>(null);
	const operation = useRef(0);
	const hashing = useRef<AbortController | null>(null);
	const pendingView = useRef<{ docId: string; view: ReaderView; revision: number } | null>(null);
	const viewRevision = useRef(0);
	const viewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const writeQueue = useRef(Promise.resolve());

	const refresh = useCallback(async () => setLibrary(await repository.listDocuments()), [repository]);

	const flushView = useCallback(() => {
		clearTimeout(viewTimer.current);
		const pending = pendingView.current;
		pendingView.current = null;
		if (pending) {
			writeQueue.current = writeQueue.current
				.then(() => repository.saveView(pending.docId, pending.view))
				.then(() => {
					if (viewRevision.current === pending.revision) setSaveStatus('saved');
				})
				.catch((failure: unknown) => {
					setSaveStatus('error');
					setError(
						`Could not save reading position: ${errorMessage(failure)} Keep this tab open or retry storage.`,
					);
				});
		}
		return writeQueue.current;
	}, [repository]);

	const activate = useCallback(
		(opened: OpenDocument) => {
			// Import can take time. Clear any selection/request made on the old paper
			// while hashing was running, as well as at the start of the import.
			onBeforeOpen();
			activeRef.current = opened;
			setActive(opened);
			setSaveStatus('saved');
		},
		[onBeforeOpen],
	);

	useEffect(() => {
		let cancelled = false;
		const token = operation.current;
		void (async () => {
			try {
				const saved = await repository.listDocuments();
				if (cancelled || operation.current !== token) return;
				setLibrary(saved);
				if (saved[0]) {
					const document = await repository.reopenDocument(saved[0].docId);
					if (cancelled || operation.current !== token) return;
					activate({ document, persistent: true });
					setNotice('Restored your most recently opened paper.');
				}
			} catch (failure) {
				if (!cancelled && operation.current === token)
					setError(`Browser storage is unavailable: ${errorMessage(failure)}`);
			} finally {
				if (!cancelled && operation.current === token) setStatus('');
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [repository, activate, onBeforeOpen]);

	useEffect(() => {
		const flush = () => {
			void flushView();
		};
		const hidden = () => {
			if (document.visibilityState === 'hidden') flush();
		};
		window.addEventListener('pagehide', flush);
		document.addEventListener('visibilitychange', hidden);
		return () => {
			hashing.current?.abort();
			operation.current += 1;
			flush();
			window.removeEventListener('pagehide', flush);
			document.removeEventListener('visibilitychange', hidden);
		};
	}, [flushView]);

	async function importFile(file: File | undefined) {
		if (!file || deletingRef.current) return;
		const token = ++operation.current;
		hashing.current?.abort();
		const controller = new AbortController();
		hashing.current = controller;
		setStatus('Checking PDF…');
		setError('');
		setNotice('');
		setFallback(null);
		let validFile = false;
		try {
			await validatePdf(file);
			if (operation.current !== token) return;
			validFile = true;
			onBeforeOpen();
			setStatus('Calculating document identity…');
			const docId = await hashFile(file, controller.signal);
			if (operation.current !== token) return;
			await flushView();
			if (operation.current !== token) return;
			setStatus('Saving PDF in this browser…');
			const writing = repository.importDocument(file, docId);
			importWrite.current = writing.catch(() => undefined);
			const result = await writing;
			if (operation.current !== token) return;
			activate({ document: result.document, persistent: true });
			setNotice(
				result.isExisting
					? 'Already in your library — restored the saved reading position.'
					: 'PDF saved in this browser.',
			);
			await refresh().catch((failure: unknown) => {
				if (operation.current === token)
					setError(`PDF saved, but the library could not refresh: ${errorMessage(failure)}`);
			});
		} catch (failure) {
			if (operation.current !== token || controller.signal.aborted) return;
			if (validFile) {
				setFallback(file);
				setError(
					`Could not save this PDF: ${errorMessage(failure)} You can read it for this session without saving.`,
				);
			} else setError(errorMessage(failure));
		} finally {
			if (operation.current === token) setStatus('');
		}
	}

	async function reopen(docId: string) {
		if (deletingRef.current) return;
		const token = ++operation.current;
		hashing.current?.abort();
		onBeforeOpen();
		setStatus('Opening saved paper…');
		setError('');
		setFallback(null);
		try {
			await flushView();
			if (operation.current !== token) return;
			const document = await repository.reopenDocument(docId);
			if (operation.current !== token) return;
			activate({ document, persistent: true });
			setNotice('Opened from browser storage.');
			await refresh();
		} catch (failure) {
			if (operation.current === token) setError(errorMessage(failure));
		} finally {
			if (operation.current === token) setStatus('');
		}
	}

	async function readForSession() {
		if (!fallback || deletingRef.current) return;
		const token = ++operation.current;
		hashing.current?.abort();
		onBeforeOpen();
		await flushView();
		if (operation.current !== token) return;
		const now = Date.now();
		activate({
			persistent: false,
			document: {
				docId: `session:${crypto.randomUUID()}`,
				name: fallback.name,
				size: fallback.size,
				mime: 'application/pdf',
				pageCount: 0,
				createdAt: now,
				lastOpenedAt: now,
				pdfBlob: fallback,
				view: { ...DEFAULT_VIEW },
			},
		});
		setFallback(null);
		setError('');
		setNotice('Session only: this PDF and its reading position will not be restored after closing this tab.');
	}

	const activeId = active?.document.docId;
	const updateView = useCallback(
		(view: ReaderView) => {
			const current = activeRef.current;
			if (!current || current.document.docId !== activeId) return;
			current.document.view = view;
			if (!current.persistent) return;
			pendingView.current = { docId: current.document.docId, view, revision: ++viewRevision.current };
			setSaveStatus('saving');
			clearTimeout(viewTimer.current);
			viewTimer.current = setTimeout(() => {
				void flushView();
			}, 180);
		},
		[flushView, activeId],
	);

	const updatePageCount = useCallback(
		(pageCount: number) => {
			const current = activeRef.current;
			if (!current || current.document.docId !== activeId || current.document.pageCount === pageCount) return;
			const docId = current.document.docId;
			current.document.pageCount = pageCount;
			setLibrary(rows => rows.map(row => (row.docId === docId ? { ...row, pageCount } : row)));
			if (current.persistent)
				void repository.updatePageCount(docId, pageCount).catch((failure: unknown) => {
					setError(`Could not save PDF metadata: ${errorMessage(failure)}`);
				});
		},
		[repository, activeId],
	);

	async function retryStorage() {
		setError('');
		if (fallback) {
			await importFile(fallback);
			return;
		}
		try {
			await refresh();
			if (activeRef.current?.persistent) {
				updateView({ ...activeRef.current.document.view });
				await flushView();
			}
		} catch (failure) {
			setError(errorMessage(failure));
		}
	}

	async function deleteData(docId?: string): Promise<boolean> {
		if (deletingRef.current) return false;
		deletingRef.current = true;
		setDeleting(true);
		operation.current += 1;
		hashing.current?.abort();
		onBeforeOpen();
		clearTimeout(viewTimer.current);
		pendingView.current = null;
		viewRevision.current += 1;
		activeRef.current = null;
		setActive(null);
		setFallback(null);
		setError('');
		setNotice('');
		setStatus(docId ? 'Deleting document data…' : 'Resetting browser data…');
		try {
			await importWrite.current;
			await writeQueue.current;
			if (docId) await repository.deleteDocument(docId);
			else await repository.wipeData();
			await refresh();
			setSaveStatus('saved');
			setNotice(docId ? 'Document and associated data deleted.' : 'All Nota browser data deleted.');
			return true;
		} catch (failure) {
			setError(`Could not delete data: ${errorMessage(failure)} Retry the data controls.`);
			return false;
		} finally {
			deletingRef.current = false;
			setDeleting(false);
			setStatus('');
		}
	}

	return {
		refreshLibrary: refresh,
		flushPendingView: flushView,
		deleteData,
		deleting,
		active,
		library,
		status,
		notice,
		error,
		fallback,
		saveStatus,
		importFile,
		reopen,
		readForSession,
		updateView,
		updatePageCount,
		retryStorage,
	};
}
