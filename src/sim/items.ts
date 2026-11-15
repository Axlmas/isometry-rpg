import type { MonsterKind } from './balance';
import type { WeaponType } from './classes';
import type { RecipeId } from './crafting';
import type { Affix } from './mods';
/**
 * Item catalogue. IDs are stable: saves, rules and drop tables use them, and
 * the client maps them to names and art. Never rename or reuse an ID that has
 * shipped; add a new one instead.
 */

export type Grade = 'none' | 'd';
export const GRADES: readonly Grade[] = ['none', 'd'];

export type EquipSlot = 'weapon' | 'helmet' | 'armor' | 'gloves' | 'boots' | 'ring' | 'amulet';
export const EQUIP_SLOTS: readonly EquipSlot[] = ['weapon', 'helmet', 'armor', 'gloves', 'boots', 'ring', 'amulet'];
/** Jewellery has no defence of its own: all its worth is in its random properties. */
export const JEWELLERY_SLOTS: readonly EquipSlot[] = ['ring', 'amulet'];

export type ItemId =
  | 'coins'
  | 'leather' | 'ironOre' | 'coal' | 'bone' | 'thread'
  | 'trainingSword' | 'ironSword' | 'soldierBlade'
  | 'trainingBow' | 'huntingBow' | 'longbow'
  | 'apprenticeStaff' | 'oakStaff' | 'runedStaff'
  | 'leatherCap' | 'ironHelm'
  | 'leatherJerkin' | 'chainShirt'
  | 'leatherBoots' | 'ironGreaves'
  | 'leatherGloves' | 'ironGauntlets'
  | 'copperRing' | 'silverRing' | 'boneAmulet' | 'silverAmulet'
  | 'firstHuntCharm' | 'packFang' | 'bristleGrips' | 'tuskRing' | 'overseerSignet'
  | 'healthPotion' | 'manaPotion' | 'chargePlain' | 'chargeD'
  | 'crystalD'
  | 'scrollWeaponPlain' | 'scrollArmorPlain' | 'scrollWeaponD' | 'scrollArmorD'
  | 'steelIngot' | 'tannedLeather' | 'cord'
  | 'recipeSoldierBlade' | 'recipeIronHelm' | 'recipeChainShirt' | 'recipeIronGreaves' | 'recipeLongbow' | 'recipeRunedStaff';

export type ConsumableEffect =
  | { kind: 'heal'; amount: number }
  | { kind: 'mana'; amount: number }
  /** Spent one per blow to strengthen it; only works with a weapon of this grade. */
  | { kind: 'charge'; grade: Grade };

/** `price` is what the merchant asks; he pays a share of it when buying from the hero. */
export type ItemDef =
  /** Goes straight to the purse and never takes an inventory slot. */
  | { id: ItemId; kind: 'currency' }
  /** Crafting resource; identical ones share a slot up to `maxStack`. */
  | { id: ItemId; kind: 'material'; maxStack: number; price: number }
  | { id: ItemId; kind: 'consumable'; maxStack: number; price: number; effect: ConsumableEffect }
  /** Read once to learn how to craft something; the hero then remembers it for good. */
  | { id: ItemId; kind: 'recipe'; maxStack: number; price: number; recipe: RecipeId }
  /** Spent at the blacksmith to enchant a weapon or a piece of armour of the given grade. */
  | { id: ItemId; kind: 'scroll'; maxStack: number; price: number; target: 'weapon' | 'armor'; grade: Grade }
  /** `weaponType` decides which class can wield it and how it attacks. */
  | { id: ItemId; kind: 'equipment'; slot: 'weapon'; weaponType: WeaponType; grade: Grade; damage: readonly [number, number]; price: number }
  /** `unique` marks a one-of-a-kind trophy: properties it always has, besides whatever it rolls. Only its own monster drops it. */
  | { id: ItemId; kind: 'equipment'; slot: Exclude<EquipSlot, 'weapon'>; grade: Grade; defense: number; price: number; unique?: readonly Affix[] };

