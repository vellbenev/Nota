export function modelModeLabel(model: string, endpoint: string) {
	if (model.endsWith('-cloud')) return 'Cloud-based';
	try {
		return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname)
			? 'Local-only model'
			: 'Local model · remote endpoint';
	} catch {
		return 'Local model · check endpoint';
	}
}

