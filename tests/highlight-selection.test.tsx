import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { HighlightColor } from '../src/domain/highlight';
import TextSelectionMenu from '../src/features/reader/TextSelectionMenu';
import { usePdfSelection } from '../src/features/reader/usePdfSelection';

const geometry = { box: [0, 0, 600, 800], transform: [1, 0, 0, -1, 0, 800], width: 600, height: 800 };
const onSelection = vi.fn(),
	onError = vi.fn(),
	onAction = vi.fn();
let top = 150;
function Fixture() {
	const root = useRef<HTMLDivElement>(null),
		geometries = useRef(new Map([[1, geometry]]));
	const [color, setColor] = useState<HighlightColor>('yellow');
	const { selected } = usePdfSelection({ root, geometries, enabled: true, onSelection, onError, onEscape: vi.fn() });
	return (
		<>
			<div ref={root} data-testid='pages'>
				<div data-pdf-page='1'>
					<div className='react-pdf__Page__textContent'>
						<span>A passage across several words</span>
					</div>
				</div>
			</div>
			{selected && (
				<TextSelectionMenu
					selection={selected}
					persistent
					onAction={onAction}
					color={color}
					onColor={setColor}
				/>
			)}
		</>
	);
}
function select() {
	const node = screen.getByText('A passage across several words').firstChild!;
	const range = document.createRange();
	range.setStart(node, 2);
	range.setEnd(node, 15);
	window.getSelection()!.removeAllRanges();
	window.getSelection()!.addRange(range);
	fireEvent(document, new Event('selectionchange'));
}
beforeEach(() => {
	vi.useFakeTimers();
	top = 150;
	vi.stubGlobal('PointerEvent', MouseEvent);
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
		return { left: 0, top: 100, right: 600, bottom: 900, width: 600, height: 800 } as DOMRect;
	});
	Object.defineProperty(Range.prototype, 'getClientRects', {
		configurable: true,
		value: () => [{ left: 40, top, width: 180, height: 16 }],
	});
	Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
		configurable: true,
		value: () => ({ left: 40, top, right: 220, bottom: top + 16, width: 180, height: 16 }),
	});
});
afterEach(() => {
	cleanup();
	window.getSelection()?.removeAllRanges();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});
test('does not interrupt a drag; final selection and chosen color survive toolbar pointer and keyboard focus', () => {
	render(<Fixture />);
	const text = screen.getByText('A passage across several words');
	fireEvent.pointerDown(text, { button: 0 });
	select();
	act(() => vi.advanceTimersByTime(200));
	expect(screen.queryByRole('toolbar', { name: 'Selection actions' })).toBeNull();
	fireEvent.pointerUp(text);
	act(() => vi.advanceTimersByTime(1));
	const green = screen.getByRole('button', { name: 'Green highlight' });
	expect(fireEvent.pointerDown(green)).toBe(false);
	fireEvent.click(green);
	expect(green.getAttribute('aria-pressed')).toBe('true');
	act(() => {
		green.focus();
		window.getSelection()!.removeAllRanges();
	});
	fireEvent(document, new Event('selectionchange'));
	act(() => vi.advanceTimersByTime(200));
	expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toBeTruthy();
	fireEvent.click(screen.getByRole('button', { name: 'Highlight', exact: true }));
	expect(onAction).toHaveBeenCalledExactlyOnceWith('highlight');
});

test('selectionchange settles keyboard/programmatic selection; scrolling keeps visible selection and dismisses offscreen selection', () => {
	render(<Fixture />);
	select();
	act(() => vi.advanceTimersByTime(110));
	expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toBeTruthy();
	top = 200;
	fireEvent.scroll(screen.getByTestId('pages'));
	act(() => vi.advanceTimersByTime(20));
	expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toBeTruthy();
	top = -30;
	fireEvent.scroll(screen.getByTestId('pages'));
	act(() => vi.advanceTimersByTime(20));
	expect(screen.queryByRole('toolbar', { name: 'Selection actions' })).toBeNull();
});

test('Escape cancels pending capture so the menu cannot reappear after dismissal', () => {
	render(<Fixture />);
	select();
	fireEvent.keyDown(document, { key: 'Escape' });
	act(() => vi.advanceTimersByTime(200));
	expect(screen.queryByRole('toolbar', { name: 'Selection actions' })).toBeNull();
	expect(window.getSelection()!.isCollapsed).toBe(true);
});

test('unrelated pointer activity does not clear an Ask composer after its PDF selection was dismissed', () => {
	render(<Fixture />);
	fireEvent.pointerDown(document.body, { button: 0 });
	expect(onSelection).not.toHaveBeenCalled();
	select();
	act(() => vi.advanceTimersByTime(110));
	onSelection.mockClear();
	fireEvent.pointerDown(document.body, { button: 0 });
	expect(onSelection).toHaveBeenCalledExactlyOnceWith(null);
	fireEvent.pointerDown(document.body, { button: 0 });
	act(() => vi.advanceTimersByTime(110));
	expect(onSelection).toHaveBeenCalledTimes(1);
});
