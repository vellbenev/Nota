import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import App from '../src/App';
import ResponseMarkdown from '../src/features/assistant/ResponseMarkdown';
import { captureNearby } from '../src/features/reader/nearbyContext';
import { database } from '../src/infrastructure/db/database';
vi.mock('../src/features/reader/ReaderWorkspace', () => ({
	default: ({
		onSelection,
		onDocumentChange,
	}: {
		onSelection: (s: object) => void;
		onDocumentChange: () => void;
	}) => (
		<div>
			<button
				onClick={() =>
					onSelection({
						docId: 'ui-paper',
						documentName: 'test.pdf',
						text: 'E = mc^2',
						page: 2,
						nearby: { before: 'Energy', after: 'Mass' },
					})
				}
			>
				Select fixture
			</button>
			<button onClick={onDocumentChange}>Switch document</button>
		</div>
	),
}));
beforeEach(async () => {
	await database.open();
});
afterEach(async () => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	await database.delete();
});

test('Persian-flowing Markdown renders inline and block math, GFM, code, and no external images', () => {
	const { container, rerender } = render(
		<ResponseMarkdown
			text={
				'انرژی با \\(E = mc^2\\) محاسبه می‌شود.\n\n\\[E = mc^2\\]\n\n| متغیر | معنی |\n| --- | --- |\n| m | جرم |\n\n`\\(code\\)`\n\n![remote](https://example.com/a.png)\n<script>alert(1)</script>'
			}
		/>,
	);
	expect(container.querySelector('.response-markdown')?.getAttribute('dir')).toBe('rtl');
	expect(container.querySelectorAll('.katex')).toHaveLength(2);
	expect(container.querySelector('.katex-display')).not.toBeNull();
	expect(container.querySelector('math annotation')?.textContent).toContain('E = mc^2');
	expect(container.querySelector('table')).not.toBeNull();
	expect(container.querySelector('code')?.textContent).toBe('\\(code\\)');
	expect(container.querySelector('img')).toBeNull();
	expect(container.querySelector('script')).toBeNull();
	rerender(<ResponseMarkdown text={'متن $E ='} />); // partial streaming formula remains renderable
	expect(container.textContent).toContain('متن');
	rerender(
		<ResponseMarkdown
			language='en'
			text={'مدل OpenAI API مقدار SHA-256 را با $E=mc^2$ بررسی می‌کند و `result()` را می‌سازد.'}
		/>,
	);
	expect(container.querySelector('.response-markdown')?.getAttribute('dir')).toBe('rtl');
	expect(container.querySelector('.response-markdown')?.getAttribute('lang')).toBe('fa');
	expect([...container.querySelectorAll('bdi[dir="ltr"]')].map(node => node.textContent)).toEqual(
		expect.arrayContaining(['OpenAI API', 'SHA-256']),
	);
	expect(container.querySelector('.katex bdi')).toBeNull();
	expect(container.querySelector('code')?.getAttribute('dir')).toBe('ltr');
});

test('nearby context uses logical selection boundaries and only adjacent paragraph fragments', () => {
	const layer = document.createElement('div');
	layer.innerHTML =
		'<span>Old\n\nBefore paragraph </span><span>selected فارسی</span><span> After paragraph\n\nLater</span>';
	document.body.append(layer);
	const range = document.createRange();
	range.selectNodeContents(layer.children[1]);
	// Real browser selection endpoints usually refer to text nodes.
	range.setStart(layer.children[1].firstChild!, 0);
	range.setEnd(layer.children[1].firstChild!, 14);
	expect(captureNearby(layer, range)).toEqual({ before: 'Before paragraph', after: 'After paragraph' });
	layer.remove();
});

test('clicking Stop aborts fetch and cancels its reader; switching documents discards response state', async () => {
	vi.stubGlobal('crypto', webcrypto);
	let signal: AbortSignal | undefined;
	let readerCancelled = false;
	const fetchSpy = vi.fn(async (_url: string, options: RequestInit) => {
		signal = options.signal as AbortSignal;
		return new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(
						new TextEncoder().encode(JSON.stringify({ message: { content: 'پاسخ $E = mc^2$' } }) + '\n'),
					);
				},
				cancel() {
					readerCancelled = true;
				},
			}),
		);
	});
	vi.stubGlobal('fetch', fetchSpy);
	render(<App />);
	fireEvent.click(screen.getByText('Model settings'));
	fireEvent.click(screen.getByRole('combobox', { name: 'Model' }));
	fireEvent.change(screen.getByRole('searchbox', { name: 'Search Model' }), { target: { value: 'local-test' } });
	fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search Model' }), { key: 'Enter' });
	fireEvent.click(screen.getByText('Select fixture'));
	fireEvent.click(screen.getByRole('button', { name: /Translate \/ Clarify/ }));
	await waitFor(() => expect(signal).toBeDefined());
	await waitFor(() => expect(screen.getByLabelText('Tutor response').querySelector('.katex')).not.toBeNull());
	fireEvent.click(screen.getByRole('button', { name: 'Stop response' }));
	expect(signal?.aborted).toBe(true);
	await waitFor(() => expect(readerCancelled).toBe(true));
	expect(screen.getByText('Stopped')).toBeTruthy();
	expect(fetchSpy).toHaveBeenCalledTimes(1);
	fireEvent.click(screen.getByText('Switch document'));
	expect(screen.queryByLabelText('Tutor response')).toBeNull();
	await act(async () => {});
	expect(await database.responseCache.count()).toBe(0);
});

test('mixed-language Markdown assigns direction to each prose block before isolating Latin terms', () => {
	const ui = render(
		<ResponseMarkdown
			text={
				'## A clear heading\n\nAn English paragraph. Another sentence.\n\nیک بند فارسی با اصطلاح Standard deviation.\n\n| Method | Result |\n| --- | --- |\n| Estimate | نتیجه |'
			}
		/>,
	);
	expect(ui.container.querySelector('h2')?.getAttribute('dir')).toBe('ltr');
	const paragraphs = ui.container.querySelectorAll('.response-markdown > p');
	expect(paragraphs[0].getAttribute('dir')).toBe('ltr');
	expect(paragraphs[1].getAttribute('dir')).toBe('rtl');
	expect(ui.container.querySelector('table')?.getAttribute('dir')).toBe('ltr');
	expect(ui.container.querySelectorAll('td')[1].getAttribute('dir')).toBe('rtl');
	expect(paragraphs[1].querySelector('bdi[dir="ltr"]')?.textContent).toBe('Standard deviation');
});
