import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLibraryTransfer, MAX_BACKUP_BYTES, prepareBackup } from '../src/features/library/transfer.ts';
import { NotaDatabase } from '../src/infrastructure/db/database.ts';
import { createDocumentRepository } from '../src/infrastructure/db/documents.ts';
import { createHighlightRepository } from '../src/infrastructure/db/highlights.ts';
import { hashBlob } from '../src/infrastructure/pdf/hashDigest.ts';
async function fixture() {
	const db = new NotaDatabase(`nota-transfer-${crypto.randomUUID()}`),
		docs = createDocumentRepository(db);
	const file = new File(['%PDF-1.7\ntransfer fixture\n%%EOF'], 'Research فارسی.pdf', { type: 'application/pdf' });
	const docId = await hashBlob(file);
	await docs.importDocument(file, docId);
	await docs.updatePageCount(docId, 5);
	await docs.saveView(docId, { page: 4, offset: 0.3, zoom: 1, fit: 'page' });
	const highlights = createHighlightRepository(db);
	const mark = await highlights.save({
		docId,
		page: 4,
		color: 'green',
		rects: [[0.1, 0.2, 0.4, 0.03]],
		anchor: { quote: 'Evidence <img src="remote">\nSecond line', prefix: 'Before', suffix: 'After' },
	});
	await highlights.addNote(mark.id, 'My note فارسی [link](https://example.com)');
	return { db, docs, docId, mark, highlights, transfer: createLibraryTransfer(db) };
}

test('backup round trip restores exact PDF bytes, reading mode, marks and notes without network access', async () => {
	const source = await fixture(),
		target = new NotaDatabase(`nota-restored-${crypto.randomUUID()}`);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = () => {
		throw new Error('No network allowed');
	};
	try {
		const prepared = await prepareBackup(await source.transfer.backup());
		const result = await createLibraryTransfer(target).restore(prepared);
		assert.deepEqual(result, { documents: 1, highlights: 1, notes: 1 });
		target.close();
		await target.open();
		const doc = await target.documents.get(source.docId);
		assert.equal(await doc.pdfBlob.text(), await (await source.db.documents.get(source.docId)).pdfBlob.text());
		assert.deepEqual(doc.view, { page: 4, offset: 0.3, zoom: 1, fit: 'page' });
		assert.deepEqual(await target.highlights.toArray(), await source.db.highlights.toArray());
		assert.deepEqual(await target.annotations.toArray(), await source.db.annotations.toArray());
		assert.equal(await target.responseCache.count(), 0);
	} finally {
		globalThis.fetch = originalFetch;
		await source.db.delete();
		await target.delete();
	}
});

test('merging is idempotent and preserves newer local edits, colors and reading positions', async () => {
	const source = await fixture();
	try {
		const prepared = await prepareBackup(await source.transfer.backup());
		const note = (await source.highlights.notes(source.docId))[0];
		await source.highlights.updateNote(note.id, 'Newer local edit');
		await source.highlights.color(source.mark.id, 'blue');
		await source.docs.saveView(source.docId, { page: 2, offset: 0.6, zoom: 1.5 });
		assert.deepEqual(await source.transfer.restore(prepared), { documents: 0, highlights: 0, notes: 0 });
		assert.equal((await source.db.annotations.get(note.id)).text, 'Newer local edit');
		assert.equal((await source.db.highlights.get(source.mark.id)).color, 'blue');
		assert.equal((await source.db.documents.get(source.docId)).view.page, 2);
		await source.db.annotations.delete(note.id);
		assert.equal((await source.transfer.restore(prepared)).notes, 1);
		assert.equal((await source.transfer.restore(prepared)).notes, 0);
	} finally {
		await source.db.delete();
	}
});

test('malformed backups, damaged PDFs and orphan notes are rejected before any write', async () => {
	const source = await fixture(),
		target = new NotaDatabase(`nota-invalid-${crypto.randomUUID()}`);
	try {
		const backup = JSON.parse(await (await source.transfer.backup()).text());
		for (const mutate of [
			value => {
				value.version = 99;
			},
			value => {
				value.documents[0].pdfBase64 = btoa('%PDF-1.7\ncorrupted');
			},
			value => {
				value.notes[0].highlightId = 'missing';
			},
			value => {
				value.highlights[0].rects = [[0.9, 0.1, 0.3, 0.1]];
			},
			value => {
				value.documents[0].view.fit = ['page'];
			},
			value => {
				value.highlights.push(value.highlights[0]);
			},
		]) {
			const value = structuredClone(backup);
			mutate(value);
			await assert.rejects(() => prepareBackup(new Blob([JSON.stringify(value)])));
		}
		await assert.rejects(() => prepareBackup(new Blob(['not JSON'])));
		await assert.rejects(() => prepareBackup({ size: MAX_BACKUP_BYTES + 1 }), /256 MiB/);
		assert.equal(await target.documents.count(), 0);
	} finally {
		await source.db.delete();
		await target.delete();
	}
});

test('conflicting identifiers roll back the complete restore transaction', async () => {
	const source = await fixture();
	try {
		const prepared = await prepareBackup(await source.transfer.backup());
		await source.db.highlights.update(source.mark.id, { docId: 'another-document' });
		await source.db.documents.delete(source.docId);
		await assert.rejects(() => source.transfer.restore(prepared), /Conflicting highlight/);
		assert.equal(await source.db.documents.count(), 0); // document insert was rolled back
	} finally {
		await source.db.delete();
	}
});

test('Markdown carries document identity, page numbers and mixed-script notes as safe text', async () => {
	const source = await fixture();
	try {
		const value = await (await source.transfer.markdown(source.docId)).text();
		assert.ok(value.includes('Research فارسی.pdf'));
		assert.ok(value.includes('### Page 4 · green highlight'));
		assert.ok(value.includes(source.docId));
		assert.ok(value.includes('> Second line'));
		assert.ok(value.includes('My note فارسی \\[link\\]'));
		assert.ok(value.includes('\\<img'));
		assert.ok(!/(?<!\\)<img/.test(value));
		await assert.rejects(() => source.transfer.markdown('not-present'), /Save a PDF/);
	} finally {
		await source.db.delete();
	}
});

test('base64 chunk boundaries preserve a larger PDF byte for byte', async () => {
	const db = new NotaDatabase(`nota-chunks-${crypto.randomUUID()}`);
	try {
		const file = new File(['%PDF-1.7\n', 'chunk data\n'.repeat(10_000), '%%EOF'], 'large.pdf');
		const docId = await hashBlob(file);
		await createDocumentRepository(db).importDocument(file, docId);
		const prepared = await prepareBackup(await createLibraryTransfer(db).backup());
		assert.deepEqual(
			new Uint8Array(await prepared.documents[0].pdfBlob.arrayBuffer()),
			new Uint8Array(await file.arrayBuffer()),
		);
	} finally {
		await db.delete();
	}
});
