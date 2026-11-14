import {
  MAX_LEVEL, MONSTER_COUNT, MONSTER_MIN_SPAWN_DISTANCE, PILLAR_CHANCE, ROOM_SIZE,
} from './balance';
import { type GridMap, type Point, type Tile, TILE_FLOOR, TILE_WALL, isWalkable } from './grid';
import { type Character, type ItemStack, newCharacter } from './inventory';
import { type EquipSlot, type ItemId, STARTING_WEAPON } from './items';
import { maxHpAtLevel, maxMpAtLevel, monsterMaxHp } from './progression';
import { createRng } from './rng';
import type { SkillId } from './skills';

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
}

export interface Player {
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
  /** When on, every blow spends a weapon charge and hits harder. */
  chargesOn: boolean;
  /** Ticks until the next potion can be drunk. */
  potionCooldown: number;
  coins: number;
  /** At most INVENTORY_SLOTS stacks. */
  inventory: ItemStack[];
  equipment: Record<EquipSlot, ItemId | null>;
  /** Goes up whenever coins, inventory or equipment change, so the client knows when to redraw them. */
  revision: number;
}

/** An item lying on the floor. */
export interface GroundLoot {
  id: number;
  itemId: ItemId;
  count: number;
  pos: Point;
  /** True while the hero should not pick it up: just dropped, or no room for it. */
  ignored: boolean;
}

/** Monster kinds are stable IDs: saves and rules use them, the client maps them to art and names. */
export type MonsterKind = 'grunt';

export interface Monster {
  /** Stable within a dungeon: the same seed always gives the same monsters. */
  id: number;
  kind: MonsterKind;
  /** Where the monster was placed; it returns here when the hero dies. */
  home: Point;
  pos: Point;
  hp: number;
  maxHp: number;
  /** True once the monster has noticed the hero. */
  aggro: boolean;
  /** Ticks until the started blow lands; zero when not attacking. */
  windup: number;
  cooldown: number;
  /** Next tile centre on the way around walls, or null when walking straight. */
  waypoint: Point | null;
}

/**
 * Things that happened during the last tick. The client turns them into
 * animation, sound and text; they never carry player-readable text.
 */
export type GameEvent =
  | { type: 'playerSwing'; dir: Point; charged: boolean }
  | { type: 'monsterHit'; id: number; damage: number; pos: Point; died: boolean }
  | { type: 'monsterWindup'; id: number }
  | { type: 'playerHit'; damage: number }
  | { type: 'playerDied'; xpLost: number }
  | { type: 'playerHealed'; amount: number }
  | { type: 'xpGained'; amount: number }
  | { type: 'levelUp'; level: number; unlocked: SkillId[] }
  | { type: 'skillUsed'; id: SkillId; dir: Point; charged: boolean }
  | { type: 'itemUsed'; itemId: ItemId }
  | { type: 'useDenied'; itemId: ItemId; reason: 'none' | 'cooldown' | 'notNeeded' }
  /** Charges were asked for but none fit the weapon in hand. */
  | { type: 'chargesEmpty' }
  | { type: 'bought'; itemId: ItemId; count: number; cost: number }
  | { type: 'sold'; itemId: ItemId; count: number; gain: number }
  | { type: 'tradeDenied'; reason: 'far' | 'coins' | 'full' | 'worthless' }
  | { type: 'skillDenied'; id: SkillId; reason: 'locked' | 'cooldown' | 'mana' }
  | { type: 'playerRespawned' }
  | { type: 'lootDropped'; id: number }
  | { type: 'itemPicked'; itemId: ItemId; count: number }
  | { type: 'inventoryFull' };

