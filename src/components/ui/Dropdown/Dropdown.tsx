import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import styles from './Dropdown.module.css';
import type { DropdownOption, DropdownProps } from './types';

export function Dropdown({
	label,
	value,
	options,
	onChange,
	placeholder = 'Select…',
	searchable = false,
	allowCustomValue = false,
	disabled = false,
	className = '',
	id,
}: DropdownProps) {
	const generatedId = useId().replace(/:/g, '');
	const listId = `dropdown-list-${generatedId}`;
	const root = useRef<HTMLDivElement>(null),
		trigger = useRef<HTMLButtonElement>(null),
		search = useRef<HTMLInputElement>(null),
		list = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false),
		[mounted, setMounted] = useState(false),
		[query, setQuery] = useState(''),
		[active, setActive] = useState(0);
	const filtered = options.filter(
		option =>
			option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ||
			option.value.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
	);
	const selected = options.find(option => option.value === value);
	const enabled = filtered.map((item, index) => ({ item, index })).filter(({ item }) => !item.disabled);
	function dismiss(restoreFocus = false) {
		setOpen(false);
		setQuery('');
		if (restoreFocus) trigger.current?.focus();
	}
	function show() {
		if (disabled) return;
		setQuery('');
		const selectedIndex = options.findIndex(option => option.value === value && !option.disabled);
		setActive(
			selectedIndex >= 0
				? selectedIndex
				: Math.max(
						0,
						options.findIndex(option => !option.disabled),
					),
		);
		setMounted(true);
		setOpen(true);
	}
	function choose(option: DropdownOption) {
		if (option.disabled) return;
		onChange(option.value);
		dismiss(true);
	}
	function move(delta: number) {
		if (!enabled.length) return;
		const at = enabled.findIndex(({ index }) => index === active);
		setActive(enabled[(at + delta + enabled.length) % enabled.length].index);
	}
	function onKeys(event: KeyboardEvent<HTMLElement>) {
		if (event.key === 'Escape' && open) {
			event.preventDefault();
			event.stopPropagation();
			dismiss(true);
			return;
		}
		if (event.key === 'Tab') {
			if (open) dismiss(event.currentTarget === search.current);
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (!open) {
				show();
				return;
			}
			move(event.key === 'ArrowDown' ? 1 : -1);
			return;
		}
		if (event.key === 'Home' || event.key === 'End') {
			if (!open) return;
			event.preventDefault();
			setActive(enabled[event.key === 'Home' ? 0 : enabled.length - 1]?.index ?? 0);
			return;
		}
		if (event.key === 'Enter' || event.key === ' ') {
			if (!open) {
				event.preventDefault();
				show();
				return;
			}
			if (event.key === ' ' && event.currentTarget === search.current) return;
			event.preventDefault();
			const option = filtered[active];
			if (option && !option.disabled) choose(option);
			else if (allowCustomValue && query.trim()) {
				onChange(query.trim());
				dismiss(true);
			}
			return;
		}
		if (
			!open &&
			searchable &&
			event.currentTarget === trigger.current &&
			event.key.length === 1 &&
			!event.altKey &&
			!event.ctrlKey &&
			!event.metaKey
		) {
			show();
			setQuery(event.key);
			setActive(0);
		}
	}
	useEffect(() => {
		if (!open) return;
		const outside = (event: PointerEvent) => {
			if (!root.current?.contains(event.target as Node) && !popover.current?.contains(event.target as Node))
				dismiss();
		};
		document.addEventListener('pointerdown', outside);
		return () => document.removeEventListener('pointerdown', outside);
	}, [open]);
	useEffect(() => {
		if (open || !mounted) return;
		const timer = window.setTimeout(() => setMounted(false), 160);
		return () => window.clearTimeout(timer);
	}, [open, mounted]);
	useEffect(() => {
		if (open && searchable) search.current?.focus();
	}, [open, searchable]);
	useEffect(() => {
		if (open)
			list.current
				?.querySelector<HTMLElement>(`[data-index="${active}"]`)
				?.scrollIntoView?.({ block: 'nearest' });
	}, [active, open, query]);
	const popover = useRef<HTMLDivElement>(null);
	const [placement, setPlacement] = useState({
		left: 8,
		top: 8,
		width: 200,
		maxHeight: 300,
		direction: 'ltr' as 'ltr' | 'rtl',
	});
	useLayoutEffect(() => {
		if (!open) return;
		function place() {
			const anchor = trigger.current?.getBoundingClientRect();
			if (!anchor) return;
			const width = Math.min(Math.max(anchor.width, 200), 320, window.innerWidth - 16);
			const height = popover.current?.getBoundingClientRect().height || 300;
			const bottom = window.innerHeight - anchor.bottom - 14;
			const above = anchor.top - 14;
			const flip = bottom < Math.min(height, 200) && above > bottom;
			const direction = getComputedStyle(root.current!).direction === 'rtl' ? 'rtl' : 'ltr';
			setPlacement({
				left: Math.max(
					8,
					Math.min(direction === 'rtl' ? anchor.right - width : anchor.left, window.innerWidth - width - 8),
				),
				top: flip ? Math.max(8, anchor.top - height - 6) : anchor.bottom + 6,
				width,
				maxHeight: Math.max(50, flip ? above : bottom),
				direction,
			});
		}
		place();
		window.addEventListener('resize', place);
		window.addEventListener('scroll', place, true);
		return () => {
			window.removeEventListener('resize', place);
			window.removeEventListener('scroll', place, true);
		};
	}, [open, query]);
	const activeOption = filtered[active];
	const showingPlaceholder = !selected && !value;
	return (
		<div ref={root} className={`${styles.root} ${className}`}>
			<button
				id={id}
				ref={trigger}
				type='button'
				role='combobox'
				aria-label={label}
				aria-haspopup='listbox'
				aria-expanded={open}
				aria-controls={listId}
				aria-activedescendant={open && activeOption ? `${listId}-${active}` : undefined}
				disabled={disabled}
				className={styles.trigger}
				onClick={() => (open ? dismiss() : show())}
				onKeyDown={onKeys}
			>
				<span
					className={`${styles.triggerLabel} ${showingPlaceholder ? styles.triggerPlaceholder : ''}`}
					dir='auto'
				>
					{selected?.label || value || placeholder}
				</span>
				<span className={styles.chevron} aria-hidden='true'>
					<svg
						viewBox='0 0 12 12'
						fill='none'
						stroke='currentColor'
						strokeWidth='1.6'
						strokeLinecap='round'
						strokeLinejoin='round'
					>
						<path d='M2.5 4.5 6 8l3.5-3.5' />
					</svg>
				</span>
			</button>
			{mounted &&
				createPortal(
					<div
						ref={popover}
						style={placement}
						className={`${styles.popover} ${open ? '' : styles.closing}`}
						aria-hidden={!open || undefined}
						inert={!open}
					>
						{searchable && (
							<input
								ref={search}
								className={styles.search}
								role='searchbox'
								aria-label={`Search ${label}`}
								aria-controls={listId}
								aria-autocomplete='list'
								aria-activedescendant={activeOption ? `${listId}-${active}` : undefined}
								value={query}
								onChange={event => {
									const text = event.target.value;
									setQuery(text);
									setActive(
										Math.max(
											0,
											options
												.filter(
													option =>
														option.label
															.toLocaleLowerCase()
															.includes(text.toLocaleLowerCase()) ||
														option.value
															.toLocaleLowerCase()
															.includes(text.toLocaleLowerCase()),
												)
												.findIndex(option => !option.disabled),
										),
									);
								}}
								onKeyDown={onKeys}
								placeholder={allowCustomValue ? 'Search or enter a model…' : 'Search…'}
							/>
						)}
						<div ref={list} id={listId} role='listbox' aria-label={label} className={styles.list}>
							{filtered.map((option, index) => {
								const isSelected = option.value === value;
								return (
									<div
										key={`${option.value}-${index}`}
										id={`${listId}-${index}`}
										data-index={index}
										role='option'
										aria-selected={isSelected}
										aria-disabled={option.disabled || undefined}
										className={`${styles.option} ${index === active ? styles.active : ''} ${option.disabled ? styles.disabled : ''}`}
										onPointerMove={() => setActive(index)}
										onClick={() => choose(option)}
									>
										{option.icon && (
											<span className={styles.itemIcon} aria-hidden='true'>
												{option.icon}
											</span>
										)}
										<span className={styles.itemLabel} dir='auto'>
											{option.label}
										</span>
										{option.badge && <span className={styles.badge}>{option.badge}</span>}
										{isSelected && (
											<span className={styles.check} aria-hidden='true'>
												✓
											</span>
										)}
									</div>
								);
							})}
							{!filtered.length && (
								<div className={styles.empty}>
									{allowCustomValue && query.trim()
										? `Press Enter to use “${query.trim()}”`
										: 'No matches'}
								</div>
							)}
						</div>
					</div>,
					document.body,
				)}
		</div>
	);
}

