import { Dexie, type Table } from 'dexie';
import type { StoredDocument } from '../../domain/document.ts';
import type { Annotation, Highlight } from '../../domain/highlight.ts';
import type { CachedResponse } from './cache.ts';

export class NotaDatabase extends Dexie {
	responseCache!: Table<CachedResponse, string>;
	highlights!: Table<Highlight, string>;
	annotations!: Table<Annotation, string>;
	documents!: Table<StoredDocument, string>;

	constructor(name = 'nota') {
		super(name);
		// Blob and view are stored values, deliberately not indexes.
		this.version(1).stores({ documents: '&docId, lastOpenedAt' });
		this.version(2).stores({
			documents: '&docId, lastOpenedAt',
			highlights: '&id, docId, [docId+page]',
			annotations: '&id, highlightId, docId, [docId+page]',
		});
		this.version(3).stores({ responseCache: '&key, docId, createdAt' });
	}
}

export const database = new NotaDatabase();

