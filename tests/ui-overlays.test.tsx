import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Button, Dialog, Dropdown, Input, Popover, Tooltip } from '../src/components/ui';
import SnipOverlay from '../src/features/reader/SnipOverlay';
import ThemeControl, { THEME_KEY } from '../src/features/workspace/ThemeControl';
beforeEach(() => {
	Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
		configurable: true,
		value: function (this: HTMLDialogElement) {
			this.setAttribute('open', '');
		},
	});
	Object.defineProperty(HTMLDialogElement.prototype, 'close', {
		configurable: true,
		value: function (this: HTMLDialogElement) {
			this.removeAttribute('open');
		},
	});
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	localStorage.removeItem(THEME_KEY);
	delete document.documentElement.dataset.theme;
	delete (document as Document & { fullscreenElement?: Element }).fullscreenElement;
});

test('settings dismiss with Escape/outside click while preserving mounted field state', () => {
	function Fixture() {
		const [value, setValue] = useState('');
		return (
			<>
				<Popover label='Preferences'>
					<Input aria-label='Draft' value={value} onChange={e => setValue(e.target.value)} />
				</Popover>
				<Button>Outside</Button>
			</>
		);
	}
	render(<Fixture />);
	const trigger = screen.getByRole('button', { name: 'Preferences' });
	expect(screen.queryByRole('textbox')).toBeNull();
	fireEvent.click(trigger);
	fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep my draft' } });
	fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
	expect(screen.queryByRole('textbox')).toBeNull();
	expect(document.activeElement).toBe(trigger);
	fireEvent.click(trigger);
	expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Keep my draft');
	fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
	expect(trigger.getAttribute('aria-expanded')).toBe('false');
});

test('nested dropdown Escape closes only the dropdown before closing settings', () => {
	render(
		<Popover label='Preferences'>
			<Dropdown label='Language' value='en' onChange={() => {}} options={[{ value: 'en', label: 'English' }]} />
		</Popover>,
	);
	fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
	const trigger = screen.getByRole('combobox', { name: 'Language' });
	fireEvent.click(trigger);
	fireEvent.keyDown(trigger, { key: 'Escape' });
	expect(trigger.getAttribute('aria-expanded')).toBe('false');
	expect(screen.getByRole('region', { name: 'Preferences' })).toBeTruthy();
	fireEvent.keyDown(trigger, { key: 'Escape' });
	expect(screen.queryByRole('region', { name: 'Preferences' })).toBeNull();
});

test('fullscreen dropdowns and tooltips belong to the fullscreen surface', () => {
	const host = document.createElement('main');
	document.body.append(host);
	Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: host });
	const ui = render(
		<>
			<Dropdown label='Zoom' value='one' onChange={() => {}} options={[{ value: 'one', label: '100%' }]} />
			<Tooltip content='Focus reading'>
				<Button>Focus</Button>
			</Tooltip>
		</>,
	);
	fireEvent.click(screen.getByRole('combobox'));
	expect(host.contains(screen.getByRole('listbox'))).toBe(true);
	expect(ui.container.contains(screen.getByRole('listbox'))).toBe(false);
	fireEvent.focus(screen.getByRole('button', { name: 'Focus' }));
	expect(host.contains(screen.getByRole('tooltip'))).toBe(true);
	fireEvent.keyDown(screen.getByRole('button', { name: 'Focus' }), { key: 'Escape' });
	expect(screen.queryByRole('tooltip')).toBeNull();
	host.remove();
});

test('modal focuses Cancel, blocks Escape while busy, and keeps nested menus in its top layer', () => {
	const dismiss = vi.fn();
	function Fixture({ busy = false }) {
		const cancel = useRef<HTMLButtonElement>(null);
		return (
			<Dialog open busy={busy} onDismiss={dismiss} initialFocus={cancel} labelledBy='test-modal-title'>
				<h2 id='test-modal-title'>Restore preview</h2>
				<Dropdown
					label='Mode'
					value='merge'
					onChange={() => {}}
					options={[{ value: 'merge', label: 'Merge' }]}
				/>
				<Button ref={cancel}>Cancel</Button>
			</Dialog>
		);
	}
	const ui = render(<Fixture />);
	const dialog = screen.getByRole('dialog');
	expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
	fireEvent.click(screen.getByRole('combobox'));
	expect(dialog.contains(screen.getByRole('listbox'))).toBe(true);
	ui.rerender(<Fixture busy />);
	fireEvent(dialog, new Event('cancel', { cancelable: true }));
	expect(dismiss).not.toHaveBeenCalled();
	ui.rerender(<Fixture />);
	fireEvent(dialog, new Event('cancel', { cancelable: true }));
	expect(dismiss).toHaveBeenCalledTimes(1);
});

test('theme resolves the system on mount and supports explicit saved overrides', () => {
	localStorage.setItem(THEME_KEY, 'light');
	let listener: (() => void) | undefined;
	const query = {
		matches: true,
		addEventListener: (_event: string, fn: () => void) => {
			listener = fn;
		},
		removeEventListener: vi.fn(),
	};
	vi.stubGlobal('matchMedia', () => query);
	render(<ThemeControl />);
	expect(document.documentElement.dataset.theme).toBe('light');
	fireEvent.click(screen.getByRole('combobox'));
	fireEvent.click(screen.getByRole('option', { name: 'System' }));
	expect(document.documentElement.dataset.theme).toBe('dark');
	expect(localStorage.getItem(THEME_KEY)).toBe('system');
	query.matches = false;
	listener?.();
	expect(document.documentElement.dataset.theme).toBe('light');
});

test('Snip actions escape clipping and show preparation errors alongside the crop controls', async () => {
	const explain = vi.fn(),
		activate = vi.fn(),
		cancel = vi.fn();
	const props = {
		page: 1,
		width: 500,
		activePage: 1,
		onActivate: activate,
		onCancel: cancel,
		getPage: vi.fn(async () => {
			throw new Error('Page unavailable');
		}),
		onExplain: explain,
	};
	const ui = render(
		<div style={{ overflow: 'hidden' }}>
			<SnipOverlay {...props} />
		</div>,
	);
	fireEvent.keyDown(screen.getByRole('region', { name: 'Snip area on page 1' }), { key: 'Enter' });
	expect(activate).toHaveBeenCalledOnce();
	expect(ui.container.contains(screen.getByRole('toolbar'))).toBe(false);
	expect(explain).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole('button', { name: 'Explain snip' }));
	const error = await screen.findByRole('alert');
	expect(screen.getByRole('toolbar').contains(error)).toBe(true);
	expect(error.textContent).toBe('Page unavailable');
	fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
	expect(cancel).toHaveBeenCalledOnce();
	expect(explain).not.toHaveBeenCalled();
});
