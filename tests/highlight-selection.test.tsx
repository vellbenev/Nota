import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import TextSelectionMenu from '../src/features/reader/TextSelectionMenu';
import { usePdfSelection } from '../src/features/reader/usePdfSelection';

const geometry = { box: [0, 0, 600, 800], transform: [1, 0, 0, -1, 0, 800], width: 600, height: 800 };
const onSelection = vi.fn(),
	onError = vi.fn(),
	onAction = vi.fn();
let top = 150;
let persistent = true;
let currentColor: 'yellow' | 'green' | 'blue' | undefined;
let lastSelection: Parameters<typeof onSelection>[0];
onSelection.mockImplementation(value => (lastSelection = value));
function Fixture() {
	const root = useRef<HTMLDivElement>(null),
		geometries = useRef(new Map([[1, geometry]]));
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
					persistent={persistent}
					onAction={onAction}
					color='yellow'
					currentColor={currentColor}
					highlighted={!!currentColor}
				/>
			)}
		</>
	);
}
function select(start = 2, end = 15) {
	const node = screen.getByText('A passage across several words').firstChild!;
	const range = document.createRange();
	range.setStart(node, start);
	range.setEnd(node, end);
	window.getSelection()!.removeAllRanges();
	window.getSelection()!.addRange(range);
	fireEvent(document, new Event('selectionchange'));
}
beforeEach(() => {
	vi.useFakeTimers();
	top = 150;
	persistent = true;
	currentColor = undefined;
	lastSelection = undefined;
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
	const green = screen.getByRole('button', { name: 'Highlight Green' });
	expect(fireEvent.pointerDown(green)).toBe(false);
	act(() => {
		green.focus();
		window.getSelection()!.removeAllRanges();
	});
	fireEvent(document, new Event('selectionchange'));
	act(() => vi.advanceTimersByTime(200));
	expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toBeTruthy();
	// One click on a color highlights with that color.
	fireEvent.click(green);
	expect(onAction).toHaveBeenCalledExactlyOnceWith('highlight', 'green');
	expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
});

test('selections record page-text offsets and drop surrounding whitespace', () => {
	render(<Fixture />);
	// "A passage across several words": offsets 1..17 are " passage across " (spaces at both ends).
	select(1, 17);
	act(() => vi.advanceTimersByTime(110));
	expect(lastSelection).toMatchObject({
		text: 'passage across',
		range: { start: 2, end: 16 },
		anchor: { quote: 'passage across', prefix: 'A ', suffix: ' several words' },
	});
});

test('already highlighted text shows its color and a Remove action; session documents cannot highlight', () => {
	currentColor = 'blue';
	render(<Fixture />);
	select();
	act(() => vi.advanceTimersByTime(110));
	expect(screen.getByRole('button', { name: 'Highlight Blue' }).getAttribute('aria-pressed')).toBe('true');
	fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
	expect(onAction).toHaveBeenCalledWith('remove');
	cleanup();
	persistent = false;
	currentColor = undefined;
	render(<Fixture />);
	select();
	act(() => vi.advanceTimersByTime(110));
	expect((screen.getByRole('button', { name: 'Highlight Yellow' }) as HTMLButtonElement).disabled).toBe(true);
	expect((screen.getByRole('button', { name: 'Note' }) as HTMLButtonElement).disabled).toBe(true);
	expect((screen.getByRole('button', { name: 'Explain' }) as HTMLButtonElement).disabled).toBe(false);
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
