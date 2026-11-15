import type { RecipeId } from './crafting';
/**
 * Item catalogue. IDs are stable: saves, rules and drop tables use them, and
 * the client maps them to names and art. Never rename or reuse an ID that has
 * shipped; add a new one instead.
 */

export type Grade = 'none' | 'd';
export const GRADES: readonly Grade[] = ['none', 'd'];

export type EquipSlot = 'weapon' | 'helmet' | 'armor' | 'boots';
export const EQUIP_SLOTS: readonly EquipSlot[] = ['weapon', 'helmet', 'armor', 'boots'];

export type ItemId =
  | 'coins'
  | 'leather' | 'ironOre' | 'coal' | 'bone' | 'thread'
  | 'trainingSword' | 'ironSword' | 'soldierBlade'
  | 'leatherCap' | 'ironHelm'
  | 'leatherJerkin' | 'chainShirt'
  | 'leatherBoots' | 'ironGreaves'
  | 'healthPotion' | 'manaPotion' | 'chargePlain' | 'chargeD'
  | 'crystalD'
  | 'scrollWeaponPlain' | 'scrollArmorPlain' | 'scrollWeaponD' | 'scrollArmorD'
  | 'steelIngot' | 'tannedLeather' | 'cord'
  | 'recipeSoldierBlade' | 'recipeIronHelm' | 'recipeChainShirt' | 'recipeIronGreaves';

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
  | { id: ItemId; kind: 'equipment'; slot: 'weapon'; grade: Grade; damage: readonly [number, number]; price: number }
  | { id: ItemId; kind: 'equipment'; slot: Exclude<EquipSlot, 'weapon'>; grade: Grade; defense: number; price: number };

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

  trainingSword: { id: 'trainingSword', kind: 'equipment', slot: 'weapon', grade: 'none', damage: [9, 14], price: 20 },
  ironSword: { id: 'ironSword', kind: 'equipment', slot: 'weapon', grade: 'none', damage: [12, 17], price: 160 },
  soldierBlade: { id: 'soldierBlade', kind: 'equipment', slot: 'weapon', grade: 'd', damage: [16, 23], price: 900 },

  leatherCap: { id: 'leatherCap', kind: 'equipment', slot: 'helmet', grade: 'none', defense: 1, price: 70 },
  ironHelm: { id: 'ironHelm', kind: 'equipment', slot: 'helmet', grade: 'd', defense: 2, price: 420 },

  leatherJerkin: { id: 'leatherJerkin', kind: 'equipment', slot: 'armor', grade: 'none', defense: 1, price: 110 },
  chainShirt: { id: 'chainShirt', kind: 'equipment', slot: 'armor', grade: 'd', defense: 3, price: 680 },

  leatherBoots: { id: 'leatherBoots', kind: 'equipment', slot: 'boots', grade: 'none', defense: 1, price: 70 },
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

  scrollWeaponPlain: { id: 'scrollWeaponPlain', kind: 'scroll', maxStack: MATERIAL_STACK, price: 120, target: 'weapon', grade: 'none' },
  scrollArmorPlain: { id: 'scrollArmorPlain', kind: 'scroll', maxStack: MATERIAL_STACK, price: 60, target: 'armor', grade: 'none' },
  scrollWeaponD: { id: 'scrollWeaponD', kind: 'scroll', maxStack: MATERIAL_STACK, price: 600, target: 'weapon', grade: 'd' },
  scrollArmorD: { id: 'scrollArmorD', kind: 'scroll', maxStack: MATERIAL_STACK, price: 300, target: 'armor', grade: 'd' },

  ironGreaves: { id: 'ironGreaves', kind: 'equipment', slot: 'boots', grade: 'd', defense: 2, price: 420 },
};

export function isItemId(value: unknown): value is ItemId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ITEMS, value);
}

/** What a new hero starts with. */
export const STARTING_WEAPON: ItemId = 'trainingSword';

/** Which charge a weapon of each grade uses. */
export const CHARGE_FOR_GRADE: Readonly<Record<Grade, ItemId>> = { none: 'chargePlain', d: 'chargeD' };

// Drop table of an ordinary monster. Chances are percentages of one roll, so
// a kill gives at most one of the things below, besides coins.
export const DROP_COINS: readonly [number, number] = [4, 12];
export const DROP_MATERIAL_CHANCE = 34;
export const DROP_PLAIN_EQUIPMENT_CHANCE = 15;
export const DROP_D_EQUIPMENT_CHANCE = 5;
export const DROP_POTION_CHANCE = 8;
export const DROP_CHARGES_CHANCE = 10;
export const DROP_SCROLL_CHANCE = 4;
export const DROP_RECIPE_CHANCE = 3;
export const DROP_SCROLLS: readonly ItemId[] = ['scrollWeaponPlain', 'scrollArmorPlain', 'scrollArmorPlain', 'scrollWeaponD', 'scrollArmorD'];
export const DROP_MATERIAL_COUNT: readonly [number, number] = [1, 2];
export const DROP_CHARGES_COUNT: readonly [number, number] = [8, 20];
export const DROP_POTIONS: readonly ItemId[] = ['healthPotion', 'manaPotion'];

export function buyPrice(itemId: ItemId): number {
  const def = ITEMS[itemId];
  return def.kind === 'currency' ? 0 : def.price;
}

/** The merchant pays half the price, rounded down; things worth 1 coin sell for nothing. */
export function sellPrice(itemId: ItemId): number {
  return Math.floor(buyPrice(itemId) / 2);
}

export function maxStackOf(itemId: ItemId): number {
  const def = ITEMS[itemId];
  return def.kind === 'equipment' || def.kind === 'currency' ? 1 : def.maxStack;
}

/** Raw materials: the ones monsters drop. Crystals and worked materials are made, not found. */
export const MATERIAL_IDS: readonly ItemId[] = ['leather', 'ironOre', 'coal', 'bone', 'thread'];
/** Recipe items; monsters drop them now and then, and the blacksmith sells them. */
export const RECIPE_ITEMS: readonly ItemId[] = (Object.keys(ITEMS) as ItemId[]).filter((id) => ITEMS[id].kind === 'recipe');

/** How many crystals an item turns into when it is broken up. Only graded equipment gives any. */
export function crystalsFor(itemId: ItemId): number {
  const def = ITEMS[itemId];
  return def.kind === 'equipment' && def.grade === 'd' ? Math.round(def.price / 30) : 0;
}
/** Equipment that monsters can drop, by grade. The starting weapon is never dropped. */
export function droppableEquipment(grade: Grade): ItemId[] {
  return (Object.keys(ITEMS) as ItemId[]).filter((id) => {
    const def = ITEMS[id];
    return def.kind === 'equipment' && def.grade === grade && id !== STARTING_WEAPON;
  });
}
