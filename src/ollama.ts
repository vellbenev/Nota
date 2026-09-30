import { buildPrompt, GENERATION_OPTIONS, type BuiltPrompt } from './prompts/context.ts';
export type Probe = { state: 'ready' | 'offline' | 'missing' | 'cors'; message: string; models: string[] };

export async function probeOllama(baseUrl: string, model: string): Promise<Probe> {
	try {
		const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(5000) });
		if (!response.ok) throw new Error(`HTTP ${response.status} from /api/tags`);
		const data = (await response.json()) as { models?: { name: string }[] };
		const models = (data.models ?? []).map(item => item.name);
		if (!models.includes(model))
			return {
				state: 'missing',
				message: `${model} is not listed by Ollama. Pull or select a model before sending.`,
				models,
			};
		return { state: 'ready', message: `${model} is available through Ollama.`, models };
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return {
			state: 'offline',
			message: `Cannot reach Ollama at ${baseUrl}. Start Ollama and check browser origin access. ${detail}`,
			models: [],
		};
	}
}

type ChatChunk = { message?: { content?: string }; done?: boolean; error?: string };

export async function streamChat(
	baseUrl: string,
	model: string,
	selectedText: string,
	page: number,
	signal: AbortSignal,
	onText: (text: string) => void,
	context?: { action: string; question?: string; prompt?: BuiltPrompt },
): Promise<void> {
	signal.throwIfAborted();
	const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		signal,
		body: JSON.stringify({
			model,
			stream: true,
			options: GENERATION_OPTIONS,
			messages: (
				context?.prompt ??
				buildPrompt({
					docId: 'legacy',
					page,
					text: selectedText,
					action:
						context?.action === 'ask'
							? 'ask'
							: context?.action === 'clarify' || context?.action === 'clarify_fa'
								? 'clarify_fa'
								: 'translate_en_fa',
					question: context?.question,
				})
			).messages,
		}),
	});
	if (!response.ok) {
		const detail = (await response.text()).slice(0, 500);
		throw new Error(`Ollama /api/chat returned HTTP ${response.status}: ${detail}`);
	}
	if (!response.body) throw new Error('Ollama returned no response stream.');
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let pending = '';
	let done = false;
	let responseLength = 0;
	const abortReader = () => {
		void reader.cancel().catch(() => undefined);
	};
	signal.addEventListener('abort', abortReader, { once: true });
	const parseLine = (line: string) => {
		signal.throwIfAborted();
		if (!line.trim()) return;
		let chunk: ChatChunk;
		try {
			chunk = JSON.parse(line) as ChatChunk;
		} catch {
			throw new Error('Ollama returned malformed NDJSON.');
		}
		if (chunk.error) throw new Error(chunk.error);
		if (chunk.message?.content) {
			responseLength += chunk.message.content.length;
			if (responseLength > 100_000) throw new Error('The response exceeded the 100,000-character limit.');
			onText(chunk.message.content);
		}
		if (chunk.done) done = true;
	};
	try {
		while (!done) {
			signal.throwIfAborted();
			const part = await reader.read();
			signal.throwIfAborted();
			if (part.done) break;
			pending += decoder.decode(part.value, { stream: true });
			if (pending.length > 1_000_000) throw new Error('Ollama returned an oversized stream frame.');
			let newline = pending.indexOf('\n');
			while (newline !== -1) {
				parseLine(pending.slice(0, newline));
				pending = pending.slice(newline + 1);
				if (done) break;
				newline = pending.indexOf('\n');
			}
		}
		pending += decoder.decode();
		if (!done && pending.trim()) parseLine(pending);
		if (!done) throw new Error('Ollama stream ended before its done event.');
	} finally {
		signal.removeEventListener('abort', abortReader);
		await reader.cancel().catch(() => undefined);
	}
}

