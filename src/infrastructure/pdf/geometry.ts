/** Rects use the unrotated crop box, with a bottom-left origin. */
export type NormalizedRect = [number, number, number, number];
export interface PageGeometry {
	rotation?: number;
	box: number[];
	transform: number[];
	width: number;
	height: number;
}
export interface ClientBox {
	left: number;
	top: number;
	width: number;
	height: number;
}
const bounds = (points: number[][]): NormalizedRect => {
	const xs = points.map(p => p[0]),
		ys = points.map(p => p[1]);
	return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
};
const corners = ([x, y, w, h]: NormalizedRect) => [
	[x, y],
	[x + w, y],
	[x, y + h],
	[x + w, y + h],
];
/** Merge only overlapping/touching fragments on the same visual line, before PDF rotation. */
function cleanClientRects(rects: Iterable<ClientBox>, client: ClientBox): ClientBox[] {
	const lines: ClientBox[] = [];
	for (const rect of rects) {
		if (![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)) continue;
		const left = Math.max(client.left, rect.left),
			top = Math.max(client.top, rect.top);
		const right = Math.min(client.left + client.width, rect.left + rect.width);
		const bottom = Math.min(client.top + client.height, rect.top + rect.height);
		if (right <= left || bottom <= top) continue;
		let merged: ClientBox = { left, top, width: right - left, height: bottom - top };
		for (let index = 0; index < lines.length; ) {
			const other = lines[index];
			const tolerance = Math.min(1, Math.min(merged.height, other.height) * 0.08);
			const sameLine =
				Math.abs(merged.top - other.top) <= tolerance &&
				Math.abs(merged.top + merged.height - other.top - other.height) <= tolerance;
			const touching =
				merged.left <= other.left + other.width + tolerance &&
				other.left <= merged.left + merged.width + tolerance;
			if (!sameLine || !touching) {
				index++;
				continue;
			}
			const x = Math.min(merged.left, other.left),
				y = Math.min(merged.top, other.top);
			merged = {
				left: x,
				top: y,
				width: Math.max(merged.left + merged.width, other.left + other.width) - x,
				height: Math.max(merged.top + merged.height, other.top + other.height) - y,
			};
			lines.splice(index, 1);
			index = 0;
		}
		lines.push(merged);
	}
	return lines;
}
export function normalizeClientRects(
	rects: Iterable<ClientBox>,
	client: ClientBox,
	geometry: PageGeometry,
): NormalizedRect[] {
	const [a, b, c, d, e, f] = geometry.transform,
		det = a * d - b * c;
	const [x0, y0, x1, y1] = geometry.box;
	if (!det || client.width <= 0 || client.height <= 0 || x1 <= x0 || y1 <= y0) return [];
	return cleanClientRects(rects, client).flatMap(rect => {
		const left = Math.max(client.left, rect.left),
			top = Math.max(client.top, rect.top);
		const right = Math.min(client.left + client.width, rect.left + rect.width);
		const bottom = Math.min(client.top + client.height, rect.top + rect.height);
		if (right <= left || bottom <= top) return [];
		const normalized = bounds(
			corners([left, top, right - left, bottom - top]).map(([x, y]) => {
				const u = ((x - client.left) * geometry.width) / client.width - e;
				const v = ((y - client.top) * geometry.height) / client.height - f;
				return [
					Math.max(0, Math.min(1, ((d * u - c * v) / det - x0) / (x1 - x0))),
					Math.max(0, Math.min(1, ((-b * u + a * v) / det - y0) / (y1 - y0))),
				];
			}),
		);
		return [normalized];
	});
}
/** Return viewport fractions suitable for percentage-based overlay positioning. */
export function projectRect(rect: NormalizedRect, geometry: PageGeometry): NormalizedRect {
	const [a, b, c, d, e, f] = geometry.transform,
		[x0, y0, x1, y1] = geometry.box;
	return bounds(
		corners(rect).map(([nx, ny]) => {
			const x = x0 + nx * (x1 - x0),
				y = y0 + ny * (y1 - y0);
			return [(a * x + c * y + e) / geometry.width, (b * x + d * y + f) / geometry.height];
		}),
	);
}
