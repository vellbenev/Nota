import { boundNearby } from '../../prompts/context.ts';
/** PDFs rarely expose paragraphs. Infer breaks from text-line gaps, retaining logical DOM order. */
export function captureNearby(layer: HTMLElement, selection: Range) {
	const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
	let before = '',
		after = '';
	let previous: DOMRect | undefined;
	let node: Node | null;
	while ((node = walker.nextNode())) {
		if (!node.textContent || node.parentElement?.closest('.endOfContent')) continue;
		const part = document.createRange();
		part.selectNodeContents(node);
		const box = node.parentElement?.getBoundingClientRect();
		let separator = '';
		if (box && previous && Math.abs(box.top - previous.top) > Math.max(box.height, previous.height) * 0.6) {
			separator = Math.abs(box.top - previous.top) > Math.max(box.height, previous.height) * 1.6 ? '\n\n' : '\n';
		}
		if (part.compareBoundaryPoints(Range.END_TO_START, selection) >= 0) {
			after += separator + node.textContent;
		} else if (part.compareBoundaryPoints(Range.START_TO_END, selection) <= 0) {
			before += separator + node.textContent;
		} else {
			if (node === selection.startContainer)
				before += separator + node.textContent.slice(0, selection.startOffset);
			if (node === selection.endContainer) after += node.textContent.slice(selection.endOffset);
		}
		previous = box;
	}
	return boundNearby(before, after);
}

