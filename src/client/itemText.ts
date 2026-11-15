import type { MessageKey } from '../i18n';
import type { EquipSlot, Grade, ItemId, WeaponType } from '../sim';

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
  boots: 'slot.boots',
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

/** Colours used for an item's grade, on the floor and in the bag. */
export const GRADE_COLOR: Record<Grade, number> = {
  none: 0xcfd3dc,
  d: 0x5fa8ff,
};
