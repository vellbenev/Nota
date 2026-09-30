import { forwardRef } from 'react';
import styles from './ScrollArea.module.css';
import type { ScrollAreaProps } from './types';
export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea(
	{ className = '', children, ...rest },
	ref,
) {
	return (
		<div {...rest} ref={ref} className={`${styles.root} ${className}`}>
			{children}
		</div>
	);
});