const MATERIAL_STACK = 99;
const POTION_STACK = 99;
const CHARGE_STACK = 9999;

export const ITEMS: Readonly<Record<ItemId, ItemDef>> = {
  coins: { id: 'coins', kind: 'currency' },

  leather: { id: 'leather', kind: 'material', maxStack: MATERIAL_STACK, price: 6 },
  ironOre: { id: 'ironOre', kind: 'material', maxStack: MATERIAL_STACK, price: 8 },
  coal: { id: 'coal', kind: 'material', maxStack: MATERIAL_STACK, price: 5 },
  bone: { id: 'bone', kind: 'material', maxStack: MATERIAL_STACK, price: 4 },
  thread: { id: 'thread', kind: 'material', maxStack: MATERIAL_STACK, price: 5 },

  trainingSword: { id: 'trainingSword', kind: 'equipment', slot: 'weapon', weaponType: 'sword', grade: 'none', damage: [9, 14], price: 20 },
  ironSword: { id: 'ironSword', kind: 'equipment', slot: 'weapon', weaponType: 'sword', grade: 'none', damage: [12, 17], price: 160 },
  soldierBlade: { id: 'soldierBlade', kind: 'equipment', slot: 'weapon', weaponType: 'sword', grade: 'd', damage: [16, 23], price: 900 },

  // Ranged weapons hit a little less hard than swords: their owner fights from a distance.
  trainingBow: { id: 'trainingBow', kind: 'equipment', slot: 'weapon', weaponType: 'bow', grade: 'none', damage: [7, 11], price: 20 },
  huntingBow: { id: 'huntingBow', kind: 'equipment', slot: 'weapon', weaponType: 'bow', grade: 'none', damage: [10, 14], price: 160 },
  longbow: { id: 'longbow', kind: 'equipment', slot: 'weapon', weaponType: 'bow', grade: 'd', damage: [13, 19], price: 900 },

  apprenticeStaff: { id: 'apprenticeStaff', kind: 'equipment', slot: 'weapon', weaponType: 'staff', grade: 'none', damage: [8, 12], price: 20 },
  oakStaff: { id: 'oakStaff', kind: 'equipment', slot: 'weapon', weaponType: 'staff', grade: 'none', damage: [11, 15], price: 160 },
  runedStaff: { id: 'runedStaff', kind: 'equipment', slot: 'weapon', weaponType: 'staff', grade: 'd', damage: [14, 21], price: 900 },

  leatherCap: { id: 'leatherCap', kind: 'equipment', slot: 'helmet', grade: 'none', defense: 1, price: 70 },
  ironHelm: { id: 'ironHelm', kind: 'equipment', slot: 'helmet', grade: 'd', defense: 2, price: 420 },

  leatherJerkin: { id: 'leatherJerkin', kind: 'equipment', slot: 'armor', grade: 'none', defense: 1, price: 110 },
  chainShirt: { id: 'chainShirt', kind: 'equipment', slot: 'armor', grade: 'd', defense: 3, price: 680 },

  leatherBoots: { id: 'leatherBoots', kind: 'equipment', slot: 'boots', grade: 'none', defense: 1, price: 70 },

  leatherGloves: { id: 'leatherGloves', kind: 'equipment', slot: 'gloves', grade: 'none', defense: 1, price: 60 },
  ironGauntlets: { id: 'ironGauntlets', kind: 'equipment', slot: 'gloves', grade: 'd', defense: 2, price: 400 },

  // Jewellery: never sold, only found. It always carries at least one random property.
  copperRing: { id: 'copperRing', kind: 'equipment', slot: 'ring', grade: 'none', defense: 0, price: 90 },
  silverRing: { id: 'silverRing', kind: 'equipment', slot: 'ring', grade: 'd', defense: 0, price: 480 },
  boneAmulet: { id: 'boneAmulet', kind: 'equipment', slot: 'amulet', grade: 'none', defense: 0, price: 90 },
  silverAmulet: { id: 'silverAmulet', kind: 'equipment', slot: 'amulet', grade: 'd', defense: 0, price: 480 },
  // Trophies: each comes from one kind of monster only, and rarely.
  firstHuntCharm: { id: 'firstHuntCharm', kind: 'equipment', slot: 'amulet', grade: 'none', defense: 0, price: 300, unique: [{ stat: 'hp', value: 18 }, { stat: 'speed', value: 4 }] },
  packFang: { id: 'packFang', kind: 'equipment', slot: 'amulet', grade: 'none', defense: 0, price: 700, unique: [{ stat: 'crit', value: 6 }, { stat: 'haste', value: 8 }] },
  bristleGrips: { id: 'bristleGrips', kind: 'equipment', slot: 'gloves', grade: 'none', defense: 2, price: 900, unique: [{ stat: 'power', value: 8 }, { stat: 'hp', value: 25 }] },
  tuskRing: { id: 'tuskRing', kind: 'equipment', slot: 'ring', grade: 'd', defense: 0, price: 1500, unique: [{ stat: 'power', value: 12 }, { stat: 'crit', value: 5 }] },
  overseerSignet: { id: 'overseerSignet', kind: 'equipment', slot: 'ring', grade: 'd', defense: 0, price: 1500, unique: [{ stat: 'defense', value: 3 }, { stat: 'hp', value: 40 }, { stat: 'mp', value: 25 }] },

  healthPotion: { id: 'healthPotion', kind: 'consumable', maxStack: POTION_STACK, price: 25, effect: { kind: 'heal', amount: 60 } },
  manaPotion: { id: 'manaPotion', kind: 'consumable', maxStack: POTION_STACK, price: 30, effect: { kind: 'mana', amount: 40 } },
  chargePlain: { id: 'chargePlain', kind: 'consumable', maxStack: CHARGE_STACK, price: 1, effect: { kind: 'charge', grade: 'none' } },
  chargeD: { id: 'chargeD', kind: 'consumable', maxStack: CHARGE_STACK, price: 3, effect: { kind: 'charge', grade: 'd' } },

  crystalD: { id: 'crystalD', kind: 'material', maxStack: 999, price: 12 },

  // Worked materials: made at the blacksmith's from what monsters drop.
  steelIngot: { id: 'steelIngot', kind: 'material', maxStack: MATERIAL_STACK, price: 40 },
  tannedLeather: { id: 'tannedLeather', kind: 'material', maxStack: MATERIAL_STACK, price: 28 },
  cord: { id: 'cord', kind: 'material', maxStack: MATERIAL_STACK, price: 18 },

  recipeSoldierBlade: { id: 'recipeSoldierBlade', kind: 'recipe', maxStack: MATERIAL_STACK, price: 400, recipe: 'soldierBlade' },
  recipeIronHelm: { id: 'recipeIronHelm', kind: 'recipe', maxStack: MATERIAL_STACK, price: 250, recipe: 'ironHelm' },
  recipeChainShirt: { id: 'recipeChainShirt', kind: 'recipe', maxStack: MATERIAL_STACK, price: 350, recipe: 'chainShirt' },
  recipeIronGreaves: { id: 'recipeIronGreaves', kind: 'recipe', maxStack: MATERIAL_STACK, price: 250, recipe: 'ironGreaves' },
  recipeLongbow: { id: 'recipeLongbow', kind: 'recipe', maxStack: MATERIAL_STACK, price: 400, recipe: 'longbow' },
  recipeRunedStaff: { id: 'recipeRunedStaff', kind: 'recipe', maxStack: MATERIAL_STACK, price: 400, recipe: 'runedStaff' },

  scrollWeaponPlain: { id: 'scrollWeaponPlain', kind: 'scroll', maxStack: MATERIAL_STACK, price: 120, target: 'weapon', grade: 'none' },
  scrollArmorPlain: { id: 'scrollArmorPlain', kind: 'scroll', maxStack: MATERIAL_STACK, price: 60, target: 'armor', grade: 'none' },
  scrollWeaponD: { id: 'scrollWeaponD', kind: 'scroll', maxStack: MATERIAL_STACK, price: 600, target: 'weapon', grade: 'd' },
  scrollArmorD: { id: 'scrollArmorD', kind: 'scroll', maxStack: MATERIAL_STACK, price: 300, target: 'armor', grade: 'd' },

  ironGreaves: { id: 'ironGreaves', kind: 'equipment', slot: 'boots', grade: 'd', defense: 2, price: 420 },
};

