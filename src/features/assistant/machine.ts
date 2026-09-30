import type { BuiltPrompt, TutorInput } from '../../prompts/context.ts';
export type RequestStatus = 'idle' | 'queued' | 'ttft' | 'streaming' | 'complete' | 'error' | 'cancelled';
export interface AssistantState {
	status: RequestStatus;
	requestId: string | null;
	docId: string | null;
	text: string;
	error: string;
	warning: string;
	cached: boolean;
	ttftMs: number | null;
	input?: TutorInput;
	prompt?: BuiltPrompt;
}
export const initialAssistant: AssistantState = {
	status: 'idle',
	requestId: null,
	docId: null,
	text: '',
	error: '',
	warning: '',
	cached: false,
	ttftMs: null,
};
export type Identity = { requestId: string; docId: string };
export type AssistantEvent =
	| { type: 'reset' }
	| ({ type: 'queue'; input: TutorInput; prompt: BuiltPrompt } & Identity)
	| ({ type: 'waiting' } & Identity)
	| ({ type: 'chunk'; text: string; ttftMs: number } & Identity)
	| ({ type: 'complete'; text: string; cached: boolean; warning?: string } & Identity)
	| ({ type: 'error'; error: string } & Identity)
	| ({ type: 'cancel' } & Identity);
export const isBusy = (status: RequestStatus) => ['queued', 'ttft', 'streaming'].includes(status);
export function assistantReducer(state: AssistantState, event: AssistantEvent): AssistantState {
	if (event.type === 'reset') return initialAssistant;
	if (event.type === 'queue') return { ...initialAssistant, ...event, status: 'queued' };
	if (event.requestId !== state.requestId || event.docId !== state.docId || !isBusy(state.status)) return state;
	switch (event.type) {
		case 'waiting':
			return { ...state, status: 'ttft' };
		case 'chunk':
			return { ...state, status: 'streaming', text: event.text, ttftMs: state.ttftMs ?? event.ttftMs };
		case 'complete':
			return {
				...state,
				status: 'complete',
				text: event.text,
				cached: event.cached,
				warning: event.warning ?? '',
			};
		case 'error':
			return { ...state, status: 'error', error: event.error };
		case 'cancel':
			return { ...state, status: 'cancelled' };
	}
}

