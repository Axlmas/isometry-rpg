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
  | 'leatherBoots' | 'ironGreaves';

export type ItemDef =
  /** Goes straight to the purse and never takes an inventory slot. */
  | { id: ItemId; kind: 'currency' }
  /** Crafting resource; identical ones share a slot up to `maxStack`. */
  | { id: ItemId; kind: 'material'; maxStack: number }
  | { id: ItemId; kind: 'equipment'; slot: 'weapon'; grade: Grade; damage: readonly [number, number] }
  | { id: ItemId; kind: 'equipment'; slot: Exclude<EquipSlot, 'weapon'>; grade: Grade; defense: number };

const MATERIAL_STACK = 99;

export const ITEMS: Readonly<Record<ItemId, ItemDef>> = {
  coins: { id: 'coins', kind: 'currency' },

  leather: { id: 'leather', kind: 'material', maxStack: MATERIAL_STACK },
  ironOre: { id: 'ironOre', kind: 'material', maxStack: MATERIAL_STACK },
  coal: { id: 'coal', kind: 'material', maxStack: MATERIAL_STACK },
  bone: { id: 'bone', kind: 'material', maxStack: MATERIAL_STACK },
  thread: { id: 'thread', kind: 'material', maxStack: MATERIAL_STACK },

  trainingSword: { id: 'trainingSword', kind: 'equipment', slot: 'weapon', grade: 'none', damage: [9, 14] },
  ironSword: { id: 'ironSword', kind: 'equipment', slot: 'weapon', grade: 'none', damage: [12, 17] },
  soldierBlade: { id: 'soldierBlade', kind: 'equipment', slot: 'weapon', grade: 'd', damage: [16, 23] },

  leatherCap: { id: 'leatherCap', kind: 'equipment', slot: 'helmet', grade: 'none', defense: 1 },
  ironHelm: { id: 'ironHelm', kind: 'equipment', slot: 'helmet', grade: 'd', defense: 2 },

  leatherJerkin: { id: 'leatherJerkin', kind: 'equipment', slot: 'armor', grade: 'none', defense: 1 },
  chainShirt: { id: 'chainShirt', kind: 'equipment', slot: 'armor', grade: 'd', defense: 3 },

  leatherBoots: { id: 'leatherBoots', kind: 'equipment', slot: 'boots', grade: 'none', defense: 1 },
  ironGreaves: { id: 'ironGreaves', kind: 'equipment', slot: 'boots', grade: 'd', defense: 2 },
};

export function isItemId(value: unknown): value is ItemId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ITEMS, value);
}

/** What a new hero starts with. */
export const STARTING_WEAPON: ItemId = 'trainingSword';

// Drop table of an ordinary monster. Chances are percentages of one roll, so
// a kill gives at most one of: a material, plain equipment, D-grade equipment.
export const DROP_COINS: readonly [number, number] = [4, 12];
export const DROP_MATERIAL_CHANCE = 40;
export const DROP_PLAIN_EQUIPMENT_CHANCE = 18;
export const DROP_D_EQUIPMENT_CHANCE = 6;
export const DROP_MATERIAL_COUNT: readonly [number, number] = [1, 2];

export const MATERIAL_IDS: readonly ItemId[] = (Object.keys(ITEMS) as ItemId[]).filter((id) => ITEMS[id].kind === 'material');
/** Equipment that monsters can drop, by grade. The starting weapon is never dropped. */
export function droppableEquipment(grade: Grade): ItemId[] {
  return (Object.keys(ITEMS) as ItemId[]).filter((id) => {
    const def = ITEMS[id];
    return def.kind === 'equipment' && def.grade === grade && id !== STARTING_WEAPON;
  });
}
