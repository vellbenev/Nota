import { responseCache, responseCacheKey } from '../../infrastructure/db/cache.ts';
import { streamChat } from '../../ollama.ts';
import { buildPrompt, type TutorInput } from '../../prompts/context.ts';
import { createDisplayBuffer } from './displayBuffer.ts';
import type { AssistantEvent, Identity } from './machine.ts';
import { requireVision } from './vision.ts';
export interface TutorSettings {
	baseUrl: string;
	modelId: string;
}
interface Active extends Identity {
	controller: AbortController;
	signature: string;
	promise?: Promise<void>;
	buffer: ReturnType<typeof createDisplayBuffer>;
}
export class TutorExecution {
	private active: Active | null = null;
	private emit: (event: AssistantEvent) => void;
	private cache: typeof responseCache;
	private stream: typeof streamChat;
	private makeBuffer: typeof createDisplayBuffer;
	private vision: typeof requireVision;
	private onComplete?: (input: TutorInput, text: string) => void;
	constructor(
		emit: (event: AssistantEvent) => void,
		cache = responseCache,
		stream = streamChat,
		makeBuffer = createDisplayBuffer,
		onComplete?: (input: TutorInput, text: string) => void,
		vision = requireVision,
	) {
		this.vision = vision;
		this.emit = emit;
		this.cache = cache;
		this.stream = stream;
		this.makeBuffer = makeBuffer;
		this.onComplete = onComplete;
	}
	cancel() {
		const active = this.active;
		if (!active) return;
		active.controller.abort();
		active.buffer.flush();
		active.buffer.cancel();
		this.emit({ type: 'cancel', requestId: active.requestId, docId: active.docId });
		this.active = null;
	}
	reset() {
		this.cancel();
		this.emit({ type: 'reset' });
	}
	run(input: TutorInput, settings: TutorSettings, regenerate = false): Promise<void> {
		const signature = JSON.stringify([input, settings]);
		if (this.active?.signature === signature) return this.active.promise ?? Promise.resolve();
		this.cancel();
		const prompt = buildPrompt(input);
		const identity = { requestId: crypto.randomUUID(), docId: input.docId };
		const controller = new AbortController();
		let firstToken: number | undefined,
			sentAt = 0;
		const buffer = this.makeBuffer(text => {
			if (this.active?.requestId === identity.requestId && text)
				this.emit({ type: 'chunk', ...identity, text, ttftMs: firstToken ?? 0 });
		});
		const active: Active = { ...identity, controller, signature, buffer };
		this.active = active;
		const valid = () => this.active === active && !controller.signal.aborted;
		this.emit({ type: 'queue', ...identity, input, prompt });
		active.promise = (async () => {
			let warning = '';
			try {
				const cacheable =
					(input.action === 'translate_en_fa' || input.action === 'clarify_fa') &&
					!input.docId.startsWith('session:');
				const modelId = `${settings.baseUrl.replace(/\/$/, '')}|${settings.modelId}`;
				const key = cacheable ? await responseCacheKey(prompt, modelId) : '';
				if (!valid()) return;
				if (cacheable && !regenerate) {
					try {
						const cached = await this.cache.get(key);
						if (!valid()) return;
						if (cached) {
							this.emit({ type: 'complete', ...identity, text: cached.text, cached: true });
							this.onComplete?.(input, cached.text);
							return;
						}
					} catch {
						warning = 'Response cache unavailable; this answer may not be saved.';
					}
				}
				if (!valid()) return;
				if (input.action === 'explain_image') {
					await this.vision(settings.baseUrl, settings.modelId, controller.signal);
					if (!valid()) return;
				}
				this.emit({ type: 'waiting', ...identity });
				sentAt = performance.now();
				await this.stream(
					settings.baseUrl,
					settings.modelId,
					input.text,
					input.page,
					controller.signal,
					part => {
						if (!valid()) return;
						if (part) {
							firstToken ??= performance.now() - sentAt;
							buffer.append(part);
						}
					},
					{ action: input.action, question: input.question, prompt },
				);
				if (!valid()) return;
				const text = buffer.flush();
				if (!text.trim()) throw new Error('Ollama completed without a visible answer. Try regenerating.');
				if (cacheable) {
					try {
						await this.cache.put({
							key,
							docId: input.docId,
							action: input.action,
							modelId,
							promptVersion: prompt.promptVersion,
							text,
						});
					} catch {
						warning = 'Answer complete, but it could not be saved to the response cache.';
					}
				}
				if (!valid()) return;
				this.emit({ type: 'complete', ...identity, text, cached: false, warning });
				this.onComplete?.(input, text);
			} catch (error) {
				if (!valid()) return;
				buffer.flush();
				this.emit({
					type: 'error',
					...identity,
					error: error instanceof Error ? error.message : String(error),
				});
			} finally {
				buffer.cancel();
				if (this.active === active) this.active = null;
			}
		})();
		return active.promise;
	}
}

