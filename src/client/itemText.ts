import type { MessageKey } from '../i18n';
import type { EquipSlot, Grade, ItemId } from '../sim';

// The rules know items only by ID. These tables turn IDs into translation
// keys. Keys are written out in full so the translation check can find them,
// and the Record types make the compiler complain when an item has no name.

export const ITEM_NAME: Record<Exclude<ItemId, 'coins'>, MessageKey> = {
  leather: 'item.leather',
  ironOre: 'item.ironOre',
  coal: 'item.coal',
  bone: 'item.bone',
  thread: 'item.thread',
  trainingSword: 'item.trainingSword',
  ironSword: 'item.ironSword',
  soldierBlade: 'item.soldierBlade',
  leatherCap: 'item.leatherCap',
  ironHelm: 'item.ironHelm',
  leatherJerkin: 'item.leatherJerkin',
  chainShirt: 'item.chainShirt',
  leatherBoots: 'item.leatherBoots',
  ironGreaves: 'item.ironGreaves',
  healthPotion: 'item.healthPotion',
  manaPotion: 'item.manaPotion',
  chargePlain: 'item.chargePlain',
  chargeD: 'item.chargeD',
  crystalD: 'item.crystalD',
  scrollWeaponPlain: 'item.scrollWeaponPlain',
  scrollArmorPlain: 'item.scrollArmorPlain',
  scrollWeaponD: 'item.scrollWeaponD',
  scrollArmorD: 'item.scrollArmorD',
};

export const SLOT_NAME: Record<EquipSlot, MessageKey> = {
  weapon: 'slot.weapon',
  helmet: 'slot.helmet',
  armor: 'slot.armor',
  boots: 'slot.boots',
};

export const GRADE_NAME: Record<Grade, MessageKey> = {
  none: 'grade.none',
  d: 'grade.d',
};

/** Colours used for an item's grade, on the floor and in the bag. */
export const GRADE_COLOR: Record<Grade, number> = {
  none: 0xcfd3dc,
  d: 0x5fa8ff,
};
