import type { Point } from '../sim';

export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;

/** Tile coordinates to screen coordinates of the tile centre. */
export function tileToScreen(x: number, y: number): Point {
  return { x: ((x - y) * TILE_WIDTH) / 2, y: ((x + y) * TILE_HEIGHT) / 2 };
}

/** Screen coordinates to (fractional) tile coordinates. */
export function screenToWorld(sx: number, sy: number): Point {
  const a = sx / (TILE_WIDTH / 2);
  const b = sy / (TILE_HEIGHT / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}
