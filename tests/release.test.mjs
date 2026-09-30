import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mascotMood } from '../src/features/mascot/projection.ts';
import { NotaDatabase } from '../src/infrastructure/db/database.ts';
import { createDocumentRepository } from '../src/infrastructure/db/documents.ts';
test('mascot projects every assistant lifecycle state', () => {
	assert.deepEqual(['idle', 'queued', 'ttft', 'streaming', 'complete', 'error', 'cancelled'].map(mascotMood), [
		'idle',
		'pondering',
		'pondering',
		'explaining',
		'idle',
		'error',
		'idle',
	]);
});
test('document deletion cascades atomically without touching another document; full wipe rebuilds empty schema', async () => {
	const db = new NotaDatabase(`release-${crypto.randomUUID()}`),
		repo = createDocumentRepository(db);
	try {
		for (const docId of ['a'.repeat(64), 'b'.repeat(64)]) {
			await repo.importDocument(new File(['%PDF-test'], 'paper.pdf'), docId);
			await db.highlights.put({ id: docId, docId, page: 1 });
			await db.annotations.put({ id: docId, docId, page: 1, highlightId: docId });
			await db.responseCache.put({ key: docId, docId, createdAt: Date.now(), text: 'cached' });
		}
		const remove = db.annotations.where.bind(db.annotations);
		db.annotations.where = () => {
			throw Error('transaction failure');
		};
		await assert.rejects(repo.deleteDocument('a'.repeat(64)), /transaction failure/);
		assert.equal(await db.highlights.count(), 2); // earlier delete must roll back
		db.annotations.where = remove;
		await repo.deleteDocument('a'.repeat(64));
		for (const table of db.tables) assert.equal(await table.count(), 1);
		await repo.wipeData();
		for (const table of db.tables) assert.equal(await table.count(), 0);
		await repo.importDocument(new File(['%PDF-new'], 'new.pdf'), 'c'.repeat(64));
		assert.equal(await db.documents.count(), 1);
	} finally {
		await db.delete();
	}
});

test('model privacy label distinguishes cloud, local and remote Ollama endpoints', async () => {
	const { modelModeLabel } = await import('../src/features/settings/modelMode.ts');
	assert.equal(modelModeLabel('gemma-cloud', 'http://localhost:11434'), 'Cloud-based');
	assert.equal(modelModeLabel('local', 'http://127.0.0.1:11434'), 'Local-only model');
	assert.equal(modelModeLabel('local', 'https://server.example'), 'Local model · remote endpoint');
});

