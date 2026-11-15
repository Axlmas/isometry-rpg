import { MAX_LEVEL, type MonsterKind, WORLD_SEED } from './balance';
import type { GridMap, Point } from './grid';
import { type Character, type ItemStack, NO_ENCHANT, NO_GEAR, newCharacter, refreshVitals } from './inventory';
import { type ItemMods, type Quality, copyMods } from './mods';
import { type EquipSlot, type ItemId, STARTING_WEAPON } from './items';
import type { ClassId, RaceId } from './classes';
import type { RecipeId } from './crafting';
import type { DevAction } from './dev';
import type { ItemTarget } from './enchant';
import type { Npc, NpcKind } from './npcs';
import type { Projectile } from './projectiles';
import { monsterMaxHp } from './progression';
import { createRng } from './rng';
import type { SkillId } from './skills';
import { type ZoneExit, type ZoneKind, buildZone } from './zones';

/** A blow on its way: its direction, shape and strength. */
export interface PendingAttack {
  dir: Point;
  /** Ticks until it lands. */
  ticks: number;
  /** Full width of the swing in radians; 2π hits all around. */
  arc: number;
  range: number;
  /** Applied to weapon damage. */
  multiplier: number;
  /** True when a weapon charge was spent on this blow. */
  charged: boolean;
  /** A sweeping blow hits everything in its arc; an ordinary one only the nearest monster. */
  cleave: boolean;
  /** For a ranged attack: how many missiles, how wide the fan, and what they do. Null for a melee blow. */
  shot: { count: number; spread: number; pierce: boolean; splash: number } | null;
}

export interface Player {
  race: RaceId;
  cls: ClassId;
  /** Position in tile units; whole numbers are tile centres. Not bound to the grid. */
  pos: Point;
  /** Direction held on the keyboard or stick: a unit vector, or zero when released. */
  moveDir: Point;
  /** Remaining waypoints of a "go there" order, nearest first. */
  path: Point[];
  /** Total distance walked, in tiles. */
  distance: number;
  /** Zero means the hero is dead and waits for a `respawn` command. */
  hp: number;
  maxHp: number;
  /** Unit vector: where the hero looks and last attacked. */
  facing: Point;
  /** Ticks until the next attack is allowed. */
  attackCooldown: number;
  /** A blow that has been started but has not landed yet. */
  pendingAttack: PendingAttack | null;
  /** Ticks since the hero last took damage; drives health regeneration. */
  ticksSinceHurt: number;
  level: number;
  /** Experience gained towards the next level. */
  xp: number;
  mp: number;
  maxMp: number;
  /** Ticks until each skill can be used again. */
  skillCooldowns: Record<SkillId, number>;
  /** Skills the hero has been taught by the trainer. */
  skills: SkillId[];
  /** Recipes the hero has learned from recipe items. */
  recipes: RecipeId[];
  /** How many monsters the hero has killed in a row without a long pause, and the ticks left to continue the run. */
  streak: number;
  streakTicks: number;
  /** Monsters killed by the hero's own hand, by kind: the measure of hunting mastery. */
  kills: Record<MonsterKind, number>;
  /** Ticks of quickened walking left, and how much quicker. */
  hasteTicks: number;
  hasteFactor: number;
  /** When on, every blow spends a weapon charge and hits harder. */
  chargesOn: boolean;
  /** Ticks until the next potion can be drunk. */
  potionCooldown: number;
  coins: number;
  /** At most INVENTORY_SLOTS stacks. */
  inventory: ItemStack[];
  equipment: Record<EquipSlot, ItemId | null>;
  /** Enchantment level of each worn item. */
  equipmentEnchant: Record<EquipSlot, number>;
  /** Quality and random properties of each worn item; null for a plain one or an empty slot. */
  equipmentMods: Record<EquipSlot, ItemMods | null>;
  /** Goes up whenever coins, inventory or equipment change, so the client knows when to redraw them. */
  revision: number;
}

/** An item lying on the floor. */
export interface GroundLoot {
  id: number;
  itemId: ItemId;
  count: number;
  /** Enchantment level of a piece of equipment; left out when it is zero. */
  enchant?: number;
  /** Quality and properties of a piece of equipment; left out for a plain one. */
  mods?: ItemMods;
  pos: Point;
  /** True while the hero should not pick it up: just dropped, or no room for it. */
  ignored: boolean;
}

