import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeClientRects, projectRect } from '../src/infrastructure/pdf/geometry.ts';

test('normalized PDF rects round-trip at all rotations, zoom levels, crop offsets and CSS sizes', () => {
	const box = [10, 20, 610, 820];
	const transforms = [
		[1, 0, 0, -1, -10, 820],
		[0, 1, 1, 0, -20, -10],
		[-1, 0, 0, 1, 610, -20],
		[0, -1, -1, 0, 820, 610],
	];
	for (const [rotation, transform] of transforms.entries())
		for (const zoom of [0.5, 1, 1.25, 2]) {
			const geometry = {
				box,
				transform: transform.map(v => v * zoom),
				width: (rotation % 2 ? 800 : 600) * zoom,
				height: (rotation % 2 ? 600 : 800) * zoom,
			};
			const expected = [0.13, 0.27, 0.4, 0.035];
			const [x, y, w, h] = projectRect(expected, geometry);
			const client = { left: 81, top: -320, width: geometry.width * 0.83, height: geometry.height * 0.83 };
			const rect = {
				left: client.left + x * client.width,
				top: client.top + y * client.height,
				width: w * client.width,
				height: h * client.height,
			};
			const actual = normalizeClientRects([rect], client, geometry)[0];
			actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-12));
		}
});
test('clips to page and keeps disjoint bidi rectangles; rejects empty geometry', () => {
	const geometry = { box: [0, 0, 100, 100], transform: [1, 0, 0, -1, 0, 100], width: 100, height: 100 };
	const client = { left: 0, top: 0, width: 100, height: 100 };
	assert.deepEqual(
		normalizeClientRects(
			[
				{ left: -10, top: -10, width: 30, height: 30 },
				{ left: 80, top: 10, width: 30, height: 10 },
				{ left: 0, top: 0, width: 0, height: 0 },
			],
			client,
			geometry,
		),
		[
			[0, 0.8, 0.2, 0.19999999999999996],
			[0.8, 0.8, 0.19999999999999996, 0.09999999999999998],
		],
	);
	assert.deepEqual(normalizeClientRects([client], { ...client, width: 0 }, geometry), []);
});

test('deduplicates and joins overlapping same-line fragments without filling bidi or column gaps', () => {
	const geometry = { box: [0, 0, 100, 100], transform: [1, 0, 0, -1, 0, 100], width: 100, height: 100 };
	const client = { left: 0, top: 0, width: 100, height: 100 };
	const rects = normalizeClientRects(
		[
			{ left: 5, top: 10, width: 20, height: 8 },
			{ left: 5, top: 10, width: 20, height: 8 },
			{ left: 20, top: 10, width: 15, height: 8 },
			{ left: 60, top: 10, width: 20, height: 8 },
			{ left: 5, top: 22, width: 30, height: 8 },
			{ left: NaN, top: 10, width: 20, height: 8 },
		],
		client,
		geometry,
	);
	assert.equal(rects.length, 3);
	const projected = rects.map(rect => projectRect(rect, geometry));
	assert.ok(Math.abs(projected[0][2] - 0.3) < 1e-12);
	assert.ok(Math.abs(projected[1][0] - 0.6) < 1e-12);
	assert.ok(Math.abs(projected[2][1] - 0.22) < 1e-12);
});
