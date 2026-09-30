import { lazy } from 'react';

export const VIEWER_LOAD_TIMEOUT_MS = 30_000;

export function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = window.setTimeout(() => reject(new Error(message)), milliseconds);
		promise.then(
			value => {
				window.clearTimeout(timer);
				resolve(value);
			},
			error => {
				window.clearTimeout(timer);
				reject(error);
			},
		);
	});
}

export const PdfViewport = lazy(() =>
	withTimeout(
		import('./PdfViewport.tsx'),
		VIEWER_LOAD_TIMEOUT_MS,
		'Loading the viewer took too long. Please reload and try again.',
	),
);

