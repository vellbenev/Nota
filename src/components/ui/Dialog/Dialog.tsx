import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useOverlayHost } from '../overlay';
import styles from './Dialog.module.css';
/** Native modal semantics, with the same Nota surface and focus behavior everywhere. */
export function Dialog({
	open,
	busy = false,
	onDismiss,
	initialFocus,
	labelledBy,
	children,
}: {
	open: boolean;
	busy?: boolean;
	onDismiss: () => void;
	initialFocus?: RefObject<HTMLElement | null>;
	labelledBy: string;
	children: ReactNode;
}) {
	const dialog = useRef<HTMLDialogElement>(null),
		host = useOverlayHost();
	useLayoutEffect(() => {
		const element = dialog.current;
		if (open && element && !element.open) {
			element.showModal();
			initialFocus?.current?.focus({ preventScroll: true });
		} else if (!open && element?.open) element.close();
	}, [open, host, initialFocus]);
	return createPortal(
		<dialog
			ref={dialog}
			className={styles.dialog}
			aria-labelledby={labelledBy}
			aria-busy={busy || undefined}
			onCancel={event => {
				event.preventDefault();
				if (!busy) onDismiss();
			}}
			onClose={() => {
				if (open && !busy) onDismiss();
			}}
		>
			{children}
		</dialog>,
		host,
	);
}
