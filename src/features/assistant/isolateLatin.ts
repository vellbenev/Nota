import type { Element, Root, RootContent, Text } from 'hast';

const LATIN_TERM =
	/[A-Za-z][A-Za-z0-9]*(?:[._:/+-][A-Za-z0-9]+)*(?:[ \t]+[A-Za-z][A-Za-z0-9]*(?:[._:/+-][A-Za-z0-9]+)*)*/g;
const BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'table', 'blockquote']);
function plainText(node: Root | RootContent): string {
	if (node.type === 'text') return node.value;
	if (
		node.type === 'element' &&
		(['math', 'svg', 'code', 'pre'].includes(node.tagName) ||
			String(node.properties.className ?? '').includes('katex'))
	)
		return '';
	return 'children' in node ? node.children.map(plainText).join('') : '';
}
const EXCLUDED = new Set(['a', 'bdi', 'code', 'pre', 'math', 'svg']);

function splitLatin(node: Text): RootContent[] {
	const result: RootContent[] = [];
	let previous = 0;
	for (const match of node.value.matchAll(LATIN_TERM)) {
		const start = match.index;
		if (start > previous) result.push({ type: 'text', value: node.value.slice(previous, start) });
		result.push({
			type: 'element',
			tagName: 'bdi',
			properties: { dir: 'ltr' },
			children: [{ type: 'text', value: match[0] }],
		});
		previous = start + match[0].length;
	}
	if (!result.length) return [node];
	if (previous < node.value.length) result.push({ type: 'text', value: node.value.slice(previous) });
	return result;
}

/** Isolate Latin terms without changing code, links, or KaTeX output. */
export default function isolateLatin() {
	return (tree: Root) => {
		function walk(node: Root | Element, inheritedSkip = false) {
			const element = node.type === 'element' ? node : null;
			// Determine each prose block before Latin terms become bidi islands.
			// A Persian paragraph must not reverse the preceding English paragraph.
			if (element && BLOCKS.has(element.tagName)) {
				const first = plainText(element).match(/\p{L}/u)?.[0];
				if (first) element.properties.dir = /[\u0600-\u06ff]/u.test(first) ? 'rtl' : 'ltr';
			}
			const classes = element?.properties.className;
			const skip =
				inheritedSkip ||
				(!!element && (EXCLUDED.has(element.tagName) || (Array.isArray(classes) && classes.includes('katex'))));
			const next: RootContent[] = [];
			for (const child of node.children) {
				if (child.type === 'text' && !skip) next.push(...splitLatin(child));
				else {
					if (child.type === 'element') walk(child, skip);
					next.push(child);
				}
			}
			node.children = next as typeof node.children;
		}
		walk(tree);
	};
}
