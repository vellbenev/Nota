import { useCallback, useEffect, useRef, useState } from 'react';
import shell from './AppShell.module.css';
import { Button, Dropdown, Input, SegmentedControl, Textarea, Tooltip } from './components/ui';
import AssistantPanel from './features/assistant/AssistantPanel';
import panel from './features/assistant/AssistantPanel.module.css';
import { followUpInput } from './features/assistant/conversation';
import { isBusy, type AssistantResponse } from './features/assistant/machine';
import TutorResponse from './features/assistant/TutorResponse';
import { useTutor } from './features/assistant/useTutor';
import { routeLanguage } from './features/reader/language';
import ReaderWorkspace from './features/reader/ReaderWorkspace';
import type { TextSelection } from './features/reader/selection';
import { modelModeLabel } from './features/settings/modelMode';
import { useWorkspaceLayout } from './features/workspace/useWorkspaceLayout';
import type { SelectedSnip } from './infrastructure/pdf/snip';
import { probeOllama, type Probe } from './ollama';
import type { TutorAction } from './prompts/context';

const DEFAULT_MODEL = 'gemma4:31b-cloud';
const DEFAULT_URL = 'http://localhost:11434';

function labelForProbe(probe: Probe | null) {
	if (!probe) return 'Check the connection when you are ready to use Nota.';
	return probe.message;
}

export default function App() {
	const [selection, setSelection] = useState<TextSelection | null>(null);
	const [draft, setDraft] = useState('');
	const [intent, setIntent] = useState<'translate' | 'clarify' | 'mixed' | 'explain' | 'ask'>('translate');
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
		if (intent === 'ask') composerRef.current?.focus({ preventScroll: true });
	}, [intent, selection]);
	const inputRef = useRef<HTMLInputElement>(null);
	const probeSequence = useRef(0);
	const layout = useWorkspaceLayout();

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
		if (!passage?.docId || action === 'mixed' || busy || (action === 'ask' && !question.trim())) return;
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
					question:
						action === 'explain'
							? 'Explain this passage in context.'
							: action === 'ask'
								? question
								: undefined,
					history: [],
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
		layout.showAssistant();
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
					history: [],
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

	async function followUp(response: AssistantResponse, question: string) {
		if (busy) return;
		setSelection(null);
		setRequestError('');
		try {
			await run(followUpInput(response, question), { baseUrl, modelId: model });
		} catch (error) {
			setRequestError(error instanceof Error ? error.message : String(error));
		}
	}

	function assistantAction(passage: TextSelection, action: 'translate' | 'explain' | 'ask') {
		layout.showAssistant();
		setSelection(passage);
		setRequestError('');
		if (action === 'ask') {
			setIntent('ask');
			setDraft('');
			// Ask only opens a composer. Submission is always explicit.
		} else if (action === 'explain') {
			setIntent('explain');
			setDraft('');
			void sendSelection(passage, 'explain');
		} else {
			const route = routeLanguage(passage.text);
			const resolved = route === 'mixed' ? 'clarify' : route;
			setIntent(resolved);
			setDraft('');
			void sendSelection(passage, resolved);
		}
	}

	return (
		<div ref={layout.root} className={`app-shell ${shell.shell}`}>
			<main
				className={`workspace ${shell.split} ${!layout.assistantOpen ? shell.focused : ''} ${layout.resizing ? shell.resizing : ''}`}
				style={{
					['--pdf-share' as string]: `${layout.share}fr`,
					['--assistant-share' as string]: `${100 - layout.share}fr`,
				}}
			>
				<ReaderWorkspace
					workspaceControls={
						<>
							<Tooltip content='Toggle reading focus · Alt + \\'>
								<Button
									size='sm'
									variant='ghost'
									onClick={layout.toggleAssistant}
									aria-pressed={!layout.assistantOpen}
									aria-controls='nota-assistant'
									aria-expanded={layout.assistantOpen}
									aria-label={layout.assistantOpen ? 'Enter focus mode' : 'Show assistant'}
								>
									{layout.assistantOpen ? 'Focus' : '✦ Show Nota'}
								</Button>
							</Tooltip>
							<Button
								size='sm'
								variant='ghost'
								onClick={() => void layout.toggleFullscreen()}
								aria-pressed={layout.fullscreen}
								aria-label={layout.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
							>
								{layout.fullscreen ? 'Exit full screen' : 'Full screen'}
							</Button>
							{layout.error && <span role='alert'>{layout.error}</span>}
						</>
					}
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
					className={`${shell.divider} ${layout.resizing ? shell.active : ''}`}
					role='separator'
					aria-hidden={!layout.assistantOpen}
					aria-orientation={layout.mobile ? 'horizontal' : 'vertical'}
					aria-label='Resize reading and assistant panes'
					aria-valuenow={Math.round(layout.share)}
					aria-valuemin={30}
					aria-valuemax={85}
					tabIndex={layout.assistantOpen ? 0 : -1}
					onKeyDown={layout.dividerKey}
					onPointerDown={layout.startDrag}
					onPointerMove={layout.moveDrag}
					onPointerUp={layout.stopDrag}
					onPointerCancel={layout.stopDrag}
					onLostPointerCapture={layout.stopDrag}
				/>
				<div
					id='nota-assistant'
					className={shell.assistantSlot}
					inert={!layout.assistantOpen}
					aria-hidden={!layout.assistantOpen}
				>
					<AssistantPanel
						status={state.status}
						active={layout.assistantOpen}
						onClose={layout.hideAssistant}
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
								<Input
									id='ollama-url'
									type='url'
									dir='ltr'
									autoComplete='off'
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
									className={panel.actionPicker}
									value={intent}
									onChange={setIntent}
									options={[
										{ value: 'translate', label: 'Translate' },
										{ value: 'clarify', label: 'Clarify' },
										{ value: 'mixed', label: 'Mixed', disabled: true },
										{ value: 'explain', label: 'Explain' },
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
									<Textarea
										className={panel.textarea}
										maxLength={2000}
										ref={composerRef}
										aria-label='Ask Nota draft'
										placeholder='What would you like to understand about this passage?'
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
									{intent === 'ask'
										? 'Send question'
										: intent === 'explain'
											? 'Explain'
											: 'Translate / Clarify'}{' '}
									<span>↗</span>
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
						{[...state.previous, ...(state.status !== 'idle' ? [state] : [])].map(response => (
							<TutorResponse
								key={response.requestId}
								response={response}
								current={response.requestId === state.requestId}
								busy={busy}
								onFollowUp={question => followUp(response, question)}
								onCancel={cancel}
								onRegenerate={() => void regenerate()}
							/>
						))}
						{requestError && (
							<p className={panel.errorText} role='alert'>
								{requestError}
							</p>
						)}
					</AssistantPanel>
				</div>
			</main>
		</div>
	);
}
