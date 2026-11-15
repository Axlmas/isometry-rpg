#!/usr/bin/env node
// Prepares a generated .glb for the web game: smaller textures in WebP, compressed
// geometry and animation, unused data removed. Same input always gives the same output.
//
//   node tools/models/optimize.mjs <in.glb> <out.glb> [--texture 1024]
//
// The game loads the result with three.js GLTFLoader + MeshoptDecoder.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const [input, output, ...rest] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: optimize.mjs <in.glb> <out.glb> [--texture 1024]');
  process.exit(1);
}
const flag = rest.indexOf('--texture');
const size = flag >= 0 ? Number(rest[flag + 1]) : 1024;

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(input);
await doc.transform(
  dedup(),
  prune(),
  resample(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 82 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write(output, doc);

const { statSync } = await import('node:fs');
const kb = (f) => (statSync(f).size / 1024).toFixed(0);
console.log(`${input} ${kb(input)} KB -> ${output} ${kb(output)} KB`);
