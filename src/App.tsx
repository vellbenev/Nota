import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import shell from './AppShell.module.css';
import { Button, Dropdown, SegmentedControl } from './components/ui';
import AssistantPanel from './features/assistant/AssistantPanel';
import panel from './features/assistant/AssistantPanel.module.css';
import { isBusy } from './features/assistant/machine';
import { useTutor } from './features/assistant/useTutor';
import { routeLanguage } from './features/reader/language';
import ReaderWorkspace from './features/reader/ReaderWorkspace';
import type { TextSelection } from './features/reader/selection';
import { modelModeLabel } from './features/settings/modelMode';
import type { SelectedSnip } from './infrastructure/pdf/snip';
import { probeOllama, type Probe } from './ollama';
import type { TutorAction } from './prompts/context';
const ResponseMarkdown = lazy(() => import('./features/assistant/ResponseMarkdown'));

const DEFAULT_MODEL = 'gemma4:31b-cloud';
const DEFAULT_URL = 'http://localhost:11434';

function labelForProbe(probe: Probe | null) {
	if (!probe) return 'Check the connection when you are ready to use Nota.';
	return probe.message;
}

export default function App() {
	const [selection, setSelection] = useState<TextSelection | null>(null);
	const [draft, setDraft] = useState('');
	const [intent, setIntent] = useState<'translate' | 'clarify' | 'mixed' | 'ask'>('translate');
	const tutor = useTutor();
	const { state, run, reset, cancel, forget } = tutor;
	const busy = isBusy(state.status);
	const [outputLanguage, setOutputLanguage] = useState<'auto' | 'fa' | 'en'>('auto');
	const [requestError, setRequestError] = useState('');
	const [model, setModel] = useState(DEFAULT_MODEL);
	const [baseUrl, setBaseUrl] = useState(DEFAULT_URL);
	const [probe, setProbe] = useState<Probe | null>(null);
	const composerRef = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		if (intent === 'ask') composerRef.current?.focus();
	}, [intent, draft === '']);
	const inputRef = useRef<HTMLInputElement>(null);
	const probeSequence = useRef(0);
	// Presentational split-pane share (PDF %). Drag handle + keyboard adjust only
	// the CSS grid share; document/assistant state and callbacks are untouched.
	const [pdfShare, setPdfShare] = useState(69);
	const splitDrag = useRef<{ startX: number; startShare: number } | null>(null);

	const checkOllama = useCallback(async () => {
		const sequence = ++probeSequence.current;
		setProbe(null);
		const result = await probeOllama(baseUrl, model);
		if (sequence === probeSequence.current) setProbe(result);
	}, [baseUrl, model]);

	useEffect(() => {
		probeSequence.current += 1;
		setProbe(null);
	}, [baseUrl, model]);

	const resetAssistant = useCallback(() => {
		reset();
		setSelection(null);
		setDraft('');
		setRequestError('');
	}, [reset]);

	async function sendSelection(passage = selection, action = intent, regenerate = false, question = draft) {
		if (!passage?.docId || action === 'mixed' || busy) return;
		setSelection(null);
		setRequestError('');
		const actionId: TutorAction =
			action === 'translate' ? 'translate_en_fa' : action === 'clarify' ? 'clarify_fa' : 'ask';
		try {
			await run(
				{
					docId: passage.docId,
					documentName: passage.documentName,
					page: passage.page,
					text: passage.text,
					nearby: passage.nearby,
					action: actionId,
					question: action === 'ask' ? question : undefined,
					outputLanguage: outputLanguage === 'auto' ? undefined : outputLanguage,
				},
				{ baseUrl, modelId: model },
				regenerate,
			);
		} catch (error) {
			setRequestError(error instanceof Error ? error.message : String(error));
		}
	}

	async function explainSnip(value: SelectedSnip) {
		setSelection(null);
		setRequestError('');
		try {
			await run(
				{
					docId: value.docId,
					documentName: value.documentName,
					page: value.page,
					text: '',
					action: 'explain_image',
					image: value.image,
					question: value.question,
				},
				{ baseUrl, modelId: model },
			);
		} catch (error) {
			setRequestError(error instanceof Error ? error.message : String(error));
		}
	}

	async function regenerate() {
		if (!state.input || busy) return;
		setRequestError('');
		try {
			await run(state.input, { baseUrl, modelId: model }, true);
		} catch (error) {
			setRequestError(error instanceof Error ? error.message : String(error));
		}
	}

	function assistantAction(passage: TextSelection, action: 'translate' | 'ask') {
		setSelection(passage);
		setRequestError('');
		if (action === 'ask') {
			setIntent('ask');
			setDraft('');
			void sendSelection(passage, 'ask', false, 'Explain this passage in context.');
		} else {
			const route = routeLanguage(passage.text);
			const resolved = route === 'mixed' ? 'clarify' : route;
			setIntent(resolved);
			setDraft('');
			void sendSelection(passage, resolved);
		}
	}

	function clampShare(next: number) {
		return Math.max(62, Math.min(78, Math.round(next)));
	}
	function startSplitDrag(event: React.PointerEvent<HTMLDivElement>) {
		if (event.button !== 0) return;
		event.preventDefault();
		splitDrag.current = { startX: event.clientX, startShare: pdfShare };
		const divider = event.currentTarget;
		divider.setPointerCapture?.(event.pointerId);
		event.currentTarget.classList.add(shell.active);
		const move = (pointer: PointerEvent) => {
			const drag = splitDrag.current;
			if (!drag) return;
			const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
			const deltaPx = (pointer.clientX - drag.startX) * (rtl ? -1 : 1);
			const deltaPct = (deltaPx / window.innerWidth) * 100;
			setPdfShare(clampShare(drag.startShare + deltaPct));
		};
		const stop = () => {
			splitDrag.current = null;
			divider.classList.remove(shell.active);
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', stop);
			window.removeEventListener('pointercancel', stop);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', stop);
		window.addEventListener('pointercancel', stop);
	}
	function onDividerKey(event: React.KeyboardEvent<HTMLDivElement>) {
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			setPdfShare(share => clampShare(share - 2));
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			setPdfShare(share => clampShare(share + 2));
		} else if (event.key === 'Home') {
			event.preventDefault();
			setPdfShare(69);
		}
	}

	return (
		<div className={`app-shell ${shell.shell}`}>
			<main className={`workspace ${shell.split}`} style={{ ['--pdf-share' as string]: `${pdfShare}%` }}>
				<ReaderWorkspace
					onDataDeleted={docId => {
						forget(docId);
						resetAssistant();
					}}
					onSnip={value => void explainSnip(value)}
					inputRef={inputRef}
					onDocumentChange={resetAssistant}
					onSelection={passage => {
						setSelection(passage);
						if (passage) setIntent(routeLanguage(passage.text));
					}}
					onAssistantAction={assistantAction}
					onSelectionError={setRequestError}
				/>

				<div
					className={shell.divider}
					role='separator'
					aria-orientation='vertical'
					aria-label='Resize reading and assistant panes'
					aria-valuenow={Math.round(pdfShare)}
					aria-valuemin={62}
					aria-valuemax={78}
					tabIndex={0}
					onKeyDown={onDividerKey}
					onPointerDown={startSplitDrag}
				/>
				<AssistantPanel
					status={state.status}
					modelLabel={modelModeLabel(model, baseUrl)}
					cloud={model.endsWith('-cloud')}
				>
					<details className={`connection-card ${panel.card}`} aria-label='Ollama connection'>
						<summary>
							Model settings{' '}
							<span
								className={`status-dot ${panel.statusDot} ${probe?.state === 'ready' ? `ready ${panel.ready}` : ''}`}
							/>
						</summary>
						<div className='connection-fields'>
							<label className={panel.fieldLabel} htmlFor='ollama-url'>
								Ollama URL
							</label>
							<input
								id='ollama-url'
								className={panel.textInput}
								value={baseUrl}
								onChange={event => setBaseUrl(event.target.value)}
								spellCheck={false}
							/>
							<div className={panel.fieldLabel}>Model</div>
							<div className={`model-row ${panel.modelRow}`}>
								<Dropdown
									id='model'
									label='Model'
									value={model}
									onChange={setModel}
									searchable
									allowCustomValue
									options={[...new Set([model, ...(probe?.models || [])])].map(value => ({
										value,
										label: value,
										badge: value.endsWith('-cloud') ? 'Cloud' : 'Local',
									}))}
								/>
								<Button size='sm' onClick={() => void checkOllama()}>
									Check
								</Button>
							</div>
							<p className={`connection-message ${panel.meta}`} role='status'>
								{labelForProbe(probe)}
							</p>
							{probe?.models.length ? (
								<p className={`available-models ${panel.meta}`}>
									Available: <bdi>{probe.models.join(', ')}</bdi>
								</p>
							) : null}
						</div>
					</details>
					{selection ? (
						<section className={`selection-card ${panel.card} ${panel.userCard}`}>
							<div className={`section-title ${panel.cardTitle}`}>
								<span>Selected passage</span>
								<span>p. {selection.page}</span>
							</div>
							<blockquote className={panel.quote} dir='auto'>
								<bdi>{selection.text}</bdi>
							</blockquote>
							<div className={panel.fieldLabel}>Action</div>
							<SegmentedControl
								label='Assistant action'
								value={intent}
								onChange={setIntent}
								options={[
									{ value: 'translate', label: 'Translate' },
									{ value: 'clarify', label: 'Clarify' },
									{ value: 'mixed', label: 'Mixed', disabled: true },
									{ value: 'ask', label: 'Ask' },
								]}
							/>
							{intent === 'ask' && (
								<div className='language-field'>
									<span className={panel.fieldLabel}>Answer language</span>
									<Dropdown
										label='Answer language'
										value={outputLanguage}
										onChange={value => setOutputLanguage(value as typeof outputLanguage)}
										options={[
											{ value: 'auto', label: 'Match question' },
											{ value: 'fa', label: 'Persian' },
											{ value: 'en', label: 'English' },
										]}
									/>
								</div>
							)}
							{intent === 'ask' && (
								<textarea
									className={panel.textarea}
									maxLength={2000}
									ref={composerRef}
									aria-label='Ask Nota draft'
									dir='auto'
									value={draft}
									onChange={e => setDraft(e.target.value)}
								/>
							)}
							<Button
								variant='primary'
								className={`send-button ${panel.sendButton}`}
								loading={busy}
								onClick={() => void sendSelection()}
								disabled={intent === 'mixed' || (intent === 'ask' && !draft.trim())}
							>
								{intent === 'ask' ? 'Send question' : 'Translate / Clarify'} <span>↗</span>
							</Button>
						</section>
					) : state.status === 'idle' && !requestError ? (
						<div className={`selection-hint ${panel.hint}`}>
							<span className={panel.hintIcon} aria-hidden='true'>
								✦
							</span>
							<h3>Your reading companion</h3>
							<p>
								Select text in the PDF to translate or clarify it. Use Snip to explore a figure or
								equation.
							</p>
							<span className={panel.hintFoot}>Grounded in the passage you choose</span>
						</div>
					) : null}
					{state.input && (state.input.text || state.input.question) && (
						<section className={`${panel.card} ${panel.userCard}`} aria-label='Your request'>
							<div className={panel.cardTitle}>
								<span>You</span>
								<span>p. {state.input.page}</span>
							</div>
							{state.input.text && (
								<blockquote className={panel.quote} dir='auto'>
									<bdi>{state.input.text}</bdi>
								</blockquote>
							)}
							{state.input.question && (
								<p className={panel.question} dir='auto'>
									{state.input.question}
								</p>
							)}
						</section>
					)}
					{(state.status !== 'idle' || requestError) && (
						<section
							className={`answer-card ${panel.card} ${panel.answerCard}`}
							aria-label='Tutor response'
						>
							<div className={`section-title ${panel.cardTitle}`}>
								<span>Nota’s response{state.input ? ` · p. ${state.input.page}` : ''}</span>
								<span className='response-state' role='status'>
									{state.status === 'ttft' ? 'Waiting for first token…' : state.status}
									{state.cached ? ' · cached' : ''}
								</span>
							</div>
							{state.text && (
								<Suspense fallback={<p dir='auto'>{state.text}</p>}>
									<ResponseMarkdown
										text={state.text}
										language={state.prompt?.envelope.output_language}
									/>
								</Suspense>
							)}
							{busy && (
								<Button
									variant='ghost'
									size='sm'
									className={`text-button ${panel.textButton}`}
									onClick={cancel}
								>
									Stop response
								</Button>
							)}
							{!busy && state.input && (
								<Button
									variant='ghost'
									size='sm'
									className={`text-button ${panel.textButton}`}
									onClick={() => void regenerate()}
								>
									Regenerate
								</Button>
							)}
							{(requestError || state.error) && (
								<p className={`error-text ${panel.errorText}`} role='alert'>
									{requestError || state.error}
								</p>
							)}
							{state.warning && (
								<p className={panel.meta} role='status'>
									{state.warning}
								</p>
							)}
							{state.prompt && (
								<details className={`sent-context ${panel.contextBox}`}>
									<summary>Request context{state.cached ? ' (replayed locally)' : ''}</summary>
									<p>{state.prompt.promptVersion}</p>
									<pre dir='auto'>{JSON.stringify(state.prompt.envelope, null, 2)}</pre>
								</details>
							)}
						</section>
					)}
				</AssistantPanel>
			</main>
		</div>
	);
}

