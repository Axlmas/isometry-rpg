import type { ItemId } from './items';

/** Race and class IDs are stable: saves refer to them. */
export type RaceId = 'human' | 'elf';
export type ClassId = 'warrior' | 'archer' | 'mage';
/** What kind of weapon a class fights with; it decides how the basic attack works. */
export type WeaponType = 'sword' | 'bow' | 'staff';

export const RACE_IDS: readonly RaceId[] = ['human', 'elf'];
export const CLASS_IDS: readonly ClassId[] = ['warrior', 'archer', 'mage'];

/**
 * How a race changes the hero: multipliers for health, mana and walking
 * speed. The human is the baseline that the level tables are written for.
 */
export const RACES: Readonly<Record<RaceId, { hp: number; mp: number; speed: number }>> = {
  human: { hp: 1, mp: 1, speed: 1 },
  // Lighter on their feet and more gifted with magic, but less sturdy.
  elf: { hp: 0.9, mp: 1.15, speed: 1.06 },
};

/**
 * How a class changes the hero: multipliers for health and mana, the weapon
 * it fights with and the weapon a new hero starts with. The warrior is the
 * baseline.
 */
export const CLASSES: Readonly<Record<ClassId, { hp: number; mp: number; weapon: WeaponType; startingWeapon: ItemId }>> = {
  warrior: { hp: 1, mp: 1, weapon: 'sword', startingWeapon: 'trainingSword' },
  archer: { hp: 0.88, mp: 1.1, weapon: 'bow', startingWeapon: 'trainingBow' },
  mage: { hp: 0.75, mp: 1.8, weapon: 'staff', startingWeapon: 'apprenticeStaff' },
};

export const isRaceId = (value: unknown): value is RaceId => typeof value === 'string' && (RACE_IDS as readonly string[]).includes(value);
export const isClassId = (value: unknown): value is ClassId => typeof value === 'string' && (CLASS_IDS as readonly string[]).includes(value);

/** How ranged weapons fire: reach in tiles, flight speed in tiles per second, and whether the missile is an arrow or a bolt of magic. */
export const RANGED: Readonly<Record<Exclude<WeaponType, 'sword'>, { range: number; speed: number; kind: 'arrow' | 'bolt' }>> = {
  bow: { range: 7.5, speed: 15, kind: 'arrow' },
  staff: { range: 6.5, speed: 11, kind: 'bolt' },
};
