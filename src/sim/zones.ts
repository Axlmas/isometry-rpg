import {
  DUNGEON_SIZE, HOLLOW_MONSTERS, MINES_MIN_LEVEL, MONSTER_COUNT, MONSTER_MIN_SPAWN_DISTANCE, MOOR_MONSTERS,
  type MonsterKind, PILLAR_CHANCE, WORLD_HEIGHT, WORLD_TREE_CHANCE, WORLD_WIDTH,
} from './balance';
import { type GridMap, type Point, type Tile, TILE_FLOOR, TILE_WALL, isWalkable } from './grid';
import type { NpcKind } from './npcs';
import type { Rng } from './rng';

/**
 * The game has two maps: the open world, which the hero crosses on foot, and
 * the dungeon, which is entered through a door. IDs are stable: saves use them.
 */
export type ZoneKind = 'overworld' | 'dungeon';
export const ZONE_KINDS: readonly ZoneKind[] = ['overworld', 'dungeon'];

export function isZoneKind(value: unknown): value is ZoneKind {
  return typeof value === 'string' && (ZONE_KINDS as readonly string[]).includes(value);
}

/** A named part of a map with its own danger level. The open world is divided into several. */
export type RegionId = 'village' | 'moor' | 'hollow' | 'mines';

export interface Region {
  id: RegionId;
  /** Monsters never attack here, and the hero recovers quickly. */
  safe: boolean;
  /** Lowest and highest level of the monsters that live here; null where it depends on the hero. */
  levels: readonly [number, number] | null;
  monsterKind: MonsterKind | null;
}

export const REGIONS: Readonly<Record<RegionId, Region>> = {
  village: { id: 'village', safe: true, levels: null, monsterKind: null },
  moor: { id: 'moor', safe: false, levels: [1, 2], monsterKind: 'wolf' },
  hollow: { id: 'hollow', safe: false, levels: [3, 5], monsterKind: 'boar' },
  mines: { id: 'mines', safe: false, levels: null, monsterKind: 'grunt' },
};

/** A place where the hero can leave for the other map. */
export interface ZoneExit {
  pos: Point;
  to: ZoneKind;
  /** The region the hero ends up in; used to name the exit. */
  leadsTo: RegionId;
}

export interface MonsterSpot {
  home: Point;
  kind: MonsterKind;
  /** Null means "the level of the dungeon". */
  level: number | null;
}

export interface ZoneLayout {
  map: GridMap;
  /** Where a hero appears when not arriving through an exit. */
  spawn: Point;
  npcs: Array<{ kind: NpcKind; pos: Point }>;
  exits: ZoneExit[];
  monsters: MonsterSpot[];
}

// The village is drawn by hand: # is a wall (palisade or house), S the place
// a new hero appears, and the letters are its people: A the alchemist, O the
// outfitter, B the blacksmith, T the trainer, G a guard. The gap in the east
// wall is the gate.
const VILLAGE = [
  '######################',
  '#....................#',
  '#..###....##....###..#',
  '#..###....##....###..#',
  '#...A......T.....B...#',
  '#...................G#',
  '#.........S...........',
  '#.....................',
  '#...................G#',
  '#..###....##....###..#',
  '#..###....##....###..#',
  '#...O................#',
  '######################',
];
const VILLAGE_PEOPLE: Readonly<Record<string, NpcKind>> = { A: 'alchemist', O: 'outfitter', B: 'blacksmith', T: 'trainer', G: 'guard' };
const VILLAGE_WIDTH = (VILLAGE[0] as string).length;
/** Top-left corner of the village on the world map. */
const VILLAGE_ORIGIN: Point = { x: 8, y: 23 };
/** The road leaves the village gate and runs east along this row to the mines. */
export const ROAD_ROW = VILLAGE_ORIGIN.y + 6;
/** A line of trees along this column separates the moor from the hollow; the passes are the only ways through. */
export const HOLLOW_BORDER = 58;
const BORDER_PASSES: ReadonlyArray<readonly [number, number]> = [[10, 12], [ROAD_ROW, ROAD_ROW + 1], [47, 49]];
const MINES_DOOR: Point = { x: WORLD_WIDTH - 4, y: ROAD_ROW };

function inVillage(x: number, y: number, margin = 0): boolean {
  return (
    x >= VILLAGE_ORIGIN.x - margin && x < VILLAGE_ORIGIN.x + VILLAGE_WIDTH + margin &&
    y >= VILLAGE_ORIGIN.y - margin && y < VILLAGE_ORIGIN.y + VILLAGE.length + margin
  );
}

/** Which region a point of a map belongs to. */
export function regionAt(zone: ZoneKind, pos: Point): Region {
  if (zone === 'dungeon') return REGIONS.mines;
  const x = Math.round(pos.x);
  const y = Math.round(pos.y);
  if (inVillage(x, y)) return REGIONS.village;
  return x > HOLLOW_BORDER ? REGIONS.hollow : REGIONS.moor;
}

/** True for the tiles of the road that crosses the open world from the village gate to the mines. */
export function isRoad(zone: ZoneKind, x: number, y: number): boolean {
  return zone === 'overworld' && (y === ROAD_ROW || y === ROAD_ROW + 1) && x >= VILLAGE_ORIGIN.x + VILLAGE_WIDTH - 1 && x <= MINES_DOOR.x;
}

