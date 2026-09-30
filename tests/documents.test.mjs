import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { NotaDatabase } from '../src/infrastructure/db/database.ts';
import { createDocumentRepository } from '../src/infrastructure/db/documents.ts';
import { hashBlob } from '../src/infrastructure/pdf/hashDigest.ts';

const makeFile = (body = 'one', name = 'paper.pdf') =>
	new File([`%PDF-1.7\n${body}`], name, { type: 'application/pdf' });

async function withDb(run) {
	const db = new NotaDatabase(`nota-test-${crypto.randomUUID()}`);
	try {
		await run(db, createDocumentRepository(db));
	} finally {
		await db.delete();
	}
}

test('identical bytes reuse a record and preserve blob, metadata and view', async () =>
	withDb(async (db, repo) => {
		const file = makeFile();
		const id = await hashBlob(file);
		const first = await repo.importDocument(file, id);
		await repo.updatePageCount(id, 120);
		const view = { page: 83, offset: 0.42, zoom: 1.5 };
		await repo.saveView(id, view);
		const second = await repo.importDocument(makeFile('one', 'renamed.pdf'), id);
		assert.equal(first.isExisting, false);
		assert.equal(second.isExisting, true);
		assert.equal(await db.documents.count(), 1);
		assert.equal(second.document.createdAt, first.document.createdAt);
		assert.equal(second.document.name, 'paper.pdf');
		assert.equal(second.document.pageCount, 120);
		assert.deepEqual(second.document.view, view);
		assert.equal(await second.document.pdfBlob.text(), await file.text());
		assert.equal('pdfBlob' in (await repo.listDocuments())[0], false);
	}));

test('concurrent imports are atomic and different bytes remain separate', async () =>
	withDb(async (db, repo) => {
		const file = makeFile();
		const id = await hashBlob(file);
		const imports = await Promise.all(Array.from({ length: 4 }, () => repo.importDocument(file, id)));
		assert.equal(imports.filter(result => !result.isExisting).length, 1);
		const other = makeFile('two');
		await repo.importDocument(other, await hashBlob(other));
		assert.equal(await db.documents.count(), 2);
	}));

test('reimport repairs a missing PDF Blob while retaining its identity and view', async () =>
	withDb(async (db, repo) => {
		const file = makeFile();
		const id = await hashBlob(file);
		await repo.importDocument(file, id);
		await repo.saveView(id, { page: 3, offset: 0.2, zoom: 1.25 });
		await db.documents.update(id, { pdfBlob: undefined });
		await assert.rejects(repo.reopenDocument(id), /no longer available/);
		const repaired = await repo.importDocument(file, id);
		assert.equal(repaired.isExisting, true);
		assert.equal(await db.documents.count(), 1);
		assert.equal(await repaired.document.pdfBlob.text(), await file.text());
		assert.equal(repaired.document.view.page, 3);
	}));

test('close/reopen restores the PDF and page state; partial updates preserve bytes', async () =>
	withDb(async (db, repo) => {
		const file = makeFile();
		const id = await hashBlob(file);
		await repo.importDocument(file, id);
		await repo.updatePageCount(id, 100);
		await repo.saveView(id, { page: 99, offset: 0.6, zoom: 2 });
		db.close();
		const reopenedDb = new NotaDatabase(db.name);
		try {
			const reopened = await createDocumentRepository(reopenedDb).reopenDocument(id);
			assert.equal(reopened.pageCount, 100);
			assert.deepEqual(reopened.view, { page: 99, offset: 0.6, zoom: 2 });
			assert.equal(await reopened.pdfBlob.text(), await file.text());
		} finally {
			reopenedDb.close();
		}
	}));

test('view bounds, missing records and a rejected storage transaction are explicit', async () =>
	withDb(async (db, repo) => {
		const file = makeFile();
		const id = await hashBlob(file);
		await assert.rejects(repo.reopenDocument(id), /no longer available/);
		await assert.rejects(repo.saveView(id, { page: 1, offset: 0, zoom: 1 }), /removed/);
		const add = db.documents.add.bind(db.documents);
		db.documents.add = () => Promise.reject(new DOMException('Storage is full', 'QuotaExceededError'));
		await assert.rejects(repo.importDocument(file, id), /Storage is full/);
		assert.equal(await db.documents.count(), 0);
		db.documents.add = add;
		await repo.importDocument(file, id);
		await repo.updatePageCount(id, 2);
		await repo.saveView(id, { page: 500, offset: -1, zoom: Infinity });
		assert.deepEqual((await repo.reopenDocument(id)).view, { page: 2, offset: 0, zoom: 1 });
	}));

