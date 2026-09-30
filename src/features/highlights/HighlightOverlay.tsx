import type { Highlight } from '../../domain/highlight';
import { projectRect, type PageGeometry } from '../../infrastructure/pdf/geometry';
export default function HighlightOverlay({
	items,
	geometry,
	activeId,
	onActivate,
}: {
	items: Highlight[];
	geometry: PageGeometry;
	activeId?: string | null;
	onActivate?: (item: Highlight) => void;
}) {
	return (
		<div className='highlight-overlay' role='group' aria-label='Saved highlights'>
			{items.flatMap(item =>
				item.rects.map((rect, index) => {
					const [x, y, w, h] = projectRect(rect, geometry);
					return (
						<span
							aria-hidden='true'
							data-highlight-id={item.id}
							key={`${item.id}-${index}`}
							className={`highlight-mark ${item.color}${activeId === item.id ? ' active-highlight' : ''}`}
							style={{
								left: `${x * 100}%`,
								top: `${y * 100}%`,
								width: `${w * 100}%`,
								height: `${h * 100}%`,
							}}
						/>
					);
				}),
			)}
			{onActivate &&
				items.map(item => {
					const [x, y, w, h] = projectRect(item.rects[0], geometry);
					return (
						<button
							key={item.id}
							type='button'
							className='highlight-keyboard-target'
							aria-label={`Open saved highlight on page ${item.page}: ${item.anchor.quote.slice(0, 80)}`}
							onClick={event => {
								event.stopPropagation();
								onActivate(item);
							}}
							style={{
								left: `${x * 100}%`,
								top: `${y * 100}%`,
								width: `${w * 100}%`,
								height: `${h * 100}%`,
							}}
						/>
					);
				})}
		</div>
	);
}
