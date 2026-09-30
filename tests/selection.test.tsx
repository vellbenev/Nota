import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import App from '../src/App';
import { routeLanguage } from '../src/features/reader/language';
import { capturePdfSelection } from '../src/features/reader/selection';
const passage = {
	docId: 'ask-paper',
	documentName: 'paper.pdf',
	text: 'Quoted text فارسی',
	page: 3,
	nearby: { before: 'Before the quote', after: 'After the quote' },
};
const image = {
	base64: 'aGVsbG8=',
	bytes: 5,
	mime: 'image/png' as const,
	width: 200,
	height: 100,
	rect: [0.1, 0.2, 0.3, 0.4] as [number, number, number, number],
};
vi.mock('../src/features/reader/ReaderWorkspace', () => ({
	default: ({
		onAssistantAction,
		onDocumentChange,
		onSnip,
	}: {
		onAssistantAction: (s: object, a: string) => void;
		onDocumentChange: () => void;
		onSnip: (s: object) => void;
	}) => (
		<div>
			<button onClick={() => onAssistantAction(passage, 'ask')}>Fixture Ask</button>
			<button onClick={() => onAssistantAction(passage, 'explain')}>Fixture Explain</button>
			<button onClick={() => onAssistantAction({ ...passage, page: 8, text: 'A different passage' }, 'ask')}>
				Other passage
			</button>
			<button
				onClick={() =>
					onSnip({
						docId: passage.docId,
						documentName: passage.documentName,
						page: 4,
						image,
						question: 'Explain this figure',
					})
				}
			>
				Fixture snip
			</button>
			<button onClick={onDocumentChange}>Switch paper</button>
		</div>
	),
}));
function mockOllama() {
	vi.stubGlobal('crypto', webcrypto);
	let answer = 0;
	const fetchSpy = vi.fn(async (url: string, _options: RequestInit) =>
		url.endsWith('/api/show')
			? new Response(JSON.stringify({ capabilities: ['vision'] }))
			: new Response(`${JSON.stringify({ message: { content: `Answer ${++answer}` }, done: true })}\n`),
	);
	vi.stubGlobal('fetch', fetchSpy);
	const chats = () =>
		fetchSpy.mock.calls
			.filter(([url]) => url.endsWith('/api/chat'))
			.map(([, options]) => JSON.parse(options.body as string));
	return { fetchSpy, chats };
}
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
test('Ask opens and focuses a draft without inference; sending uses exactly that passage', async () => {
	const { fetchSpy, chats } = mockOllama();
	render(<App />);
	fireEvent.click(screen.getByText('Fixture Ask'));
	const draft = screen.getByLabelText('Ask Nota draft');
	expect(document.activeElement).toBe(draft);
	expect(fetchSpy).not.toHaveBeenCalled();
	fireEvent.change(draft, { target: { value: 'Why is this assumption necessary?' } });
	expect(fetchSpy).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole('button', { name: /Send question/ }));
	await screen.findByText((_, node) => node?.tagName === 'P' && node.textContent === 'Answer 1');
	const envelope = JSON.parse(chats()[0].messages.at(-1).content);
	expect(envelope.reader_question).toBe('Why is this assumption necessary?');
	expect(envelope.untrusted_source.selected_text).toBe(passage.text);
	expect(envelope.recent_history).toEqual([]);
});

test('Explain sends immediately; each answer keeps a follow-up composer and its original context', async () => {
	const { fetchSpy, chats } = mockOllama();
	render(<App />);
	fireEvent.click(screen.getByText('Fixture Explain'));
	await screen.findByText((_, node) => node?.tagName === 'P' && node.textContent === 'Answer 1');
	expect(JSON.stringify(chats()[0].messages)).toContain('Explain this passage in context.');
	fireEvent.click(screen.getByRole('button', { name: 'Explain this step further' }));
	expect(fetchSpy).toHaveBeenCalledTimes(1); // suggested questions only fill the composer
	const firstQuestion = screen.getByLabelText('Follow-up question for page 3');
	expect((firstQuestion as HTMLTextAreaElement).value).toBe('Explain this step further');
	fireEvent.click(screen.getByText('Other passage'));
	fireEvent.change(firstQuestion, { target: { value: 'Why this assumption?' } });
	fireEvent.submit(firstQuestion.closest('form')!);
	await screen.findByText((_, node) => node?.tagName === 'P' && node.textContent === 'Answer 2');
	expect(screen.getByText('Answer 1')).toBeTruthy();
	expect(screen.getAllByRole('button', { name: 'Send follow-up' })).toHaveLength(2);
	const next = JSON.parse(chats()[1].messages.at(-1).content);
	expect(next.untrusted_source.selected_text).toBe(passage.text);
	expect(next.untrusted_source.page).toBe(3);
	expect(next.untrusted_source.nearby_context).toEqual(passage.nearby);
	expect(next.recent_history.at(-1).content).toBe('Answer 1');
	// Branching from the first answer excludes the later answer from that branch.
	fireEvent.change(firstQuestion, { target: { value: 'Another question about the first answer' } });
	fireEvent.submit(firstQuestion.closest('form')!);
	await screen.findByText((_, node) => node?.tagName === 'P' && node.textContent === 'Answer 3');
	expect(JSON.parse(chats()[2].messages.at(-1).content).recent_history).not.toEqual(
		expect.arrayContaining([expect.objectContaining({ content: 'Answer 2' })]),
	);
	fireEvent.click(screen.getByText('Switch paper'));
	expect(screen.queryByText('Answer 1')).toBeNull();
	expect(screen.queryByRole('button', { name: 'Send follow-up' })).toBeNull();
});

test('a snip follow-up resends the same crop and page with the preceding answer', async () => {
	const { chats } = mockOllama();
	render(<App />);
	fireEvent.click(screen.getByText('Fixture snip'));
	await screen.findByText((_, node) => node?.tagName === 'P' && node.textContent === 'Answer 1');
	const question = screen.getByLabelText('Follow-up question for page 4');
	fireEvent.change(question, { target: { value: 'Explain the second row' } });
	fireEvent.submit(question.closest('form')!);
	await screen.findByText((_, node) => node?.tagName === 'P' && node.textContent === 'Answer 2');
	const body = chats()[1],
		envelope = JSON.parse(body.messages.at(-1).content);
	expect(body.messages.at(-1).images).toEqual([image.base64]);
	expect(envelope.untrusted_source.image.rect).toEqual(image.rect);
	expect(envelope.untrusted_source.page).toBe(4);
	expect(envelope.reader_question).toBe('Explain the second row');
	expect(envelope.recent_history.at(-1).content).toBe('Answer 1');
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

test('PDF presentation line breaks preserve word boundaries without adding spaces between adjacent glyph spans', () => {
	const root = document.createElement('div');
	root.innerHTML =
		'<div data-pdf-page="1"><div class="react-pdf__Page__textContent"><span>measurement</span><br role="presentation"><span>method and </span><span>un</span><span>certainty</span></div></div>';
	document.body.append(root);
	const layer = root.querySelector('.react-pdf__Page__textContent')!;
	const range = document.createRange();
	range.setStart(layer.firstChild!.firstChild!, 0);
	range.setEnd(layer.lastChild!.firstChild!, 9);
	const selection = window.getSelection()!;
	selection.removeAllRanges();
	selection.addRange(range);
	expect(capturePdfSelection(root, selection)).toEqual({ page: 1, text: 'measurement\nmethod and uncertainty' });
	root.remove();
	selection.removeAllRanges();
});
