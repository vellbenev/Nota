import type { NormalizedRect } from '../infrastructure/pdf/geometry.ts';
export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue'] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];
export const isHighlightColor = (value: unknown): value is HighlightColor =>
	typeof value === 'string' && (HIGHLIGHT_COLORS as readonly string[]).includes(value);
export interface TextAnchor {
	quote: string;
	prefix: string;
	suffix: string;
}
/**
 * Character offsets into the page's readable text-layer string (text nodes plus
 * one newline per PDF.js line break). Optional: highlights created before text
 * anchoring only have geometry and a quote anchor, and are resolved on demand.
 */
export interface TextRange {
	start: number;
	end: number;
}
export interface Highlight {
	id: string;
	docId: string;
	page: number;
	rotation?: number;
	rects: NormalizedRect[];
	anchor: TextAnchor;
	range?: TextRange;
	color: HighlightColor;
	createdAt: number;
}
export interface Annotation {
	id: string;
	highlightId: string;
	docId: string;
	page: number;
	text: string;
	createdAt: number;
}
