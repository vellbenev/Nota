import type { ButtonHTMLAttributes, ReactNode } from 'react';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: 'primary' | 'secondary' | 'ghost' | 'subtle' | 'danger';
	size?: 'sm' | 'md' | 'icon';
	loading?: boolean;
	icon?: ReactNode;
}

