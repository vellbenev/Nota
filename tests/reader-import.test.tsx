import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { createRef, StrictMode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import ReaderWorkspace from '../src/features/reader/ReaderWorkspace';
import { NotaDatabase } from '../src/infrastructure/db/database';
import { createDocumentRepository } from '../src/infrastructure/db/documents';

vi.mock('../src/infrastructure/pdf/hashFile.ts', async () => {
	const { hashBlob } = await import('../src/infrastructure/pdf/hashDigest');
	return { hashFile: hashBlob };
});
vi.mock('../src/features/reader/PdfViewport.tsx', () => ({
	default: (props: {
		initialView: { page: number; zoom: number };
		onViewChange: (view: object) => void;
		onPageCount: (count: number) => void;
	}) => (
		<div>
			<p data-testid='restored-view'>
				{props.initialView.page}:{props.initialView.zoom}
			</p>
			<button
				onClick={() => {
					props.onPageCount(100);
					props.onViewChange({ page: 42, offset: 0.3, zoom: 1.5 });
				}}
			>
				Read page 42
			</button>
		</div>
	),
}));

let db: NotaDatabase;
let repo: ReturnType<typeof createDocumentRepository>;
const callbacks = { onDocumentChange: vi.fn(), onSelection: vi.fn(), onSelectionError: vi.fn() };
const file = (name = 'paper.pdf', text = 'one') => new File([`%PDF-1.7\n${text}`], name, { type: 'application/pdf' });
const mount = () =>
	render(
		<StrictMode>
			<ReaderWorkspace inputRef={createRef()} {...callbacks} repository={repo} />
		</StrictMode>,
	);

beforeEach(() => {
	vi.stubGlobal('File', NodeFile);
	vi.stubGlobal('Blob', NodeBlob);
	db = new NotaDatabase(`nota-ui-${crypto.randomUUID()}`);
	repo = createDocumentRepository(db);
});
afterEach(async () => {
	cleanup();
	await db.delete();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

test('file input and drop share persistent import; renamed duplicate restores state', async () => {
	mount();
	await waitFor(() => expect(screen.queryByText('Opening saved library…')).toBeNull());
	fireEvent.change(screen.getByLabelText('Import PDF'), { target: { files: [file()] } });
	await screen.findByRole('heading', { name: 'paper.pdf' });
	fireEvent.click(await screen.findByText('Read page 42'));
	// Switch immediately: the pending reading position must flush before reopen.
	fireEvent.drop(screen.getByRole('region', { name: 'PDF reader' }), {
		dataTransfer: { files: [file('renamed.pdf')], types: ['Files'] },
	});
	await screen.findByText(/Already in your library/);
	expect(await db.documents.count()).toBe(1);
	const record = (await db.documents.toArray())[0];
	expect(record.view).toEqual({ page: 42, offset: 0.3, zoom: 1.5 });
	cleanup();
	mount();
	await screen.findByRole('heading', { name: 'paper.pdf' });
	expect(screen.getByTestId('restored-view').textContent).toBe('42:1.5');
});

test('saved paper switch flushes state and reopens without another upload', async () => {
	mount();
	fireEvent.change(screen.getByLabelText('Import PDF'), { target: { files: [file('first.pdf')] } });
	await screen.findByRole('heading', { name: 'first.pdf' });
	fireEvent.click(await screen.findByText('Read page 42'));
	fireEvent.drop(screen.getByRole('region', { name: 'PDF reader' }), {
		dataTransfer: { files: [file('second.pdf', 'two')], types: ['Files'] },
	});
	await screen.findByRole('heading', { name: 'second.pdf' });
	const first = (await repo.listDocuments()).find(item => item.name === 'first.pdf')!;
	fireEvent.click(screen.getByRole('combobox', { name: 'Saved papers' }));
	fireEvent.click(screen.getByRole('option', { name: /first.pdf/ }));
	await screen.findByRole('heading', { name: 'first.pdf' });
	expect(screen.getByTestId('restored-view').textContent).toBe('42:1.5');
	expect(await db.documents.count()).toBe(2);
});

test('invalid drop writes nothing, and quota failure offers explicit session-only reading', async () => {
	mount();
	fireEvent.drop(screen.getByRole('region', { name: 'PDF reader' }), {
		dataTransfer: { files: [new File(['text'], 'bad.pdf')], types: ['Files'] },
	});
	await screen.findByText('This file does not contain a PDF header.');
	expect(await db.documents.count()).toBe(0);
	vi.spyOn(repo, 'importDocument').mockRejectedValue(new DOMException('Full', 'QuotaExceededError'));
	fireEvent.change(screen.getByLabelText('Import PDF'), { target: { files: [file()] } });
	fireEvent.click(await screen.findByRole('button', { name: 'Read for this session' }));
	await screen.findByRole('heading', { name: 'paper.pdf' });
	expect(screen.getByText('Session only')).toBeTruthy();
	expect(await db.documents.count()).toBe(0);
});

