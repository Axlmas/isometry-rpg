import {
  MONSTER_AGGRO_RANGE, MONSTER_ATTACK_COOLDOWN, MONSTER_ATTACK_REACH, MONSTER_ATTACK_START,
  MONSTER_ATTACK_WINDUP, MONSTER_DAMAGE, MONSTER_KNOCKBACK, MONSTER_RADIUS, MONSTER_REPATH_INTERVAL,
  MONSTER_SPEED, MIN_DAMAGE_TAKEN, PLAYER_ATTACK_ARC, PLAYER_ATTACK_RANGE, PLAYER_RADIUS, TICK_MS,
} from './balance';
import { clearLine, pushOutOfWalls } from './collision';
import type { Point } from './grid';
import { dropLoot, playerDamage, playerDefense } from './inventory';
import {
  DROP_COINS, DROP_D_EQUIPMENT_CHANCE, DROP_MATERIAL_CHANCE, DROP_MATERIAL_COUNT, DROP_PLAIN_EQUIPMENT_CHANCE,
  MATERIAL_IDS, droppableEquipment,
} from './items';
import { findPath } from './pathfinding';
import { createRng } from './rng';
import type { Monster, World } from './world';

/** Rolls an integer in [min, max] from the world's own random sequence. */
function roll(world: World, [min, max]: readonly [number, number]): number {
  const rng = createRng(world.rngState);
  const value = rng.int(min, max);
  world.rngState = rng.state;
  return value;
}

function pick<T>(world: World, options: readonly T[]): T {
  return options[roll(world, [0, options.length - 1])] as T;
}

/** Rolls what a dead monster leaves behind and puts it on the floor. */
function dropMonsterLoot(world: World, at: Point): void {
  dropLoot(world, 'coins', roll(world, DROP_COINS), at);
  // Placed slightly apart so both drops are visible.
  const beside = { x: at.x + 0.35, y: at.y + 0.1 };
  const chance = roll(world, [1, 100]);
  if (chance <= DROP_MATERIAL_CHANCE) {
    dropLoot(world, pick(world, MATERIAL_IDS), roll(world, DROP_MATERIAL_COUNT), beside);
  } else if (chance <= DROP_MATERIAL_CHANCE + DROP_PLAIN_EQUIPMENT_CHANCE) {
    dropLoot(world, pick(world, droppableEquipment('none')), 1, beside);
  } else if (chance <= DROP_MATERIAL_CHANCE + DROP_PLAIN_EQUIPMENT_CHANCE + DROP_D_EQUIPMENT_CHANCE) {
    dropLoot(world, pick(world, droppableEquipment('d')), 1, beside);
  }
}

/** Lands the hero's blow: damages every monster inside the swing. */
export function resolvePlayerAttack(world: World, dir: Point): void {
  const { player, map } = world;
  const halfArc = PLAYER_ATTACK_ARC / 2;
  for (const monster of world.monsters) {
    const dx = monster.pos.x - player.pos.x;
    const dy = monster.pos.y - player.pos.y;
    const distance = Math.hypot(dx, dy);
    if (distance > PLAYER_ATTACK_RANGE + MONSTER_RADIUS) continue;
    // A monster standing on top of the hero is hit whatever the direction.
    if (distance > PLAYER_RADIUS) {
      const cos = (dx * dir.x + dy * dir.y) / distance;
      if (Math.acos(Math.min(1, Math.max(-1, cos))) > halfArc) continue;
    }
    // No hitting through walls.
    if (!clearLine(map, player.pos, monster.pos, 0.05)) continue;

    const damage = roll(world, playerDamage(player));
    monster.hp = Math.max(0, monster.hp - damage);
    monster.aggro = true;
    monster.windup = 0; // A hit interrupts the monster's own attack.
    if (distance > 0) {
      monster.pos = pushOutOfWalls(
        map,
        { x: monster.pos.x + (dx / distance) * MONSTER_KNOCKBACK, y: monster.pos.y + (dy / distance) * MONSTER_KNOCKBACK },
        MONSTER_RADIUS,
      );
    }
    world.events.push({ type: 'monsterHit', id: monster.id, damage, pos: { ...monster.pos }, died: monster.hp === 0 });
    if (monster.hp === 0) dropMonsterLoot(world, monster.pos);
  }
  world.monsters = world.monsters.filter((monster) => monster.hp > 0);
}

/** Applies a monster's blow to the hero; armour absorbs part of it. */
function hurtPlayer(world: World, rawDamage: number): void {
  const { player } = world;
  if (player.hp <= 0) return;
  const damage = Math.max(MIN_DAMAGE_TAKEN, rawDamage - playerDefense(player));
  player.hp = Math.max(0, player.hp - damage);
  player.ticksSinceHurt = 0;
  world.events.push({ type: 'playerHit', damage });
  if (player.hp === 0) {
    player.moveDir = { x: 0, y: 0 };
    player.path = [];
    player.pendingAttack = null;
    world.events.push({ type: 'playerDied' });
  }
}

