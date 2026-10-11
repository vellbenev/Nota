import type { Highlight, TextAnchor, TextRange } from '../../domain/highlight';

/**
 * A page's "readable text" is the PDF.js text layer flattened to a string:
 * every text node in document order, plus one "\n" per presentational <br>.
 * Highlight text ranges are offsets into this string, so they stay attached to
 * the same characters at any zoom level, rotation or window size.
 */
export const TEXT_LAYER = '.react-pdf__Page__textContent';

function readable(node: Node): string {
	if (node.nodeType === Node.TEXT_NODE) return (node as Text).data;
	if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR') return '\n';
	let out = '';
	for (const child of Array.from(node.childNodes)) out += readable(child);
	return out;
}

/** PDF.js uses presentational <br> elements; Range.toString() drops those line breaks. */
export function readableRange(range: Range) {
	return readable(range.cloneContents());
}

export function pageText(layer: Element) {
	return readable(layer);
}

/** Offset of a DOM boundary point within the layer's readable text. */
export function textOffset(layer: Element, container: Node, offset: number) {
	const range = layer.ownerDocument.createRange();
	range.selectNodeContents(layer);
	range.setEnd(container, offset);
	return readableRange(range).length;
}

type Boundary = [Node, number];
/** Map readable-text offsets back to a live DOM range, or null if out of bounds. */
export function domRange(layer: Element, { start, end }: TextRange): Range | null {
	if (!(start >= 0 && end > start)) return null;
	let position = 0;
	let from: Boundary | null = null,
		to: Boundary | null = null;
	const walker = layer.ownerDocument.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
	for (let node = walker.nextNode(); node && !to; node = walker.nextNode()) {
		const isText = node.nodeType === Node.TEXT_NODE;
		const isBreak = !isText && (node as Element).tagName === 'BR';
		if (!isText && !isBreak) continue;
		const length = isText ? (node as Text).data.length : 1;
		const index = () => Array.prototype.indexOf.call(node!.parentNode!.childNodes, node);
		if (!from && start >= position && start < position + length)
			from = isText ? [node, start - position] : [node.parentNode!, index()];
		if (from && end > position && end <= position + length)
			to = isText ? [node, end - position] : [node.parentNode!, index() + 1];
		position += length;
	}
	if (!from || !to) return null;
	const range = layer.ownerDocument.createRange();
	range.setStart(...from);
	range.setEnd(...to);
	return range;
}

const commonSuffix = (a: string, b: string) => {
	let n = 0;
	while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
	return n;
};
const commonPrefix = (a: string, b: string) => {
	let n = 0;
	while (n < a.length && n < b.length && a[n] === b[n]) n++;
	return n;
};

/** Find the quote in the page text, preferring the occurrence whose context matches best. */
export function locateQuote(text: string, anchor: TextAnchor): TextRange | null {
	const { quote, prefix, suffix } = anchor;
	if (!quote) return null;
	let best: TextRange | null = null,
		bestScore = -1;
	for (let at = text.indexOf(quote); at >= 0; at = text.indexOf(quote, at + 1)) {
		const end = at + quote.length;
		const score =
			commonSuffix(text.slice(Math.max(0, at - prefix.length), at), prefix) +
			commonPrefix(text.slice(end, end + suffix.length), suffix);
		if (score > bestScore) {
			best = { start: at, end };
			bestScore = score;
		}
	}
	return best;
}

/** The highlight's current text range on this page, or null if its text cannot be found. */
export function resolveRange(item: Pick<Highlight, 'anchor' | 'range'>, text: string): TextRange | null {
	const { range, anchor } = item;
	if (range && range.end <= text.length && text.slice(range.start, range.end) === anchor.quote) return range;
	return locateQuote(text, anchor);
}

export const rangesOverlap = (a: TextRange, b: TextRange) => a.start < b.end && b.start < a.end;
export const rangeContains = (outer: TextRange, inner: TextRange) =>
	outer.start <= inner.start && inner.end <= outer.end;

export function anchorFor(text: string, range: TextRange): TextAnchor {
	return {
		quote: text.slice(range.start, range.end),
		prefix: text.slice(Math.max(0, range.start - 64), range.start),
		suffix: text.slice(range.end, range.end + 64),
	};
}
