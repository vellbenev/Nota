// Development-only visual regression fixture. No inference or library writes.
import '@fontsource-variable/vazirmatn/wght.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Dropdown, SegmentedControl } from '../../src/components/ui';
import '../../src/components/ui/tokens.css';
import AssistantPanel from '../../src/features/assistant/AssistantPanel';
import panel from '../../src/features/assistant/AssistantPanel.module.css';
import { initialAssistant, type RequestStatus } from '../../src/features/assistant/machine';
import TutorResponse from '../../src/features/assistant/TutorResponse';
import ThemeControl from '../../src/features/workspace/ThemeControl';
import { buildPrompt, type TutorInput } from '../../src/prompts/context';
import '../../src/styles.css';
import styles from './ui.module.css';
const text = `## Understanding the assumption

A bounded model gives us a useful approximation. Here is a deliberately long response to check wrapping, scrolling, and keyboard access.

$$\n\\sum_{i=1}^{n} (x_i - \\bar{x})^2 = (n-1)s^2\n$$

| Method | Measurement | Limitations |
| --- | --- | --- |
| Controlled experiment | Variation across several repeated measurements | An assumption that deserves a closer look |

\`\`\`ts
const estimate = observations.map(item => item.measurement).reduce((sum, value) => sum + value, 0) / observations.length;
\`\`\`

> Check the conditions before applying the formula.

یک توضیح فارسی با عبارت **Standard deviation**، عدد ۱۲۳، و فرمول $E=mc^2$ برای بررسی جهت متن و خوانایی.
`;
const input: TutorInput = {
	docId: 'session:ui-audit',
	page: 8,
	text: 'The assumptions underlying an estimate matter. فرض‌های مدل مهم هستند.',
	action: 'ask',
	question: 'Why is this assumption needed?',
};
function Harness() {
	const [status, setStatus] = useState<RequestStatus>('complete');
	const [action, setAction] = useState('explain');
	const [message, setMessage] = useState('');
	const [size, setSize] = useState('wide');
	const response = {
		...initialAssistant,
		input,
		prompt: buildPrompt(input),
		requestId: 'visual-regression',
		status,
		text: ['queued', 'ttft'].includes(status) ? '' : text,
		error: status === 'error' ? 'Ollama is unavailable. Check the local daemon and try again.' : '',
	};
	return (
		<main className={styles.root}>
			<h1>Nota UI regression</h1>
			<p>Production components with deterministic content. No model requests or library changes.</p>
			<div className={styles.controls}>
				<ThemeControl />
				<Dropdown
					label='Response state'
					value={status}
					onChange={value => setStatus(value as RequestStatus)}
					options={['queued', 'ttft', 'streaming', 'complete', 'error', 'cancelled'].map(value => ({
						value,
						label: value,
					}))}
				/>
				<Dropdown
					label='Panel width'
					value={size}
					onChange={setSize}
					options={[
						{ value: 'wide', label: '480px' },
						{ value: 'narrow', label: '240px' },
					]}
				/>
			</div>
			<div className={styles.slot} style={{ width: size === 'wide' ? 480 : 240 }}>
				<AssistantPanel
					status={status}
					modelLabel='Local · Ollama'
					cloud={false}
					onClose={() => setMessage('Close control works')}
				>
					<div>
						<SegmentedControl
							className={panel.actionPicker}
							label='Assistant action'
							value={action}
							onChange={setAction}
							options={['translate', 'clarify', 'mixed', 'explain', 'ask'].map(value => ({
								value,
								label: value[0].toUpperCase() + value.slice(1),
								disabled: value === 'mixed',
							}))}
						/>
					</div>
					<TutorResponse
						response={response}
						current
						busy={['queued', 'ttft', 'streaming'].includes(status)}
						onCancel={() => setStatus('cancelled')}
						onRegenerate={() => setStatus('queued')}
						onFollowUp={async question => {
							setMessage(question);
						}}
					/>
					{message && <p role='status'>{message}</p>}
					<Button onClick={() => setStatus('complete')}>Reset fixture</Button>
				</AssistantPanel>
			</div>
		</main>
	);
}
createRoot(document.getElementById('root')!).render(<Harness />);
