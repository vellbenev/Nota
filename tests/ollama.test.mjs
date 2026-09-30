import assert from 'node:assert/strict';
import test from 'node:test';
import { streamChat } from '../src/ollama.ts';

function mockStream(parts) {
	const original = globalThis.fetch;
	globalThis.fetch = async () =>
		new Response(
			new ReadableStream({
				start(controller) {
					for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
					controller.close();
				},
			}),
			{ status: 200 },
		);
	return () => {
		globalThis.fetch = original;
	};
}

test('parses NDJSON across byte boundaries and multiple lines', async () => {
	const restore = mockStream([
		'{"message":{"content":"Hel',
		'lo"}}\n{"message":{"content":" world"}}\n{"do',
		'ne":true}\n',
	]);
	const text = [];
	try {
		await streamChat('http://localhost:11434', 'test', 'passage', 1, new AbortController().signal, part =>
			text.push(part),
		);
		assert.equal(text.join(''), 'Hello world');
	} finally {
		restore();
	}
});

test('rejects a stream without a terminal done event', async () => {
	const restore = mockStream(['{"message":{"content":"partial"}}']);
	try {
		await assert.rejects(
			streamChat('http://localhost:11434', 'test', 'passage', 1, new AbortController().signal, () => {}),
			/done event/,
		);
	} finally {
		restore();
	}
});

test('Stop aborts the underlying HTTP fetch signal and cancels the stream reader immediately', async () => {
	const original = globalThis.fetch;
	let receivedSignal,
		cancelled = false;
	globalThis.fetch = async (_url, options) => {
		receivedSignal = options.signal;
		return new Response(
			new ReadableStream({
				cancel() {
					cancelled = true;
				},
			}),
		);
	};
	try {
		const controller = new AbortController();
		const pending = streamChat('http://localhost:11434', 'local', 'text', 1, controller.signal, () => {});
		await new Promise(resolve => setImmediate(resolve));
		controller.abort();
		assert.equal(receivedSignal.aborted, true);
		await assert.rejects(pending, error => error.name === 'AbortError');
		assert.equal(cancelled, true);
	} finally {
		globalThis.fetch = original;
	}
});

