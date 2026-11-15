import type { MessageKey } from '../i18n';
import type { EquipSlot, Grade, ItemId, Quality, WeaponType } from '../sim';

export type RecipeItemId = 'recipeSoldierBlade' | 'recipeIronHelm' | 'recipeChainShirt' | 'recipeIronGreaves' | 'recipeLongbow' | 'recipeRunedStaff';

// The rules know items only by ID. These tables turn IDs into translation
// keys. Keys are written out in full so the translation check can find them,
// and the Record types make the compiler complain when an item has no name.

/** Recipe items have no entry here: their name is built from the name of what they make. */
export const ITEM_NAME: Record<Exclude<ItemId, 'coins' | RecipeItemId>, MessageKey> = {
  leather: 'item.leather',
  ironOre: 'item.ironOre',
  coal: 'item.coal',
  bone: 'item.bone',
  thread: 'item.thread',
  trainingSword: 'item.trainingSword',
  ironSword: 'item.ironSword',
  soldierBlade: 'item.soldierBlade',
  trainingBow: 'item.trainingBow',
  huntingBow: 'item.huntingBow',
  longbow: 'item.longbow',
  apprenticeStaff: 'item.apprenticeStaff',
  oakStaff: 'item.oakStaff',
  runedStaff: 'item.runedStaff',
  leatherCap: 'item.leatherCap',
  ironHelm: 'item.ironHelm',
  leatherJerkin: 'item.leatherJerkin',
  chainShirt: 'item.chainShirt',
  leatherBoots: 'item.leatherBoots',
  ironGreaves: 'item.ironGreaves',
  leatherGloves: 'item.leatherGloves',
  ironGauntlets: 'item.ironGauntlets',
  copperRing: 'item.copperRing',
  silverRing: 'item.silverRing',
  boneAmulet: 'item.boneAmulet',
  silverAmulet: 'item.silverAmulet',
  firstHuntCharm: 'item.firstHuntCharm',
  packFang: 'item.packFang',
  bristleGrips: 'item.bristleGrips',
  tuskRing: 'item.tuskRing',
  overseerSignet: 'item.overseerSignet',
  healthPotion: 'item.healthPotion',
  manaPotion: 'item.manaPotion',
  chargePlain: 'item.chargePlain',
  chargeD: 'item.chargeD',
  crystalD: 'item.crystalD',
  scrollWeaponPlain: 'item.scrollWeaponPlain',
  scrollArmorPlain: 'item.scrollArmorPlain',
  scrollWeaponD: 'item.scrollWeaponD',
  scrollArmorD: 'item.scrollArmorD',
  steelIngot: 'item.steelIngot',
  tannedLeather: 'item.tannedLeather',
  cord: 'item.cord',
};

export const SLOT_NAME: Record<EquipSlot, MessageKey> = {
  weapon: 'slot.weapon',
  helmet: 'slot.helmet',
  armor: 'slot.armor',
  gloves: 'slot.gloves',
  boots: 'slot.boots',
  ring: 'slot.ring',
  amulet: 'slot.amulet',
};

/** Kinds of weapon; each class fights with one of them. */
export const WEAPON_NAME: Record<WeaponType, MessageKey> = {
  sword: 'slot.weaponSword',
  bow: 'slot.weaponBow',
  staff: 'slot.weaponStaff',
};

export const GRADE_NAME: Record<Grade, MessageKey> = {
  none: 'grade.none',
  d: 'grade.d',
};

export const QUALITY_NAME: Record<Quality, MessageKey> = {
  common: 'quality.common',
  fine: 'quality.fine',
  rare: 'quality.rare',
  epic: 'quality.epic',
};

/** Colours of an item's quality: its name, its bag cell and its glow on the ground. */
export const QUALITY_COLOR: Record<Quality, number> = {
  common: 0xcfd3dc,
  fine: 0x6fd08c,
  rare: 0x5fa8ff,
  epic: 0xc58bff,
};

/** A trophy's name is written in its own colour, whatever quality it rolled. */
export const UNIQUE_CSS = '#e8a23a';

export function qualityCss(quality: Quality): string {
  return `#${QUALITY_COLOR[quality].toString(16).padStart(6, '0')}`;
}
