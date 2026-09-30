/** Capability checks send only the model name, never the image or PDF text. */
export async function requireVision(baseUrl: string, model: string, signal: AbortSignal): Promise<void> {
	signal.throwIfAborted();
	try {
		const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/show`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ model }),
			signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
		});
		if (!response.ok)
			throw new Error(
				`Could not verify vision support for ${model} (HTTP ${response.status}). Check Ollama and select an installed vision-capable model, then retry Explain snip.`,
			);
		const data = (await response.json()) as { capabilities?: unknown };
		signal.throwIfAborted();
		if (!Array.isArray(data.capabilities) || !data.capabilities.includes('vision'))
			throw new Error(
				`Vision requires a vision-capable model. ${model} does not report image support. Select an installed vision model in Model and retry Explain snip. If capabilities are missing, update Ollama first.`,
			);
	} catch (error) {
		signal.throwIfAborted();
		throw new Error(
			`Vision check failed: ${error instanceof Error ? error.message : String(error)} Check the Ollama connection and selected model, then retry Explain snip.`,
		);
	}
}

