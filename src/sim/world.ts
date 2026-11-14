import { clearLine, pushOutOfWalls } from './collision';
import { type GridMap, type Point, type Tile, TILE_FLOOR, TILE_WALL, isWalkable } from './grid';
import { findPath } from './pathfinding';
import { createRng } from './rng';

/** The rules advance in fixed steps so that results do not depend on frame rate. */
export const TICK_MS = 50;
/** Tiles per second. */
export const PLAYER_SPEED = 4.5;
/** The hero is a circle this wide (in tiles) for collisions. Must stay below 0.5. */
export const PLAYER_RADIUS = 0.3;

const ROOM_SIZE = 18;
const PILLAR_CHANCE = 0.12;

export interface Player {
  /** Position in tile units; whole numbers are tile centres. Not bound to the grid. */
  pos: Point;
  /** Direction held on the keyboard or stick: a unit vector, or zero when released. */
  moveDir: Point;
  /** Remaining waypoints of a "go there" order, nearest first. */
  path: Point[];
  /** Total distance walked, in tiles. */
  distance: number;
}

export interface World {
  seed: number;
  tick: number;
  map: GridMap;
  spawn: Point;
  player: Player;
}

export type Command =
  /** Walk to a point, going around walls. */
  | { type: 'moveTo'; x: number; y: number }
  /** Walk in a direction until told otherwise; (0, 0) stops. Cancels `moveTo`. */
  | { type: 'moveDir'; dx: number; dy: number };

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
    player: { pos: { ...spawn }, moveDir: { x: 0, y: 0 }, path: [], distance: 0 },
  };
}

function planRoute(world: World, target: Point): Point[] | null {
  const { player, map } = world;
  if (![target.x, target.y].every(Number.isFinite)) return null;
  const goalTile = { x: Math.round(target.x), y: Math.round(target.y) };
  if (!isWalkable(map, goalTile.x, goalTile.y)) return null; // Walls are not a destination.
  const startTile = { x: Math.round(player.pos.x), y: Math.round(player.pos.y) };
  const tiles = findPath(map, startTile, goalTile);
  if (tiles === null) return null;

  // The grid is only used to find a way around walls. The exact clicked point
  // is the destination, nudged away from a wall if the hero would not fit.
  const destination = pushOutOfWalls(map, target, PLAYER_RADIUS);
  const waypoints: Point[] = [startTile, ...tiles, destination];

  // Drop every waypoint the hero can walk past in a straight line, so the
  // route looks free-form instead of following tile centres.
  const route: Point[] = [];
  let from = player.pos;
  let index = 0;
  while (index < waypoints.length) {
    let furthest = index;
    for (let i = waypoints.length - 1; i > index; i--) {
      if (clearLine(map, from, waypoints[i] as Point, PLAYER_RADIUS)) {
        furthest = i;
        break;
      }
    }
    from = waypoints[furthest] as Point;
    route.push({ ...from });
    index = furthest + 1;
  }
  return route;
}

function applyCommand(world: World, command: Command): void {
  const { player } = world;
  if (command.type === 'moveDir') {
    const length = Math.hypot(command.dx, command.dy);
    // The direction is normalised here so that no input can exceed the speed limit.
    player.moveDir = Number.isFinite(length) && length > 0
      ? { x: command.dx / length, y: command.dy / length }
      : { x: 0, y: 0 };
    if (length > 0) player.path = [];
    return;
  }
  const route = planRoute(world, { x: command.x, y: command.y });
  if (route === null) return;
  player.path = route;
  player.moveDir = { x: 0, y: 0 };
}

/** Advances the world by one tick. Mutates `world`. */
export function step(world: World, commands: readonly Command[] = []): void {
  for (const command of commands) applyCommand(world, command);

  const { player, map } = world;
  const before = { ...player.pos };
  let remaining = (PLAYER_SPEED * TICK_MS) / 1000;

  if (player.moveDir.x !== 0 || player.moveDir.y !== 0) {
    player.pos = pushOutOfWalls(
      map,
      { x: player.pos.x + player.moveDir.x * remaining, y: player.pos.y + player.moveDir.y * remaining },
      PLAYER_RADIUS,
    );
  } else if (player.path.length > 0) {
    while (remaining > 0 && player.path.length > 0) {
      const target = player.path[0] as Point;
      const dx = target.x - player.pos.x;
      const dy = target.y - player.pos.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= remaining) {
        player.pos = { ...target };
        player.path.shift();
        remaining -= distance;
      } else {
        player.pos = { x: player.pos.x + (dx / distance) * remaining, y: player.pos.y + (dy / distance) * remaining };
        remaining = 0;
      }
    }
    player.pos = pushOutOfWalls(map, player.pos, PLAYER_RADIUS);
    // Safety net: if something blocks the route, give up instead of pushing forever.
    if (player.path.length > 0 && Math.hypot(player.pos.x - before.x, player.pos.y - before.y) < 1e-6) player.path = [];
  }

  player.distance += Math.hypot(player.pos.x - before.x, player.pos.y - before.y);
  world.tick += 1;
}

export function isMoving(world: World): boolean {
  const { moveDir, path } = world.player;
  return moveDir.x !== 0 || moveDir.y !== 0 || path.length > 0;
}