function chase(world: World, monster: Monster, distance: number): void {
  const { player, map } = world;
  let target: Point = player.pos;
  if (clearLine(map, monster.pos, player.pos, MONSTER_RADIUS)) {
    monster.waypoint = null;
  } else {
    // Monsters take turns re-planning so the cost is spread over several ticks.
    if (monster.waypoint === null || (world.tick + monster.id) % MONSTER_REPATH_INTERVAL === 0) {
      const from = { x: Math.round(monster.pos.x), y: Math.round(monster.pos.y) };
      const to = { x: Math.round(player.pos.x), y: Math.round(player.pos.y) };
      monster.waypoint = findPath(map, from, to)?.[0] ?? null;
    }
    if (monster.waypoint === null) return;
    target = monster.waypoint;
  }

  const dx = target.x - monster.pos.x;
  const dy = target.y - monster.pos.y;
  const toTarget = Math.hypot(dx, dy);
  // Stop just short of the hero instead of walking into them.
  const stopAt = target === player.pos ? MONSTER_ATTACK_START * 0.85 : 0;
  const move = Math.min((MONSTER_SPEED * TICK_MS) / 1000, Math.max(0, (target === player.pos ? distance : toTarget) - stopAt));
  if (toTarget === 0 || move <= 0) {
    if (target !== player.pos) monster.waypoint = null;
    return;
  }
  monster.pos = pushOutOfWalls(
    map,
    { x: monster.pos.x + (dx / toTarget) * move, y: monster.pos.y + (dy / toTarget) * move },
    MONSTER_RADIUS,
  );
}

/** Keeps monsters from standing inside each other or inside the hero. */
function separate(world: World): void {
  const { monsters, player, map } = world;
  for (let i = 0; i < monsters.length; i++) {
    const a = monsters[i] as Monster;
    for (let j = i + 1; j < monsters.length; j++) {
      const b = monsters[j] as Monster;
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const distance = Math.hypot(dx, dy);
      const overlap = MONSTER_RADIUS * 2 - distance;
      if (overlap <= 0) continue;
      // Two monsters on exactly the same point are split along a fixed axis.
      const nx = distance > 0 ? dx / distance : 1;
      const ny = distance > 0 ? dy / distance : 0;
      a.pos = { x: a.pos.x - (nx * overlap) / 2, y: a.pos.y - (ny * overlap) / 2 };
      b.pos = { x: b.pos.x + (nx * overlap) / 2, y: b.pos.y + (ny * overlap) / 2 };
    }
  }
  for (const monster of monsters) {
    const dx = monster.pos.x - player.pos.x;
    const dy = monster.pos.y - player.pos.y;
    const distance = Math.hypot(dx, dy);
    const overlap = MONSTER_RADIUS + PLAYER_RADIUS - distance;
    if (overlap > 0 && distance > 0) {
      monster.pos = { x: monster.pos.x + (dx / distance) * overlap, y: monster.pos.y + (dy / distance) * overlap };
    }
    monster.pos = pushOutOfWalls(map, monster.pos, MONSTER_RADIUS);
  }
}

/** Advances every monster by one tick: notice the hero, chase, attack. */
export function updateMonsters(world: World): void {
  const { player } = world;
  const heroAlive = player.hp > 0;
  for (const monster of world.monsters) {
    if (monster.cooldown > 0) monster.cooldown -= 1;
    if (!heroAlive) {
      monster.aggro = false;
      monster.windup = 0;
      continue;
    }
    const distance = Math.hypot(player.pos.x - monster.pos.x, player.pos.y - monster.pos.y);
    if (!monster.aggro && distance <= MONSTER_AGGRO_RANGE) monster.aggro = true;
    if (!monster.aggro) continue;

    if (monster.windup > 0) {
      // The monster stands still while it prepares the blow.
      monster.windup -= 1;
      if (monster.windup === 0) {
        monster.cooldown = MONSTER_ATTACK_COOLDOWN;
        if (distance <= MONSTER_ATTACK_REACH) hurtPlayer(world, roll(world, MONSTER_DAMAGE));
      }
    } else if (distance <= MONSTER_ATTACK_START && monster.cooldown === 0) {
      monster.windup = MONSTER_ATTACK_WINDUP;
      world.events.push({ type: 'monsterWindup', id: monster.id });
    } else {
      chase(world, monster, distance);
    }
  }
  separate(world);
}

/** Puts surviving monsters back where they started, at full health. */
export function resetMonsters(world: World): void {
  for (const monster of world.monsters) {
    monster.pos = { ...monster.home };
    monster.hp = monster.maxHp;
    monster.aggro = false;
    monster.windup = 0;
    monster.cooldown = 0;
    monster.waypoint = null;
  }
}
