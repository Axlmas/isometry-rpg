import { type World, PLAYER_MAX_HP, PLAYER_RADIUS, circleFree, createWorld } from '../sim';

/** Increase when the saved shape changes, and add a migration in `parseSave`. */
export const SAVE_VERSION = 3;
const SAVE_KEY = 'isometry-rpg.save';
const LOCALE_KEY = 'isometry-rpg.locale';

/** The subset of the Web Storage API we use; lets tests pass a fake. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface SaveData {
  version: number;
  seed: number;
  x: number;
  y: number;
  /** Total distance walked, in tiles. */
  distance: number;
  /** Zero means the hero is dead and the game opens on the defeat screen. */
  hp: number;
  /** IDs of the monsters already killed in this dungeon. */
  dead: number[];
  /** State of the combat random generator, so reloading does not re-roll outcomes. */
  rngState: number;
}

export type LoadResult =
  | { status: 'none' }
  | { status: 'damaged' }
  | { status: 'ok'; world: World };

/** Returns the browser storage, or null when it is blocked (private mode, policy). */
export function openStorage(): KeyValueStore | null {
  try {
    const storage = window.localStorage;
    const probe = 'isometry-rpg.probe';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export function serializeWorld(world: World): string {
  // The map and the monsters' starting places are not stored: they are rebuilt
  // from the seed. Surviving monsters are back at full health after a reload.
  const alive = new Set(world.monsters.map((monster) => monster.id));
  const dead: number[] = [];
  for (let id = 0; id < world.monsterTotal; id++) if (!alive.has(id)) dead.push(id);
  const data: SaveData = {
    version: SAVE_VERSION,
    seed: world.seed,
    x: world.player.pos.x,
    y: world.player.pos.y,
    distance: world.player.distance,
    hp: world.player.hp,
    dead,
    rngState: world.rngState,
  };
  return JSON.stringify(data);
}

/** Brings a save written by an older version of the game up to date, one version at a time. */
function migrate(data: Record<string, unknown>): Record<string, unknown> {
  let current = data;
  // v1 counted whole tiles; v2 stores the distance walked.
  if (current.version === 1) current = { ...current, version: 2, distance: current.tilesWalked };
  // v3 added combat and a larger room, so the old position no longer applies:
  // the hero starts at the entrance of the same dungeon with full health.
  if (current.version === 2) {
    current = { ...current, version: 3, x: null, y: null, hp: PLAYER_MAX_HP, dead: [], rngState: null };
  }
  return current;
}

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Saved data can be edited or corrupted, so every field is checked. */
export function parseSave(raw: string | null): LoadResult {
  if (raw === null) return { status: 'none' };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 'damaged' };
    const data = migrate(parsed as Record<string, unknown>);
    const { seed, x, y, distance, hp, dead, rngState } = data;
    if (data.version !== SAVE_VERSION || !isInt(seed) || !isFiniteNumber(distance) || distance < 0) {
      return { status: 'damaged' };
    }
    const world = createWorld(seed);

    // `null` is written by migrations and means "use the default".
    if (x !== null || y !== null) {
      if (!isFiniteNumber(x) || !isFiniteNumber(y)) return { status: 'damaged' };
      // A position inside or overlapping a wall cannot come from normal play.
      if (!circleFree(world.map, { x, y }, PLAYER_RADIUS)) return { status: 'damaged' };
      world.player.pos = { x, y };
    }
    if (!isInt(hp) || hp < 0 || hp > world.player.maxHp) return { status: 'damaged' };
    if (
      !Array.isArray(dead) ||
      !dead.every((id) => isInt(id) && id >= 0 && id < world.monsterTotal) ||
      new Set(dead).size !== dead.length
    ) {
      return { status: 'damaged' };
    }
    if (rngState !== null) {
      if (!isInt(rngState) || rngState < 0 || rngState > 0xffffffff) return { status: 'damaged' };
      world.rngState = rngState;
    }

    world.player.distance = distance;
    world.player.hp = hp;
    world.monsters = world.monsters.filter((monster) => !dead.includes(monster.id));
    return { status: 'ok', world };
  } catch {
    return { status: 'damaged' };
  }
}

export function loadWorld(store: KeyValueStore | null): LoadResult {
  if (!store) return { status: 'none' };
  try {
    return parseSave(store.getItem(SAVE_KEY));
  } catch {
    return { status: 'damaged' };
  }
}

/** Returns false when the save could not be written (for example, storage is full). */
export function saveWorld(store: KeyValueStore | null, world: World): boolean {
  if (!store) return false;
  try {
    store.setItem(SAVE_KEY, serializeWorld(world));
    return true;
  } catch {
    return false;
  }
}

export function loadLocale(store: KeyValueStore | null): string | null {
  try {
    return store?.getItem(LOCALE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function saveLocale(store: KeyValueStore | null, locale: string): void {
  try {
    store?.setItem(LOCALE_KEY, locale);
  } catch {
    // The preference is a convenience; the game works without it.
  }
}
