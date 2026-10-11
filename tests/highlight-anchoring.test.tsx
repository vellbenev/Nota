import { afterEach, expect, test } from 'vitest';
import type { Highlight } from '../src/domain/highlight';
import { planHighlight, type Layout } from '../src/features/highlights/planning';
import {
	anchorFor,
	domRange,
	locateQuote,
	pageText,
	readableRange,
	resolveRange,
	textOffset,
} from '../src/features/reader/pageText';
import { needsSelectionStabilizer, stabilizeTextSelection } from '../src/features/reader/textLayerSelection';

/** A PDF.js-like text layer: marked content, presentational <br>s and the trailing endOfContent. */
function layer() {
	document.body.innerHTML =
		`<div id="root"><div data-pdf-page="1"><div class="react-pdf__Page__textContent">` +
		`<span class="markedContent"><span>Results are robust</span><br role="presentation"><span>to the <b>choice</b> of prior.</span></span>` +
		`<span class="markedContent"><span>Results are robust again.</span></span><div class="endOfContent"></div>` +
		`</div></div></div>`;
	return document.querySelector<HTMLElement>('.react-pdf__Page__textContent')!;
}
afterEach(() => {
	document.body.innerHTML = '';
	window.getSelection()?.removeAllRanges();
});

test('page text flattens line breaks, and offsets round-trip through live DOM ranges', () => {
	const root = layer();
	const text = pageText(root);
	expect(text).toBe('Results are robust\nto the choice of prior.Results are robust again.');
	for (const [start, end] of [
		[0, 7],
		[12, 25],
		[18, 19],
		[26, 32],
		[8, text.length],
	]) {
		const range = domRange(root, { start, end })!;
		expect(readableRange(range)).toBe(text.slice(start, end));
		expect(textOffset(root, range.startContainer, range.startOffset)).toBe(start);
		expect(textOffset(root, range.endContainer, range.endOffset)).toBe(end);
	}
	expect(domRange(root, { start: 5, end: 5 })).toBeNull();
	expect(domRange(root, { start: 0, end: text.length + 1 })).toBeNull();
});

test('legacy highlights without offsets resolve by quote and context; stale offsets fall back to the quote', () => {
	const text = pageText(layer());
	const second = text.lastIndexOf('Results are robust');
	expect(locateQuote(text, { quote: 'Results are robust', prefix: 'of prior.', suffix: ' again' })).toEqual({
		start: second,
		end: second + 18,
	});
	expect(locateQuote(text, { quote: 'Results are robust', prefix: '', suffix: '\nto' })).toEqual({
		start: 0,
		end: 18,
	});
	expect(
		resolveRange({ anchor: { quote: 'choice', prefix: 'to the ', suffix: '' }, range: { start: 0, end: 6 } }, text),
	).toEqual({
		start: 26,
		end: 32,
	});
	expect(locateQuote(text, { quote: 'missing', prefix: '', suffix: '' })).toBeNull();
});

const base = (
	id: string,
	start: number,
	end: number,
	color: Highlight['color'] = 'yellow',
	createdAt = 1,
): Highlight => ({
	id,
	docId: 'doc',
	page: 1,
	rects: [[0.1, 0.1, 0.1, 0.02]],
	anchor: { quote: 'x'.repeat(end - start), prefix: '', suffix: '' },
	range: { start, end },
	color,
	createdAt,
});
const text = 'x'.repeat(200);
const layout: Layout = range => ({ rects: [[0.1, 0.1, 0.5, 0.02]], anchor: anchorFor(text, range) });
const select = (start: number, end: number) => ({
	docId: 'doc',
	page: 1,
	rects: [[0.2, 0.1, 0.1, 0.02]] as [number, number, number, number][],
	anchor: { quote: text.slice(start, end), prefix: '', suffix: '' },
	range: { start, end },
});

test('highlighting plans: create, no-op, recolor, and merge into the oldest without stacking', () => {
	const a = base('a', 10, 20, 'yellow', 1),
		b = base('b', 30, 40, 'green', 2),
		other = { ...base('o', 10, 20), page: 2 };
	expect(planHighlight(select(50, 60), 'blue', [a, b, other], text, layout).kind).toBe('create');
	// Touching is not overlapping: adjacent highlights stay separate.
	expect(planHighlight(select(20, 30), 'blue', [a, b], text, layout).kind).toBe('create');
	expect(planHighlight(select(12, 18), 'yellow', [a], text, layout)).toEqual({ kind: 'none', item: a });
	expect(planHighlight(select(12, 18), 'blue', [a], text, layout)).toEqual({
		kind: 'recolor',
		items: [a],
		color: 'blue',
	});
	const merged = planHighlight(select(15, 35), 'blue', [b, a], text, layout);
	expect(merged.kind).toBe('merge');
	if (merged.kind !== 'merge') return;
	expect(merged.survivor).toMatchObject({ id: 'a', color: 'blue', range: { start: 10, end: 40 }, createdAt: 1 });
	expect(merged.survivor.anchor.quote).toHaveLength(30);
	expect(merged.absorbed.map(item => item.id)).toEqual(['b']);
	// Extending one highlight beyond its edge also merges rather than stacking.
	expect(planHighlight(select(5, 15), 'yellow', [a], text, layout)).toMatchObject({
		kind: 'merge',
		survivor: { id: 'a', range: { start: 5, end: 20 } },
		absorbed: [],
	});
	// Without page text (layer not rendered), never guess: create as before.
	expect(planHighlight(select(12, 18), 'blue', [a], null, layout).kind).toBe('create');
});

test('selection stabilizer moves endOfContent beside the moving edge while dragging, then restores it', () => {
	const root = layer();
	const end = root.querySelector('.endOfContent')!;
	const cleanup = stabilizeTextSelection(document.getElementById('root')!, true);
	const first = root.querySelector('span span')!.firstChild!;
	document.dispatchEvent(new Event('pointerdown'));
	const range = document.createRange();
	range.setStart(first, 0);
	range.setEnd(first, 7);
	window.getSelection()!.addRange(range);
	document.dispatchEvent(new Event('selectionchange'));
	expect(root.classList.contains('selecting')).toBe(true);
	expect(end.previousSibling).toBe(first.parentNode);
	expect((end as HTMLElement).style.userSelect).toBe('text');
	document.dispatchEvent(new Event('pointerup'));
	expect(root.lastElementChild).toBe(end);
	expect(root.classList.contains('selecting')).toBe(false);
	expect((end as HTMLElement).style.userSelect).toBe('');
	cleanup();
});

test('stabilizer is skipped where browsers handle blank-space selection natively', () => {
	const fake = (agent: string, moz = false) =>
		({ CSS: { supports: () => moz }, navigator: { userAgent: agent } }) as unknown as Window;
	expect(needsSelectionStabilizer(fake('Mozilla/5.0 Firefox/140.0', true))).toBe(false);
	expect(needsSelectionStabilizer(fake('Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36'))).toBe(false);
	expect(needsSelectionStabilizer(fake('Mozilla/5.0 Chrome/141.0.0.0 Safari/537.36'))).toBe(true);
	expect(needsSelectionStabilizer(fake('Mozilla/5.0 (Macintosh) Version/26.0 Safari/605.1.15'))).toBe(true);
});
