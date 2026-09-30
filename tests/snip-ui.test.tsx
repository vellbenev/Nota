import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PDFPageProxy } from 'pdfjs-dist';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import SnipOverlay from '../src/features/reader/SnipOverlay';
import { encodeSnip, MAX_SNIP_BYTES, renderSnip } from '../src/infrastructure/pdf/snip';
const drawImage = vi.fn();
const context = { fillStyle: '', fillRect: vi.fn(), drawImage };
const proxy = () => ({
	getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
	render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
});
beforeEach(() => {
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
	vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
	vi.stubGlobal(
		'PointerEvent',
		class extends MouseEvent {
			pointerId = 1;
		},
	);
	HTMLElement.prototype.setPointerCapture = vi.fn();
	HTMLElement.prototype.hasPointerCapture = () => true;
	HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	drawImage.mockClear();
});
test('low-resolution crop renders translated PDF into a bounded canvas; high-resolution canvas is cropped directly', async () => {
	const page = proxy(),
		signal = new AbortController().signal;
	const result = await renderSnip(page as unknown as PDFPageProxy, [0.25, 0.25, 0.5, 0.5], 300, null, signal);
	expect(result.width).toBe(600);
	expect(result.height).toBe(800);
	const args = page.render.mock.calls[0] as unknown as [{ transform: number[]; canvas: HTMLCanvasElement }];
	expect(args[0].transform).toEqual([1, 0, 0, 1, -300, -400]);
	expect(args[0].canvas.width).toBe(0);
	const source = document.createElement('canvas');
	source.width = 1200;
	source.height = 1600;
	await renderSnip(page as unknown as PDFPageProxy, [0.25, 0.25, 0.5, 0.5], 300, source, signal);
	expect(page.render).toHaveBeenCalledTimes(1);
	expect(drawImage).toHaveBeenCalledWith(source, 300, 400, 600, 800, 0, 0, 600, 800);
});
test('encoding reduces dimensions when compression alone cannot meet byte cap', () => {
	vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function () {
		return this.width > 600
			? `data:image/png;base64,${'A'.repeat((MAX_SNIP_BYTES * 4) / 3 + 4)}`
			: 'data:image/png;base64,AAAA';
	});
	const canvas = document.createElement('canvas');
	canvas.width = 1024;
	canvas.height = 800;
	const result = encodeSnip(canvas, [0, 0, 1, 1], new AbortController().signal);
	expect(result.width).toBeLessThanOrEqual(600);
	expect(result.bytes).toBeLessThanOrEqual(MAX_SNIP_BYTES);
});
test('crop render cancellation cancels PDF.js work and releases its bitmap', async () => {
	const abort = new AbortController();
	let reject: (e: Error) => void = () => {};
	let canvas: HTMLCanvasElement | undefined;
	const cancel = vi.fn(() => reject(new Error('cancelled')));
	const page = {
		...proxy(),
		render: vi.fn((args: { canvas: HTMLCanvasElement }) => {
			canvas = args.canvas;
			return {
				promise: new Promise((_, r) => {
					reject = r;
				}),
				cancel,
			};
		}),
	};
	const pending = renderSnip(page as unknown as PDFPageProxy, [0, 0, 0.5, 0.5], 300, null, abort.signal);
	abort.abort();
	await expect(pending).rejects.toThrow('cancelled');
	expect(cancel).toHaveBeenCalled();
	expect(canvas?.width).toBe(0);
});
test('drawing and optional question stay local; only Explain snip produces an image callback', async () => {
	const onExplain = vi.fn(),
		getPage = vi.fn(async () => proxy() as unknown as PDFPageProxy),
		fetchSpy = vi.fn();
	vi.stubGlobal('fetch', fetchSpy);
	function Harness() {
		const [active, setActive] = useState<number | null>(null);
		return (
			<SnipOverlay
				page={1}
				width={600}
				activePage={active}
				onActivate={() => setActive(1)}
				onCancel={vi.fn()}
				getPage={getPage}
				onExplain={onExplain}
			/>
		);
	}
	render(<Harness />);
	const region = screen.getByLabelText('Snip area on page 1');
	vi.spyOn(region, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 600, height: 800 } as DOMRect);
	fireEvent.pointerDown(region, { clientX: 60, clientY: 80, button: 0 });
	fireEvent.pointerMove(region, { clientX: 360, clientY: 480 });
	fireEvent.pointerUp(region, { clientX: 360, clientY: 480 });
	fireEvent.change(screen.getByLabelText('Snip question (optional)'), { target: { value: 'Explain this chart' } });
	expect(getPage).not.toHaveBeenCalled();
	expect(fetchSpy).not.toHaveBeenCalled();
	expect(onExplain).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole('button', { name: 'Explain snip' }));
	await waitFor(() => expect(onExplain).toHaveBeenCalledTimes(1));
	expect(onExplain.mock.calls[0][0]).toBe(1);
	expect(onExplain.mock.calls[0][2]).toBe('Explain this chart');
	expect(fetchSpy).not.toHaveBeenCalled();
});

