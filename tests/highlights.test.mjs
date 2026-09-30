import 'fake-indexeddb/auto';
import { Dexie } from 'dexie';
import assert from 'node:assert/strict';
import test from 'node:test';
import { NotaDatabase } from '../src/infrastructure/db/database.ts';
import { createDocumentRepository } from '../src/infrastructure/db/documents.ts';
import { createHighlightRepository } from '../src/infrastructure/db/highlights.ts';
const docId = 'a'.repeat(64),
	other = 'b'.repeat(64);
const input = {
	docId,
	page: 1,
	rects: [[0.1, 0.2, 0.3, 0.04]],
	anchor: { quote: 'English فارسی', prefix: 'before ', suffix: ' after' },
	color: 'yellow',
};
test('v1 upgrades preserve documents; highlights and notes survive reopen, isolate documents and delete atomically without network', async () => {
	const name = `highlights-${crypto.randomUUID()}`;
	const old = new Dexie(name);
	old.version(1).stores({ documents: '&docId, lastOpenedAt' });
	await old
		.table('documents')
		.put({ docId, name: 'paper.pdf', pdfBlob: new Blob(['pdf']), view: { page: 1, offset: 0, zoom: 1 } });
	old.close();
	const db = new NotaDatabase(name),
		repo = createHighlightRepository(db);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = () => {
		throw new Error('Local highlights must never fetch');
	};
	try {
		assert.equal((await db.documents.get(docId)).name, 'paper.pdf');
		const saved = await repo.save(input);
		await repo.addNote(saved.id, 'Local note فارسی');
		await repo.color(saved.id, 'blue');
		await createDocumentRepository(db).importDocument(new File(['%PDF-other'], 'other.pdf'), other);
		assert.deepEqual(await repo.list(other), []);
		db.close();
		await db.open();
		assert.equal((await repo.list(docId))[0].color, 'blue');
		assert.deepEqual((await repo.list(docId))[0].anchor, input.anchor);
		assert.equal((await repo.notes(docId))[0].text, 'Local note فارسی');
		await repo.remove(saved.id);
		assert.equal((await repo.list(docId)).length, 0);
		assert.equal((await repo.notes(docId)).length, 0);
		await assert.rejects(repo.addNote(saved.id, 'orphan'), /no longer exists/);
		await assert.rejects(repo.save({ ...input, docId: 'missing' }), /Save the document/);
		await assert.rejects(repo.save({ ...input, rects: [[0, 0, 2, 1]] }), /Invalid/);
	} finally {
		globalThis.fetch = originalFetch;
		await db.delete();
	}
});

