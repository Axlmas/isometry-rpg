import { type World, createWorld, isWalkable } from '../sim';

/** Increase when the saved shape changes, and add a migration in `parseSave`. */
export const SAVE_VERSION = 1;
const SAVE_KEY = 'isometry-rpg.save';
const LOCALE_KEY = 'isometry-rpg.locale';

/** The subset of the Web Storage API we use; lets tests pass a fake. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface SaveData {
  version: number;
  seed: number;
  x: number;
  y: number;
  tilesWalked: number;
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
  // The map is not stored: it is rebuilt from the seed. While walking, the
  // player is saved on the nearest tile.
  const data: SaveData = {
    version: SAVE_VERSION,
    seed: world.seed,
    x: Math.round(world.player.pos.x),
    y: Math.round(world.player.pos.y),
    tilesWalked: world.player.tilesWalked,
  };
  return JSON.stringify(data);
}

/** Saved data can be edited or corrupted, so every field is checked. */
export function parseSave(raw: string | null): LoadResult {
  if (raw === null) return { status: 'none' };
  try {
    const data = JSON.parse(raw) as Partial<SaveData> | null;
    const valid =
      data !== null &&
      typeof data === 'object' &&
      data.version === SAVE_VERSION &&
      Number.isInteger(data.seed) &&
      Number.isInteger(data.x) &&
      Number.isInteger(data.y) &&
      Number.isInteger(data.tilesWalked) &&
      (data.tilesWalked as number) >= 0;
    if (!valid) return { status: 'damaged' };
    const world = createWorld(data.seed as number);
    if (!isWalkable(world.map, data.x as number, data.y as number)) return { status: 'damaged' };
    world.player.pos = { x: data.x as number, y: data.y as number };
    world.player.tilesWalked = data.tilesWalked as number;
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
