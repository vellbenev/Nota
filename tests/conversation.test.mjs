import assert from 'node:assert/strict';
import { test } from 'node:test';
import { followUpInput } from '../src/features/assistant/conversation.ts';
import { assistantReducer, initialAssistant } from '../src/features/assistant/machine.ts';
import { buildPrompt, LIMITS } from '../src/prompts/context.ts';
const input = {
	docId: 'paper',
	documentName: 'paper.pdf',
	page: 7,
	text: 'Original passage',
	action: 'ask',
	question: 'Why?',
};
const prompt = buildPrompt(input);

test('follow-ups retain source and answer language while bounding the original branch', () => {
	const source = {
		...input,
		nearby: { before: 'Before', after: 'After' },
		history: Array.from({ length: 8 }, (_, i) => ({
			role: i % 2 ? 'assistant' : 'user',
			content: `${i}${'x'.repeat(1800)}`,
		})),
	};
	const response = { ...initialAssistant, input: source, prompt, text: 'The original answer', status: 'complete' };
	const continued = followUpInput(response, '  Explain this step  ');
	assert.equal(continued.text, input.text);
	assert.equal(continued.docId, input.docId);
	assert.equal(continued.page, input.page);
	assert.deepEqual(continued.nearby, source.nearby);
	assert.equal(continued.question, 'Explain this step');
	assert.equal(continued.outputLanguage, prompt.envelope.output_language);
	assert.ok(continued.history.length <= LIMITS.historyTurns);
	assert.ok(continued.history.reduce((size, turn) => size + turn.content.length, 0) <= LIMITS.history);
	assert.equal(continued.history.at(-1).content, 'The original answer');
	assert.equal(source.history.length, 8); // source turn is not mutated
	assert.throws(() => followUpInput(response, ' '), /question/);
});

test('visible turns are bounded; Regenerate replaces a turn and reset clears the transcript', () => {
	let state = initialAssistant;
	for (let i = 0; i < 14; i++) {
		const id = { docId: input.docId, requestId: String(i) };
		state = assistantReducer(state, { type: 'queue', ...id, input, prompt });
		state = assistantReducer(state, { type: 'complete', ...id, text: `Answer ${i}`, cached: false });
	}
	assert.equal(state.previous.length, 11);
	assert.equal(state.previous[0].requestId, '2');
	assert.equal(state.text, 'Answer 13');
	const old = state.previous;
	state = assistantReducer(state, {
		type: 'queue',
		docId: input.docId,
		requestId: 'regen',
		input,
		prompt,
		replace: true,
	});
	assert.equal(state.previous, old);
	assert.equal(state.previous.at(-1).text, 'Answer 12');
	assert.equal(
		assistantReducer(state, { type: 'chunk', docId: input.docId, requestId: '13', text: 'stale', ttftMs: 1 }),
		state,
	);
	assert.deepEqual(assistantReducer(state, { type: 'reset' }).previous, []);
});
