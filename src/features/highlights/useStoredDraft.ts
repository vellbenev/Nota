import { useCallback, useEffect, useState } from 'react';

const PREFIX = 'nota:draft:';
function read(key: string) {
	try {
		return window.localStorage.getItem(PREFIX + key);
	} catch {
		return null;
	}
}
function write(key: string, value: string) {
	try {
		if (value) window.localStorage.setItem(PREFIX + key, value);
		else window.localStorage.removeItem(PREFIX + key);
	} catch {
		// Storage can be unavailable (private mode, quota); the in-memory draft still works.
	}
}
export const hasStoredDraft = (key: string) => read(key) !== null;

/**
 * Text being typed into a note survives switching highlights, closing the panel,
 * changing papers and reloading the tab. It is cleared once saved or discarded.
 */
export function useStoredDraft(key: string, initial = '') {
	const [value, setValue] = useState(() => read(key) ?? initial);
	useEffect(() => setValue(read(key) ?? initial), [key, initial]);
	const update = useCallback(
		(next: string) => {
			setValue(next);
			write(key, next === initial ? '' : next);
		},
		[key, initial],
	);
	const clear = useCallback(() => {
		write(key, '');
		setValue(initial);
	}, [key, initial]);
	return [value, update, clear] as const;
}
