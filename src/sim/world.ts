import {
  MONSTER_COUNT, MONSTER_MAX_HP, MONSTER_MIN_SPAWN_DISTANCE, PILLAR_CHANCE, PLAYER_MAX_HP, ROOM_SIZE,
} from './balance';
import { type GridMap, type Point, type Tile, TILE_FLOOR, TILE_WALL, isWalkable } from './grid';
import { createRng } from './rng';

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
  pendingAttack: { dir: Point; ticks: number } | null;
  /** Ticks since the hero last took damage; drives health regeneration. */
  ticksSinceHurt: number;
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
  | { type: 'playerSwing'; dir: Point }
  | { type: 'monsterHit'; id: number; damage: number; pos: Point; died: boolean }
  | { type: 'monsterWindup'; id: number }
  | { type: 'playerHit'; damage: number }
  | { type: 'playerDied' }
  | { type: 'playerRespawned' };

export interface World {
  seed: number;
  tick: number;
  /** State of the random generator used for combat rolls. */
  rngState: number;
  map: GridMap;
  spawn: Point;
  player: Player;
  /** Living monsters, ordered by id. */
  monsters: Monster[];
  /** How many monsters this dungeon started with. */
  monsterTotal: number;
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
  | { type: 'respawn' };

export function createWorld(seed: number): World {
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
      hp: MONSTER_MAX_HP,
      maxHp: MONSTER_MAX_HP,
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
    player: {
      pos: { ...spawn },
      moveDir: { x: 0, y: 0 },
      path: [],
      distance: 0,
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      facing: { x: 1, y: 1 },
      attackCooldown: 0,
      pendingAttack: null,
      ticksSinceHurt: 0,
    },
    monsters,
    monsterTotal: monsters.length,
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
