import { forwardRef } from 'react';
import styles from './Button.module.css';
import type { ButtonProps } from './types';

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
	{
		variant = 'secondary',
		size = 'md',
		loading = false,
		icon,
		children,
		className = '',
		disabled,
		type = 'button',
		...rest
	},
	ref,
) {
	return (
		<button
			{...rest}
			ref={ref}
			type={type}
			disabled={disabled || loading}
			aria-busy={loading || undefined}
			className={`${styles.button} ${styles[variant]} ${styles[size]} ${className}`}
		>
			{loading ? (
				<span className={styles.spinner} aria-hidden='true' />
			) : icon ? (
				<span className={styles.iconWrap} aria-hidden='true'>
					{icon}
				</span>
			) : null}
			{children}
		</button>
	);
});

// Kept for backward compatibility: prefer `import { IconButton } from '../IconButton'`.
export { IconButton } from '../IconButton';

