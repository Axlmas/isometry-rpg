import type { Point } from '../sim';

export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;

/** Tile coordinates to screen coordinates of the tile centre. */
export function tileToScreen(x: number, y: number): Point {
  return { x: ((x - y) * TILE_WIDTH) / 2, y: ((x + y) * TILE_HEIGHT) / 2 };
}

/** Screen coordinates to the tile under that point. */
export function screenToTile(sx: number, sy: number): Point {
  const a = sx / (TILE_WIDTH / 2);
  const b = sy / (TILE_HEIGHT / 2);
  return { x: Math.round((a + b) / 2), y: Math.round((b - a) / 2) };
}