export interface Monster {
  /** Stable within a dungeon: the same seed always gives the same monsters. */
  id: number;
  kind: MonsterKind;
  /** Sets its health, damage and the experience it gives. */
  level: number;
  /** A rare, much stronger monster with a richer drop. */
  elder: boolean;
  /** True once it has raised the alarm (or answered one), so an alarm does not spread without end. */
  called: boolean;
  /** Where the monster lives; it returns here when it loses the hero, and comes back here after dying. */
  home: Point;
  pos: Point;
  hp: number;
  maxHp: number;
  /** True once the monster has noticed the hero. */
  aggro: boolean;
  /** True while it walks back home after giving up a chase; it ignores the hero until it arrives. */
  returning: boolean;
  /** Ticks until the started blow lands; zero when not attacking. */
  windup: number;
  cooldown: number;
  /** Ticks of slowed walking left. */
  slowTicks: number;
  /** Next tile centre on the way around walls, or null when walking straight. */
  waypoint: Point | null;
  /** Where an idle monster is strolling to, if anywhere, and the ticks it rests before the next stroll. */
  stroll: Point | null;
  rest: number;
}

/**
 * Things that happened during the last tick. The client turns them into
 * animation, sound and text; they never carry player-readable text.
 */
export type GameEvent =
  | { type: 'playerSwing'; dir: Point; charged: boolean }
  /** The hero loosed an arrow or a bolt (the missiles themselves are in `world.projectiles`). */
  | { type: 'playerShot'; dir: Point; charged: boolean }
  /** A missile hit something or reached the end of its flight. */
  | { type: 'projectileEnded'; id: number; pos: Point; kind: 'arrow' | 'bolt' }
  /** The hero's class cannot wield this weapon. */
  | { type: 'equipDenied'; itemId: ItemId }
  | { type: 'monsterHit'; id: number; damage: number; pos: Point; died: boolean; crit: boolean }
  | { type: 'monsterWindup'; id: number }
  | { type: 'playerHit'; damage: number }
  | { type: 'playerDied'; xpLost: number }
  | { type: 'playerHealed'; amount: number }
  | { type: 'xpGained'; amount: number }
  | { type: 'levelUp'; level: number; unlocked: SkillId[] }
  /** Enough of one kind of monster killed to know it better. */
  | { type: 'masteryUp'; kind: MonsterKind; tier: number }
  | { type: 'skillUsed'; id: SkillId; dir: Point; charged: boolean }
  | { type: 'itemUsed'; itemId: ItemId }
  | { type: 'useDenied'; itemId: ItemId; reason: 'none' | 'cooldown' | 'notNeeded' }
  /** Charges were asked for but none fit the weapon in hand. */
  | { type: 'chargesEmpty' }
  | { type: 'bought'; itemId: ItemId; count: number; cost: number }
  | { type: 'sold'; itemId: ItemId; count: number; gain: number }
  | { type: 'tradeDenied'; reason: 'far' | 'coins' | 'full' | 'worthless' | 'notSold' }
  | { type: 'skillDenied'; id: SkillId; reason: 'locked' | 'unlearned' | 'cooldown' | 'mana' }
  | { type: 'skillLearned'; id: SkillId }
  | { type: 'learnDenied'; id: SkillId; reason: 'far' | 'class' | 'level' | 'coins' }
  | { type: 'enchanted'; itemId: ItemId; level: number }
  /** The attempt failed and the item was destroyed; `level` is what it had. */
  | { type: 'enchantFailed'; itemId: ItemId; level: number; crystals: number }
  | { type: 'enchantDenied'; reason: 'far' | 'scroll' | 'max' }
  | { type: 'crystallized'; itemId: ItemId; crystals: number }
  | { type: 'crystallizeDenied'; reason: 'far' | 'noCrystals' | 'full' }
  | { type: 'recipeLearned'; recipe: RecipeId }
  /** The hero tried to read a recipe they already know. */
  | { type: 'recipeDenied'; recipe: RecipeId }
  | { type: 'crafted'; recipe: RecipeId; itemId: ItemId; count: number; quality?: Quality }
  /** The attempt failed and the ingredients are gone. */
  | { type: 'craftFailed'; recipe: RecipeId }
  | { type: 'craftDenied'; recipe: RecipeId; reason: 'far' | 'unknown' | 'materials' | 'full' }
  | { type: 'guardStrike'; npcId: number; monsterId: number; damage: number; pos: Point; died: boolean }
  | { type: 'playerRespawned' }
  | { type: 'lootDropped'; id: number }
  | { type: 'itemPicked'; itemId: ItemId; count: number; quality?: Quality }
  | { type: 'inventoryFull' }
  /** The hero asked to leave through an exit; the client builds the next zone. */
  | { type: 'travel'; to: ZoneKind };

