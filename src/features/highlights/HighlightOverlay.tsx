import type { Highlight } from '../../domain/highlight';
import { projectRect, type PageGeometry } from '../../infrastructure/pdf/geometry';
export default function HighlightOverlay({ items, geometry }: { items: Highlight[]; geometry: PageGeometry }) {
	return (
		<div className='highlight-overlay' aria-hidden='true'>
			{items.flatMap(item =>
				item.rects.map((rect, index) => {
					const [x, y, w, h] = projectRect(rect, geometry);
					return (
						<span
							key={`${item.id}-${index}`}
							className={`highlight-mark ${item.color}`}
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
		</div>
	);
}