export function isItemId(value: unknown): value is ItemId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ITEMS, value);
}

/** The weapon of the default hero (a warrior); other classes start with their own, see classes.ts. */
export const STARTING_WEAPON: ItemId = 'trainingSword';
/** Weapons every new hero of some class starts with. Monsters never drop them. */
export const STARTING_WEAPONS: readonly ItemId[] = ['trainingSword', 'trainingBow', 'apprenticeStaff'];

/** Which charge a weapon of each grade uses. */
export const CHARGE_FOR_GRADE: Readonly<Record<Grade, ItemId>> = { none: 'chargePlain', d: 'chargeD' };

/** Raw materials: the ones monsters drop. Crystals and worked materials are made, not found. */
export const MATERIAL_IDS: readonly ItemId[] = ['leather', 'ironOre', 'coal', 'bone', 'thread'];
/** Recipe items; some monsters drop them, and the blacksmith sells them. */
export const RECIPE_ITEMS: readonly ItemId[] = (Object.keys(ITEMS) as ItemId[]).filter((id) => ITEMS[id].kind === 'recipe');

/** How many crystals an item turns into when it is broken up. Only graded equipment gives any. */
export function crystalsFor(itemId: ItemId): number {
  const def = ITEMS[itemId];
  return def.kind === 'equipment' && def.grade === 'd' ? Math.round(def.price / 30) : 0;
}

