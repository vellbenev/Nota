import type { RequestStatus } from '../assistant/machine.ts';
export type MascotMood = 'idle' | 'pondering' | 'explaining' | 'error';
export function mascotMood(status: RequestStatus): MascotMood {
	return status === 'queued' || status === 'ttft'
		? 'pondering'
		: status === 'streaming'
			? 'explaining'
			: status === 'error'
				? 'error'
				: 'idle';
}
export const MASCOT_LABELS: Record<MascotMood, string> = {
	idle: 'Ready to help',
	pondering: 'Pondering',
	explaining: 'Explaining',
	error: 'Needs attention',
};

