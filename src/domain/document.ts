export interface ReaderView {
	/** One-based page number, and fraction down that page at the viewport anchor. */
	page: number;
	offset: number;
	zoom: number;
	/** Automatic fit is optional so existing saved views remain compatible. */
	fit?: 'manual' | 'width' | 'page';
}

export interface StoredDocument {
	docId: string;
	name: string;
	size: number;
	mime: string;
	pageCount: number;
	createdAt: number;
	lastOpenedAt: number;
	pdfBlob: Blob;
	view: ReaderView;
}

export type DocumentSummary = Omit<StoredDocument, 'pdfBlob'>;
export type OpenDocument = { document: StoredDocument; persistent: boolean };

export const DEFAULT_VIEW: ReaderView = { page: 1, offset: 0, zoom: 1 };

export function normalizeView(view: Partial<ReaderView>, pageCount = 0): ReaderView {
	const page = Number.isFinite(view.page) ? Math.max(1, Math.floor(view.page!)) : 1;
	return {
		page: pageCount > 0 ? Math.min(page, pageCount) : page,
		offset: Number.isFinite(view.offset) ? Math.max(0, Math.min(1, view.offset!)) : 0,
		zoom: Number.isFinite(view.zoom) ? Math.max(0.5, Math.min(2, view.zoom!)) : 1,
		...(['manual', 'width', 'page'].includes(view.fit ?? '') ? { fit: view.fit } : {}),
	};
}
