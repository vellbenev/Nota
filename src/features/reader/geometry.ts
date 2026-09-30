import { normalizeView, type ReaderView } from '../../domain/document.ts';

export interface PageDimensions {
	width: number;
	height: number;
}
export interface PageRow {
	start: number;
	pageHeight: number;
	size: number;
}
export const PAGE_LABEL_HEIGHT = 24;
export const PAGE_GAP = 24;
export const DEFAULT_PAGE: PageDimensions = { width: 612, height: 792 };

export function pageLayout(pages: PageDimensions[], width: number): PageRow[] {
	let start = 0;
	return pages.map(page => {
		const pageHeight = (width * page.height) / page.width;
		const row = { start, pageHeight, size: pageHeight + PAGE_LABEL_HEIGHT + PAGE_GAP };
		start += row.size;
		return row;
	});
}

export function viewAtOffset(rows: PageRow[], scrollTop: number, zoom: number): ReaderView {
	let low = 0;
	let high = rows.length - 1;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		// Browsers round scrollTop to device pixels. A jump to a fractional row
		// start must not become the preceding page's end after that rounding.
		if (rows[middle].start <= scrollTop + 1) low = middle;
		else high = middle - 1;
	}
	const row = rows[low];
	return normalizeView(
		{ page: low + 1, offset: row ? (scrollTop - row.start) / row.pageHeight : 0, zoom },
		rows.length,
	);
}

export function offsetForView(rows: PageRow[], view: ReaderView): number {
	const normalized = normalizeView(view, rows.length);
	const row = rows[normalized.page - 1];
	return row ? row.start + row.pageHeight * normalized.offset : 0;
}

