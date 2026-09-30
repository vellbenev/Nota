import react from '@vitejs/plugin-react';
import { existsSync, readdirSync } from 'node:fs';
import { defineConfig } from 'vite';
const mascotDirectory = new URL('./public/mascot/', import.meta.url);
const mascot = existsSync(mascotDirectory)
	? readdirSync(mascotDirectory)
			.filter(name => name.endsWith('.riv'))
			.sort()[0]
	: undefined;
export default defineConfig({
	plugins: [
		react(),
		{
			name: 'pdf-viewer-engine-order',
			transform(code, id) {
				// PDF.js viewer reads globalThis.pdfjsLib. Make its initialization order
				// explicit when viewer utilities and the engine live in different chunks.
				if (id.endsWith('/pdfjs-dist/web/pdf_viewer.mjs'))
					return { code: "import 'pdfjs-dist';\n" + code, map: null };
			},
		},
	],
	resolve: { alias: [{ find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/build/pdf.min.mjs' }] },
	define: { __MASCOT_ASSET__: JSON.stringify(mascot ? `/mascot/${encodeURIComponent(mascot)}` : null) },
	server: { host: '127.0.0.1', port: 5173, strictPort: true },
	build: {
		target: 'es2022',
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (!id.includes('node_modules')) return;
					if (id.includes('@rive-app')) return 'rive';
					if (id.includes('pdfjs-dist/web/')) return 'pdf-links';
					if (id.includes('pdfjs-dist')) return 'pdf-engine';
					if (id.includes('react-pdf')) return 'pdf-view';
					if (id.includes('/katex/')) return 'math';
					if (
						/react-markdown|remark-|rehype-|micromark|mdast-|hast-|unist-|unified|vfile|bail|trough|property-information|decode-named-character|character-entities|ccount|comma-separated-tokens|space-separated-tokens|html-url-attributes|trim-lines|zwitch|is-plain-obj/.test(
							id,
						)
					)
						return 'markdown';
					if (/\/react\/|\/react-dom\/|\/scheduler\//.test(id)) return 'ui-core';
					if (id.includes('/dexie/')) return 'storage';
					if (id.includes('@tanstack')) return 'virtualizer';
					return 'markdown';
				},
			},
		},
	},
});

