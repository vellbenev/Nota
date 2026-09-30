import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
const assets = await readdir('dist/assets');
for (const name of assets.filter(n => n.endsWith('.css'))) {
	const file = resolve('dist/assets', name),
		css = await readFile(file, 'utf8');
	for (const match of css.matchAll(/url\(["']?([^)'"\s]+)["']?\)/g)) {
		const url = match[1];
		if (url.startsWith('data:')) continue;
		assert.ok(!/^(?:https?:)?\/\//.test(url), `External CSS asset: ${url}`);
		await access(url.startsWith('/') ? resolve('dist', url.slice(1)) : resolve(dirname(file), url));
	}
}
const html = await readFile('dist/index.html', 'utf8');
assert.ok(!/(?:src|href)=["'](?:https?:)?\/\//.test(html), 'External entry asset');
assert.ok(
	assets.some(n => n.startsWith('pdf.worker') && n.endsWith('.mjs')),
	'Missing local PDF worker',
);
assert.ok(
	assets.some(n => n.startsWith('vazirmatn-arabic') && n.endsWith('.woff2')),
	'Missing local Vazirmatn font',
);
assert.ok(
	assets.some(n => n.startsWith('rive-') && n.endsWith('.wasm')),
	'Missing local Rive WASM',
);
for (const name of assets.filter(n => n.endsWith('.js'))) {
	assert.ok((await readFile(`dist/assets/${name}`)).length < 500_000, `Application chunk exceeds 500 kB: ${name}`);
}
console.log('Local CSS/Vazirmatn, entry assets, PDF worker, Rive WASM and application chunk limits verified.');

