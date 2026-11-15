import {
  DUNGEON_SIZE, ELDER_CHANCE, MINES_MIN_LEVEL, MONSTER_COUNT, MONSTER_MIN_SPAWN_DISTANCE, MONSTER_SPACING,
  type MonsterKind, PILLAR_CHANCE, REGION_MONSTERS, WORLD_HEIGHT, WORLD_SEED, WORLD_WIDTH,
} from './balance';
import { type GridMap, type Point, type Tile, TILE_FLOOR, TILE_ROCK, TILE_RUIN, TILE_WALL, TILE_WATER, isWalkable } from './grid';
import { fractal2, noise2 } from './noise';
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
export type RegionId = 'village' | 'pasture' | 'moor' | 'hollow' | 'thicket' | 'mines';
export const REGION_IDS: readonly RegionId[] = ['village', 'pasture', 'moor', 'hollow', 'thicket', 'mines'];

export interface Region {
  id: RegionId;
  /** Monsters never attack here, and the hero recovers quickly. */
  safe: boolean;
  /** Lowest and highest level of the monsters that live here; null where it depends on the hero. */
  levels: readonly [number, number] | null;
  monsterKind: MonsterKind | null;
}

/**
 * The further from the village, the harder: young wolves on the meadow by the
 * river, wolves on the moor beyond it, boars in the hollow, tuskers in the
 * thicket around the mines.
 */
export const REGIONS: Readonly<Record<RegionId, Region>> = {
  village: { id: 'village', safe: true, levels: null, monsterKind: null },
  pasture: { id: 'pasture', safe: false, levels: [1, 1], monsterKind: 'wolfPup' },
  moor: { id: 'moor', safe: false, levels: [2, 3], monsterKind: 'wolf' },
  hollow: { id: 'hollow', safe: false, levels: [3, 5], monsterKind: 'boar' },
  thicket: { id: 'thicket', safe: false, levels: [5, 7], monsterKind: 'tusker' },
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
  elder: boolean;
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
// outfitter, B the blacksmith, T the trainer, H the hunter, G a guard. The gap in the east
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
  '#...O...........H....#',
  '######################',
];
const VILLAGE_PEOPLE: Readonly<Record<string, NpcKind>> = { A: 'alchemist', O: 'outfitter', B: 'blacksmith', T: 'trainer', H: 'hunter', G: 'guard' };
const VILLAGE_WIDTH = (VILLAGE[0] as string).length;
/** Top-left corner of the village on the world map. */
const VILLAGE_ORIGIN: Point = { x: 10, y: 35 };
const GATE: Point = { x: VILLAGE_ORIGIN.x + VILLAGE_WIDTH - 1, y: VILLAGE_ORIGIN.y + 6 };
const MINES_DOOR: Point = { x: WORLD_WIDTH - 7, y: 45 };

function inVillage(x: number, y: number, margin = 0): boolean {
  return (
    x >= VILLAGE_ORIGIN.x - margin && x < VILLAGE_ORIGIN.x + VILLAGE_WIDTH + margin &&
    y >= VILLAGE_ORIGIN.y - margin && y < VILLAGE_ORIGIN.y + VILLAGE.length + margin
  );
}

// The shape of the open world. Nothing here is a straight line: regions meet
// along wavering borders, the road winds, the river bends. All of it is a
// pure function of position, so it is the same in every game.
const SHAPE_SEED = WORLD_SEED;

/**
 * The heart of each open-world region. The meadow is everything on the
 * village's side of the river; beyond the river a point belongs to the region
 * whose heart is nearest, give or take.
 */
export const REGION_SITES: Readonly<Record<Exclude<RegionId, 'village' | 'mines'>, Point & { reach: number }>> = {
  // A larger `reach` makes a region claim more ground.
  pasture: { x: 37, y: 30, reach: 1 },
  moor: { x: 68, y: 21, reach: 1 },
  hollow: { x: 68, y: 63, reach: 1 },
  thicket: { x: 104, y: 42, reach: 0.82 },
};

/** Which region a point of a map belongs to. */
export function regionAt(zone: ZoneKind, pos: Point): Region {
  if (zone === 'dungeon') return REGIONS.mines;
  const x = Math.round(pos.x);
  const y = Math.round(pos.y);
  if (inVillage(x, y)) return REGIONS.village;
  if (x <= riverColumn(y) + 1) return REGIONS.pasture;
  // Bending the map a little before measuring makes the borders waver.
  const wx = x + (fractal2(x / 15, y / 15, SHAPE_SEED + 1) - 0.5) * 20;
  const wy = y + (fractal2(x / 15, y / 15, SHAPE_SEED + 2) - 0.5) * 20;
  let best: RegionId = 'moor';
  let bestDistance = Infinity;
  for (const id of ['moor', 'hollow', 'thicket'] as const) {
    const site = REGION_SITES[id];
    const distance = Math.hypot(wx - site.x, wy - site.y) / site.reach;
    if (distance < bestDistance) {
      best = id;
      bestDistance = distance;
    }
  }
  return REGIONS[best];
}

