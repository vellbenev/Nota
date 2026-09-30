import type { ReactNode } from 'react';
import { IconButton, ScrollArea } from '../../components/ui';
import MascotView from '../mascot/MascotView';
import styles from './AssistantPanel.module.css';
import type { RequestStatus } from './machine';
interface Props {
	status: RequestStatus;
	modelLabel: string;
	cloud: boolean;
	children: ReactNode;
	active?: boolean;
	onClose?: () => void;
}
/** Visual shell only; request state and actions remain owned by App. */
export default function AssistantPanel({ status, modelLabel, cloud, children, active = true, onClose }: Props) {
	return (
		<aside className={`assistant-pane ${styles.pane}`} aria-label='Nota tutor'>
			<header className={`assistant-heading ${styles.heading}`}>
				{active && <MascotView status={status} />}
				<h2 className='visually-hidden'>Ask Nota</h2>
				<span className={`model-location ${styles.modelTag} ${cloud ? styles.cloud : ''}`}>{modelLabel}</span>
				{onClose && (
					<IconButton size='sm' aria-label='Hide assistant' onClick={onClose}>
						×
					</IconButton>
				)}
			</header>
			<ScrollArea className={`assistant-content ${styles.content}`}>
				<div className={styles.stack}>{children}</div>
			</ScrollArea>
		</aside>
	);
}