/** The level of the mines for a hero of the given level: never a walk-over for a beginner. */
export function minesLevelFor(heroLevel: number): number {
  return Math.max(MINES_MIN_LEVEL, heroLevel);
}

/** Turns unreachable floor into walls, so every floor tile the player sees is a valid destination. */
function sealUnreachable(map: GridMap, from: Point): void {
  const { width, tiles } = map;
  const reachable = new Array<boolean>(tiles.length).fill(false);
  const queue: Point[] = [from];
  reachable[from.y * width + from.x] = true;
  for (let head = 0; head < queue.length; head++) {
    const { x, y } = queue[head] as Point;
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

const near = (x: number, y: number, p: Point, reach = 1): boolean => Math.abs(x - p.x) <= reach && Math.abs(y - p.y) <= reach;

/** Picks `count` distinct tiles from `candidates`. */
function pickSpots(candidates: Point[], count: number, rng: Rng): Point[] {
  const spots: Point[] = [];
  while (spots.length < count && candidates.length > 0) {
    spots.push(...(candidates.splice(rng.int(0, candidates.length - 1), 1) as [Point]));
  }
  return spots;
}

function buildOverworld(rng: Rng): ZoneLayout {
  const width = WORLD_WIDTH;
  const height = WORLD_HEIGHT;
  const tiles: Tile[] = [];
  let spawn: Point = { ...VILLAGE_ORIGIN };
  const npcs: ZoneLayout['npcs'] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inVillage(x, y)) {
        const cell = (VILLAGE[y - VILLAGE_ORIGIN.y] as string)[x - VILLAGE_ORIGIN.x];
        tiles.push(cell === '#' ? TILE_WALL : TILE_FLOOR);
        if (cell === 'S') spawn = { x, y };
        const person = VILLAGE_PEOPLE[cell as string];
        if (person) npcs.push({ kind: person, pos: { x, y } });
        continue;
      }
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      const onRoad = (y === ROAD_ROW || y === ROAD_ROW + 1) && x > VILLAGE_ORIGIN.x;
      const pass = BORDER_PASSES.some(([from, to]) => y >= from && y <= to);
      const regionBorder = x === HOLLOW_BORDER && !pass;
      // Nothing grows on the road, right against the village wall, or around the mine door.
      const keepClear = onRoad || inVillage(x, y, 1) || near(x, y, MINES_DOOR, 2) || (x === HOLLOW_BORDER && pass);
      const tree = !keepClear && rng.next() < WORLD_TREE_CHANCE;
      tiles.push(edge || regionBorder || tree ? TILE_WALL : TILE_FLOOR);
    }
  }
  const map: GridMap = { width, height, tiles };
  sealUnreachable(map, spawn);

  const monsters: MonsterSpot[] = [];
  for (const [region, count] of [[REGIONS.moor, MOOR_MONSTERS], [REGIONS.hollow, HOLLOW_MONSTERS]] as const) {
    const candidates: Point[] = [];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (!isWalkable(map, x, y) || regionAt('overworld', { x, y }) !== region) continue;
        // Away from the village walls, the road and the mine door, so arriving is never an ambush.
        if (inVillage(x, y, MONSTER_MIN_SPAWN_DISTANCE) || Math.abs(y - ROAD_ROW) <= 2 || near(x, y, MINES_DOOR, MONSTER_MIN_SPAWN_DISTANCE)) continue;
        candidates.push({ x, y });
      }
    }
    const [min, max] = region.levels as readonly [number, number];
    for (const home of pickSpots(candidates, count, rng)) {
      monsters.push({ home, kind: region.monsterKind as MonsterKind, level: rng.int(min, max) });
    }
  }

  return { map, spawn, npcs, exits: [{ pos: MINES_DOOR, to: 'dungeon', leadsTo: 'mines' }], monsters };
}

function buildDungeon(rng: Rng): ZoneLayout {
  const size = DUNGEON_SIZE;
  const spawn = { x: Math.floor(size / 2), y: Math.floor(size / 2) };
  const tiles: Tile[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      tiles.push(edge || (!near(x, y, spawn) && rng.next() < PILLAR_CHANCE) ? TILE_WALL : TILE_FLOOR);
    }
  }
  const map: GridMap = { width: size, height: size, tiles };
  sealUnreachable(map, spawn);

  const candidates: Point[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isWalkable(map, x, y) && Math.hypot(x - spawn.x, y - spawn.y) >= MONSTER_MIN_SPAWN_DISTANCE) candidates.push({ x, y });
    }
  }
  const monsters = pickSpots(candidates, MONSTER_COUNT, rng).map((home): MonsterSpot => ({ home, kind: 'grunt', level: null }));
  return { map, spawn, npcs: [], exits: [{ pos: { x: spawn.x, y: spawn.y - 1 }, to: 'overworld', leadsTo: 'hollow' }], monsters };
}

export function buildZone(zone: ZoneKind, rng: Rng): ZoneLayout {
  return zone === 'overworld' ? buildOverworld(rng) : buildDungeon(rng);
}
