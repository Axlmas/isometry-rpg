import { type Grade, type ItemDef, JEWELLERY_SLOTS } from './items';
import type { Rng } from './rng';

/**
 * What makes two copies of the same item differ: a quality and a few random
 * properties, rolled when a monster drops the item or the blacksmith makes it.
 * Things bought from a merchant are always plain.
 */

/** Quality and stat IDs are stable: saves use them. */
export type Quality = 'common' | 'fine' | 'rare' | 'epic';
export const QUALITIES: readonly Quality[] = ['common', 'fine', 'rare', 'epic'];

/**
 * hp, mp and defense are plain points; power (damage), crit (chance of a
 * critical blow), haste (attack speed) and speed (walking) are percent.
 */
export type StatId = 'hp' | 'mp' | 'power' | 'defense' | 'crit' | 'haste' | 'speed';
export const STAT_IDS: readonly StatId[] = ['hp', 'mp', 'power', 'defense', 'crit', 'haste', 'speed'];

export interface Affix {
  stat: StatId;
  value: number;
}

export interface ItemMods {
  quality: Quality;
  affixes: Affix[];
}

export const QUALITY: Readonly<Record<Quality, {
  /** How often it comes up, out of 100, on an ordinary drop and on an elder's. */
  weight: number;
  elderWeight: number;
  /** Share added to a weapon's damage. */
  damage: number;
  /** Points added to a piece of armour's defence. */
  defense: number;
  /** How many random properties the item gets. */
  affixes: number;
  /** Multiplier of the price a merchant pays. */
  worth: number;
}>> = {
  common: { weight: 60, elderWeight: 20, damage: 0, defense: 0, affixes: 0, worth: 1 },
  fine: { weight: 28, elderWeight: 45, damage: 0.1, defense: 0, affixes: 1, worth: 1.25 },
  rare: { weight: 10, elderWeight: 27, damage: 0.2, defense: 1, affixes: 2, worth: 1.75 },
  epic: { weight: 2, elderWeight: 8, damage: 0.35, defense: 2, affixes: 3, worth: 3 },
};

/** The range each property is rolled in, by the grade of the item. */
export const AFFIX_RANGE: Readonly<Record<Grade, Readonly<Record<StatId, readonly [number, number]>>>> = {
  none: { hp: [6, 14], mp: [4, 10], power: [2, 5], defense: [1, 1], crit: [1, 3], haste: [2, 5], speed: [2, 4] },
  d: { hp: [12, 26], mp: [8, 18], power: [4, 9], defense: [1, 2], crit: [2, 5], haste: [4, 8], speed: [3, 6] },
};

type Equipment = Extract<ItemDef, { kind: 'equipment' }>;

/** How many properties an item of this quality carries. Jewellery always has one more. */
export function affixCount(def: Equipment, quality: Quality): number {
  return QUALITY[quality].affixes + (JEWELLERY_SLOTS.includes(def.slot) ? 1 : 0);
}

/**
 * Rolls the quality and properties of a freshly made or dropped item.
 * Returns undefined for a plain item (common, no properties). `elder` uses
 * the luckier odds of an elder monster's drop.
 */
export function rollMods(rng: Rng, def: Equipment, elder = false): ItemMods | undefined {
  let roll = rng.int(1, 100);
  let quality: Quality = 'common';
  for (const id of QUALITIES) {
    const weight = elder ? QUALITY[id].elderWeight : QUALITY[id].weight;
    if (roll <= weight) {
      quality = id;
      break;
    }
    roll -= weight;
  }
  const pool = [...STAT_IDS];
  const affixes: Affix[] = [];
  for (let i = affixCount(def, quality); i > 0 && pool.length > 0; i--) {
    const [stat] = pool.splice(rng.int(0, pool.length - 1), 1) as [StatId];
    const [min, max] = AFFIX_RANGE[def.grade][stat];
    affixes.push({ stat, value: rng.int(min, max) });
  }
  return quality === 'common' && affixes.length === 0 ? undefined : { quality, affixes };
}

/** Whether `value` is a well-formed set of properties that this item could really have rolled. */
export function validMods(def: Equipment, value: unknown): value is ItemMods {
  if (typeof value !== 'object' || value === null) return false;
  const { quality, affixes } = value as { quality?: unknown; affixes?: unknown };
  if (!QUALITIES.includes(quality as Quality) || !Array.isArray(affixes)) return false;
  if (affixes.length !== affixCount(def, quality as Quality)) return false;
  if (quality === 'common' && affixes.length === 0) return false; // A plain item carries no mods at all.
  const seen = new Set<unknown>();
  for (const affix of affixes as unknown[]) {
    if (typeof affix !== 'object' || affix === null) return false;
    const { stat, value: amount } = affix as { stat?: unknown; value?: unknown };
    if (!STAT_IDS.includes(stat as StatId) || seen.has(stat)) return false;
    seen.add(stat);
    const [min, max] = AFFIX_RANGE[def.grade][stat as StatId];
    if (!Number.isInteger(amount) || (amount as number) < min || (amount as number) > max) return false;
  }
  return true;
}

export function copyMods(mods: ItemMods | null | undefined): ItemMods | undefined {
  return mods ? { quality: mods.quality, affixes: mods.affixes.map((affix) => ({ ...affix })) } : undefined;
}

/** Multiplier of the merchant's price for an item with these properties. */
export function worthOf(mods: ItemMods | null | undefined): number {
  return mods ? QUALITY[mods.quality].worth : 1;
}
