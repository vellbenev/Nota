import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { Button, Dropdown, IconButton, ScrollArea, SegmentedControl, Tooltip } from '../src/components/ui';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

test('dropdown filters, announces active option, accepts keyboard selection, and dismisses', () => {
	function Fixture() {
		const [value, setValue] = useState('a');
		return (
			<div dir='rtl'>
				<Dropdown
					label='Saved papers'
					value={value}
					onChange={setValue}
					searchable
					options={[
						{ value: 'a', label: 'اول.pdf', icon: '▤', badge: '73 pages' },
						{ value: 'b', label: 'Second.pdf', icon: '▤', badge: '5 pages' },
					]}
				/>
				<button>Outside</button>
			</div>
		);
	}
	render(<Fixture />);
	const trigger = screen.getByRole('combobox', { name: 'Saved papers' });
	expect(trigger.getAttribute('aria-expanded')).toBe('false');
	fireEvent.keyDown(trigger, { key: 'ArrowDown' });
	expect(trigger.getAttribute('aria-expanded')).toBe('true');
	const search = screen.getByRole('searchbox', { name: 'Search Saved papers' });
	expect(search.getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id);
	fireEvent.change(search, { target: { value: 'Second' } });
	expect(screen.queryByRole('option', { name: /اول/ })).toBeNull();
	fireEvent.keyDown(search, { key: 'Enter' });
	expect(trigger.textContent).toContain('Second.pdf');
	expect(trigger.getAttribute('aria-expanded')).toBe('false');
	fireEvent.click(trigger);
	fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
	expect(trigger.getAttribute('aria-expanded')).toBe('false');
	expect(document.activeElement).toBe(trigger);
	fireEvent.click(trigger);
	fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
	expect(trigger.getAttribute('aria-expanded')).toBe('false');
});

test('select-only dropdown skips disabled options with arrows and keeps menu inside RTL control', () => {
	const onChange = vi.fn();
	const { container } = render(
		<div dir='rtl'>
			<Dropdown
				label='Language'
				value='auto'
				onChange={onChange}
				options={[
					{ value: 'auto', label: 'Auto' },
					{ value: 'fa', label: 'فارسی', disabled: true },
					{ value: 'en', label: 'English' },
				]}
			/>
		</div>,
	);
	const trigger = screen.getByRole('combobox', { name: 'Language' });
	fireEvent.keyDown(trigger, { key: 'Enter' });
	fireEvent.keyDown(trigger, { key: 'ArrowDown' });
	expect(screen.getByRole('option', { name: 'English' }).id).toBe(trigger.getAttribute('aria-activedescendant'));
	fireEvent.keyDown(trigger, { key: 'Enter' });
	expect(onChange).toHaveBeenCalledWith('en');
	expect(container.querySelector('[dir="rtl"] [role="combobox"]')).toBeTruthy();
});

test('button, tooltip, segmented control, and scroll area expose keyboard and loading semantics', () => {
	const onChange = vi.fn();
	render(
		<>
			<Tooltip content='Copy text'>
				<IconButton aria-label='Copy'>⧉</IconButton>
			</Tooltip>
			<Button loading>Send</Button>
			<SegmentedControl
				label='Action'
				value='translate'
				onChange={onChange}
				options={[
					{ value: 'translate', label: 'Translate' },
					{ value: 'clarify', label: 'Clarify' },
				]}
			/>
			<ScrollArea aria-label='Responses'>Answer</ScrollArea>
		</>,
	);
	expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true);
	expect(screen.getByRole('button', { name: 'Copy' }).getAttribute('aria-describedby')).toBe(
		screen.getByRole('tooltip', { hidden: true }).id,
	);
	fireEvent.keyDown(screen.getByRole('button', { name: 'Translate' }), { key: 'ArrowRight' });
	expect(onChange).toHaveBeenCalledWith('clarify');
	expect(screen.getByLabelText('Responses').textContent).toBe('Answer');
});

test('dropdown escapes clipping parents and clamps to the viewport', () => {
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
		return {
			left: 1000,
			right: 1040,
			top: 740,
			bottom: 770,
			width: 40,
			height: 30,
			x: 1000,
			y: 740,
			toJSON: () => ({}),
		} as DOMRect;
	});
	const { container } = render(
		<div style={{ overflow: 'hidden' }}>
			<Dropdown label='Edge menu' value='a' onChange={() => {}} options={[{ value: 'a', label: 'Alpha' }]} />
		</div>,
	);
	fireEvent.click(screen.getByRole('combobox', { name: 'Edge menu' }));
	const list = screen.getByRole('listbox');
	expect(container.contains(list)).toBe(false);
	const popup = list.parentElement!;
	expect(parseFloat(popup.style.left) + parseFloat(popup.style.width)).toBeLessThanOrEqual(window.innerWidth - 8);
	expect(parseFloat(popup.style.top)).toBeGreaterThanOrEqual(8);
	fireEvent.click(screen.getByRole('option', { name: 'Alpha' }));
	expect(screen.getByRole('combobox').getAttribute('aria-expanded')).toBe('false');
});

test('segmented Home and End skip disabled boundary options', () => {
	const onChange = vi.fn();
	render(
		<SegmentedControl
			label='Modes'
			value='b'
			onChange={onChange}
			options={[
				{ value: 'a', label: 'First', disabled: true },
				{ value: 'b', label: 'Middle' },
				{ value: 'c', label: 'Last', disabled: true },
			]}
		/>,
	);
	fireEvent.keyDown(screen.getByRole('button', { name: 'Middle' }), { key: 'Home' });
	expect(onChange).toHaveBeenLastCalledWith('b');
	fireEvent.keyDown(screen.getByRole('button', { name: 'Middle' }), { key: 'End' });
	expect(onChange).toHaveBeenLastCalledWith('b');
});
