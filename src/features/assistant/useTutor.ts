import { useCallback, useEffect, useReducer, useRef } from 'react';
import { boundHistory, type HistoryTurn, type TutorInput } from '../../prompts/context.ts';
import { TutorExecution, type TutorSettings } from './execution.ts';
import { assistantReducer, initialAssistant } from './machine.ts';
export function useTutor() {
	const [state, dispatch] = useReducer(assistantReducer, initialAssistant);
	const history = useRef(new Map<string, HistoryTurn[]>());
	const execution = useRef<TutorExecution | null>(null);
	if (!execution.current)
		execution.current = new TutorExecution(dispatch, undefined, undefined, undefined, (input, text) => {
			const previous = history.current.get(input.docId) ?? [];
			history.current.set(
				input.docId,
				boundHistory([
					...previous,
					{ role: 'user', content: `${input.action} (page ${input.page}): ${input.question || input.text}` },
					{ role: 'assistant', content: text },
				]),
			);
			// Keep this session's recent documents bounded too.
			if (history.current.size > 10) history.current.delete(history.current.keys().next().value!);
		});
	useEffect(() => () => execution.current?.reset(), []);
	const reset = useCallback(() => execution.current!.reset(), []);
	const cancel = useCallback(() => execution.current!.cancel(), []);
	const run = useCallback(
		(input: TutorInput, settings: TutorSettings, regenerate = false) =>
			execution.current!.run(
				{
					...input,
					history: input.history ?? (input.action === 'ask' ? history.current.get(input.docId) : []),
				},
				settings,
				regenerate,
			),
		[],
	);
	const forget = useCallback((docId?: string) => {
		execution.current!.reset();
		if (docId) history.current.delete(docId);
		else history.current.clear();
	}, []);
	return { state, run, reset, cancel, forget };
}

