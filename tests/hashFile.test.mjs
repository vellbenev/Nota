import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { hashBlob } from '../src/infrastructure/pdf/hashDigest.ts';
import { hashFile } from '../src/infrastructure/pdf/hashFile.ts';
import { validatePdf } from '../src/infrastructure/pdf/validatePdf.ts';

test('SHA-256 matches standard vectors and depends only on PDF bytes', async () => {
	assert.equal(await hashBlob(new Blob(['abc'])), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
	assert.equal(await hashBlob(new Blob([])), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
	const bytes = new Uint8Array(4 * 1024 * 1024 + 123).map((_, index) => index % 251);
	const first = new File([bytes], 'paper.pdf');
	const renamed = new File([bytes], 'renamed.pdf', { type: 'application/pdf', lastModified: 123 });
	const expected = createHash('sha256').update(bytes).digest('hex');
	assert.equal(await hashBlob(first), expected);
	assert.equal(await hashBlob(renamed), expected);
	bytes[bytes.length - 1] ^= 1;
	assert.notEqual(await hashBlob(new Blob([bytes])), expected);
});

test('worker bridge terminates on result and cancellation', async () => {
	const original = globalThis.Worker;
	const workers = [];
	class WorkerStub {
		terminated = false;
		constructor() {
			workers.push(this);
		}
		postMessage() {}
		terminate() {
			this.terminated = true;
		}
	}
	globalThis.Worker = WorkerStub;
	try {
		const result = hashFile(new Blob(['abc']));
		const digest = await hashBlob(new Blob(['abc']));
		workers[0].onmessage({ data: { docId: digest } });
		assert.equal(await result, digest);
		assert.equal(workers[0].terminated, true);
		const controller = new AbortController();
		const cancelled = hashFile(new Blob(['abc']), controller.signal);
		controller.abort();
		await assert.rejects(cancelled, { name: 'AbortError' });
		assert.equal(workers[1].terminated, true);
		await assert.rejects(hashFile(new Blob(), controller.signal), { name: 'AbortError' });
		assert.equal(workers.length, 2);
	} finally {
		globalThis.Worker = original;
	}
});

test('import validation rejects empty and disguised non-PDF files', async () => {
	await validatePdf(new File(['%PDF-1.7\nfixture'], 'paper.PDF'));
	await assert.rejects(validatePdf(new File([], 'empty.pdf')), /empty/);
	await assert.rejects(validatePdf(new File(['plain text'], 'fake.pdf')), /PDF header/);
	await assert.rejects(validatePdf(new File(['plain text'], 'note.txt')), /Choose a PDF/);
});

