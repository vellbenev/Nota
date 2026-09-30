import { GENERATION_OPTIONS, type BuiltPrompt, type TutorAction } from '../../prompts/context.ts';
import { database, type NotaDatabase } from './database.ts';
export interface CachedResponse {
	key: string;
	docId: string;
	action: TutorAction;
	modelId: string;
	promptVersion: string;
	text: string;
	createdAt: number;
	bytes: number;
}
export const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export const CACHE_MAX_BYTES = 50 * 1024 * 1024;
export async function responseCacheKey(prompt: BuiltPrompt, modelId: string) {
	const source = prompt.envelope.untrusted_source;
	// JSON tuple prevents delimiter collisions. Preserve paragraph boundaries and math whitespace.
	const normalizedText = source.selected_text.normalize('NFC').replace(/\r\n?/g, '\n').trim();
	const context = { ...prompt.envelope, untrusted_source: { ...source, selected_text: undefined } };
	const bytes = new TextEncoder().encode(
		JSON.stringify([
			source.docId,
			prompt.envelope.action,
			normalizedText,
			context,
			modelId,
			prompt.promptVersion,
			GENERATION_OPTIONS,
		]),
	);
	return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte =>
		byte.toString(16).padStart(2, '0'),
	).join('');
}
export function createCacheRepository(db: NotaDatabase = database) {
	return {
		async get(key: string): Promise<CachedResponse | undefined> {
			const entry = await db.responseCache.get(key);
			if (entry && Date.now() - entry.createdAt > CACHE_MAX_AGE) {
				await db.responseCache.delete(key);
				return undefined;
			}
			return entry;
		},
		async put(value: Omit<CachedResponse, 'createdAt' | 'bytes'>) {
			if ((value.action !== 'translate_en_fa' && value.action !== 'clarify_fa') || !value.text.trim()) return;
			const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
			if (bytes > CACHE_MAX_BYTES) return;
			await db.transaction('rw', db.responseCache, async () => {
				await db.responseCache
					.where('createdAt')
					.below(Date.now() - CACHE_MAX_AGE)
					.delete();
				await db.responseCache.put({ ...value, bytes, createdAt: Date.now() });
				const entries = await db.responseCache.orderBy('createdAt').toArray();
				let size = entries.reduce((sum, item) => sum + item.bytes, 0);
				for (const entry of entries) {
					if (size <= CACHE_MAX_BYTES) break;
					await db.responseCache.delete(entry.key);
					size -= entry.bytes;
				}
			});
		},
	};
}
export const responseCache = createCacheRepository();

