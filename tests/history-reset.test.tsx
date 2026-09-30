import { act, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { useTutor } from '../src/features/assistant/useTutor';
import type { TutorInput } from '../src/prompts/context';
const observed = vi.hoisted(() => ({
	inputs: [] as TutorInput[],
	complete: undefined as undefined | ((input: TutorInput, text: string) => void),
}));
vi.mock('../src/features/assistant/execution', () => ({
	TutorExecution: class {
		constructor(
			_emit: unknown,
			_cache: unknown,
			_stream: unknown,
			_buffer: unknown,
			complete: (i: TutorInput, t: string) => void,
		) {
			observed.complete = complete;
		}
		reset() {}
		cancel() {}
		run(input: TutorInput) {
			observed.inputs.push(input);
			return Promise.resolve();
		}
	},
}));
test('individual deletion forgets its history; full reset clears every document history', async () => {
	const { result, unmount } = renderHook(() => useTutor());
	const input: TutorInput = { docId: 'one', page: 1, text: 'Excerpt', action: 'ask', question: 'Why?' };
	const settings = { baseUrl: 'http://localhost:11434', modelId: 'local' };
	observed.complete!(input, 'Answer one');
	observed.complete!({ ...input, docId: 'two' }, 'Answer two');
	await act(async () => {
		await result.current.run(input, settings);
	});
	expect(observed.inputs.at(-1)?.history).toHaveLength(2);
	act(() => result.current.forget('one'));
	await act(async () => {
		await result.current.run(input, settings);
	});
	expect(observed.inputs.at(-1)?.history ?? []).toHaveLength(0);
	await act(async () => {
		await result.current.run({ ...input, docId: 'two' }, settings);
	});
	expect(observed.inputs.at(-1)?.history).toHaveLength(2);
	act(() => result.current.forget());
	await act(async () => {
		await result.current.run({ ...input, docId: 'two' }, settings);
	});
	expect(observed.inputs.at(-1)?.history ?? []).toHaveLength(0);
	unmount();
});

