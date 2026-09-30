import type { ButtonHTMLAttributes, ReactNode } from 'react';
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: 'ghost' | 'secondary' | 'subtle' | 'primary';
	size?: 'sm' | 'md';
	loading?: boolean;
	children?: ReactNode;
}

