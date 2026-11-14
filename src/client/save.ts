import {
  type Character, type EquipSlot, type ItemId, type ItemStack, type World,
  EQUIP_SLOTS, INVENTORY_SLOTS, ITEMS, PLAYER_MAX_HP, PLAYER_RADIUS, STARTING_WEAPON,
  characterOf, circleFree, createWorld, isItemId, newCharacter,
} from '../sim';

/** Increase when the saved shape changes, and add a migration in `parseSave`. */
export const SAVE_VERSION = 4;
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
  coins: number;
  inventory: Array<{ id: ItemId; count: number }>;
  equipment: Record<EquipSlot, ItemId | null>;
  /** Items lying on the floor. */
  loot: Array<{ id: ItemId; count: number; x: number; y: number }>;
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
    coins: world.player.coins,
    inventory: world.player.inventory.map((stack) => ({ id: stack.itemId, count: stack.count })),
    equipment: { ...world.player.equipment },
    loot: world.loot.map((loot) => ({ id: loot.itemId, count: loot.count, x: loot.pos.x, y: loot.pos.y })),
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
  // v4 added items: the hero gets the starting weapon and an empty bag.
  if (current.version === 3) {
    current = { ...current, version: 4, coins: 0, inventory: [], equipment: newCharacter(STARTING_WEAPON).equipment, loot: [] };
  }
  return current;
}

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Checks a saved stack: a known item and a count that item allows. */
function parseStack(value: unknown, allowCurrency: boolean): ItemStack | null {
  if (!isRecord(value) || !isItemId(value.id) || !isInt(value.count) || value.count < 1) return null;
  const def = ITEMS[value.id];
  if (def.kind === 'currency' ? !allowCurrency : value.count > (def.kind === 'material' ? def.maxStack : 1)) return null;
  return { itemId: value.id, count: value.count };
}

function parseCharacter(data: Record<string, unknown>): Character | null {
  const { coins, inventory, equipment } = data;
  if (!isInt(coins) || coins < 0) return null;
  if (!Array.isArray(inventory) || inventory.length > INVENTORY_SLOTS || !isRecord(equipment)) return null;
  const stacks: ItemStack[] = [];
  for (const entry of inventory) {
    const stack = parseStack(entry, false);
    if (!stack) return null;
    stacks.push(stack);
  }
  const worn = newCharacter(STARTING_WEAPON).equipment;
  if (Object.keys(equipment).some((slot) => !EQUIP_SLOTS.includes(slot as EquipSlot))) return null;
  for (const slot of EQUIP_SLOTS) {
    const itemId = equipment[slot];
    if (itemId === null) {
      worn[slot] = null;
      continue;
    }
    // An item may only be worn in the slot it was made for.
    if (!isItemId(itemId)) return null;
    const def = ITEMS[itemId];
    if (def.kind !== 'equipment' || def.slot !== slot) return null;
    worn[slot] = itemId;
  }
  return { coins, inventory: stacks, equipment: worn };
}

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
    const character = parseCharacter(data);
    if (!character) return { status: 'damaged' };
    const world = createWorld(seed, character);

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

    const { loot } = data;
    if (!Array.isArray(loot) || loot.length > 500) return { status: 'damaged' };
    for (const entry of loot) {
      const stack = parseStack(entry, true);
      if (!stack || !isRecord(entry) || !isFiniteNumber(entry.x) || !isFiniteNumber(entry.y)) return { status: 'damaged' };
      const pos = { x: entry.x, y: entry.y };
      if (!circleFree(world.map, pos, PLAYER_RADIUS)) return { status: 'damaged' };
      world.loot.push({ id: world.nextLootId, itemId: stack.itemId, count: stack.count, pos, ignored: false });
      world.nextLootId += 1;
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

/** The hero's belongings, to carry into the next dungeon. */
export { characterOf };

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
