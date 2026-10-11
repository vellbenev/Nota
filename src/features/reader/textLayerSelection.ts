/**
 * Keeps drag selections in PDF.js text layers from "jumping".
 *
 * A text layer is a sparse set of absolutely positioned spans. When a drag ends
 * over blank space (past the end of a line, between paragraphs, in a margin or
 * column gutter), browsers resolve the focus to an arbitrary DOM position, which
 * often extends the selection to the end of the page or into the next page.
 * PDF.js's own viewer avoids this by moving the layer's `.endOfContent` element
 * (a full-size, selectable backdrop while selecting) next to the selection's
 * moving edge, so blank space maps to the nearest text instead.
 *
 * React-PDF renders the same `.endOfContent` element but only toggles a
 * `selecting` class on its layer. This module ports the PDF.js behaviour
 * (TextLayerBuilder#enableGlobalSelectionListener) for every text layer inside
 * `root`, including pages mounted later by the virtualizer. Firefox and
 * Chromium 148+ handle this natively, exactly as PDF.js assumes.
 */
const LAYER = '.react-pdf__Page__textContent';

export function needsSelectionStabilizer(win: Window = window) {
	const css = (win as Window & { CSS?: typeof CSS }).CSS;
	if (css?.supports?.('-moz-user-select', 'none')) return false; // Firefox
	const nav = win.navigator as Navigator & { userAgentData?: { brands?: { brand: string; version: string }[] } };
	const version =
		nav.userAgentData?.brands?.find(({ brand }) => brand === 'Chromium')?.version ??
		/\bChrome\/(\d+)\b/.exec(nav.userAgent)?.[1];
	return !(version && Number.parseInt(version, 10) >= 148);
}

export function stabilizeTextSelection(root: HTMLElement, enabled = needsSelectionStabilizer()) {
	const ends = new WeakMap<Element, HTMLElement>();
	let pointerDown = false;
	let previous: Range | null = null;

	const layers = () => Array.from(root.querySelectorAll<HTMLElement>(LAYER));
	const endFor = (layer: HTMLElement) => {
		let end = ends.get(layer);
		if (!end || !layer.contains(end)) {
			end = layer.querySelector<HTMLElement>('.endOfContent') ?? undefined;
			if (end) ends.set(layer, end);
		}
		return end;
	};
	const reset = (layer: HTMLElement) => {
		const end = endFor(layer);
		if (end) {
			if (end.parentElement !== layer || layer.lastElementChild !== end) layer.append(end);
			end.style.width = '';
			end.style.height = '';
			end.style.userSelect = '';
		}
		layer.classList.remove('selecting');
	};
	const resetAll = () => {
		previous = null;
		layers().forEach(reset);
	};

	const onPointerDown = () => {
		pointerDown = true;
	};
	const onPointerUp = () => {
		pointerDown = false;
		resetAll();
	};
	const onKeyUp = () => {
		if (!pointerDown) resetAll();
	};
	const onSelectionChange = () => {
		const selection = document.getSelection();
		if (!selection || selection.rangeCount === 0) {
			resetAll();
			return;
		}
		const range = selection.getRangeAt(0);
		const active = new Set<HTMLElement>();
		for (const layer of layers()) {
			if (range.intersectsNode(layer)) {
				active.add(layer);
				layer.classList.add('selecting');
			} else reset(layer);
		}
		if (!enabled || !pointerDown || !active.size) {
			previous = range.cloneRange();
			return;
		}
		// Which edge is moving? A backward drag modifies the start.
		const modifyStart =
			!!previous &&
			(range.compareBoundaryPoints(Range.END_TO_END, previous) === 0 ||
				range.compareBoundaryPoints(Range.START_TO_END, previous) === 0);
		let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer;
		if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
		if (!modifyStart && range.endOffset === 0 && anchor) {
			// The focus sits before this node's content; anchor on the previous non-empty node.
			do {
				while (anchor && !anchor.previousSibling) anchor = anchor.parentNode;
				anchor = anchor?.previousSibling ?? null;
			} while (anchor && !anchor.childNodes.length);
		}
		const parent = anchor?.parentElement;
		const layer = parent?.closest<HTMLElement>(LAYER);
		const end = layer && active.has(layer) ? endFor(layer) : undefined;
		if (anchor && parent && layer && end && anchor !== end) {
			end.style.width = layer.style.width;
			end.style.height = layer.style.height;
			end.style.userSelect = 'text';
			parent.insertBefore(end, modifyStart ? anchor : anchor.nextSibling);
		}
		previous = range.cloneRange();
	};

	document.addEventListener('pointerdown', onPointerDown, true);
	document.addEventListener('pointerup', onPointerUp);
	document.addEventListener('keyup', onKeyUp);
	document.addEventListener('selectionchange', onSelectionChange);
	window.addEventListener('blur', onPointerUp);
	return () => {
		document.removeEventListener('pointerdown', onPointerDown, true);
		document.removeEventListener('pointerup', onPointerUp);
		document.removeEventListener('keyup', onKeyUp);
		document.removeEventListener('selectionchange', onSelectionChange);
		window.removeEventListener('blur', onPointerUp);
		resetAll();
	};
}
