import { type GridMap, type Point, type Tile, TILE_FLOOR, TILE_WALL, isWalkable } from './grid';
import { findPath } from './pathfinding';
import { createRng } from './rng';

/** The rules advance in fixed steps so that results do not depend on frame rate. */
export const TICK_MS = 50;
/** Tiles per second. */
export const PLAYER_SPEED = 4.5;

const ROOM_SIZE = 18;
const PILLAR_CHANCE = 0.12;

export interface Player {
  /** Position in tile units; whole numbers are tile centres. */
  pos: Point;
  /** Remaining tiles to walk through, nearest first. */
  path: Point[];
  tilesWalked: number;
}

export interface World {
  seed: number;
  tick: number;
  map: GridMap;
  spawn: Point;
  player: Player;
}

export type Command = { type: 'moveTo'; x: number; y: number };

function generateMap(seed: number): { map: GridMap; spawn: Point } {
  const rng = createRng(seed);
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
  return { map, spawn };
}

export function createWorld(seed: number): World {
  const { map, spawn } = generateMap(seed >>> 0);
  return {
    seed: seed >>> 0,
    tick: 0,
    map,
    spawn,
    player: { pos: { ...spawn }, path: [], tilesWalked: 0 },
  };
}

function applyCommand(world: World, command: Command): void {
  const { player, map } = world;
  const goal = { x: command.x, y: command.y };
  // While walking, the player is between two tiles. The new route starts at
  // the tile they are already heading to, so they never leave the grid.
  const next = player.path[0];
  const from = next ?? { x: Math.round(player.pos.x), y: Math.round(player.pos.y) };
  const route = findPath(map, from, goal);
  if (route === null) return; // Walls and unreachable tiles are ignored.
  player.path = next ? [next, ...route] : route;
}

/** Advances the world by one tick. Mutates `world`. */
export function step(world: World, commands: readonly Command[] = []): void {
  for (const command of commands) applyCommand(world, command);

  const { player } = world;
  let remaining = (PLAYER_SPEED * TICK_MS) / 1000;
  while (remaining > 0 && player.path.length > 0) {
    const target = player.path[0] as Point;
    const dx = target.x - player.pos.x;
    const dy = target.y - player.pos.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= remaining) {
      player.pos = { ...target };
      player.path.shift();
      player.tilesWalked += 1;
      remaining -= distance;
    } else {
      player.pos.x += (dx / distance) * remaining;
      player.pos.y += (dy / distance) * remaining;
      remaining = 0;
    }
  }
  world.tick += 1;
}

export function isMoving(world: World): boolean {
  return world.player.path.length > 0;
}