/** The row the road runs along at column `x`: from the village gate to the mine door, winding in between. */
function roadRow(x: number): number {
  const t = Math.min(1, Math.max(0, (x - GATE.x) / (MINES_DOOR.x - GATE.x)));
  const straight = GATE.y + (MINES_DOOR.y - GATE.y) * t;
  // The bends fade out towards both ends so the road meets the gate and the door exactly.
  const bend = (noise2(x / 15, 0.5, SHAPE_SEED + 3) - 0.5) * 36 * Math.sin(Math.PI * t);
  return Math.round(straight + bend);
}

/** True for the tiles of the road that crosses the open world from the village gate to the mines. */
export function isRoad(zone: ZoneKind, x: number, y: number): boolean {
  if (zone !== 'overworld' || x < GATE.x || x > MINES_DOOR.x) return false;
  // Two tiles wide, and where the road steps to another row the step is filled in.
  const here = roadRow(x);
  const next = roadRow(Math.min(MINES_DOOR.x, x + 1));
  return y >= Math.min(here, next) && y <= Math.max(here, next) + 1;
}

/** How far a tile is from the road, in rows. */
function offRoad(x: number, y: number): number {
  if (x < GATE.x - 2 || x > MINES_DOOR.x + 2) return Infinity;
  return Math.abs(y - roadRow(Math.min(MINES_DOOR.x, Math.max(GATE.x, x))));
}

/** The column the river runs along at row `y`. It flows from north to south between the meadow and the wilds. */
function riverColumn(y: number): number {
  return Math.round(45 + (noise2(0.5, y / 13, SHAPE_SEED + 4) - 0.5) * 14);
}
/** Rows where the river is shallow enough to wade across, besides the bridge on the road. */
const FORDS: readonly number[] = [17, 66];

function isRiver(x: number, y: number): boolean {
  const column = riverColumn(y);
  if (x < column || x > column + 1) return false;
  return !FORDS.some((ford) => Math.abs(y - ford) <= 1);
}

/** Still water: a lake in the hollow and a tarn on the moor, with wavering shores. */
const LAKES: ReadonlyArray<Point & { radius: number }> = [{ x: 74, y: 70, radius: 5.5 }, { x: 84, y: 14, radius: 3.6 }];
function isLake(x: number, y: number): boolean {
  return LAKES.some((lake) => Math.hypot(x - lake.x, y - lake.y) < lake.radius + (noise2(x / 4, y / 4, SHAPE_SEED + 5) - 0.5) * 3.5);
}

/** An old ring of standing stones on the moor and a ruined hall in the thicket: places to find one's way by. */
const STONE_RING: Point & { radius: number } = { x: 70, y: 24, radius: 4 };
const RUIN = { x: 96, y: 24, width: 11, height: 8 } as const;

function landmarkTile(x: number, y: number): Tile | null {
  const fromRing = Math.hypot(x - STONE_RING.x, y - STONE_RING.y);
  if (fromRing <= STONE_RING.radius + 2.5) {
    // Eight stones stand around the ring, and one in the middle; the rest is kept open.
    if (fromRing < 0.5) return TILE_ROCK;
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      if (x === STONE_RING.x + Math.round(Math.cos(angle) * STONE_RING.radius) && y === STONE_RING.y + Math.round(Math.sin(angle) * STONE_RING.radius)) return TILE_ROCK;
    }
    return TILE_FLOOR;
  }
  const rx = x - RUIN.x;
  const ry = y - RUIN.y;
  if (rx >= -2 && ry >= -2 && rx < RUIN.width + 2 && ry < RUIN.height + 2) {
    const inside = rx >= 0 && ry >= 0 && rx < RUIN.width && ry < RUIN.height;
    const onWall = inside && (rx === 0 || ry === 0 || rx === RUIN.width - 1 || ry === RUIN.height - 1 || (rx === 6 && ry < 5));
    // Time has taken about a third of the walls, and the doorway faces south.
    const standing = noise2(x * 3.7, y * 3.7, SHAPE_SEED + 6) > 0.34 && !(ry === RUIN.height - 1 && (rx === 3 || rx === 4));
    return onWall && standing ? TILE_RUIN : TILE_FLOOR;
  }
  return null;
}

