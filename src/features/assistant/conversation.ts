import { boundHistory, type TutorInput } from '../../prompts/context.ts';
import type { AssistantResponse } from './machine';

/** Branch from this answer, rather than the last passage selected in the reader. */
export function followUpInput(response: AssistantResponse, question: string): TutorInput {
	const input = response.input;
	if (!input || !response.text.trim()) throw new Error('Wait for an answer before continuing.');
	if (!question.trim()) throw new Error('Enter a follow-up question.');
	return {
		...input,
		action: input.image ? 'explain_image' : 'ask',
		question: question.trim(),
		outputLanguage: response.prompt?.envelope.output_language ?? input.outputLanguage,
		history: boundHistory([
			...(input.history ?? []),
			{ role: 'user', content: `${input.action} (page ${input.page}): ${input.question || input.text}` },
			{ role: 'assistant', content: response.text },
		]),
	};
}
