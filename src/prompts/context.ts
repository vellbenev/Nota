import { validateSnip, type SnipImage } from '../infrastructure/pdf/snip.ts';
import { ASK_PROMPT, ASK_VERSION } from './ask.ts';
import { BASE_PROMPT, BASE_VERSION } from './base.ts';
import { CLARIFY_PROMPT, CLARIFY_VERSION } from './clarify.ts';
import { EXPLAIN_IMAGE_PROMPT, EXPLAIN_IMAGE_VERSION } from './explainImage.ts';
import { TRANSLATE_PROMPT, TRANSLATE_VERSION } from './translate.ts';
export type TutorAction = 'translate_en_fa' | 'clarify_fa' | 'ask' | 'explain_image';
export interface HistoryTurn {
	role: 'user' | 'assistant';
	content: string;
}
export interface TutorInput {
	image?: SnipImage;
	docId: string;
	documentName?: string;
	page: number;
	text: string;
	nearby?: { before: string; after: string };
	action: TutorAction;
	question?: string;
	outputLanguage?: 'fa' | 'en';
	history?: HistoryTurn[];
}
export const LIMITS = { selection: 6000, nearby: 1500, question: 2000, history: 4000, historyTurns: 6 };
export const GENERATION_OPTIONS = { temperature: 0.2, num_ctx: 16384, num_predict: 4096 };
const templates = {
	translate_en_fa: [TRANSLATE_VERSION, TRANSLATE_PROMPT],
	clarify_fa: [CLARIFY_VERSION, CLARIFY_PROMPT],
	ask: [ASK_VERSION, ASK_PROMPT],
	explain_image: [EXPLAIN_IMAGE_VERSION, EXPLAIN_IMAGE_PROMPT],
};
/** At most the adjacent paragraph on either side, bounded to 1,500 characters total. */
export function boundNearby(before = '', after = '') {
	const previous =
		before
			.trim()
			.split(/\n\s*\n/u)
			.at(-1) ?? '';
	const next = after.trim().split(/\n\s*\n/u)[0] ?? '';
	return { before: previous.slice(-LIMITS.nearby / 2), after: next.slice(0, LIMITS.nearby / 2) };
}
export function boundHistory(history: HistoryTurn[] = []): HistoryTurn[] {
	let remaining = LIMITS.history;
	const result: HistoryTurn[] = [];
	for (const turn of history.slice(-LIMITS.historyTurns).reverse()) {
		if (!remaining) break;
		const content = turn.content.slice(-Math.min(remaining, 1500));
		result.unshift({ role: turn.role, content });
		remaining -= content.length;
	}
	return result;
}
export function buildPrompt(input: TutorInput) {
	if (!input.docId || !Number.isInteger(input.page) || input.page < 1)
		throw new Error('A document and page anchor are required.');
	if (input.action === 'explain_image') {
		if (!input.image) throw new Error('Select a crop first.');
		validateSnip(input.image);
	}
	if ((input.action !== 'explain_image' && !input.text.trim()) || input.text.length > LIMITS.selection)
		throw new Error('Select between 1 and 6,000 characters.');
	if (input.action === 'ask' && !input.question?.trim()) throw new Error('Enter a question.');
	if ((input.question?.length ?? 0) > LIMITS.question) throw new Error('Keep the question within 2,000 characters.');
	const [actionVersion, instruction] = templates[input.action];
	const promptVersion = `${BASE_VERSION}/${actionVersion}/envelope-v1`;
	const outputLanguage =
		input.action === 'ask' || input.action === 'explain_image'
			? (input.outputLanguage ?? (!input.question || /[\u0600-\u06ff]/u.test(input.question) ? 'fa' : 'en'))
			: 'fa';
	const envelope = {
		action: input.action,
		output_language: outputLanguage,
		untrusted_source: {
			docId: input.docId,
			document: (input.documentName ?? '').slice(0, 200),
			page: input.page,
			image:
				input.action === 'explain_image'
					? {
							width: input.image!.width,
							height: input.image!.height,
							mime: input.image!.mime,
							rect: input.image!.rect,
						}
					: undefined,
			selected_text: input.text,
			nearby_context: boundNearby(input.nearby?.before, input.nearby?.after),
		},
		reader_question:
			input.action === 'ask' || input.action === 'explain_image' ? (input.question ?? '').trim() : '',
		recent_history: boundHistory(input.history),
	};
	return {
		promptVersion,
		envelope,
		messages: [
			{ role: 'system' as const, content: `${BASE_PROMPT}\n\n${instruction}` },
			{
				role: 'user' as const,
				content: JSON.stringify(envelope),
				...(input.action === 'explain_image' ? { images: [input.image!.base64] } : {}),
			},
		],
	};
}
export type BuiltPrompt = ReturnType<typeof buildPrompt>;

