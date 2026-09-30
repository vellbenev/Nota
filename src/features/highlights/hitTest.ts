import type { Highlight } from '../../domain/highlight';
import { projectRect, type ClientBox, type PageGeometry } from '../../infrastructure/pdf/geometry';
/** Hit-test beneath the PDF text layer, leaving native dragging/selection untouched. */
export function highlightAtPoint(items: Highlight[], geometry: PageGeometry, box: ClientBox, x: number, y: number) {
	if (box.width <= 0 || box.height <= 0) return undefined;
	const px = (x - box.left) / box.width,
		py = (y - box.top) / box.height;
	return [...items].reverse().find(item =>
		item.rects.some(rect => {
			const [left, top, width, height] = projectRect(rect, geometry);
			return px >= left && px <= left + width && py >= top && py <= top + height;
		}),
	);
}
