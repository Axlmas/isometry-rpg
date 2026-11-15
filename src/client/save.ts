import {
  type Character, type ClassId, type EquipSlot, type MonsterKind, type RaceId, type ItemId, type ItemMods, type ItemStack, type RecipeId, type SkillId, type World, type ZoneKind,
  CLASSES, ENCHANT_MAX, EQUIP_SLOTS, INVENTORY_SLOTS, ITEMS, MAX_LEVEL, MONSTER_KIND_IDS, NO_ENCHANT, NO_GEAR, RECIPES, SKILLS, PLAYER_RADIUS,
  circleFree, createWorld, isClassId, isItemId, isRaceId, isRecipeId, isSkillId, isZoneKind, maxStackOf, copyMods, validMods, xpToNextLevel,
} from '../sim';

/**
 * Increase when the saved shape changes. While the game is in development an
 * older save is not converted: the player starts a new hero. Once the game
 * has real players, add a migration step here instead.
 */
export const SAVE_VERSION = 13;
const SAVE_KEY = 'isometry-rpg.save';
const LOCALE_KEY = 'isometry-rpg.locale';

/** The subset of the Web Storage API we use; lets tests pass a fake. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface SaveData {
  version: number;
  race: RaceId;
  cls: ClassId;
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
  inventory: Array<{ id: ItemId; count: number; enchant?: number; mods?: ItemMods }>;
  equipment: Record<EquipSlot, ItemId | null>;
  /** Enchantment level of each worn item. */
  enchants: Record<EquipSlot, number>;
  /** Quality and properties of each worn item; null for a plain one. */
  mods: Record<EquipSlot, ItemMods | null>;
  /** Monsters killed, by kind. */
  kills: Record<MonsterKind, number>;
  /** Skills learned from the trainer. */
  skills: SkillId[];
  /** Recipes learned from recipe items. */
  recipes: RecipeId[];
  /** Items lying on the floor. */
  loot: Array<{ id: ItemId; count: number; enchant?: number; mods?: ItemMods; x: number; y: number }>;
}

export type LoadResult =
  | { status: 'none' }
  | { status: 'damaged' }
  /** Written by an earlier version of the game and no longer usable. */
  | { status: 'outdated' }
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
    race: world.player.race,
    cls: world.player.cls,
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
    inventory: world.player.inventory.map((stack) => ({ id: stack.itemId, count: stack.count, ...(stack.enchant ? { enchant: stack.enchant } : {}), ...(stack.mods ? { mods: stack.mods } : {}) })),
    equipment: { ...world.player.equipment },
    enchants: { ...world.player.equipmentEnchant },
    mods: { ...world.player.equipmentMods },
    kills: { ...world.player.kills },
    skills: [...world.player.skills],
    recipes: [...world.player.recipes],
    loot: world.loot.map((loot) => ({ id: loot.itemId, count: loot.count, ...(loot.enchant ? { enchant: loot.enchant } : {}), ...(loot.mods ? { mods: loot.mods } : {}), x: loot.pos.x, y: loot.pos.y })),
  };
  return JSON.stringify(data);
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
  const { enchant, mods } = value;
  const stack: ItemStack = { itemId: value.id, count: value.count };
  if (enchant !== undefined) {
    // Only equipment can be enchanted, and only so far.
    if (def.kind !== 'equipment' || !isInt(enchant) || enchant < 1 || enchant > ENCHANT_MAX) return null;
    stack.enchant = enchant;
  }
  if (mods !== undefined) {
    // Only equipment has a quality, and only properties it could really have rolled.
    if (def.kind !== 'equipment' || !validMods(def, mods)) return null;
    stack.mods = copyMods(mods);
  }
  return stack;
}

