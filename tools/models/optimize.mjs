#!/usr/bin/env node
// Prepares a generated .glb for the web game: smaller textures in WebP, compressed
// geometry and animation, unused data removed. Same input always gives the same output.
//
//   node tools/models/optimize.mjs <in.glb> <out.glb> [--texture 1024] [--simplify 0.2] [--anim-only]
//
//   --texture    largest texture side in pixels (default 1024)
//   --simplify   keep about this share of triangles (for objects drawn thousands of times)
//   --error      how far the simplified shape may stray, as a share of its size (default 0.01)
//   --sloppy     with --simplify: merge nearby pieces too (foliage made of many separate clumps)
//   --anim-only  keep only the animations: for extra clips of a model that is already loaded
//
// The game loads the result with three.js GLTFLoader + MeshoptDecoder.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive, dedup, meshopt, prune, resample, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { statSync } from 'node:fs';

const [input, output, ...rest] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: optimize.mjs <in.glb> <out.glb> [--texture 1024] [--simplify 0.2] [--anim-only]');
  process.exit(1);
}
const option = (name) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const size = Number(option('--texture') ?? 1024);
const ratio = option('--simplify') === undefined ? null : Number(option('--simplify'));
const animOnly = rest.includes('--anim-only');
const error = Number(option('--error') ?? 0.01);
const sloppy = rest.includes('--sloppy');

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(input);
const root = doc.getRoot();
if (animOnly) {
  // Bones stay (the clips address them by name); meshes, skins and pictures go.
  for (const node of root.listNodes()) {
    node.setMesh(null);
    node.setSkin(null);
  }
  for (const mesh of root.listMeshes()) mesh.dispose();
  for (const skin of root.listSkins()) skin.dispose();
  for (const material of root.listMaterials()) material.dispose();
  for (const texture of root.listTextures()) texture.dispose();
}

const steps = [dedup(), prune(), resample()];
if (ratio !== null && sloppy) steps.push(weld(), sloppySimplify(ratio, error));
else if (ratio !== null) steps.push(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error }));
if (!animOnly) steps.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 82 }));
steps.push(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await doc.transform(...steps);
await io.write(output, doc);

/**
 * Sloppy simplification ignores the mesh's topology, so it can merge leaf clumps that
 * the regular simplifier must keep apart. Fine for trees seen from a distance.
 */
function sloppySimplify(ratio, error) {
  return (document) => {
    for (const mesh of document.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const indices = prim.getIndices();
        const position = prim.getAttribute('POSITION');
        if (!indices || !position) continue;
        const src = new Uint32Array(indices.getArray());
        const positions = new Float32Array(position.getArray());
        const target = Math.floor((src.length * ratio) / 3) * 3;
        const [out] = MeshoptSimplifier.simplifySloppy(src, positions, 3, null, target, error);
        indices.setArray(new Uint32Array(out));
        // Drop the vertices no triangle uses any more.
        compactPrimitive(prim);
      }
    }
  };
}

const kb = (f) => (statSync(f).size / 1024).toFixed(0);
console.log(`${input} ${kb(input)} KB -> ${output} ${kb(output)} KB`);
