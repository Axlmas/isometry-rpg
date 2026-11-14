export interface Point {
  x: number;
  y: number;
}

export const TILE_FLOOR = 0;
export const TILE_WALL = 1;
export type Tile = typeof TILE_FLOOR | typeof TILE_WALL;

export interface GridMap {
  width: number;
  height: number;
  /** Row-major: index = y * width + x. */
  tiles: Tile[];
}

export function inBounds(map: GridMap, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < map.width && y < map.height;
}

export function tileAt(map: GridMap, x: number, y: number): Tile {
  if (!inBounds(map, x, y)) return TILE_WALL;
  return map.tiles[y * map.width + x] ?? TILE_WALL;
}

export function isWalkable(map: GridMap, x: number, y: number): boolean {
  return tileAt(map, x, y) === TILE_FLOOR;
}
