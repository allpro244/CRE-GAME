// Inline the Vite production build into a single self-contained HTML file.
// No dependencies: reads dist/, folds the one JS chunk and one CSS file into index.html.
// Usage: pnpm build && node tools/bundle.mjs  ->  groundwork.html
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const assets = join(dist, 'assets');
let html = readFileSync(join(dist, 'index.html'), 'utf8');

const files = readdirSync(assets);
const js = files.find(f => f.endsWith('.js'));
const css = files.find(f => f.endsWith('.css'));
if (!js || !css) throw new Error(`Expected one .js and one .css in ${assets}, saw: ${files.join(', ')}`);

const jsCode = readFileSync(join(assets, js), 'utf8');
const cssCode = readFileSync(join(assets, css), 'utf8');

// Use function replacers so `$` in the bundled code isn't treated as a replacement pattern.
html = html.replace(/\s*<link\b[^>]*rel="stylesheet"[^>]*>/, () => `\n    <style>${cssCode}</style>`);
html = html.replace(/\s*<script\b[^>]*type="module"[^>]*><\/script>/, () => `\n    <script type="module">${jsCode}</script>`);

if (html.includes('/assets/')) {
  console.warn('⚠ Some /assets/ reference remained un-inlined — check the build output.');
}

writeFileSync('groundwork.html', html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`✓ groundwork.html written (${kb} KB, self-contained)`);
