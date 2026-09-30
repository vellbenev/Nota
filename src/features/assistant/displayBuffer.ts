/** Coalesce all token chunks; Markdown renders at most 20 times/sec, aligned with frames. */
export function createDisplayBuffer(
	emit: (text: string) => void,
	schedule = requestAnimationFrame,
	unschedule = cancelAnimationFrame,
	now = () => performance.now(),
) {
	let frame = 0,
		text = '',
		previous = -Infinity;
	const tick = () => {
		frame = 0;
		if (now() - previous >= 50) {
			previous = now();
			emit(text);
		} else frame = schedule(tick);
	};
	return {
		append(part: string) {
			text += part;
			if (!frame) frame = schedule(tick);
		},
		flush() {
			if (frame) unschedule(frame);
			frame = 0;
			emit(text);
			return text;
		},
		cancel() {
			if (frame) unschedule(frame);
			frame = 0;
		},
		text: () => text,
	};
}

