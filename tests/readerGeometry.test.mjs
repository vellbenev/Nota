import assert from 'node:assert/strict';
import test from 'node:test';
import { fitPageWidth, offsetForView, pageLayout, viewAtOffset } from '../src/features/reader/geometry.ts';

test('mixed page sizes preserve the page point through zoom and pane resize', () => {
	const pages = Array.from({ length: 120 }, (_, i) =>
		i % 3 === 0 ? { width: 792, height: 612 } : { width: 612, height: 792 },
	);
	const initial = pageLayout(pages, 620);
	const anchor = { page: 89, offset: 0.37, zoom: 1 };
	const restoredInitial = viewAtOffset(initial, offsetForView(initial, anchor), 1);
	assert.equal(restoredInitial.page, anchor.page);
	assert.ok(Math.abs(restoredInitial.offset - anchor.offset) < 1e-10);
	for (const width of [310, 775, 1240, 550]) {
		const resized = pageLayout(pages, width);
		const restored = viewAtOffset(resized, offsetForView(resized, anchor), width / 620);
		assert.equal(restored.page, anchor.page);
		assert.ok(Math.abs(restored.offset - anchor.offset) < 1e-10);
	}
});

test('out of range positions clamp safely without invalid page indexes', () => {
	const rows = pageLayout(
		[
			{ width: 100, height: 100 },
			{ width: 100, height: 200 },
		],
		400,
	);
	assert.deepEqual(viewAtOffset(rows, -50, 1), { page: 1, offset: 0, zoom: 1 });
	assert.deepEqual(viewAtOffset(rows, 90000, 1), { page: 2, offset: 1, zoom: 1 });
	assert.equal(offsetForView(rows, { page: 999, offset: 0, zoom: 1 }), rows[1].start);
});

test('device-pixel rounding at a page boundary does not select the prior page', () => {
	const rows = pageLayout(
		Array.from({ length: 120 }, () => ({ width: 595, height: 842 })),
		780,
	);
	const target = rows[79].start;
	const restored = viewAtOffset(rows, Math.floor(target), 1);
	assert.equal(restored.page, 80);
	assert.equal(restored.offset, 0);
});

test('fit page respects viewport width, height and portrait/landscape aspect ratios', () => {
	assert.equal(fitPageWidth(800, 600, { width: 612, height: 792 }), 426);
	assert.equal(fitPageWidth(800, 1000, { width: 612, height: 792 }), 735);
	assert.equal(fitPageWidth(800, 600, { width: 792, height: 612 }), 714);
	assert.equal(fitPageWidth(300, 600, { width: 612, height: 792 }), 252);
	assert.equal(fitPageWidth(20, 20, { width: 612, height: 792 }), 1);
});
