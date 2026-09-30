import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import type { RequestStatus } from '../assistant/machine';
import styles from './MascotView.module.css';
import { MASCOT_LABELS, mascotMood } from './projection';
const RiveMascot = lazy(() => import('./RiveMascot'));
class RiveBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	componentDidCatch() {
		this.props.onFailure();
	}
	render() {
		return this.state.failed ? null : this.props.children;
	}
}
function MascotContent({ status, asset = '/mascot/nota.riv' }: { status: RequestStatus; asset?: string | null }) {
	const mood = mascotMood(status),
		[reduced, setReduced] = useState(
			() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
		);
	const [attempt, setAttempt] = useState(0);
	const [failed, setFailed] = useState(false),
		[ready, setReady] = useState(false);
	useEffect(() => {
		const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
		if (!query) return;
		const change = () => {
			setReduced(query.matches);
			setReady(false);
		};
		query.addEventListener('change', change);
		return () => query.removeEventListener('change', change);
	}, []);
	const retry = () => {
		setReady(false);
		setFailed(false);
		setAttempt(value => value + 1);
	};
	return (
		<div
			className={`mascot-view mood-${mood} ${styles.view} ${mood === 'error' ? styles.error : ''}${reduced ? ' reduced-motion' : ''}`}
		>
			<div className={`mascot-art ${styles.art}`}>
				{(!ready || failed || reduced || !asset) && (
					<span className={styles.placeholder} aria-hidden='true'>
						{!failed && !reduced && asset ? (
							<span className={styles.loader} />
						) : (
							<span className={styles.dot} />
						)}
					</span>
				)}
				{asset && !reduced && !failed && (
					<RiveBoundary
						key={attempt}
						onFailure={() => {
							setFailed(true);
							setReady(false);
						}}
					>
						<Suspense fallback={null}>
							<RiveMascot
								src={asset}
								mood={mood}
								onReady={() => setReady(true)}
								onFailure={() => {
									setFailed(true);
									setReady(false);
								}}
							/>
						</Suspense>
					</RiveBoundary>
				)}
				{failed && asset && !reduced && (
					<button type='button' className={styles.retry} onClick={retry} aria-label='Retry mascot animation'>
						↻
					</button>
				)}
			</div>
			<span className={styles.meta}>
				<span className={`mascot-badge ${styles.state}`} role='status' aria-live='polite'>
					{MASCOT_LABELS[mood]}
				</span>
				<span className={styles.sub}>
					{reduced
						? 'Animation paused'
						: failed || !asset
							? 'Animation unavailable'
							: !ready
								? 'Loading companion…'
								: mood === 'idle'
									? 'Companion ready'
									: mood === 'pondering'
										? 'Reading your paper…'
										: mood === 'explaining'
											? 'Writing an answer…'
											: 'Check the model settings'}
				</span>
			</span>
		</div>
	);
}

export default function MascotView({
	status,
	asset = '/mascot/nota.riv',
}: {
	status: RequestStatus;
	asset?: string | null;
}) {
	return <MascotContent key={asset} status={status} asset={asset} />;
}
