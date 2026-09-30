import { forwardRef } from 'react';
import styles from './IconButton.module.css';
import type { IconButtonProps } from './types';

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
	{ variant = 'ghost', size = 'md', loading = false, children, className = '', disabled, type = 'button', ...rest },
	ref,
) {
	return (
		<button
			{...rest}
			ref={ref}
			type={type}
			disabled={disabled || loading}
			aria-busy={loading || undefined}
			className={`${styles.iconButton} ${styles[variant]} ${styles[size]} ${className}`}
		>
			{loading ? <span className={styles.spinner} aria-hidden='true' /> : children}
		</button>
	);
});

