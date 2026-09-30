import type { NormalizedRect } from '../infrastructure/pdf/geometry.ts';
export type HighlightColor = 'yellow' | 'green' | 'blue';
export interface TextAnchor {
	quote: string;
	prefix: string;
	suffix: string;
}
export interface Highlight {
	id: string;
	docId: string;
	page: number;
	rotation?: number;
	rects: NormalizedRect[];
	anchor: TextAnchor;
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

