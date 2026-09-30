import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import App from '../src/App';
import { routeLanguage } from '../src/features/reader/language';
import { capturePdfSelection } from '../src/features/reader/selection';
vi.mock('../src/features/reader/ReaderWorkspace', () => ({
	default: ({ onAssistantAction }: { onAssistantAction: (s: object, a: string) => void }) => (
		<button
			onClick={() =>
				onAssistantAction(
					{ docId: 'ask-paper', documentName: 'paper.pdf', text: 'Quoted text فارسی', page: 3 },
					'ask',
				)
			}
		>
			Fixture Ask
		</button>
	),
}));
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
test('Ask Nota starts a request immediately without a confirmation or drafting step', async () => {
	vi.stubGlobal('crypto', webcrypto);
	const fetchSpy = vi.fn(
		async (_url: string, _options: RequestInit) =>
			new Response(`${JSON.stringify({ message: { content: 'پاسخ' }, done: true })}\n`),
	);
	vi.stubGlobal('fetch', fetchSpy);
	render(<App />);
	fireEvent.click(screen.getByText('Fixture Ask'));
	expect(screen.queryByLabelText('Ask Nota draft')).toBeNull();
	await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
	const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
	expect(JSON.stringify(body.messages)).toContain('Explain this passage in context.');
	expect(JSON.stringify(body.messages)).toContain('Quoted text فارسی');
	expect(screen.queryByText(/I understand/)).toBeNull();
});
test('single-page guard rejects cross-page selections and language routing handles mixed scripts', () => {
	const root = document.createElement('div');
	root.innerHTML =
		'<div data-pdf-page="1"><div class="react-pdf__Page__textContent">English فارسی</div></div><div data-pdf-page="2"><div class="react-pdf__Page__textContent">Second</div></div>';
	document.body.append(root);
	const range = document.createRange();
	range.setStart(root.children[0].firstChild!.firstChild!, 0);
	range.setEnd(root.children[1].firstChild!.firstChild!, 3);
	const selection = window.getSelection()!;
	selection.removeAllRanges();
	selection.addRange(range);
	expect(capturePdfSelection(root, selection)).toBe('Select text from one PDF page at a time.');
	expect(routeLanguage('English فارسی')).toBe('mixed');
	expect(routeLanguage('فارسی')).toBe('clarify');
	expect(routeLanguage('English')).toBe('translate');
	root.remove();
	selection.removeAllRanges();
});

