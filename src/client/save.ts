import {
  type Character, type EquipSlot, type ItemId, type ItemStack, type SkillId, type World, type ZoneKind,
  ENCHANT_MAX, EQUIP_SLOTS, INVENTORY_SLOTS, ITEMS, MAX_LEVEL, SKILLS, SKILL_IDS, PLAYER_MAX_HP, PLAYER_RADIUS, STARTING_WEAPON,
  circleFree, createWorld, isItemId, isSkillId, isZoneKind, maxStackOf, newCharacter, xpToNextLevel,
} from '../sim';

/** Increase when the saved shape changes, and add a migration in `parseSave`. */
export const SAVE_VERSION = 9;
const SAVE_KEY = 'isometry-rpg.save';
const LOCALE_KEY = 'isometry-rpg.locale';

/** The subset of the Web Storage API we use; lets tests pass a fake. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface SaveData {
  version: number;
  /** Which map the hero is on. */
  zone: ZoneKind;
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
  level: number;
  /** Experience gained towards the next level. */
  xp: number;
  mp: number;
  /** Strength of this dungeon's monsters. */
  dungeonLevel: number;
  /** Whether weapon charges are switched on. */
  chargesOn: boolean;
  coins: number;
  /** `enchant` is the enchantment level of a piece of equipment; left out when zero. */
  inventory: Array<{ id: ItemId; count: number; enchant?: number }>;
  equipment: Record<EquipSlot, ItemId | null>;
  /** Enchantment level of each worn item. */
  enchants: Record<EquipSlot, number>;
  /** Skills learned from the trainer. */
  skills: SkillId[];
  /** Items lying on the floor. */
  loot: Array<{ id: ItemId; count: number; enchant?: number; x: number; y: number }>;
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
  // The map and the monsters' places are not stored: they are rebuilt from the
  // seed. Surviving monsters are back at full health after a reload. Only a
  // dungeon remembers its dead; in the open world monsters come back anyway.
  const alive = new Set(world.monsters.map((monster) => monster.id));
  const dead: number[] = [];
  if (world.zone === 'dungeon') {
    for (let id = 0; id < world.monsterTotal; id++) if (!alive.has(id)) dead.push(id);
  }
  const data: SaveData = {
    version: SAVE_VERSION,
    zone: world.zone,
    seed: world.seed,
    x: world.player.pos.x,
    y: world.player.pos.y,
    distance: world.player.distance,
    hp: world.player.hp,
    dead,
    rngState: world.rngState,
    level: world.player.level,
    xp: world.player.xp,
    mp: world.player.mp,
    dungeonLevel: world.dungeonLevel,
    chargesOn: world.player.chargesOn,
    coins: world.player.coins,
    inventory: world.player.inventory.map((stack) => ({ id: stack.itemId, count: stack.count, ...(stack.enchant ? { enchant: stack.enchant } : {}) })),
    equipment: { ...world.player.equipment },
    enchants: { ...world.player.equipmentEnchant },
    skills: [...world.player.skills],
    loot: world.loot.map((loot) => ({ id: loot.itemId, count: loot.count, ...(loot.enchant ? { enchant: loot.enchant } : {}), x: loot.pos.x, y: loot.pos.y })),
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
  // v5 added levels and mana: everyone starts at level 1 with full mana (null).
  if (current.version === 4) current = { ...current, version: 5, level: 1, xp: 0, mp: null, dungeonLevel: 1 };
  // v6 added consumables; weapon charges start switched off.
  if (current.version === 5) current = { ...current, version: 6, chargesOn: false };
  // v7 added zones; older saves were always inside a dungeon.
  if (current.version === 6) current = { ...current, version: 7, zone: 'dungeon' };
  // v8 joined the village and the field into one open world. A hero saved in
  // either wakes up in the village; a hero in the dungeon stays there.
  if (current.version === 7) {
    current = current.zone === 'dungeon'
      ? { ...current, version: 8 }
      : { ...current, version: 8, zone: 'overworld', x: null, y: null, dead: [], loot: [] };
  }
  // v9 added the trainer and enchanting. Heroes keep the skills they could
  // already use, as if the trainer had taught them; nothing is enchanted yet.
  if (current.version === 8) {
    const level = typeof current.level === 'number' ? current.level : 1;
    current = {
      ...current,
      version: 9,
      skills: SKILL_IDS.filter((id) => SKILLS[id].unlockLevel <= level),
      enchants: { weapon: 0, helmet: 0, armor: 0, boots: 0 },
    };
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
  if (def.kind === 'currency' ? !allowCurrency : value.count > maxStackOf(value.id)) return null;
  const { enchant } = value;
  if (enchant === undefined) return { itemId: value.id, count: value.count };
  // Only equipment can be enchanted, and only so far.
  if (def.kind !== 'equipment' || !isInt(enchant) || enchant < 1 || enchant > ENCHANT_MAX) return null;
  return { itemId: value.id, count: value.count, enchant };
}

function parseCharacter(data: Record<string, unknown>): Character | null {
  const { level, xp, coins, inventory, equipment, enchants, skills } = data;
  if (!isInt(level) || level < 1 || level > MAX_LEVEL) return null;
  // Experience at or above the next level's threshold cannot come from normal play.
  if (!isInt(xp) || xp < 0 || (level < MAX_LEVEL ? xp >= xpToNextLevel(level) : xp !== 0)) return null;
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
  if (!isRecord(enchants) || Object.keys(enchants).some((slot) => !EQUIP_SLOTS.includes(slot as EquipSlot))) return null;
  const equipmentEnchant = { weapon: 0, helmet: 0, armor: 0, boots: 0 };
  for (const slot of EQUIP_SLOTS) {
    const value = enchants[slot];
    // An empty slot cannot be enchanted.
    if (!isInt(value) || value < 0 || value > ENCHANT_MAX || (value > 0 && worn[slot] === null)) return null;
    equipmentEnchant[slot] = value;
  }
  // A skill can only have been learned once, and not before its level.
  if (!Array.isArray(skills) || new Set(skills).size !== skills.length) return null;
  if (!skills.every((id) => isSkillId(id) && SKILLS[id].unlockLevel <= level)) return null;
  return { level, xp, coins, inventory: stacks, equipment: worn, equipmentEnchant, skills: skills as SkillId[] };
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
    const { dungeonLevel, mp, chargesOn, zone } = data;
    if (!isZoneKind(zone)) return { status: 'damaged' };
    if (typeof chargesOn !== 'boolean') return { status: 'damaged' };
    if (!isInt(dungeonLevel) || dungeonLevel < 1 || dungeonLevel > MAX_LEVEL) return { status: 'damaged' };
    const world = createWorld(seed, character, dungeonLevel, zone);
    if (mp !== null) {
      if (!isInt(mp) || mp < 0 || mp > world.player.maxMp) return { status: 'damaged' };
      world.player.mp = mp;
    }

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
      world.loot.push({ id: world.nextLootId, itemId: stack.itemId, count: stack.count, pos, ignored: false, ...(stack.enchant ? { enchant: stack.enchant } : {}) });
      world.nextLootId += 1;
    }

    world.player.distance = distance;
    world.player.chargesOn = chargesOn;
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
