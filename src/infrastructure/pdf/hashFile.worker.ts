import { hashBlob } from './hashDigest.ts';

self.onmessage = async (event: MessageEvent<Blob>) => {
	try {
		self.postMessage({ docId: await hashBlob(event.data) });
	} catch (error) {
		self.postMessage({ error: error instanceof Error ? error.message : 'Could not hash this PDF.' });
	}
};

