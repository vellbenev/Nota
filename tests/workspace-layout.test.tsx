import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { LAYOUT_KEY, readLayout, useWorkspaceLayout } from '../src/features/workspace/useWorkspaceLayout';
function Workspace() {
	const layout = useWorkspaceLayout();
	return (
		<div ref={layout.root}>
			<button
				aria-label={layout.assistantOpen ? 'Enter focus mode' : 'Show assistant'}
				onClick={layout.toggleAssistant}
			>
				Toggle
			</button>
			<button onClick={layout.showAssistant}>Ask from paper</button>
			<button onClick={() => void layout.toggleFullscreen()}>
				{layout.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
			</button>
			<div
				role='separator'
				aria-valuenow={layout.share}
				tabIndex={layout.assistantOpen ? 0 : -1}
				onKeyDown={layout.dividerKey}
			/>
			<div id='nota-assistant' inert={!layout.assistantOpen} aria-hidden={!layout.assistantOpen}>
				<input aria-label='Question draft' defaultValue='Keep my thought' />
				<button onClick={layout.hideAssistant}>Hide assistant</button>
			</div>
			{layout.error && <p role='alert'>{layout.error}</p>}
		</div>
	);
}
beforeEach(() => {
	localStorage.clear();
	vi.stubGlobal(
		'matchMedia',
		vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
	);
});
afterEach(() => {
	cleanup();
	localStorage.clear();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
test('focus hides the whole assistant, restores focus and draft, and explicit Ask reopens it', () => {
	const ui = render(<Workspace />);
	const draft = screen.getByLabelText('Question draft') as HTMLInputElement;
	fireEvent.change(draft, { target: { value: 'Unsent follow-up' } });
	const hide = screen.getByRole('button', { name: 'Hide assistant' });
	hide.focus();
	fireEvent.click(hide);
	expect(ui.container.querySelector('#nota-assistant')?.hasAttribute('inert')).toBe(true);
	expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show assistant' }));
	expect(JSON.parse(localStorage.getItem(LAYOUT_KEY)!).assistantOpen).toBe(false);
	fireEvent.click(screen.getByRole('button', { name: 'Ask from paper' }));
	expect(screen.getByLabelText('Question draft')).toBe(draft);
	expect(draft.value).toBe('Unsent follow-up');
	fireEvent.keyDown(window, { altKey: true, code: 'Backslash' });
	expect(screen.getByRole('button', { name: 'Show assistant' })).toBeTruthy();
});
test('wider resize range and hidden assistant preference survive remount; corrupt preferences recover', () => {
	const ui = render(<Workspace />);
	for (let i = 0; i < 8; i++) fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowLeft' });
	expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('53');
	fireEvent.click(screen.getByRole('button', { name: 'Enter focus mode' }));
	ui.unmount();
	render(<Workspace />);
	expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('53');
	expect(screen.getByRole('button', { name: 'Show assistant' })).toBeTruthy();
	expect(readLayout({ getItem: () => '{broken' })).toEqual({ share: 69, assistantOpen: true });
	expect(readLayout({ getItem: () => '{"share":999,"assistantOpen":false}' }).share).toBe(85);
});
test('fullscreen follows native events and browser denial is reported', async () => {
	let element: Element | null = null;
	Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => element });
	const request = vi.fn(async function (this: HTMLElement) {
		element = this;
		document.dispatchEvent(new Event('fullscreenchange'));
	});
	Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: request });
	Object.defineProperty(document, 'exitFullscreen', {
		configurable: true,
		value: vi.fn(async () => {
			element = null;
			document.dispatchEvent(new Event('fullscreenchange'));
		}),
	});
	render(<Workspace />);
	await act(async () => {
		fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
	});
	expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeTruthy();
	act(() => {
		element = null;
		document.dispatchEvent(new Event('fullscreenchange'));
	});
	request.mockRejectedValueOnce(new Error('Browser denied fullscreen'));
	await act(async () => {
		fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
	});
	expect(screen.getByRole('alert').textContent).toBe('Browser denied fullscreen');
	delete (HTMLElement.prototype as Partial<HTMLElement>).requestFullscreen;
});
