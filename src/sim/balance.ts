/**
 * Every tunable number of the game rules lives here.
 * Durations are in ticks (one tick = TICK_MS), distances in tiles.
 */

/** The rules advance in fixed steps so that results do not depend on frame rate. */
export const TICK_MS = 50;
const ticks = (seconds: number): number => Math.round((seconds * 1000) / TICK_MS);

// Maps
/** The open world is always built from this seed, so its geography is the same for everyone. */
export const WORLD_SEED = 20261;
export const WORLD_WIDTH = 100;
export const WORLD_HEIGHT = 60;
/** Share of open-world tiles taken by trees. */
export const WORLD_TREE_CHANCE = 0.06;
export const MOOR_MONSTERS = 36;
export const HOLLOW_MONSTERS = 30;
export const DUNGEON_SIZE = 24;
/** Share of dungeon tiles that are pillars. */
export const PILLAR_CHANCE = 0.1;
/** The mines are never easier than this, however weak the hero who enters. */
export const MINES_MIN_LEVEL = 4;
/** The hero can use an exit while standing this close to it. */
export const EXIT_RANGE = 1.6;
/** In a safe region, one point of health and of mana comes back every this many ticks. */
export const SAFE_REGEN_INTERVAL = ticks(0.1);

// Hero
/** Tiles per second. */
export const PLAYER_SPEED = 4.5;
/** Collision radius. Must stay below 0.5. */
export const PLAYER_RADIUS = 0.3;
/** Health and mana at level 1; each further level adds the per-level amount. */
export const PLAYER_MAX_HP = 100;
export const PLAYER_HP_PER_LEVEL = 15;
export const PLAYER_MAX_MP = 40;
export const PLAYER_MP_PER_LEVEL = 6;
/** One point of mana comes back every this many ticks. */
export const PLAYER_MP_REGEN_INTERVAL = ticks(0.5);
/** Each level above the first adds this share to weapon damage. */
export const PLAYER_DAMAGE_PER_LEVEL = 0.06;

// Levels
export const MAX_LEVEL = 20;
/** Experience to the next level = XP_CURVE_BASE * level ^ XP_CURVE_POWER. */
export const XP_CURVE_BASE = 50;
export const XP_CURVE_POWER = 1.5;
/** Dying costs this share of the experience needed for the current level. */
export const DEATH_XP_LOSS = 0.05;
/** Damage without a weapon. Weapon damage is in items.ts. */
export const UNARMED_DAMAGE: readonly [number, number] = [3, 5];
/** How many different stacks the hero can carry. */
export const INVENTORY_SLOTS = 24;
/** The hero picks up loot lying this close. */
export const LOOT_PICKUP_RADIUS = 0.7;
/** However good the armour, a blow that lands always hurts at least this much. */
export const MIN_DAMAGE_TAKEN = 1;
/** How far the weapon reaches from the hero's centre. */
export const PLAYER_ATTACK_RANGE = 1.35;
/** Full width of the swing, in radians. */
export const PLAYER_ATTACK_ARC = (110 * Math.PI) / 180;
/** Delay between pressing attack and the blow landing. */
export const PLAYER_ATTACK_WINDUP = ticks(0.1);
/** Minimum time between two attacks. */
export const PLAYER_ATTACK_COOLDOWN = ticks(0.45);
/** Health comes back after this long without taking damage... */
export const PLAYER_REGEN_DELAY = ticks(5);
/** ...at one point per this many ticks. */
export const PLAYER_REGEN_INTERVAL = ticks(0.25);

// Monsters
/** Kind IDs are stable: saves and rules use them, the client maps them to art. */
export type MonsterKind = 'grunt' | 'wolf' | 'boar';
/**
 * How each kind differs from the baseline numbers below: multipliers for
 * health, damage and experience, and its own speed in tiles per second.
 */
export const MONSTER_KINDS: Readonly<Record<MonsterKind, { hp: number; damage: number; xp: number; speed: number }>> = {
  grunt: { hp: 1, damage: 1, xp: 1, speed: 2.6 },
  // Field beasts are weaker but quicker: a warm-up before the dungeon.
  wolf: { hp: 0.6, damage: 0.7, xp: 0.5, speed: 3.3 },
  // Slow and tough.
  boar: { hp: 1.1, damage: 0.9, xp: 0.9, speed: 2.4 },
};
/** How many monsters a dungeon holds. */
export const MONSTER_COUNT = 9;
/** A dead open-world monster comes back at its place after this long... */
export const MONSTER_RESPAWN_TIME = ticks(40);
/** ...but not while the hero stands this close to that place. */
export const MONSTER_RESPAWN_CLEARANCE = 7;
/** A monster gives up the chase this far from its place, walks back and heals. */
export const MONSTER_LEASH = 13;
/** Monsters are never placed closer than this to the hero's starting point. */
export const MONSTER_MIN_SPAWN_DISTANCE = 6;
export const MONSTER_RADIUS = 0.3;
/** Health, damage and experience of a monster in a level 1 dungeon... */
export const MONSTER_MAX_HP = 30;
export const MONSTER_XP = 12;
/** ...and the share added by each further dungeon level. */
export const MONSTER_HP_PER_LEVEL = 0.3;
export const MONSTER_DAMAGE_PER_LEVEL = 0.22;
export const MONSTER_XP_PER_LEVEL = 0.3;
export const MONSTER_DAMAGE: readonly [number, number] = [5, 9];
/** A monster notices the hero within this distance. */
export const MONSTER_AGGRO_RANGE = 5.5;
/** A monster starts its attack within this distance... */
export const MONSTER_ATTACK_START = 0.95;
/** ...and the blow lands if the hero is still within this one. */
export const MONSTER_ATTACK_REACH = 1.2;
/** The visible warning before a monster's blow; the hero can step away. */
export const MONSTER_ATTACK_WINDUP = ticks(0.5);
export const MONSTER_ATTACK_COOLDOWN = ticks(0.9);
/** A hit pushes the monster back this far and interrupts its attack. */
export const MONSTER_KNOCKBACK = 0.25;
/** How often a monster re-plans its way around walls. */
export const MONSTER_REPATH_INTERVAL = ticks(0.4);

// Consumables and trade
/** A charged blow deals this many times the normal damage. */
export const CHARGE_DAMAGE_MULTIPLIER = 1.5;
/** After drinking a potion, the next one has to wait this long. */
export const POTION_COOLDOWN = ticks(6);
/** The hero can trade while standing this close to the merchant. */
export const MERCHANT_RANGE = 2.2;
/** The most the hero can buy or sell in one order. */
export const MAX_TRADE_COUNT = 1000;