/** How thick the woods are in each region: the share of noise above which trees grow. */
const WOODS: Readonly<Record<Exclude<RegionId, 'village' | 'mines'>, number>> = { pasture: 0.7, moor: 0.69, hollow: 0.65, thicket: 0.61 };

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
    // Only open ground is closed off; water and stone stay what they are.
    if (!reachable[i] && tiles[i] === TILE_FLOOR) tiles[i] = TILE_WALL;
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
      const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
      if (edge === 0) {
        tiles.push(TILE_WALL);
        continue;
      }
      const region = regionAt('overworld', { x, y }).id as keyof typeof WOODS;
      // Nothing grows on the road, right against the village wall, or around the mine door.
      const keepClear = offRoad(x, y) <= 2 || inVillage(x, y, 2) || near(x, y, MINES_DOOR, 3);
      if (keepClear) {
        tiles.push(TILE_FLOOR);
        continue;
      }
      const landmark = landmarkTile(x, y);
      if (landmark !== null) {
        tiles.push(landmark);
        continue;
      }
      if (isRiver(x, y) || isLake(x, y)) {
        tiles.push(TILE_WATER);
        continue;
      }
      // Woods come in masses with clearings between them, and close in towards the edge of the world.
      const woods = fractal2(x / 7, y / 7, SHAPE_SEED + 7) + Math.max(0, (5 - edge) / 5) * 0.45;
      const lone = rng.next() < 0.012;
      if (woods > WOODS[region] || lone) {
        tiles.push(TILE_WALL);
        continue;
      }
      // Boulder fields on the moor and in the thicket.
      const stony = (region === 'moor' || region === 'thicket') && fractal2(x / 5, y / 5, SHAPE_SEED + 8) > 0.74;
      tiles.push(stony ? TILE_ROCK : TILE_FLOOR);
    }
  }
  const map: GridMap = { width, height, tiles };
  sealUnreachable(map, spawn);

  const monsters: MonsterSpot[] = [];
  const regionOf: RegionId[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) regionOf.push(regionAt('overworld', { x, y }).id);
  for (const id of ['pasture', 'moor', 'hollow', 'thicket'] as const) {
    const region = REGIONS[id];
    const candidates: Point[] = [];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (!isWalkable(map, x, y) || regionOf[y * width + x] !== id) continue;
        // Away from the village walls, the road and the mine door, so arriving is never an ambush.
        if (inVillage(x, y, MONSTER_MIN_SPAWN_DISTANCE) || offRoad(x, y) <= 3 || near(x, y, MINES_DOOR, MONSTER_MIN_SPAWN_DISTANCE)) continue;
        candidates.push({ x, y });
      }
    }
    const [min, max] = region.levels as readonly [number, number];
    const homes: Point[] = [];
    // Monsters gather where the ground suits them: crowded spots here, empty stretches there.
    // How many stand together is never the same twice, so every pull is a judgement call.
    for (let attempt = 0; attempt < 6000 && homes.length < REGION_MONSTERS[id] && candidates.length > 0; attempt++) {
      const index = rng.int(0, candidates.length - 1);
      const spot = candidates[index] as Point;
      const liking = noise2(spot.x / 6, spot.y / 6, SHAPE_SEED + 9);
      if (rng.next() > 0.15 + liking) continue;
      candidates.splice(index, 1);
      if (monsters.some(({ home }) => Math.hypot(home.x - spot.x, home.y - spot.y) < MONSTER_SPACING)) continue;
      homes.push(spot);
      monsters.push({ home: spot, kind: region.monsterKind as MonsterKind, level: rng.int(min, max), elder: rng.int(1, 100) <= ELDER_CHANCE });
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
  const monsters = pickSpots(candidates, MONSTER_COUNT, rng).map((home): MonsterSpot => ({ home, kind: 'grunt', level: null, elder: rng.int(1, 100) <= ELDER_CHANCE }));
  return { map, spawn, npcs: [], exits: [{ pos: { x: spawn.x, y: spawn.y - 1 }, to: 'overworld', leadsTo: 'thicket' }], monsters };
}

/** The open world is always the same, so it is built once and copied for each game. */
let overworld: ZoneLayout | null = null;

export function buildZone(zone: ZoneKind, rng: Rng): ZoneLayout {
  if (zone !== 'overworld') return buildDungeon(rng);
  overworld ??= buildOverworld(rng);
  return {
    map: { ...overworld.map, tiles: [...overworld.map.tiles] },
    spawn: { ...overworld.spawn },
    npcs: overworld.npcs.map((npc) => ({ kind: npc.kind, pos: { ...npc.pos } })),
    exits: overworld.exits.map((exit) => ({ ...exit, pos: { ...exit.pos } })),
    monsters: overworld.monsters.map((spot) => ({ ...spot, home: { ...spot.home } })),
  };
}
