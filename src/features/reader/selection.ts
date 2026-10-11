import type { TextAnchor, TextRange } from '../../domain/highlight';
import { normalizeClientRects, type NormalizedRect, type PageGeometry } from '../../infrastructure/pdf/geometry';
import { captureNearby } from './nearbyContext';
import { domRange, readableRange, TEXT_LAYER } from './pageText';
export interface TextSelection {
	docId?: string;
	documentName?: string;
	nearby?: { before: string; after: string };
	text: string;
	page: number;
	rotation?: number;
	rects?: NormalizedRect[];
	anchor?: TextAnchor;
	/** Offsets into the page's readable text; see pageText.ts. */
	range?: TextRange;
	position?: { left: number; top: number; bottom?: number };
}

export function capturePdfSelection(
	root: HTMLElement,
	selection: Selection | null,
	geometries?: Map<number, PageGeometry>,
): TextSelection | string | null {
	if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
	if (selection.rangeCount !== 1) return 'Select text from one PDF page at a time.';
	let range = selection.getRangeAt(0);
	const pageFor = (node: Node) =>
		(node instanceof Element ? node : node.parentElement)
			?.closest<HTMLElement>(TEXT_LAYER)
			?.closest<HTMLElement>('[data-pdf-page]');
	const start = pageFor(range.startContainer);
	const end = pageFor(range.endContainer);
	if (!start && !end) return null;
	if (!start || !end || start !== end || !root.contains(start) || !root.contains(end)) {
		return 'Select text from one PDF page at a time.';
	}
	let text = readableRange(range);
	if (!text.trim()) return null;
	if (/[\uFB50-\uFDFF\uFE70-\uFEFF]/u.test(text)) {
		return 'This PDF exposes shaped glyphs instead of readable Persian text. Use a PDF with a correct text map; Use Snip mode to request an explanation of this area.';
	}
	if (text.length > 6000) return 'Select at most 6,000 characters at a time.';
	const page = Number(start.dataset.pdfPage);
	const layer = start.querySelector<HTMLElement>(TEXT_LAYER);
	const geometry = geometries?.get(page);
	if (!layer || !geometry) return { text, page };
	const before = range.cloneRange();
	before.selectNodeContents(layer);
	before.setEnd(range.startContainer, range.startOffset);
	let prefix = readableRange(before);
	// Drag and triple-click selections often include surrounding spaces or line
	// breaks. Trim them so a highlight never paints a sliver on a neighbouring line.
	const lead = text.length - text.trimStart().length,
		trail = text.length - text.trimEnd().length;
	if (lead || trail) {
		const trimmed = domRange(layer, { start: prefix.length + lead, end: prefix.length + text.length - trail });
		if (trimmed) {
			range = trimmed;
			prefix = prefix + text.slice(0, lead);
			text = text.slice(lead, text.length - trail);
		}
	}
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
		anchor: { quote: text, prefix: prefix.slice(-64), suffix: readableRange(after).slice(0, 64) },
		range: { start: prefix.length, end: prefix.length + text.length },
		position: { left: position.left, top: position.top, bottom: position.bottom },
	};
}
