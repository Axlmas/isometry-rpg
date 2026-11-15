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
export const WORLD_WIDTH = 124;
export const WORLD_HEIGHT = 84;
/** How many monsters live in each region of the open world. */
export const REGION_MONSTERS = { pasture: 40, moor: 46, hollow: 42, thicket: 28 } as const;
/** No two monsters make their home closer than this. */
export const MONSTER_SPACING = 2.4;
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
/** While a blow is being struck and recovered from, the hero walks at this share of full speed: fight or run, not both. */
export const PLAYER_ATTACK_SLOW = 0.4;
/** Kills of one kind of monster that raise the hero's mastery of hunting it, tier by tier. */
export const MASTERY_TIERS: readonly number[] = [10, 50, 200, 1000];
/** Each tier adds this share to damage against that kind... */
export const MASTERY_DAMAGE = 0.05;
/** ...and this many chances in a thousand of its rarest drop. */
export const MASTERY_RARE = 1;
/** A kill within this long of the previous one continues a streak... */
export const STREAK_WINDOW = ticks(12);
/** ...and each kill of a streak after the first adds this share of experience, up to the cap. */
export const STREAK_XP = 0.03;
export const STREAK_CAP = 10;
/** Minimum time between two attacks. */
export const PLAYER_ATTACK_COOLDOWN = ticks(0.45);
/** Health comes back after this long without taking damage... */
export const PLAYER_REGEN_DELAY = ticks(5);
/** ...at one point per this many ticks. */
export const PLAYER_REGEN_INTERVAL = ticks(0.5);

/** Chance of a critical blow without any gear, in percent, the most gear can raise it to, and what it multiplies damage by. */
export const CRIT_BASE = 5;
export const CRIT_MAX = 60;
export const CRIT_MULTIPLIER = 2;
/** However quick the gear, attacks never come faster than this. */
export const PLAYER_ATTACK_COOLDOWN_MIN = ticks(0.2);

// Monsters
/** Kind IDs are stable: saves and rules use them, the client maps them to art. */
export type MonsterKind = 'grunt' | 'wolf' | 'boar' | 'wolfPup' | 'tusker';
export const MONSTER_KIND_IDS: readonly MonsterKind[] = ['wolfPup', 'wolf', 'boar', 'tusker', 'grunt'];
/**
 * How each kind differs from the baseline numbers below: multipliers for
 * health, damage and experience, its speed in tiles per second, and its
 * temper. `aggro` is how far it notices the hero (zero: it minds its own
 * business until hit); `social` is how far its call for help carries to
 * others of its kind.
 */
export const MONSTER_KINDS: Readonly<Record<MonsterKind, { hp: number; damage: number; xp: number; speed: number; aggro: number; social: number }>> = {
  // Young and harmless unless provoked: the first prey of a new hero.
  wolfPup: { hp: 0.6, damage: 0.6, xp: 0.5, speed: 4.1, aggro: 0, social: 0 },
  // Weak alone, but it attacks on sight, cannot be outrun and never comes alone for long.
  wolf: { hp: 0.65, damage: 0.75, xp: 0.6, speed: 4.9, aggro: 3.6, social: 2.8 },
  // Peaceful, slow and tough; hit one and the herd around it turns on the hero.
  boar: { hp: 1.15, damage: 0.95, xp: 0.95, speed: 3.6, aggro: 0, social: 3.2 },
  // A loner that attacks on sight and hits hardest of all the beasts.
  tusker: { hp: 1.45, damage: 1.15, xp: 1.4, speed: 4.3, aggro: 4, social: 0 },
  grunt: { hp: 1, damage: 1, xp: 1, speed: 3.9, aggro: 4.5, social: 3 },
};
/** An elder of any kind attacks on sight from at least this far. */
export const ELDER_AGGRO = 4.5;
/** An idle monster strolls around its home: this far from it, at this share of its speed, resting this long between walks. */
export const WANDER_RADIUS = 3.5;
export const WANDER_SPEED = 0.3;
export const WANDER_REST: readonly [number, number] = [ticks(2), ticks(8)];
/** How many monsters a dungeon holds. */
export const MONSTER_COUNT = 9;
/** A dead open-world monster comes back at its place after this long... */
export const MONSTER_RESPAWN_TIME = ticks(30);
/** ...but not while the hero stands this close to that place. */
export const MONSTER_RESPAWN_CLEARANCE = 7;
/** A monster gives up the chase this far from its place, walks back and heals. */
export const MONSTER_LEASH = 12;
/** Monsters are never placed closer than this to the hero's starting point. */
export const MONSTER_MIN_SPAWN_DISTANCE = 6;
export const MONSTER_RADIUS = 0.3;
/** Health, damage and experience of a monster in a level 1 dungeon... */
export const MONSTER_MAX_HP = 30;
export const MONSTER_XP = 12;
/** ...and the share added by each further dungeon level. */
export const MONSTER_HP_PER_LEVEL = 0.3;
export const MONSTER_DAMAGE_PER_LEVEL = 0.16;
export const MONSTER_XP_PER_LEVEL = 0.3;
export const MONSTER_DAMAGE: readonly [number, number] = [9, 14];
/** A monster starts its attack within this distance... */
export const MONSTER_ATTACK_START = 0.95;
/** ...and the blow lands if the hero is still within this one. */
export const MONSTER_ATTACK_REACH = 1.35;
/** The visible warning before a monster's blow. It keeps after the hero meanwhile, so walking off is not enough. */
export const MONSTER_ATTACK_WINDUP = ticks(0.35);
export const MONSTER_ATTACK_COOLDOWN = ticks(0.7);
/** A hit pushes the monster back this far, unless it has already begun its own blow. */
export const MONSTER_KNOCKBACK = 0.25;
/** Share of monsters, in percent, that are elders: rare, tough, and generous. */
export const ELDER_CHANCE = 6;
/** How an elder differs from an ordinary monster of its kind. */
export const ELDER = { hp: 3, damage: 1.5, xp: 4, coins: 3, drops: 2 } as const;
/** How often a monster re-plans its way around walls. */
export const MONSTER_REPATH_INTERVAL = ticks(0.4);

// Consumables and trade
/** A charged blow deals this many times the normal damage. */
export const CHARGE_DAMAGE_MULTIPLIER = 1.5;
/** After drinking a potion, the next one has to wait this long. */
export const POTION_COOLDOWN = ticks(6);
/** The hero can talk to an NPC while standing this close. */
export const NPC_RANGE = 2.2;
/** The most the hero can buy or sell in one order. */
export const MAX_TRADE_COUNT = 1000;

// Village guards
/** A guard strikes monsters that come this close. */
export const GUARD_RANGE = 3.5;
/** Each blow takes this share of the monster's full health. */
export const GUARD_DAMAGE_SHARE = 0.4;
export const GUARD_COOLDOWN = ticks(0.8);

// Enchanting
/** Up to this level an enchantment always succeeds. */
export const ENCHANT_SAFE = 3;
export const ENCHANT_MAX = 10;
/** Chance of success above the safe level, in percent. On failure the item is destroyed. */
export const ENCHANT_CHANCE = 66;
/** Damage added to a weapon by each enchantment level, by grade. */
export const ENCHANT_WEAPON_BONUS: Readonly<Record<'none' | 'd', number>> = { none: 1, d: 2 };
/** Defence added to a piece of armour by each enchantment level. */
export const ENCHANT_ARMOR_BONUS = 1;
