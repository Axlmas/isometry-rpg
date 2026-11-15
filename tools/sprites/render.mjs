// Renders the 3D models listed in characters.mjs into sprite sheets.
//
//   npm install            (once, in this folder)
//   node render.mjs <folder with the downloaded model packs> [name ...]
//
// Writes public/sprites/<name>.webp and <name>.json in the game's root.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHARACTERS, OPTIONAL_PARTS } from './characters.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [assetsArg, ...only] = process.argv.slice(2);
if (!assetsArg || !existsSync(assetsArg)) {
  console.error('Usage: node render.mjs <folder with the downloaded model packs> [name ...]\nSee README.md for where to get the packs.');
  process.exit(1);
}
const assets = resolve(assetsArg);
const out = resolve(here, '../../public/sprites');
mkdirSync(out, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png' };
// Serves this folder, and the model packs under /assets/. Nothing outside those two folders.
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const [root, relative] = path.startsWith('/assets/') ? [assets, path.slice('/assets/'.length)] : [here, path.slice(1)];
  const file = normalize(join(root, relative));
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
});
await new Promise((done) => server.listen(0, done));
const { port } = server.address();

// Playwright comes with the development environment; it is not a dependency of this tool.
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (error) => console.error(String(error)));
await page.goto(`http://localhost:${port}/page.html`);
await page.waitForFunction('window.ready === true');

for (const character of CHARACTERS) {
  if (only.length > 0 && !only.includes(character.name)) continue;
  const result = await page.evaluate(([c, parts]) => window.renderCharacter(c, parts), [character, OPTIONAL_PARTS]);
  writeFileSync(join(out, `${character.name}.webp`), Buffer.from(result.image.split(',')[1], 'base64'));
  writeFileSync(join(out, `${character.name}.json`), `${JSON.stringify(result.manifest)}\n`);
  console.log(`${character.name}: ${result.width}x${result.height}`);
}
await browser.close();
server.close();