export interface World {
  seed: number;
  tick: number;
  /** State of the random generator used for combat rolls. */
  rngState: number;
  map: GridMap;
  zone: ZoneKind;
  spawn: Point;
  /** The people of this map: merchants, the trainer, guards. Monsters ignore them. */
  npcs: Npc[];
  exits: ZoneExit[];
  player: Player;
  /** Living monsters, ordered by id. */
  monsters: Monster[];
  /** How many monsters this zone started with. */
  monsterTotal: number;
  /** Dead open-world monsters waiting to come back, with the ticks left. Dungeon monsters stay dead. */
  respawns: Array<{ ticks: number; monster: Monster }>;
  /** Level of a dungeon's monsters. Open-world monsters have the level of their region instead. */
  dungeonLevel: number;
  /** Arrows and bolts in flight. */
  projectiles: Projectile[];
  nextProjectileId: number;
  /** True in development builds: allows the `dev` command. */
  dev: boolean;
  /** Items on the floor, ordered by id. */
  loot: GroundLoot[];
  nextLootId: number;
  /** Replaced on every tick. */
  events: GameEvent[];
}

export type Command =
  /** Walk to a point, going around walls. */
  | { type: 'moveTo'; x: number; y: number }
  /** Walk in a direction until told otherwise; (0, 0) stops. Cancels `moveTo`. */
  | { type: 'moveDir'; dx: number; dy: number }
  /** Strike in a direction. Ignored while the previous attack is cooling down. */
  | { type: 'attack'; dx: number; dy: number }
  /** Return to the entrance with full health. Only works when the hero is dead. */
  /** Use a skill. A zero direction means "where the hero is facing". */
  | { type: 'skill'; id: SkillId; dx: number; dy: number }
  | { type: 'respawn' }
  /** Wear the item in an inventory slot. */
  | { type: 'equip'; index: number }
  /** Move a worn item back to the inventory. */
  | { type: 'unequip'; slot: EquipSlot }
  /** Drop an inventory slot on the floor. */
  | { type: 'drop'; index: number }
  /** Use an item from the bag: drink a potion or read a recipe. */
  | { type: 'use'; itemId: ItemId }
  /** Switch weapon charges on or off. */
  | { type: 'toggleCharges' }
  /** Trade with the merchant; only works next to him. */
  | { type: 'buy'; itemId: ItemId; count: number }
  | { type: 'sell'; index: number; count: number }
  /** Learn a skill from the trainer. */
  | { type: 'learn'; id: SkillId }
  /** Have the blacksmith enchant an item, or break one from the bag into crystals. */
  | { type: 'enchant'; target: ItemTarget }
  | { type: 'crystallize'; index: number }
  /** Have the blacksmith make something from a recipe. */
  | { type: 'craft'; recipe: RecipeId }
  /** Leave through the exit the hero is standing at. */
  | { type: 'travel' }
  /** A testing shortcut; ignored unless the world was created for development. */
  | ({ type: 'dev' } & DevAction);

