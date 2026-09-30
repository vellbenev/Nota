import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import MascotView from '../src/features/mascot/MascotView';
import RiveMascot from '../src/features/mascot/RiveMascot';

const runtime = vi.hoisted(() => ({
	property: { value: 0 },
	disconnected: { value: 0 },
	rive: {
		activeArtboard: 'new_JSON',
		stateMachineNames: ['State Machine 1'],
		viewModelInstance: { number: vi.fn() },
		stateMachineInputs: vi.fn(),
	},
	options: {} as Record<string, unknown>,
}));
vi.mock('@rive-app/react-canvas', () => ({
	Alignment: { Center: 'center' },
	Fit: { Contain: 'contain' },
	Layout: class {
		constructor(options: object) {
			Object.assign(this, options);
		}
	},
	RuntimeLoader: { setWasmUrl: vi.fn(), setWasmFallbackUrl: vi.fn() },
	useRive: (options: Record<string, unknown>) => {
		runtime.options = options;
		return { rive: runtime.rive, RiveComponent: () => <canvas /> };
	},
}));
beforeEach(() => {
	vi.clearAllMocks();
	runtime.property.value = 0;
	// Model the runtime regression: late-started machines don't share this property.
	runtime.rive.viewModelInstance.number.mockImplementation(name =>
		name === 'numberProperty'
			? runtime.options.stateMachine === 'State Machine 1'
				? runtime.property
				: runtime.disconnected
			: null,
	);
	runtime.rive.stateMachineInputs.mockReturnValue([]);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

test('binds the explicit state machine before synchronizing assistant status changes', async () => {
	const ui = render(<MascotView status='idle' />);
	await waitFor(() => expect(runtime.property.value).toBe(1));
	for (const [status, value] of [
		['ttft', 4],
		['streaming', 2],
		['complete', 1],
		['error', 7],
		['idle', 1],
	] as const) {
		ui.rerender(<MascotView status={status} />);
		await waitFor(() => expect(runtime.property.value).toBe(value));
	}
	expect(runtime.options).toMatchObject({
		artboard: 'new_JSON',
		stateMachine: 'State Machine 1',
		autoplay: true,
		autoBind: true,
	});
	expect(runtime.options.layout).toMatchObject({ fit: 'contain', alignment: 'center' });
	expect(runtime.rive.viewModelInstance.number).toHaveBeenCalledTimes(1);
	expect(runtime.rive.viewModelInstance.number).toHaveBeenCalledWith('numberProperty');
});

test('falls back without marking the mascot ready when the bound property is missing', () => {
	runtime.rive.viewModelInstance.number.mockReturnValue(null);
	const onFailure = vi.fn(), onReady = vi.fn();
	render(<RiveMascot src='/mascot/nota.riv' mood='idle' onReady={onReady} onFailure={onFailure} />);
	expect(onFailure).toHaveBeenCalledOnce();
	expect(onReady).not.toHaveBeenCalled();
});

test('returns to fallback on load errors and runtime exceptions', () => {
	runtime.rive.viewModelInstance.number.mockImplementation(() => {
		throw new Error('Runtime unavailable');
	});
	const onFailure = vi.fn();
	render(<RiveMascot src='/mascot/nota.riv' mood='idle' onReady={vi.fn()} onFailure={onFailure} />);
	expect(onFailure).toHaveBeenCalledTimes(1);
	(runtime.options.onLoadError as () => void)();
	expect(onFailure).toHaveBeenCalledTimes(2);
	window.dispatchEvent(new ErrorEvent('error', { filename: '/assets/rive.js' }));
	expect(onFailure).toHaveBeenCalledTimes(3);
});

test('unmounts the runtime when reduced motion is enabled and resumes the current pose when disabled', async () => {
	let change = () => {};
	const query = {
		matches: false,
		addEventListener: vi.fn((_event, listener) => {
			change = listener;
		}),
		removeEventListener: vi.fn(),
	};
	vi.stubGlobal('matchMedia', () => query);
	const ui = render(<MascotView status='idle' />);
	await waitFor(() => expect(ui.container.querySelector('canvas')).not.toBeNull());
	const { act } = await import('@testing-library/react');
	act(() => {
		query.matches = true;
		change();
	});
	expect(ui.container.querySelector('canvas')).toBeNull();
	expect(ui.container.querySelector('svg')).not.toBeNull();
	ui.rerender(<MascotView status='streaming' />);
	act(() => {
		query.matches = false;
		change();
	});
	await waitFor(() => expect(runtime.property.value).toBe(2));
});

