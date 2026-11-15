/**
 * Smooth pseudo-random fields for shaping the open world: where forests
 * grow, where a river bends, where one region gives way to another. Pure
 * functions of position and seed, so the same place always looks the same.
 */

function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Value noise in [0, 1): smooth, with features about one unit across. */
export function noise2(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const top = hash(x0, y0, seed) * (1 - tx) + hash(x0 + 1, y0, seed) * tx;
  const bottom = hash(x0, y0 + 1, seed) * (1 - tx) + hash(x0 + 1, y0 + 1, seed) * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Two layers of noise: broad shapes with finer detail on their edges. In [0, 1). */
export function fractal2(x: number, y: number, seed: number): number {
  return noise2(x, y, seed) * 0.67 + noise2(x * 2.1, y * 2.1, seed + 101) * 0.33;
}
