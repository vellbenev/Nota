import { useLayoutEffect, useState } from 'react';
import { Dropdown } from '../../components/ui';
export const THEME_KEY = 'nota.theme.v1';
type Theme = 'system' | 'light' | 'dark';
export default function ThemeControl() {
	const [theme, setTheme] = useState<Theme>(() => {
		try {
			const value = localStorage.getItem(THEME_KEY);
			return value === 'light' || value === 'dark' ? value : 'system';
		} catch {
			return 'system';
		}
	});
	useLayoutEffect(() => {
		const query = window.matchMedia?.('(prefers-color-scheme: dark)');
		const apply = () => {
			document.documentElement.dataset.theme = theme === 'system' ? (query?.matches ? 'dark' : 'light') : theme;
		};
		apply();
		query?.addEventListener('change', apply);
		try {
			localStorage.setItem(THEME_KEY, theme);
		} catch {
			/* Theme still works for this session. */
		}
		return () => query?.removeEventListener('change', apply);
	}, [theme]);
	return (
		<section aria-label='Appearance'>
			<h3>Appearance</h3>
			<Dropdown
				label='Color theme'
				value={theme}
				onChange={value => setTheme(value as Theme)}
				options={[
					{ value: 'system', label: 'System' },
					{ value: 'light', label: 'Light' },
					{ value: 'dark', label: 'Dark' },
				]}
			/>
		</section>
	);
}
