import { Button, Dropdown, IconButton, Input, Tooltip } from '../../components/ui';
import styles from './ReaderToolbar.module.css';
interface Props {
	pageDraft: string;
	pageCount: number;
	zoom: number;
	fitMode: 'manual' | 'width' | 'page';
	onFit: (mode: 'width' | 'page') => void;
	snipMode: boolean;
	onPageDraft: (value: string) => void;
	onPageJump: () => void;
	onZoom: (value: number) => void;
	onSnipToggle: () => void;
	notesOpen: boolean;
	highlightCount: number;
	onNotesToggle: () => void;
}
/** Presentation only: navigation and snip callbacks remain in the PDF viewport. */
export default function ReaderToolbar({
	pageDraft,
	pageCount,
	zoom,
	fitMode,
	onFit,
	snipMode,
	onPageDraft,
	onPageJump,
	onZoom,
	onSnipToggle,
	notesOpen,
	highlightCount,
	onNotesToggle,
}: Props) {
	return (
		<div className={`reader-controls ${styles.readerBar}`} aria-label='Reader controls'>
			<form
				className={styles.pageJump}
				noValidate
				onSubmit={event => {
					event.preventDefault();
					onPageJump();
				}}
			>
				<label htmlFor='page-number'>Page</label>
				<Input
					id='page-number'
					aria-label='Page'
					type='number'
					min={1}
					max={pageCount}
					value={pageDraft}
					onChange={event => onPageDraft(event.target.value)}
					onBlur={onPageJump}
				/>
				<span className={styles.pageTotal}>of {pageCount}</span>
				<button type='submit' tabIndex={-1} aria-hidden='true' className='visually-hidden'>
					Go
				</button>
			</form>
			<div className={styles.zoomGroup}>
				<Tooltip content='Zoom out'>
					<IconButton
						size='sm'
						variant='secondary'
						aria-label='Zoom out'
						onClick={() => onZoom(zoom - 0.25)}
						disabled={zoom <= 0.5}
					>
						−
					</IconButton>
				</Tooltip>
				<Dropdown
					id='reader-zoom'
					className={`zoom-dropdown ${styles.zoomMenu}`}
					label='Zoom'
					value={fitMode === 'manual' ? String(zoom) : fitMode}
					onChange={value => (value === 'width' || value === 'page' ? onFit(value) : onZoom(Number(value)))}
					options={[
						{ value: 'width', label: 'Fit width' },
						{ value: 'page', label: 'Fit page' },
						...[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(value => ({
							value: String(value),
							label: `${Math.round(value * 100)}%`,
						})),
					]}
				/>
				<Tooltip content='Zoom in'>
					<IconButton
						size='sm'
						variant='secondary'
						aria-label='Zoom in'
						onClick={() => onZoom(zoom + 0.25)}
						disabled={zoom >= 2}
					>
						+
					</IconButton>
				</Tooltip>
			</div>
			<Tooltip content='Crop part of a PDF page'>
				<Button size='sm' className={styles.snipToggle} aria-pressed={snipMode} onClick={onSnipToggle}>
					Snip
				</Button>
			</Tooltip>
			<Button
				size='sm'
				aria-label='Highlights and notes'
				aria-expanded={notesOpen}
				aria-controls='highlight-notes-panel'
				onClick={onNotesToggle}
			>
				Notes{highlightCount ? ` (${highlightCount})` : ''}
			</Button>
		</div>
	);
}
