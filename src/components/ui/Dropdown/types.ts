import type { ReactNode } from 'react';
export interface DropdownOption {
	value: string;
	label: string;
	icon?: ReactNode;
	badge?: string;
	disabled?: boolean;
}
export interface DropdownProps {
	label: string;
	value: string;
	options: DropdownOption[];
	onChange: (value: string) => void;
	placeholder?: string;
	searchable?: boolean;
	allowCustomValue?: boolean;
	disabled?: boolean;
	className?: string;
	id?: string;
}