export interface World {
  seed: number;
  tick: number;
  /** State of the random generator used for combat rolls. */
  rngState: number;
  map: GridMap;
  spawn: Point;
  /** Where the merchant stands; always next to the entrance. Monsters ignore him. */
  merchant: Point;
  player: Player;
  /** Living monsters, ordered by id. */
  monsters: Monster[];
  /** How many monsters this dungeon started with. */
  monsterTotal: number;
  /** Sets how strong this dungeon's monsters are and how much experience they give. */
  dungeonLevel: number;
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
  /** Drink a potion from the bag. */
  | { type: 'use'; itemId: ItemId }
  /** Switch weapon charges on or off. */
  | { type: 'toggleCharges' }
  /** Trade with the merchant; only works next to him. */
  | { type: 'buy'; itemId: ItemId; count: number }
  | { type: 'sell'; index: number; count: number };

/**
 * Builds a dungeon from a seed. Pass the hero's belongings to carry them over
 * from the previous dungeon; without them a new hero is created. The dungeon
 * is as strong as the hero entering it unless a level is given.
 */
export function createWorld(
  seed: number,
  character: Character = newCharacter(STARTING_WEAPON),
  dungeonLevel: number = character.level,
): World {
  const level = Math.min(MAX_LEVEL, Math.max(1, Math.floor(character.level)));
  const monsterHp = monsterMaxHp(dungeonLevel);
  const rng = createRng(seed >>> 0);
  const width = ROOM_SIZE;
  const height = ROOM_SIZE;
  const spawn = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
  const tiles: Tile[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      const nearSpawn = Math.abs(x - spawn.x) <= 1 && Math.abs(y - spawn.y) <= 1;
      const pillar = !border && !nearSpawn && rng.next() < PILLAR_CHANCE;
      tiles.push(border || pillar ? TILE_WALL : TILE_FLOOR);
    }
  }

  // Close off pockets the player could never reach, so that every floor tile
  // the player can see is a valid destination.
  const map: GridMap = { width, height, tiles };
  const reachable = new Array<boolean>(width * height).fill(false);
  const queue: Point[] = [spawn];
  reachable[spawn.y * width + spawn.x] = true;
  while (queue.length > 0) {
    const { x, y } = queue.shift() as Point;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      const index = ny * width + nx;
      if (isWalkable(map, nx, ny) && !reachable[index]) {
        reachable[index] = true;
        queue.push({ x: nx, y: ny });
      }
    }
  }
  for (let i = 0; i < tiles.length; i++) {
    if (!reachable[i]) tiles[i] = TILE_WALL;
  }

  // Monsters stand on distinct floor tiles away from the entrance.
  const candidates: Point[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isWalkable(map, x, y) && Math.hypot(x - spawn.x, y - spawn.y) >= MONSTER_MIN_SPAWN_DISTANCE) {
        candidates.push({ x, y });
      }
    }
  }
  const monsters: Monster[] = [];
  while (monsters.length < MONSTER_COUNT && candidates.length > 0) {
    const [home] = candidates.splice(rng.int(0, candidates.length - 1), 1) as [Point];
    monsters.push({
      id: monsters.length,
      kind: 'grunt',
      home,
      pos: { ...home },
      hp: monsterHp,
      maxHp: monsterHp,
      aggro: false,
      windup: 0,
      cooldown: 0,
      waypoint: null,
    });
  }

  return {
    seed: seed >>> 0,
    tick: 0,
    rngState: rng.state,
    map,
    spawn,
    // The tiles around the entrance are always free, so the merchant never stands in a wall.
    merchant: { x: spawn.x - 1, y: spawn.y - 1 },
    player: {
      pos: { ...spawn },
      moveDir: { x: 0, y: 0 },
      path: [],
      distance: 0,
      hp: maxHpAtLevel(level),
      maxHp: maxHpAtLevel(level),
      level,
      xp: character.xp,
      mp: maxMpAtLevel(level),
      maxMp: maxMpAtLevel(level),
      skillCooldowns: { heavyBlow: 0, sweep: 0, secondWind: 0 },
      chargesOn: false,
      potionCooldown: 0,
      facing: { x: 1, y: 1 },
      attackCooldown: 0,
      pendingAttack: null,
      ticksSinceHurt: 0,
      coins: character.coins,
      inventory: character.inventory.map((stack) => ({ ...stack })),
      equipment: { ...character.equipment },
      revision: 0,
    },
    monsters,
    monsterTotal: monsters.length,
    dungeonLevel,
    loot: [],
    nextLootId: 0,
    events: [],
  };
}

export function isAlive(world: World): boolean {
  return world.player.hp > 0;
}

export function isMoving(world: World): boolean {
  const { moveDir, path } = world.player;
  return moveDir.x !== 0 || moveDir.y !== 0 || path.length > 0;
}
