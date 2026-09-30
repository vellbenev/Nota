import { lazy, Suspense, useRef, useState } from 'react';
import { Button, Textarea } from '../../components/ui';
import panel from './AssistantPanel.module.css';
import { isBusy, type AssistantResponse } from './machine';
const statusLabels = {
	idle: 'Ready',
	queued: 'Queued',
	ttft: 'Waiting for first token…',
	streaming: 'Writing…',
	complete: 'Complete',
	error: 'Needs attention',
	cancelled: 'Stopped',
};
const ResponseMarkdown = lazy(() => import('./ResponseMarkdown'));

export default function TutorResponse({
	response,
	current,
	busy,
	onFollowUp,
	onCancel,
	onRegenerate,
}: {
	response: AssistantResponse;
	current: boolean;
	busy: boolean;
	onFollowUp: (question: string) => Promise<void>;
	onCancel: () => void;
	onRegenerate: () => void;
}) {
	const [draft, setDraft] = useState('');
	const composer = useRef<HTMLTextAreaElement>(null);
	const { input } = response;
	const responding = current && isBusy(response.status);
	const canContinue = !!input && !!response.text.trim() && !isBusy(response.status);
	return (
		<article className={panel.turn} aria-label={`Conversation turn · page ${input?.page ?? ''}`}>
			{input && (
				<section className={`${panel.card} ${panel.userCard}`} aria-label='Your request'>
					<div className={panel.cardTitle}>
						<span>You</span>
						<span>p. {input.page}</span>
					</div>
					{input.text && (
						<blockquote className={panel.quote} dir='auto'>
							<bdi>{input.text}</bdi>
						</blockquote>
					)}
					{input.image && (
						<img
							className={panel.snipPreview}
							src={`data:${input.image.mime};base64,${input.image.base64}`}
							alt={`Selected figure from page ${input.page}`}
						/>
					)}
					{input.question && (
						<p className={panel.question} dir='auto'>
							{input.question}
						</p>
					)}
				</section>
			)}
			<section
				className={`answer-card ${panel.card} ${panel.answerCard}`}
				aria-label={current ? 'Tutor response' : 'Previous tutor response'}
			>
				<div className={panel.cardTitle}>
					<span>Nota’s response{input ? ` · p. ${input.page}` : ''}</span>
					<span role='status'>
						{statusLabels[response.status]}
						{response.cached ? ' · cached' : ''}
					</span>
				</div>
				{response.text && (
					<Suspense fallback={<p dir='auto'>{response.text}</p>}>
						<ResponseMarkdown text={response.text} language={response.prompt?.envelope.output_language} />
					</Suspense>
				)}
				{responding && (
					<Button variant='ghost' size='sm' onClick={onCancel}>
						Stop response
					</Button>
				)}
				{current && !responding && input && (
					<Button variant='ghost' size='sm' disabled={busy} onClick={onRegenerate}>
						Regenerate
					</Button>
				)}
				{response.error && (
					<p className={panel.errorText} role='alert'>
						{response.error}
					</p>
				)}
				{response.warning && (
					<p className={panel.meta} role='status'>
						{response.warning}
					</p>
				)}
				{canContinue && (
					<form
						className={panel.followUp}
						onSubmit={event => {
							event.preventDefault();
							if (!busy && draft.trim()) void onFollowUp(draft);
						}}
					>
						<label className={panel.fieldLabel} htmlFor={`follow-up-${response.requestId}`}>
							Continue this conversation
						</label>
						<div className={panel.suggestions}>
							{['Explain this step further', 'Why is this assumption needed?'].map(question => (
								<Button
									key={question}
									size='sm'
									variant='ghost'
									disabled={busy}
									onClick={() => {
										setDraft(question);
										composer.current?.focus({ preventScroll: true });
									}}
								>
									{question}
								</Button>
							))}
						</div>
						<Textarea
							ref={composer}
							id={`follow-up-${response.requestId}`}
							className={panel.textarea}
							dir='auto'
							aria-label={`Follow-up question for page ${input!.page}`}
							maxLength={2000}
							value={draft}
							onChange={event => setDraft(event.target.value)}
							disabled={busy}
							placeholder='Ask more about this passage or figure…'
						/>
						<Button size='sm' type='submit' disabled={busy || !draft.trim()}>
							Send follow-up
						</Button>
					</form>
				)}
				{response.prompt && (
					<details className={panel.contextBox}>
						<summary>Request context{response.cached ? ' (replayed locally)' : ''}</summary>
						<p>{response.prompt.promptVersion}</p>
						<pre dir='auto'>{JSON.stringify(response.prompt.envelope, null, 2)}</pre>
					</details>
				)}
			</section>
		</article>
	);
}
