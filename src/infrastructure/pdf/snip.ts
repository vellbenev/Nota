import type { PDFPageProxy } from 'pdfjs-dist';
/** Ephemeral snip coordinates are top-left fractions of the displayed (rotated) page. */
export type SnipRect = [number, number, number, number];
export interface SnipImage {
	base64: string;
	mime: 'image/png' | 'image/jpeg';
	width: number;
	height: number;
	bytes: number;
	rect: SnipRect;
}
export interface SelectedSnip {
	docId: string;
	documentName?: string;
	page: number;
	image: SnipImage;
	question: string;
}
export const MAX_SNIP_SIDE = 1024;
export const MAX_SNIP_BYTES = 384 * 1024; // raw bytes; base64 <= 512 KiB
export function cropFromPoints(
	start: { x: number; y: number },
	end: { x: number; y: number },
	box: { left: number; top: number; width: number; height: number },
): SnipRect | null {
	if (
		![start.x, start.y, end.x, end.y, box.left, box.top, box.width, box.height].every(Number.isFinite) ||
		box.width <= 0 ||
		box.height <= 0
	)
		return null;
	const clamp = (n: number) => Math.max(0, Math.min(1, n));
	const x1 = clamp((start.x - box.left) / box.width),
		x2 = clamp((end.x - box.left) / box.width);
	const y1 = clamp((start.y - box.top) / box.height),
		y2 = clamp((end.y - box.top) / box.height);
	if (Math.abs(x2 - x1) * box.width < 8 || Math.abs(y2 - y1) * box.height < 8) return null;
	return [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)];
}
export function cropPlan(rect: SnipRect, pageWidth: number, pageHeight: number, displayWidth: number) {
	if (
		rect.length !== 4 ||
		rect.some(n => !Number.isFinite(n) || n < 0 || n > 1) ||
		rect[2] <= 0 ||
		rect[3] <= 0 ||
		rect[0] + rect[2] > 1.000001 ||
		rect[1] + rect[3] > 1.000001 ||
		![pageWidth, pageHeight, displayWidth].every(n => Number.isFinite(n) && n > 0)
	)
		throw new Error('Select a valid area within one page.');
	const cropWidth = rect[2] * pageWidth,
		cropHeight = rect[3] * pageHeight;
	const scale = Math.min(
		Math.max(2, (displayWidth / pageWidth) * 2),
		MAX_SNIP_SIDE / Math.max(cropWidth, cropHeight),
	);
	return {
		scale,
		width: Math.max(1, Math.min(MAX_SNIP_SIDE, Math.round(cropWidth * scale))),
		height: Math.max(1, Math.min(MAX_SNIP_SIDE, Math.round(cropHeight * scale))),
		x: rect[0] * pageWidth * scale,
		y: rect[1] * pageHeight * scale,
	};
}
export function validateSnip(image: SnipImage) {
	if (
		!['image/png', 'image/jpeg'].includes(image.mime) ||
		!Number.isInteger(image.width) ||
		!Number.isInteger(image.height) ||
		image.width < 1 ||
		image.height < 1 ||
		Math.max(image.width, image.height) > MAX_SNIP_SIDE ||
		!image.base64 ||
		image.base64.length > (MAX_SNIP_BYTES * 4) / 3 ||
		!/^[A-Za-z0-9+/]+={0,2}$/.test(image.base64) ||
		image.base64.length % 4 !== 0
	)
		throw new Error('Invalid or oversized snip image. Try a smaller crop.');
	const bytes =
		(image.base64.length * 3) / 4 - (image.base64.endsWith('==') ? 2 : image.base64.endsWith('=') ? 1 : 0);
	if (bytes > MAX_SNIP_BYTES || bytes !== image.bytes) throw new Error('Invalid snip byte size.');
	cropPlan(image.rect, 1, 1, 1);
}
export function encodeSnip(canvas: HTMLCanvasElement, rect: SnipRect, signal: AbortSignal): SnipImage {
	let working = canvas;
	try {
		for (let attempt = 0; attempt < 8; attempt++) {
			for (const [mime, quality] of [
				['image/png', 1],
				['image/jpeg', 0.85],
				['image/jpeg', 0.65],
				['image/jpeg', 0.45],
			] as const) {
				signal.throwIfAborted();
				const url = working.toDataURL(mime, quality),
					base64 = url.split(',')[1] ?? '';
				const bytes = (base64.length * 3) / 4 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
				if (base64 && bytes <= MAX_SNIP_BYTES) {
					const image = { base64, mime, width: working.width, height: working.height, bytes, rect };
					validateSnip(image);
					return image;
				}
			}
			const smaller = document.createElement('canvas');
			smaller.width = Math.max(1, Math.floor(working.width * 0.75));
			smaller.height = Math.max(1, Math.floor(working.height * 0.75));
			const ctx = smaller.getContext('2d');
			if (!ctx) throw new Error('Canvas cropping is unavailable.');
			ctx.fillStyle = 'white';
			ctx.fillRect(0, 0, smaller.width, smaller.height);
			ctx.drawImage(working, 0, 0, smaller.width, smaller.height);
			if (working !== canvas) {
				working.width = 0;
				working.height = 0;
			}
			working = smaller;
		}
		throw new Error('Could not compress this crop. Select a smaller area.');
	} finally {
		if (working !== canvas) {
			working.width = 0;
			working.height = 0;
		}
	}
}
export async function renderSnip(
	page: PDFPageProxy,
	rect: SnipRect,
	displayWidth: number,
	source: HTMLCanvasElement | null,
	signal: AbortSignal,
): Promise<SnipImage> {
	signal.throwIfAborted();
	const base = page.getViewport({ scale: 1 }),
		plan = cropPlan(rect, base.width, base.height, displayWidth);
	const canvas = document.createElement('canvas');
	canvas.width = plan.width;
	canvas.height = plan.height;
	try {
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Canvas cropping is unavailable.');
		context.fillStyle = 'white';
		context.fillRect(0, 0, canvas.width, canvas.height);
		if (source && source.width * rect[2] >= plan.width && source.height * rect[3] >= plan.height) {
			context.drawImage(
				source,
				rect[0] * source.width,
				rect[1] * source.height,
				rect[2] * source.width,
				rect[3] * source.height,
				0,
				0,
				plan.width,
				plan.height,
			);
		} else {
			// Only a crop-sized bitmap is allocated, even for large PDF pages.
			const task = page.render({
				canvas,
				canvasContext: context,
				viewport: page.getViewport({ scale: plan.scale }),
				transform: [1, 0, 0, 1, -plan.x, -plan.y],
				background: 'white',
			});
			const abort = () => task.cancel();
			signal.addEventListener('abort', abort, { once: true });
			try {
				await task.promise;
			} finally {
				signal.removeEventListener('abort', abort);
			}
		}
		signal.throwIfAborted();
		return encodeSnip(canvas, rect, signal);
	} finally {
		canvas.width = 0;
		canvas.height = 0;
	}
}

