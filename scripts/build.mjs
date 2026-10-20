// Bundles the game into a single self-contained dist/index.html
// (works from file://, easy to host anywhere): `npm run build`

import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');

const res = await build({
  entryPoints: [join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['es2020'],
  write: false,
  legalComments: 'none',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

let html = await readFile(join(root, 'index.html'), 'utf8');
const tag = '<script type="module" src="./src/main.js"></script>';
if (!html.includes(tag)) throw new Error('index.html script tag not found');
html = html.replace(tag, () => `<script>${js}</script>`);

await mkdir(out, { recursive: true });
await writeFile(join(out, 'index.html'), html);
console.log(`dist/index.html  ${(html.length / 1024).toFixed(1)} KiB`);