/** A carried-over amount, forced into [min, max]; anything missing or not a number becomes the maximum. */
function carried(value: number | undefined, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return max;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * Builds a map. Pass the hero's belongings to carry them over; without them
 * a new hero is created. `dungeonLevel` sets the level of a dungeon's monsters
 * (open-world monsters have the level of their region). `from` places the
 * hero at the exit that leads back to the map they came from.
 */
export function createWorld(
  seed: number,
  character: Character = newCharacter(STARTING_WEAPON),
  dungeonLevel: number = character.level,
  zone: ZoneKind = 'dungeon',
  from: ZoneKind | null = null,
  dev = false,
): World {
  const race = character.race ?? 'human';
  const cls = character.cls ?? 'warrior';
  const level = Math.min(MAX_LEVEL, Math.max(1, Math.floor(character.level)));
  const rng = createRng(seed >>> 0);
  // The open world's geography never changes; only a dungeon is shaped by the seed.
  const layout = buildZone(zone, zone === 'overworld' ? createRng(WORLD_SEED) : rng);
  const { map, spawn } = layout;
  const arrival = layout.exits.find((exit) => exit.to === from)?.pos ?? spawn;

  const monsters: Monster[] = layout.monsters.map((spot, id) => {
    const monsterLevel = spot.level ?? dungeonLevel;
    const hp = monsterMaxHp(monsterLevel, spot.kind, spot.elder);
    return {
      id,
      kind: spot.kind,
      level: monsterLevel,
      elder: spot.elder,
      called: false,
      home: spot.home,
      pos: { ...spot.home },
      hp,
      maxHp: hp,
      aggro: false,
      returning: false,
      windup: 0,
      cooldown: 0,
      slowTicks: 0,
      waypoint: null,
      stroll: null,
      // Not everyone sets off at the same moment.
      rest: (id * 37) % 120,
    };
  });

  const world: World = {
    seed: seed >>> 0,
    tick: 0,
    rngState: rng.state,
    map,
    zone,
    spawn,
    npcs: layout.npcs.map((npc, id) => ({ id, kind: npc.kind, pos: npc.pos, cooldown: 0 })),
    exits: layout.exits,
    player: {
      race,
      cls,
      pos: { ...arrival },
      moveDir: { x: 0, y: 0 },
      path: [],
      distance: 0,
      // Carried-over health is kept within sensible bounds; a hero never arrives dead.
      hp: 1,
      maxHp: 1,
      level,
      xp: character.xp,
      mp: 0,
      maxMp: 0,
      skillCooldowns: { heavyBlow: 0, sweep: 0, secondWind: 0, powerShot: 0, volley: 0, swiftness: 0, fireBolt: 0, frostNova: 0, mend: 0 },
      hasteTicks: 0,
      hasteFactor: 1,
      skills: [...(character.skills ?? [])],
      recipes: [...(character.recipes ?? [])],
      streak: 0,
      streakTicks: 0,
      kills: { wolfPup: 0, wolf: 0, boar: 0, tusker: 0, grunt: 0, ...character.kills },
      chargesOn: false,
      potionCooldown: 0,
      facing: { x: 1, y: 1 },
      attackCooldown: 0,
      pendingAttack: null,
      ticksSinceHurt: 0,
      coins: character.coins,
      inventory: character.inventory.map((stack) => ({ ...stack })),
      equipment: { ...NO_GEAR, ...character.equipment },
      equipmentEnchant: { ...NO_ENCHANT, ...character.equipmentEnchant },
      equipmentMods: {
        weapon: copyMods(character.equipmentMods?.weapon) ?? null,
        helmet: copyMods(character.equipmentMods?.helmet) ?? null,
        armor: copyMods(character.equipmentMods?.armor) ?? null,
        gloves: copyMods(character.equipmentMods?.gloves) ?? null,
        boots: copyMods(character.equipmentMods?.boots) ?? null,
        ring: copyMods(character.equipmentMods?.ring) ?? null,
        amulet: copyMods(character.equipmentMods?.amulet) ?? null,
      },
      revision: 0,
    },
    monsters,
    monsterTotal: monsters.length,
    respawns: [],
    dungeonLevel,
    projectiles: [],
    nextProjectileId: 0,
    dev,
    loot: [],
    nextLootId: 0,
    events: [],
  };
  // Maximum health and mana depend on what the hero wears.
  const { player } = world;
  refreshVitals(player);
  player.hp = carried(character.hp, 1, player.maxHp);
  player.mp = carried(character.mp, 0, player.maxMp);
  return world;
}

export function isAlive(world: World): boolean {
  return world.player.hp > 0;
}

export function isMoving(world: World): boolean {
  const { moveDir, path } = world.player;
  return moveDir.x !== 0 || moveDir.y !== 0 || path.length > 0;
}

export type { NpcKind };