/** True for a trophy: a piece of equipment with properties of its own that only one kind of monster drops. */
export function isUnique(itemId: ItemId): boolean {
  const def = ITEMS[itemId];
  return def.kind === 'equipment' && def.slot !== 'weapon' && def.unique !== undefined;
}

/** Equipment that monsters can drop, by grade. Starting weapons are never dropped. */
export function droppableEquipment(grade: Grade): ItemId[] {
  return (Object.keys(ITEMS) as ItemId[]).filter((id) => {
    const def = ITEMS[id];
    return def.kind === 'equipment' && def.grade === grade && !STARTING_WEAPONS.includes(id) && !isUnique(id);
  });
}

/** One line of a monster's drop table: with this chance it drops one of these items, this many. */
export interface DropEntry {
  /** Percent of kills. */
  chance: number;
  /** One of these, each equally likely. */
  items: readonly ItemId[];
  count: readonly [number, number];
}

export interface DropTable {
  /** Every kill leaves this many coins. */
  coins: readonly [number, number];
  /** Besides coins, a kill gives at most one of these. Chances add up to no more than 100. */
  drops: readonly DropEntry[];
  /**
   * The trophy only this kind of monster carries, rolled separately from the
   * rest: `chance` in a thousand from an ordinary one, `elderChance` in a
   * hundred from an elder.
   */
  rare: { itemId: ItemId; chance: number; elderChance: number };
}

const one = [1, 1] as const;
const POTIONS: readonly ItemId[] = ['healthPotion', 'manaPotion'];
const PLAIN_SCROLLS: readonly ItemId[] = ['scrollWeaponPlain', 'scrollArmorPlain', 'scrollArmorPlain'];
const D_SCROLLS: readonly ItemId[] = ['scrollWeaponD', 'scrollArmorD', 'scrollArmorD'];

