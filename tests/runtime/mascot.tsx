// Open /tests/runtime/mascot.html with Vite running. Uses the real Rive asset,
// assistant execution/reducer and display buffer with a deterministic local stream.
import { useEffect, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TutorExecution } from '../../src/features/assistant/execution';
import { assistantReducer, initialAssistant } from '../../src/features/assistant/machine';
import MascotView from '../../src/features/mascot/MascotView';
import '../../src/styles.css';
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function Harness() {
	const [state, dispatch] = useReducer(assistantReducer, initialAssistant);
	const [frames, setFrames] = useState<{ status: string; image: string }[]>([]);
	const host = useRef<HTMLDivElement>(null);
	const fail = useRef(false);
	const execution = useRef<TutorExecution | null>(null);
	if (!execution.current)
		execution.current = new TutorExecution(
			dispatch,
			undefined,
			async (_url, _model, _text, _page, _signal, onToken) => {
				await delay(1800);
				if (fail.current) throw new Error('Fixture error');
				onToken('Fixture response');
				await delay(1800);
			},
		);
	useEffect(() => {
		const timer = setTimeout(() => {
			const canvas = host.current?.querySelector('canvas');
			if (canvas) setFrames(previous => [...previous, { status: state.status, image: canvas.toDataURL() }]);
		}, 1000);
		return () => clearTimeout(timer);
	}, [state.status]);
	const run = (action: 'ask' | 'translate_en_fa', error = false) => {
		fail.current = error;
		void execution.current!.run(
			{
				docId: 'session:mascot-regression',
				action,
				page: 1,
				text: 'A local test passage.',
				question: action === 'ask' ? 'Explain this passage' : undefined,
			},
			{ baseUrl: 'http://fixture.invalid', modelId: 'fixture' },
			true,
		);
	};
	return (
		<main style={{ padding: 24, maxWidth: 760 }}>
			<h1>Nota mascot runtime regression</h1>
			<p>Real assistant execution and Rive WASM; deterministic local response stream.</p>
			<div ref={host}>
				<MascotView status={state.status} />
			</div>
			<p>
				Assistant status: <strong>{state.status}</strong>
			</p>
			<button onClick={() => run('ask')}>Ask question</button>{' '}
			<button onClick={() => run('translate_en_fa')}>Translate passage</button>{' '}
			<button onClick={() => run('ask', true)}>Simulate error</button>
			<p>{state.text || state.error}</p>
			<div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
				{frames.map((frame, i) => (
					<figure key={i} style={{ margin: 0 }}>
						<img width='96' height='96' src={frame.image} />
						<figcaption>{frame.status}</figcaption>
					</figure>
				))}
			</div>
		</main>
	);
}
createRoot(document.getElementById('root')!).render(<Harness />);

