import { DUNGEON_SIZE, FIELD_SIZE, FIELD_TREE_CHANCE, type MonsterKind, PILLAR_CHANCE } from './balance';
import { type GridMap, type Point, type Tile, TILE_FLOOR, TILE_WALL, isWalkable } from './grid';
import type { Rng } from './rng';

/** Zone IDs are stable: saves refer to them. */
export type ZoneKind = 'village' | 'field' | 'dungeon';
export const ZONE_KINDS: readonly ZoneKind[] = ['village', 'field', 'dungeon'];

export function isZoneKind(value: unknown): value is ZoneKind {
  return typeof value === 'string' && (ZONE_KINDS as readonly string[]).includes(value);
}

/** A place where the hero can leave for another zone. */
export interface ZoneExit {
  pos: Point;
  to: ZoneKind;
}

export interface ZoneLayout {
  map: GridMap;
  /** Where a hero appears when not arriving through an exit. */
  spawn: Point;
  merchant: Point | null;
  exits: ZoneExit[];
  /** What lives here, or null for a safe zone. */
  monsterKind: MonsterKind | null;
}

/** Turns unreachable floor into walls, so every floor tile the player sees is a valid destination. */
function sealUnreachable(map: GridMap, from: Point): void {
  const { width, tiles } = map;
  const reachable = new Array<boolean>(tiles.length).fill(false);
  const queue: Point[] = [from];
  reachable[from.y * width + from.x] = true;
  while (queue.length > 0) {
    const { x, y } = queue.shift() as Point;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      const index = ny * width + nx;
      if (isWalkable(map, nx, ny) && !reachable[index]) {
        reachable[index] = true;
        queue.push({ x: nx, y: ny });
      }
    }
  }
  for (let i = 0; i < tiles.length; i++) {
    if (!reachable[i]) tiles[i] = TILE_WALL;
  }
}

/** A square room with random obstacles. `keepClear` says which tiles must stay floor. */
function scatter(size: number, chance: number, rng: Rng, keepClear: (x: number, y: number) => boolean): GridMap {
  const tiles: Tile[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const border = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      const obstacle = !border && !keepClear(x, y) && rng.next() < chance;
      tiles.push(border || obstacle ? TILE_WALL : TILE_FLOOR);
    }
  }
  return { width: size, height: size, tiles };
}

const near = (x: number, y: number, p: Point, reach = 1): boolean => Math.abs(x - p.x) <= reach && Math.abs(y - p.y) <= reach;

// The village is drawn by hand and is the same for everyone: # is a wall
// (palisade or house), M the merchant, S the place a new hero appears,
// F the gate to the field.
const VILLAGE = [
  '######################',
  '#....................#',
  '#..###....##....###..#',
  '#..###....##....###..#',
  '#....................#',
  '#....M...............#',
  '#.........S.........F#',
  '#....................#',
  '#....................#',
  '#..###....##....###..#',
  '#..###....##....###..#',
  '#....................#',
  '######################',
];

function buildVillage(): ZoneLayout {
  const tiles: Tile[] = [];
  let spawn: Point = { x: 1, y: 1 };
  let merchant: Point | null = null;
  const exits: ZoneExit[] = [];
  VILLAGE.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      tiles.push(cell === '#' ? TILE_WALL : TILE_FLOOR);
      if (cell === 'S') spawn = { x, y };
      if (cell === 'M') merchant = { x, y };
      if (cell === 'F') exits.push({ pos: { x, y }, to: 'field' });
    });
  });
  return { map: { width: (VILLAGE[0] as string).length, height: VILLAGE.length, tiles }, spawn, merchant, exits, monsterKind: null };
}

function buildField(rng: Rng): ZoneLayout {
  const size = FIELD_SIZE;
  const mid = Math.floor(size / 2);
  const villageGate = { x: 1, y: mid };
  const dungeonDoor = { x: size - 2, y: mid };
  // A road runs straight from the village gate to the dungeon, so the way is never blocked.
  const map = scatter(size, FIELD_TREE_CHANCE, rng, (x, y) => y === mid || near(x, y, villageGate) || near(x, y, dungeonDoor));
  sealUnreachable(map, villageGate);
  return {
    map,
    spawn: { x: villageGate.x + 1, y: mid },
    merchant: null,
    exits: [{ pos: villageGate, to: 'village' }, { pos: dungeonDoor, to: 'dungeon' }],
    monsterKind: 'wolf',
  };
}

function buildDungeon(rng: Rng): ZoneLayout {
  const size = DUNGEON_SIZE;
  const spawn = { x: Math.floor(size / 2), y: Math.floor(size / 2) };
  const map = scatter(size, PILLAR_CHANCE, rng, (x, y) => near(x, y, spawn));
  sealUnreachable(map, spawn);
  return { map, spawn, merchant: null, exits: [{ pos: { x: spawn.x, y: spawn.y - 1 }, to: 'field' }], monsterKind: 'grunt' };
}

export function buildZone(zone: ZoneKind, rng: Rng): ZoneLayout {
  if (zone === 'village') return buildVillage();
  if (zone === 'field') return buildField(rng);
  return buildDungeon(rng);
}