/**
 * What each kind of monster leaves behind. Beasts give hides and bones; the
 * ghouls of the mines give ore, coal and everything needed for graded gear.
 * The hunter in the village tells the player what is written here.
 */
export const DROP_TABLES: Readonly<Record<MonsterKind, DropTable>> = {
  wolfPup: {
    coins: [1, 4],
    drops: [
      { chance: 40, items: ['leather', 'bone'], count: [1, 1] },
      { chance: 8, items: ['thread'], count: [1, 2] },
      { chance: 5, items: POTIONS, count: one },
      { chance: 3, items: ['leatherCap', 'leatherBoots', 'leatherGloves'], count: one },
    ],
    rare: { itemId: 'firstHuntCharm', chance: 5, elderChance: 15 },
  },
  wolf: {
    coins: [3, 8],
    drops: [
      { chance: 42, items: ['leather', 'bone'], count: [1, 2] },
      { chance: 12, items: ['thread'], count: [1, 2] },
      { chance: 5, items: POTIONS, count: one },
      { chance: 4, items: ['leatherCap', 'leatherBoots', 'leatherGloves', 'leatherJerkin'], count: one },
      { chance: 2, items: ['copperRing', 'boneAmulet'], count: one },
    ],
    rare: { itemId: 'packFang', chance: 3, elderChance: 12 },
  },
  boar: {
    coins: [5, 12],
    drops: [
      { chance: 40, items: ['leather', 'bone'], count: [1, 3] },
      { chance: 10, items: ['thread'], count: [1, 3] },
      { chance: 10, items: droppableEquipment('none'), count: one },
      { chance: 6, items: POTIONS, count: one },
      { chance: 8, items: ['chargePlain'], count: [8, 20] },
      { chance: 3, items: PLAIN_SCROLLS, count: one },
    ],
    rare: { itemId: 'bristleGrips', chance: 3, elderChance: 12 },
  },
  tusker: {
    coins: [9, 20],
    drops: [
      { chance: 36, items: ['leather', 'bone', 'ironOre'], count: [1, 3] },
      { chance: 12, items: droppableEquipment('none'), count: one },
      { chance: 3, items: droppableEquipment('d'), count: one },
      { chance: 7, items: POTIONS, count: one },
      { chance: 8, items: ['chargePlain'], count: [10, 25] },
      { chance: 4, items: PLAIN_SCROLLS, count: one },
      { chance: 1, items: D_SCROLLS, count: one },
    ],
    rare: { itemId: 'tuskRing', chance: 3, elderChance: 12 },
  },
  grunt: {
    coins: [10, 22],
    drops: [
      { chance: 38, items: ['ironOre', 'coal'], count: [1, 3] },
      { chance: 9, items: droppableEquipment('none'), count: one },
      { chance: 6, items: droppableEquipment('d'), count: one },
      { chance: 8, items: POTIONS, count: one },
      { chance: 8, items: ['chargePlain'], count: [10, 25] },
      { chance: 3, items: PLAIN_SCROLLS, count: one },
      { chance: 2, items: D_SCROLLS, count: one },
      { chance: 4, items: RECIPE_ITEMS, count: one },
    ],
    rare: { itemId: 'overseerSignet', chance: 3, elderChance: 12 },
  },
};

export function buyPrice(itemId: ItemId): number {
  const def = ITEMS[itemId];
  return def.kind === 'currency' ? 0 : def.price;
}

/**
 * The merchant pays half the price, rounded down; things worth 1 coin sell for nothing.
 * `worth` is the multiplier of a piece of equipment's quality (see mods.ts).
 */
export function sellPrice(itemId: ItemId, worth = 1): number {
  return Math.floor((buyPrice(itemId) * worth) / 2);
}

export function maxStackOf(itemId: ItemId): number {
  const def = ITEMS[itemId];
  return def.kind === 'equipment' || def.kind === 'currency' ? 1 : def.maxStack;
}
