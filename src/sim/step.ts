import {
  PLAYER_ATTACK_COOLDOWN, PLAYER_ATTACK_WINDUP, PLAYER_RADIUS, PLAYER_REGEN_DELAY, PLAYER_REGEN_INTERVAL,
  PLAYER_SPEED, TICK_MS,
} from './balance';
import { clearLine, pushOutOfWalls } from './collision';
import { resetMonsters, resolvePlayerAttack, updateMonsters } from './combat';
import { type Point, isWalkable } from './grid';
import { findPath } from './pathfinding';
import type { Command, World } from './world';

/** Returns the unit vector for a direction, or null when it is zero or not a number. */
function normalize(dx: number, dy: number): Point | null {
  const length = Math.hypot(dx, dy);
  return Number.isFinite(length) && length > 0 ? { x: dx / length, y: dy / length } : null;
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
  if (command.type === 'respawn') {
    if (player.hp > 0) return;
    player.pos = { ...world.spawn };
    player.hp = player.maxHp;
    player.attackCooldown = 0;
    player.ticksSinceHurt = 0;
    resetMonsters(world);
    world.events.push({ type: 'playerRespawned' });
    return;
  }
  if (player.hp <= 0) return; // The dead take no orders.

  switch (command.type) {
    case 'moveDir': {
      // Normalised here so that no input can exceed the speed limit.
      const dir = normalize(command.dx, command.dy);
      player.moveDir = dir ?? { x: 0, y: 0 };
      if (dir) player.path = [];
      return;
    }
    case 'moveTo': {
      const route = planRoute(world, { x: command.x, y: command.y });
      if (route === null) return;
      player.path = route;
      player.moveDir = { x: 0, y: 0 };
      return;
    }
    case 'attack': {
      const dir = normalize(command.dx, command.dy);
      if (dir === null || player.attackCooldown > 0) return;
      player.facing = dir;
      player.attackCooldown = PLAYER_ATTACK_COOLDOWN;
      player.pendingAttack = { dir, ticks: PLAYER_ATTACK_WINDUP };
      world.events.push({ type: 'playerSwing', dir });
      return;
    }
  }
}

function movePlayer(world: World): void {
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

  const dx = player.pos.x - before.x;
  const dy = player.pos.y - before.y;
  const walked = Math.hypot(dx, dy);
  player.distance += walked;
  // The hero looks where they walk, unless a swing is in progress.
  if (walked > 1e-6 && player.pendingAttack === null && player.attackCooldown === 0) {
    player.facing = { x: dx / walked, y: dy / walked };
  }
}

/** Advances the world by one tick. Mutates `world`. */
export function step(world: World, commands: readonly Command[] = []): void {
  world.events = [];
  for (const command of commands) applyCommand(world, command);

  const { player } = world;
  if (player.hp > 0) {
    movePlayer(world);

    if (player.attackCooldown > 0) player.attackCooldown -= 1;
    if (player.pendingAttack) {
      player.pendingAttack.ticks -= 1;
      if (player.pendingAttack.ticks <= 0) {
        const { dir } = player.pendingAttack;
        player.pendingAttack = null;
        resolvePlayerAttack(world, dir);
      }
    }
  }

  updateMonsters(world);

  if (player.hp > 0) {
    player.ticksSinceHurt += 1;
    if (
      player.hp < player.maxHp &&
      player.ticksSinceHurt >= PLAYER_REGEN_DELAY &&
      (player.ticksSinceHurt - PLAYER_REGEN_DELAY) % PLAYER_REGEN_INTERVAL === 0
    ) {
      player.hp += 1;
    }
  }
  world.tick += 1;
}