function parseCharacter(data: Record<string, unknown>): Character | null {
  const { race, cls, level, xp, coins, inventory, equipment, enchants, mods, skills, recipes, kills } = data;
  if (!isRaceId(race) || !isClassId(cls)) return null;
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
  const worn: Record<EquipSlot, ItemId | null> = { ...NO_GEAR };
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
    // A class can only hold its own kind of weapon.
    if (def.slot === 'weapon' && def.weaponType !== CLASSES[cls].weapon) return null;
    worn[slot] = itemId;
  }
  if (!isRecord(enchants) || Object.keys(enchants).some((slot) => !EQUIP_SLOTS.includes(slot as EquipSlot))) return null;
  const equipmentEnchant: Record<EquipSlot, number> = { ...NO_ENCHANT };
  for (const slot of EQUIP_SLOTS) {
    const value = enchants[slot];
    // An empty slot cannot be enchanted.
    if (!isInt(value) || value < 0 || value > ENCHANT_MAX || (value > 0 && worn[slot] === null)) return null;
    equipmentEnchant[slot] = value;
  }
  if (!isRecord(mods) || Object.keys(mods).some((slot) => !EQUIP_SLOTS.includes(slot as EquipSlot))) return null;
  const equipmentMods: Record<EquipSlot, ItemMods | null> = { ...NO_GEAR };
  for (const slot of EQUIP_SLOTS) {
    const value = mods[slot];
    if (value === null) continue;
    const itemId = worn[slot];
    const def = itemId ? ITEMS[itemId] : null;
    // An empty slot has no properties, and a worn item only ones it could have rolled.
    if (!def || def.kind !== 'equipment' || !validMods(def, value)) return null;
    equipmentMods[slot] = copyMods(value) ?? null;
  }
  if (!isRecord(kills) || Object.keys(kills).length !== MONSTER_KIND_IDS.length) return null;
  const killed = {} as Record<MonsterKind, number>;
  for (const kind of MONSTER_KIND_IDS) {
    const count = kills[kind];
    if (!isInt(count) || count < 0) return null;
    killed[kind] = count;
  }
  // A skill can only have been learned once, and not before its level.
  if (!Array.isArray(skills) || new Set(skills).size !== skills.length) return null;
  if (!skills.every((id) => isSkillId(id) && SKILLS[id].unlockLevel <= level && SKILLS[id].cls === cls)) return null;
  // Only recipes that have to be learned can be in the list, each once.
  if (!Array.isArray(recipes) || new Set(recipes).size !== recipes.length) return null;
  if (!recipes.every((id) => isRecipeId(id) && RECIPES[id].mustLearn)) return null;
  return { race, cls, level, xp, coins, inventory: stacks, equipment: worn, equipmentEnchant, equipmentMods, kills: killed, skills: skills as SkillId[], recipes: recipes as RecipeId[] };
}

/** Saved data can be edited or corrupted, so every field is checked. */
export function parseSave(raw: string | null, dev = false): LoadResult {
  if (raw === null) return { status: 'none' };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 'damaged' };
    const data = parsed as Record<string, unknown>;
    if (isInt(data.version) && data.version >= 1 && data.version < SAVE_VERSION) return { status: 'outdated' };
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
    const world = createWorld(seed, character, dungeonLevel, zone, null, dev);
    if (!isInt(mp) || mp < 0 || mp > world.player.maxMp) return { status: 'damaged' };
    world.player.mp = mp;

    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return { status: 'damaged' };
    // A position inside or overlapping a wall cannot come from normal play.
    if (!circleFree(world.map, { x, y }, PLAYER_RADIUS)) return { status: 'damaged' };
    world.player.pos = { x, y };
    if (!isInt(hp) || hp < 0 || hp > world.player.maxHp) return { status: 'damaged' };
    if (
      !Array.isArray(dead) ||
      !dead.every((id) => isInt(id) && id >= 0 && id < world.monsterTotal) ||
      new Set(dead).size !== dead.length
    ) {
      return { status: 'damaged' };
    }
    if (!isInt(rngState) || rngState < 0 || rngState > 0xffffffff) return { status: 'damaged' };
    world.rngState = rngState;

    const { loot } = data;
    if (!Array.isArray(loot) || loot.length > 500) return { status: 'damaged' };
    for (const entry of loot) {
      const stack = parseStack(entry, true);
      if (!stack || !isRecord(entry) || !isFiniteNumber(entry.x) || !isFiniteNumber(entry.y)) return { status: 'damaged' };
      const pos = { x: entry.x, y: entry.y };
      if (!circleFree(world.map, pos, PLAYER_RADIUS)) return { status: 'damaged' };
      world.loot.push({ id: world.nextLootId, itemId: stack.itemId, count: stack.count, pos, ...(stack.enchant ? { enchant: stack.enchant } : {}), ...(stack.mods ? { mods: stack.mods } : {}) });
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

export function loadWorld(store: KeyValueStore | null, dev = false): LoadResult {
  if (!store) return { status: 'none' };
  try {
    return parseSave(store.getItem(SAVE_KEY), dev);
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

/** Forgets the saved hero; the language choice is kept. */
export function clearSave(store: KeyValueStore | null): void {
  try {
    store?.removeItem(SAVE_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
