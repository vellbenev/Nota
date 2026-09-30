export function hashFile(file: Blob, signal?: AbortSignal): Promise<string> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException('Import cancelled.', 'AbortError'));
			return;
		}
		const worker = new Worker(new URL('./hashFile.worker.ts', import.meta.url), { type: 'module' });
		const finish = (docId?: string, error?: Error) => {
			signal?.removeEventListener('abort', abort);
			worker.terminate();
			if (error) reject(error);
			else resolve(docId!);
		};
		const abort = () => finish(undefined, new DOMException('Import cancelled.', 'AbortError'));
		signal?.addEventListener('abort', abort, { once: true });
		worker.onmessage = (event: MessageEvent<{ docId?: string; error?: string }>) => {
			const { docId, error } = event.data;
			if (docId && /^[a-f0-9]{64}$/.test(docId)) finish(docId);
			else finish(undefined, new Error(error || 'The PDF hashing worker returned an invalid digest.'));
		};
		worker.onerror = () => finish(undefined, new Error('The PDF hashing worker failed.'));
		worker.onmessageerror = () => finish(undefined, new Error('Could not read the PDF hashing result.'));
		try {
			worker.postMessage(file);
		} catch (error) {
			finish(undefined, error instanceof Error ? error : new Error(String(error)));
		}
	});
}

