import { useEffect, useState, type RefObject } from 'react';
/** Keep overlays inside the active fullscreen surface or native modal top layer. */
export function useOverlayHost(anchor?: RefObject<HTMLElement | null>) {
	const [, refresh] = useState(0);
	useEffect(() => {
		const changed = () => refresh(value => value + 1);
		document.addEventListener('fullscreenchange', changed);
		return () => document.removeEventListener('fullscreenchange', changed);
	}, []);
	return (
		anchor?.current?.closest<HTMLElement>('dialog[open], [data-ui-overlay]') ??
		document.fullscreenElement ??
		document.body
	);
}
