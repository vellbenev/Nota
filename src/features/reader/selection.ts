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
	position?: { left: number; top: number };
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
	const text = range.toString();
	if (!text.trim()) return null;
	if (/[\uFB50-\uFDFF\uFE70-\uFEFF]/u.test(text)) {
		return 'This PDF exposes shaped glyphs instead of readable Persian text. Use a PDF with a correct text map; snip support is planned for a later phase.';
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
		anchor: { quote: text, prefix: before.toString().slice(-64), suffix: after.toString().slice(0, 64) },
		position: { left: position.left, top: position.top },
	};
}

