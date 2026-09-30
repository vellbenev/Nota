import type { ReactElement } from 'react';
export interface TooltipProps {
	content: string;
	children: ReactElement;
	className?: string;
	delayMs?: number;
}

