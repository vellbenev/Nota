import assert from 'node:assert/strict';
import test from 'node:test';
import { TutorExecution } from '../src/features/assistant/execution.ts';
import { requireVision } from '../src/features/assistant/vision.ts';
import { cropFromPoints, cropPlan, validateSnip } from '../src/infrastructure/pdf/snip.ts';
import { streamChat } from '../src/ollama.ts';
import { buildPrompt } from '../src/prompts/context.ts';
const image = { base64: 'AAAA', mime: 'image/png', bytes: 3, width: 100, height: 80, rect: [0.1, 0.2, 0.3, 0.4] };
const input = { docId: 'paper', page: 4, text: '', action: 'explain_image', image, question: 'Explain the axes' };
const settings = { baseUrl: 'http://localhost:11434', modelId: 'vision-model' };
const buffer = emit => {
	let text = '';
	return {
		append: p => (text += p),
		flush: () => {
			emit(text);
			return text;
		},
		cancel: () => {},
		text: () => text,
	};
};

test('crop coordinates clamp reverse drags to one page; reject tiny and invalid areas', () => {
	assert.deepEqual(
		cropFromPoints({ x: 260, y: 220 }, { x: -20, y: 20 }, { left: 10, top: 20, width: 200, height: 200 }),
		[0, 0, 1, 1],
	);
	assert.deepEqual(
		cropFromPoints({ x: 60, y: 70 }, { x: 160, y: 170 }, { left: 10, top: 20, width: 200, height: 200 }),
		[0.25, 0.25, 0.5, 0.5],
	);
	assert.equal(cropFromPoints({ x: 1, y: 1 }, { x: 3, y: 3 }, { left: 0, top: 0, width: 100, height: 100 }), null);
	assert.equal(
		cropFromPoints({ x: NaN, y: 1 }, { x: 30, y: 30 }, { left: 0, top: 0, width: 100, height: 100 }),
		null,
	);
});
test('crop render plan uses 2x at low zoom and clamps large/rotated crops to 1024', () => {
	assert.deepEqual(cropPlan([0.25, 0.25, 0.5, 0.5], 600, 800, 300), {
		scale: 2,
		width: 600,
		height: 800,
		x: 300,
		y: 400,
	});
	const whole = cropPlan([0, 0, 1, 1], 800, 600, 1600);
	assert.equal(whole.width, 1024);
	assert.equal(whole.height, 768);
	assert.throws(() => cropPlan([0.9, 0, 0.2, 1], 600, 800, 600), /valid area/);
	assert.throws(() => validateSnip({ ...image, width: 1025 }), /oversized/);
	assert.throws(() => validateSnip({ ...image, bytes: 99 }), /byte size/);
});
test('vision prompt and actual Ollama payload contain one raw base64 user image and page/question metadata', async () => {
	const prompt = buildPrompt(input);
	assert.match(prompt.promptVersion, /explain_image-v1/);
	assert.match(prompt.messages[0].content, /unreadable, truncated/);
	assert.equal(prompt.envelope.untrusted_source.page, 4);
	assert.equal(prompt.envelope.reader_question, input.question);
	assert.equal(JSON.stringify(prompt.envelope).includes('AAAA'), false);
	const original = globalThis.fetch;
	let body;
	globalThis.fetch = async (_url, options) => {
		body = JSON.parse(options.body);
		return new Response('{"message":{"content":"answer"},"done":true}\n');
	};
	try {
		await streamChat(settings.baseUrl, settings.modelId, '', 4, new AbortController().signal, () => {}, {
			action: 'explain_image',
			prompt,
		});
		assert.deepEqual(body.messages[1].images, ['AAAA']);
		assert.equal(body.messages[0].images, undefined);
	} finally {
		globalThis.fetch = original;
	}
});
test('vision capabilities are verified explicitly; unknown, unsupported and unavailable models fail closed', async () => {
	const original = globalThis.fetch;
	let calls = [];
	try {
		globalThis.fetch = async (url, options) => {
			calls.push([url, JSON.parse(options.body)]);
			return Response.json({ capabilities: ['completion', 'vision'] });
		};
		await requireVision(settings.baseUrl, 'vision-model', new AbortController().signal);
		assert.deepEqual(calls[0], [settings.baseUrl + '/api/show', { model: 'vision-model' }]);
		for (const data of [{ capabilities: ['completion'] }, {}]) {
			globalThis.fetch = async () => Response.json(data);
			await assert.rejects(
				requireVision(settings.baseUrl, 'text-model', new AbortController().signal),
				/vision-capable/,
			);
		}
		globalThis.fetch = async () => new Response('offline', { status: 503 });
		await assert.rejects(requireVision(settings.baseUrl, 'vision-model', new AbortController().signal), /HTTP 503/);
		globalThis.fetch = async () => {
			throw new TypeError('Network failure');
		};
		await assert.rejects(
			requireVision(settings.baseUrl, 'vision-model', new AbortController().signal),
			/Network failure/,
		);
	} finally {
		globalThis.fetch = original;
	}
});
test('snip lifecycle gates chat, bypasses disk cache, handles network error and cancels capability and chat requests', async () => {
	let signal,
		finish,
		chatCalls = 0;
	const events = [];
	const cache = {
		get: async () => {
			throw Error('must not read cache');
		},
		put: async () => {
			throw Error('must not write cache');
		},
	};
	const gate = async (_u, _m, s) => {
		signal = s;
		await new Promise(r => {
			finish = r;
		});
	};
	const runner = new TutorExecution(
		e => events.push(e),
		cache,
		async () => {
			chatCalls++;
		},
		buffer,
		undefined,
		gate,
	);
	const pending = runner.run(input, settings);
	assert.equal(chatCalls, 0);
	runner.cancel();
	assert.equal(signal.aborted, true);
	finish();
	await pending;
	assert.equal(chatCalls, 0);
	const failure = new TutorExecution(
		e => events.push(e),
		cache,
		async () => {
			throw Error('Network failure');
		},
		buffer,
		undefined,
		async () => {},
	);
	await failure.run(input, settings);
	assert.equal(events.at(-1).type, 'error');
	assert.match(events.at(-1).error, /Network failure/);
	const stream = new TutorExecution(
		e => events.push(e),
		cache,
		async (_u, _m, _t, _p, s, cb) => {
			signal = s;
			cb('partial');
			await new Promise(r => {
				finish = r;
			});
		},
		buffer,
		undefined,
		async () => {},
	);
	signal = undefined;
	const streaming = stream.run(input, settings);
	while (!signal) await new Promise(r => setImmediate(r));
	stream.reset();
	assert.equal(signal.aborted, true);
	finish();
	await streaming;
	assert.equal(events.at(-1).type, 'reset');
	const blocked = new TutorExecution(
		e => events.push(e),
		cache,
		async () => {
			chatCalls++;
		},
		buffer,
		undefined,
		async () => {
			throw Error('Select a vision-capable model');
		},
	);
	await blocked.run(input, settings);
	assert.equal(chatCalls, 0);
	assert.equal(events.at(-1).type, 'error');
});

