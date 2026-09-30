import type { TextAnchor } from '../../domain/highlight';
import { normalizeClientRects, type NormalizedRect, type PageGeometry } from '../../infrastructure/pdf/geometry';
import { captureNearby } from './nearbyContext';
export interface TextSelection {
	docId?: string;
	documentName?: string;
	nearby?: { before: string; after: string };
	text: string;
	page: number;
	rotation?: number;
	rects?: NormalizedRect[];
	anchor?: TextAnchor;
	position?: { left: number; top: number; bottom?: number };
}

/** PDF.js uses presentation BR elements; Range.toString() drops those line breaks. */
function readableRange(range: Range) {
	function text(node: Node): string {
		if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
		if (node instanceof Element && node.tagName === 'BR') return '\n';
		return Array.from(node.childNodes).map(text).join('');
	}
	return text(range.cloneContents());
}

export function capturePdfSelection(
	root: HTMLElement,
	selection: Selection | null,
	geometries?: Map<number, PageGeometry>,
): TextSelection | string | null {
	if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
	if (selection.rangeCount !== 1) return 'Select text from one PDF page at a time.';
	const range = selection.getRangeAt(0);
	const pageFor = (node: Node) =>
		(node instanceof Element ? node : node.parentElement)
			?.closest<HTMLElement>('.react-pdf__Page__textContent')
			?.closest<HTMLElement>('[data-pdf-page]');
	const start = pageFor(range.startContainer);
	const end = pageFor(range.endContainer);
	if (!start && !end) return null;
	if (!start || !end || start !== end || !root.contains(start) || !root.contains(end)) {
		return 'Select text from one PDF page at a time.';
	}
	const text = readableRange(range);
	if (!text.trim()) return null;
	if (/[\uFB50-\uFDFF\uFE70-\uFEFF]/u.test(text)) {
		return 'This PDF exposes shaped glyphs instead of readable Persian text. Use a PDF with a correct text map; Use Snip mode to request an explanation of this area.';
	}
	if (text.length > 6000) return 'Select at most 6,000 characters at a time.';
	const page = Number(start.dataset.pdfPage);
	const layer = start.querySelector<HTMLElement>('.react-pdf__Page__textContent');
	const geometry = geometries?.get(page);
	if (!layer || !geometry) return { text, page };
	const before = range.cloneRange();
	before.selectNodeContents(layer);
	before.setEnd(range.startContainer, range.startOffset);
	const after = range.cloneRange();
	after.selectNodeContents(layer);
	after.setStart(range.endContainer, range.endOffset);
	const rects = normalizeClientRects(Array.from(range.getClientRects()), layer.getBoundingClientRect(), geometry);
	if (!rects.length) return null;
	const position = range.getBoundingClientRect();
	return {
		text,
		page,
		nearby: captureNearby(layer, range),
		rotation: geometry.rotation ?? 0,
		rects,
		anchor: { quote: text, prefix: readableRange(before).slice(-64), suffix: readableRange(after).slice(0, 64) },
		position: { left: position.left, top: position.top, bottom: position.bottom },
	};
}
