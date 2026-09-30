import wasmUrl from '@rive-app/canvas/rive.wasm?url';
import { Alignment, Fit, Layout, RuntimeLoader, useRive, type ViewModelInstanceNumber } from '@rive-app/react-canvas';
import { useEffect, useRef } from 'react';
import type { MascotMood } from './projection';
RuntimeLoader.setWasmUrl(wasmUrl);
RuntimeLoader.setWasmFallbackUrl(null); // Never fall back to a CDN.
const stateValues: Record<MascotMood, number> = { idle: 1, pondering: 4, explaining: 2, error: 7 };
const artboard = 'new_JSON',
	stateMachine = 'State Machine 1';
export default function RiveMascot({
	src,
	mood,
	onReady,
	onFailure,
}: {
	src: string;
	mood: MascotMood;
	onReady: () => void;
	onFailure: () => void;
}) {
	const callbacks = useRef({ onReady, onFailure });
	callbacks.current = { onReady, onFailure };
	const pose = useRef<ViewModelInstanceNumber | null>(null);
	// Instantiate the machine BEFORE autoBind: starting it later leaves its data
	// context disconnected from rive.viewModelInstance, despite successful writes.
	const { rive, RiveComponent } = useRive({
		src,
		artboard,
		stateMachine,
		autoplay: true,
		autoBind: true,
		enableRiveAssetCDN: false,
		layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
		assetLoader: (_asset, bytes) => bytes.length === 0, // Decode embedded assets; suppress external loading.
		onLoadError: () => callbacks.current.onFailure(),
	});
	useEffect(() => {
		// Animation-frame/WASM errors occur outside React's error boundary.
		const failOnRuntimeError = (event: ErrorEvent) => {
			if (/rive|wasm-function/i.test(`${event.filename} ${event.error?.stack ?? ''}`))
				callbacks.current.onFailure();
		};
		window.addEventListener('error', failOnRuntimeError);
		return () => window.removeEventListener('error', failOnRuntimeError);
	}, []);
	useEffect(() => {
		if (!rive) return;
		try {
			// Verified against nota.riv: no legacy inputs; ViewModel1 owns the pose.
			const input = rive.viewModelInstance?.number('numberProperty');
			if (
				rive.activeArtboard !== artboard ||
				!rive.stateMachineNames.includes(stateMachine) ||
				!input ||
				typeof input.value !== 'number'
			) {
				callbacks.current.onFailure();
				return;
			}
			pose.current = input;
		} catch {
			callbacks.current.onFailure();
		}
		return () => {
			pose.current = null;
		};
	}, [rive]);
	useEffect(() => {
		if (!rive || !pose.current) return;
		try {
			pose.current.value = stateValues[mood];
			callbacks.current.onReady();
		} catch {
			callbacks.current.onFailure();
		}
	}, [rive, mood]);
	return <RiveComponent className='rive-mascot' />;
}

