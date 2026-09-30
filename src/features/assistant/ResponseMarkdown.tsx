import 'katex/dist/katex.min.css';
import { memo } from 'react';
import Markdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import isolateLatin from './isolateLatin';
import styles from './ResponseMarkdown.module.css';
/** Accept common model \(...\)/\[...\] delimiters, leaving fenced and inline code alone. */
export function normalizeMathDelimiters(text: string) {
	return text
		.split(/(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g)
		.map((part, index) =>
			index % 2
				? part
				: part
						.replace(/\\\[([\s\S]*?)\\\]/g, (_, math: string) => `\n\n$$\n${math}\n$$\n\n`)
						.replace(/\\\(([^\n]*?)\\\)/g, (_, math: string) => `$${math}$`),
		)
		.join('');
}
export default memo(function ResponseMarkdown({ text, language = 'fa' }: { text: string; language?: 'fa' | 'en' }) {
	const persian = /[\u0600-\u06ff]/u.test(text);
	const direction = persian || (language === 'fa' && !text.trim()) ? 'rtl' : 'ltr';
	return (
		<div className={`response-markdown ${styles.body}`} dir={direction} lang={persian ? 'fa' : language}>
			<Markdown
				remarkPlugins={[remarkGfm, remarkMath]}
				rehypePlugins={[[rehypeKatex, { throwOnError: false, trust: false, strict: 'ignore' }], isolateLatin]}
				skipHtml
				components={{
					// A generated image must never cause an implicit external request.
					img: ({ alt }) => <span>[{alt || 'Image omitted'}]</span>,
					a: ({ href, children }) => (
						<a href={href} target='_blank' rel='noopener noreferrer'>
							<bdi>{children}</bdi>
						</a>
					),
					code: ({ children }) => (
						<code dir='ltr'>
							<bdi>{children}</bdi>
						</code>
					),
					blockquote: ({ children }) => <blockquote dir='auto'>{children}</blockquote>,
					pre: ({ children }) => <pre dir='ltr'>{children}</pre>,
				}}
			>
				{normalizeMathDelimiters(text)}
			</Markdown>
		</div>
	);
});

