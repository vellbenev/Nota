import type { Highlight, HighlightColor, TextAnchor, TextRange } from '../../domain/highlight';
import type { NormalizedRect } from '../../infrastructure/pdf/geometry';
import { rangeContains, rangesOverlap, resolveRange } from '../reader/pageText';

export interface PassageSelection {
	docId: string;
	page: number;
	rotation?: number;
	rects: NormalizedRect[];
	anchor: TextAnchor;
	range?: TextRange;
}
/** Geometry and anchor for an arbitrary text range on the same page. */
export type Layout = (range: TextRange) => { rects: NormalizedRect[]; anchor: TextAnchor } | null;

export type HighlightPlan =
	| { kind: 'create'; value: Omit<Highlight, 'id' | 'createdAt'> }
	| { kind: 'merge'; survivor: Highlight; absorbed: Highlight[] }
	| { kind: 'recolor'; items: Highlight[]; color: HighlightColor }
	| { kind: 'none'; item: Highlight };

/** Saved highlights on the selection's page whose text overlaps it. */
export function overlappingHighlights(
	selection: Pick<PassageSelection, 'page' | 'range'>,
	items: Highlight[],
	text: string | null,
) {
	if (!selection.range || text === null) return [];
	return items
		.filter(item => item.page === selection.page)
		.map(item => ({ item, range: resolveRange(item, text) }))
		.filter(
			(entry): entry is { item: Highlight; range: TextRange } =>
				!!entry.range && rangesOverlap(entry.range, selection.range!),
		);
}

/**
 * Highlighting text never stacks a second mark on already-highlighted text:
 * - no overlap: create a highlight;
 * - inside one highlight: change its color (or nothing, if it already matches);
 * - otherwise: extend the oldest overlapped highlight over the union and fold
 *   the others into it (their notes are kept by the repository).
 */
export function planHighlight(
	selection: PassageSelection,
	color: HighlightColor,
	items: Highlight[],
	text: string | null,
	layout: Layout,
): HighlightPlan {
	const create: HighlightPlan = {
		kind: 'create',
		value: {
			docId: selection.docId,
			page: selection.page,
			rotation: selection.rotation,
			rects: selection.rects,
			anchor: selection.anchor,
			...(selection.range ? { range: selection.range } : {}),
			color,
		},
	};
	const overlaps = overlappingHighlights(selection, items, text);
	if (!overlaps.length || !selection.range) return create;
	if (overlaps.length === 1 && rangeContains(overlaps[0].range, selection.range)) {
		const { item } = overlaps[0];
		return item.color === color ? { kind: 'none', item } : { kind: 'recolor', items: [item], color };
	}
	const union = {
		start: Math.min(selection.range.start, ...overlaps.map(entry => entry.range.start)),
		end: Math.max(selection.range.end, ...overlaps.map(entry => entry.range.end)),
	};
	const geometry = layout(union);
	if (!geometry) return create;
	const ordered = overlaps.map(entry => entry.item).sort((a, b) => a.createdAt - b.createdAt);
	const [oldest, ...absorbed] = ordered;
	return {
		kind: 'merge',
		survivor: {
			...oldest,
			rotation: selection.rotation,
			rects: geometry.rects,
			anchor: geometry.anchor,
			range: union,
			color,
		},
		absorbed,
	};
}
