import { type World, PLAYER_RADIUS, circleFree, createWorld } from '../sim';

/** Increase when the saved shape changes, and add a migration in `parseSave`. */
export const SAVE_VERSION = 2;
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
  // The map is not stored: it is rebuilt from the seed.
  const data: SaveData = {
    version: SAVE_VERSION,
    seed: world.seed,
    x: world.player.pos.x,
    y: world.player.pos.y,
    distance: world.player.distance,
  };
  return JSON.stringify(data);
}

/** Brings a save written by an older version of the game up to date. */
function migrate(data: Record<string, unknown>): Record<string, unknown> {
  // v1 counted whole tiles; v2 stores the distance walked.
  if (data.version === 1) return { ...data, version: 2, distance: data.tilesWalked };
  return data;
}

/** Saved data can be edited or corrupted, so every field is checked. */
export function parseSave(raw: string | null): LoadResult {
  if (raw === null) return { status: 'none' };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 'damaged' };
    const data = migrate(parsed as Record<string, unknown>) as Partial<SaveData>;
    const { seed, x, y, distance } = data;
    if (
      data.version !== SAVE_VERSION ||
      typeof seed !== 'number' || !Number.isInteger(seed) ||
      typeof x !== 'number' || !Number.isFinite(x) ||
      typeof y !== 'number' || !Number.isFinite(y) ||
      typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0
    ) {
      return { status: 'damaged' };
    }
    const world = createWorld(seed);
    // A position inside or overlapping a wall cannot come from normal play.
    if (!circleFree(world.map, { x, y }, PLAYER_RADIUS)) return { status: 'damaged' };
    world.player.pos = { x, y };
    world.player.distance = distance;
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
