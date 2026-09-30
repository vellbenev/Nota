import { Button, Dropdown, IconButton, Tooltip } from '../../components/ui';
import styles from './ReaderToolbar.module.css';
interface Props {
	pageDraft: string;
	pageCount: number;
	zoom: number;
	snipMode: boolean;
	onPageDraft: (value: string) => void;
	onPageJump: () => void;
	onZoom: (value: number) => void;
	onSnipToggle: () => void;
}
/** Presentation only: navigation and snip callbacks remain in the PDF viewport. */
export default function ReaderToolbar({
	pageDraft,
	pageCount,
	zoom,
	snipMode,
	onPageDraft,
	onPageJump,
	onZoom,
	onSnipToggle,
}: Props) {
	return (
		<div className={`reader-controls ${styles.readerBar}`} aria-label='Reader controls'>
			<form
				className={styles.pageJump}
				onSubmit={event => {
					event.preventDefault();
					onPageJump();
				}}
			>
				<label htmlFor='page-number'>Page</label>
				<input
					id='page-number'
					type='number'
					min={1}
					max={pageCount}
					value={pageDraft}
					onChange={event => onPageDraft(event.target.value)}
					onBlur={onPageJump}
				/>
				<span className={styles.pageTotal}>of {pageCount}</span>
				<button type='submit' className='visually-hidden'>
					Go
				</button>
			</form>
			<div className={styles.zoomGroup}>
				<Tooltip content='Zoom out'>
					<IconButton
						size='sm'
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
					value={String(zoom)}
					onChange={value => onZoom(Number(value))}
					options={[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(value => ({
						value: String(value),
						label: `${Math.round(value * 100)}%`,
					}))}
				/>
				<Tooltip content='Zoom in'>
					<IconButton size='sm' aria-label='Zoom in' onClick={() => onZoom(zoom + 0.25)} disabled={zoom >= 2}>
						+
					</IconButton>
				</Tooltip>
			</div>
			<Tooltip content='Crop part of a PDF page'>
				<Button size='sm' className={styles.snipToggle} aria-pressed={snipMode} onClick={onSnipToggle}>
					Snip
				</Button>
			</Tooltip>
		</div>
	);
}

