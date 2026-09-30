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
export default function MascotView({
	status,
	asset = '/mascot/nota.riv',
}: {
	status: RequestStatus;
	asset?: string | null;
}) {
	const mood = mascotMood(status),
		[reduced, setReduced] = useState(
			() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
		);
	const [failed, setFailed] = useState(false),
		[ready, setReady] = useState(false);
	useEffect(() => {
		const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
		if (!query) return;
		const change = () => setReduced(query.matches);
		query.addEventListener('change', change);
		return () => query.removeEventListener('change', change);
	}, []);
	return (
		<div
			className={`mascot-view mood-${mood} ${styles.view} ${styles[`mood-${mood}`] ?? ''}${reduced ? ` reduced-motion ${styles.reducedMotion}` : ''}`}
		>
			<div className={`mascot-art ${styles.art}`} aria-hidden='true'>
				{(!ready || failed || reduced) && (
					<svg className={`nota-mascot ${styles.mascot}`} viewBox='0 0 96 96' focusable='false'>
						<ellipse className='mascot-shadow' cx='48' cy='85' rx='26' ry='5' fill='#cbd5bf' />
						<g className={`mascot-body ${styles.bodyArt}`}>
							<path
								d='M25 29 Q18 8 38 23 Q48 17 58 23 Q78 8 71 29 Q85 43 75 65 Q66 80 48 80 Q28 80 21 64 Q11 42 25 29'
								fill='#82976c'
								stroke='#4d6744'
								strokeWidth='2'
							/>
							<path
								d='M24 43 Q24 28 39 32 Q48 37 57 32 Q73 28 73 44 Q72 65 48 68 Q24 66 24 43'
								fill='#f7f3e3'
							/>
							<g className='mascot-eyes' fill='#31452d'>
								<ellipse cx='35' cy='45' rx='4' ry='5' />
								<ellipse cx='61' cy='45' rx='4' ry='5' />
							</g>
							<path
								className='mascot-mouth'
								d={
									mood === 'error'
										? 'M41 59 Q48 52 55 59'
										: mood === 'explaining'
											? 'M42 55 Q48 67 54 55 Z'
											: 'M42 55 Q48 61 54 55'
								}
								fill={mood === 'explaining' ? '#566e45' : 'none'}
								stroke='#566e45'
								strokeWidth='2.5'
								strokeLinecap='round'
							/>
							<path
								d='M26 72 L46 67 L48 84 L26 80 Z M70 72 L50 67 L48 84 L70 80 Z'
								fill='#f7f3e3'
								stroke='#4d6744'
								strokeWidth='2'
							/>
						</g>
						<g className={`mascot-spark ${styles.spark}`} fill='#a47b36'>
							<path d='M80 17 l2 6 6 2-6 2-2 6-2-6-6-2 6-2z' />
						</g>
					</svg>
				)}
				{asset && !reduced && !failed && (
					<RiveBoundary
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
			</div>
			<span className={styles.meta}>
				<span className={`mascot-badge ${styles.state}`} role='status' aria-live='polite'>
					{MASCOT_LABELS[mood]}
				</span>
				<span className={styles.sub}>
					{mood === 'idle'
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

