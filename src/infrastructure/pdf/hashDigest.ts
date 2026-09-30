/** Web Crypto is one-shot, not incremental. This runs inside the hashing worker. */
export async function hashBlob(blob: Blob): Promise<string> {
	const bytes = await blob.arrayBuffer();
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

