import {
  MONSTER_AGGRO_RANGE, MONSTER_ATTACK_COOLDOWN, MONSTER_ATTACK_REACH, MONSTER_ATTACK_START,
  MONSTER_ATTACK_WINDUP, MONSTER_DAMAGE, MONSTER_KNOCKBACK, MONSTER_RADIUS, MONSTER_REPATH_INTERVAL,
  MONSTER_KINDS, MONSTER_LEASH, MONSTER_RESPAWN_CLEARANCE, MONSTER_RESPAWN_TIME, MIN_DAMAGE_TAKEN, PLAYER_RADIUS, TICK_MS,
} from './balance';
import { clearLine, pushOutOfWalls } from './collision';
import type { Point } from './grid';
import { dropLoot, playerDamage, playerDefense } from './inventory';
import {
  DROP_CHARGES_CHANCE, DROP_CHARGES_COUNT, DROP_COINS, DROP_D_EQUIPMENT_CHANCE, DROP_MATERIAL_CHANCE,
  DROP_MATERIAL_COUNT, DROP_PLAIN_EQUIPMENT_CHANCE, DROP_POTIONS, DROP_POTION_CHANCE, DROP_SCROLLS, DROP_SCROLL_CHANCE,
  MATERIAL_IDS, droppableEquipment,
} from './items';
import { guardDuty } from './npcs';
import { findPath } from './pathfinding';
import { applyDeathPenalty, damageBonusAtLevel, grantXp, monsterDamageBonus, monsterXp } from './progression';
import { createRng } from './rng';
import type { Monster, PendingAttack, World } from './world';
import { regionAt } from './zones';

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
  // Each threshold is the upper end of one outcome's share of the roll.
  const material = DROP_MATERIAL_CHANCE;
  const plain = material + DROP_PLAIN_EQUIPMENT_CHANCE;
  const dGrade = plain + DROP_D_EQUIPMENT_CHANCE;
  const potion = dGrade + DROP_POTION_CHANCE;
  const charges = potion + DROP_CHARGES_CHANCE;
  if (chance <= material) dropLoot(world, pick(world, MATERIAL_IDS), roll(world, DROP_MATERIAL_COUNT), beside);
  else if (chance <= plain) dropLoot(world, pick(world, droppableEquipment('none')), 1, beside);
  else if (chance <= dGrade) dropLoot(world, pick(world, droppableEquipment('d')), 1, beside);
  else if (chance <= potion) dropLoot(world, pick(world, DROP_POTIONS), 1, beside);
  else if (chance <= charges) dropLoot(world, 'chargePlain', roll(world, DROP_CHARGES_COUNT), beside);
  else if (chance <= charges + DROP_SCROLL_CHANCE) dropLoot(world, pick(world, DROP_SCROLLS), 1, beside);
}

/** Removes dead monsters. In the open world they come back after a while; a dungeon stays cleared. */
function buryTheDead(world: World): void {
  if (world.zone === 'overworld') {
    for (const monster of world.monsters) {
      if (monster.hp === 0) world.respawns.push({ ticks: MONSTER_RESPAWN_TIME, monster });
    }
  }
  world.monsters = world.monsters.filter((monster) => monster.hp > 0);
}

/** Lands the hero's blow: damages every monster inside the swing. */
export function resolvePlayerAttack(world: World, attack: PendingAttack): void {
  const { player, map } = world;
  const { dir } = attack;
  const halfArc = attack.arc / 2;
  let xp = 0;
  for (const monster of world.monsters) {
    const dx = monster.pos.x - player.pos.x;
    const dy = monster.pos.y - player.pos.y;
    const distance = Math.hypot(dx, dy);
    if (distance > attack.range + MONSTER_RADIUS) continue;
    // A monster standing on top of the hero is hit whatever the direction.
    if (distance > PLAYER_RADIUS && halfArc < Math.PI) {
      const cos = (dx * dir.x + dy * dir.y) / distance;
      if (Math.acos(Math.min(1, Math.max(-1, cos))) > halfArc) continue;
    }
    // No hitting through walls.
    if (!clearLine(map, player.pos, monster.pos, 0.05)) continue;

    const damage = Math.round(roll(world, playerDamage(player)) * damageBonusAtLevel(player.level) * attack.multiplier);
    monster.hp = Math.max(0, monster.hp - damage);
    monster.aggro = true;
    monster.returning = false;
    monster.windup = 0; // A hit interrupts the monster's own attack.
    if (distance > 0) {
      monster.pos = pushOutOfWalls(
        map,
        { x: monster.pos.x + (dx / distance) * MONSTER_KNOCKBACK, y: monster.pos.y + (dy / distance) * MONSTER_KNOCKBACK },
        MONSTER_RADIUS,
      );
    }
    world.events.push({ type: 'monsterHit', id: monster.id, damage, pos: { ...monster.pos }, died: monster.hp === 0 });
    if (monster.hp === 0) {
      dropMonsterLoot(world, monster.pos);
      xp += monsterXp(monster.level, monster.kind);
    }
  }
  buryTheDead(world);
  grantXp(world, xp);
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
    world.events.push({ type: 'playerDied', xpLost: applyDeathPenalty(world) });
  }
}

/** How many tiles a monster may examine when looking for a way around walls. */
const MONSTER_PATH_BUDGET = 500;

/**
 * Moves a monster one tick towards `target`: straight if nothing is in the
 * way, otherwise around walls. Stops `stopAt` short of the target.
 */
function walkTowards(world: World, monster: Monster, target: Point, stopAt: number): void {
  const { map } = world;
  let aim = target;
  if (clearLine(map, monster.pos, target, MONSTER_RADIUS)) {
    monster.waypoint = null;
  } else {
    // Monsters take turns re-planning so the cost is spread over several ticks.
    if (monster.waypoint === null || (world.tick + monster.id) % MONSTER_REPATH_INTERVAL === 0) {
      const from = { x: Math.round(monster.pos.x), y: Math.round(monster.pos.y) };
      const to = { x: Math.round(target.x), y: Math.round(target.y) };
      monster.waypoint = findPath(map, from, to, MONSTER_PATH_BUDGET)?.[0] ?? null;
    }
    if (monster.waypoint === null) return;
    aim = monster.waypoint;
  }

  const dx = aim.x - monster.pos.x;
  const dy = aim.y - monster.pos.y;
  const toAim = Math.hypot(dx, dy);
  const reach = aim === target ? Math.max(0, toAim - stopAt) : toAim;
  const move = Math.min((MONSTER_KINDS[monster.kind].speed * TICK_MS) / 1000, reach);
  if (toAim === 0 || move <= 0) {
    if (aim !== target) monster.waypoint = null;
    return;
  }
  monster.pos = pushOutOfWalls(
    map,
    { x: monster.pos.x + (dx / toAim) * move, y: monster.pos.y + (dy / toAim) * move },
    MONSTER_RADIUS,
  );
}

/** Makes a monster forget the hero and head home. */
function giveUp(monster: Monster): void {
  monster.aggro = false;
  monster.returning = true;
  monster.windup = 0;
  monster.waypoint = null;
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
    // A monster walking home passes through the hero; otherwise standing in its way would trap it.
    if (overlap > 0 && distance > 0 && !monster.returning) {
      monster.pos = { x: monster.pos.x + (dx / distance) * overlap, y: monster.pos.y + (dy / distance) * overlap };
    }
    monster.pos = pushOutOfWalls(map, monster.pos, MONSTER_RADIUS);
  }
}

/** Brings back dead open-world monsters whose time has come. */
function respawnMonsters(world: World): void {
  if (world.respawns.length === 0) return;
  const { player } = world;
  const waiting: World['respawns'] = [];
  for (const entry of world.respawns) {
    entry.ticks -= 1;
    const { monster } = entry;
    const heroNear = Math.hypot(player.pos.x - monster.home.x, player.pos.y - monster.home.y) < MONSTER_RESPAWN_CLEARANCE;
    if (entry.ticks > 0 || heroNear) {
      waiting.push(entry);
      continue;
    }
    world.monsters.push({
      ...monster,
      pos: { ...monster.home },
      hp: monster.maxHp,
      aggro: false,
      returning: false,
      windup: 0,
      cooldown: 0,
      waypoint: null,
    });
  }
  if (waiting.length === world.respawns.length) return;
  world.respawns = waiting;
  // Keep the list ordered by id, as the rest of the rules expect.
  world.monsters.sort((a, b) => a.id - b.id);
}

/** Advances every monster by one tick: notice the hero, chase, attack, give up, come back. */
export function updateMonsters(world: World): void {
  const { player } = world;
  respawnMonsters(world);
  // Nobody is hunted in a safe place, and the dead are left alone.
  const heroIsPrey = player.hp > 0 && !regionAt(world.zone, player.pos).safe;
  for (const monster of world.monsters) {
    if (monster.cooldown > 0) monster.cooldown -= 1;

    if (monster.returning) {
      const fromHome = Math.hypot(monster.home.x - monster.pos.x, monster.home.y - monster.pos.y);
      if (fromHome < 0.3) {
        monster.returning = false;
        monster.waypoint = null;
        monster.hp = monster.maxHp; // A monster that got away is fresh again.
      } else {
        walkTowards(world, monster, monster.home, 0);
      }
      continue;
    }
    if (!heroIsPrey) {
      if (monster.aggro) giveUp(monster);
      continue;
    }

    const distance = Math.hypot(player.pos.x - monster.pos.x, player.pos.y - monster.pos.y);
    if (!monster.aggro && distance <= MONSTER_AGGRO_RANGE) monster.aggro = true;
    if (!monster.aggro) continue;
    // The leash only matters in the open world; in a dungeon there is nowhere to run.
    if (world.zone === 'overworld' && Math.hypot(monster.home.x - monster.pos.x, monster.home.y - monster.pos.y) > MONSTER_LEASH) {
      giveUp(monster);
      continue;
    }

    if (monster.windup > 0) {
      // The monster stands still while it prepares the blow.
      monster.windup -= 1;
      if (monster.windup === 0) {
        monster.cooldown = MONSTER_ATTACK_COOLDOWN;
        if (distance <= MONSTER_ATTACK_REACH) hurtPlayer(world, Math.round(roll(world, MONSTER_DAMAGE) * monsterDamageBonus(monster.level, monster.kind)));
      }
    } else if (distance <= MONSTER_ATTACK_START && monster.cooldown === 0) {
      monster.windup = MONSTER_ATTACK_WINDUP;
      world.events.push({ type: 'monsterWindup', id: monster.id });
    } else {
      // Stop just short of the hero instead of walking into them.
      walkTowards(world, monster, player.pos, MONSTER_ATTACK_START * 0.85);
    }
  }
  separate(world);
  guardDuty(world);
  buryTheDead(world);
}

/** Puts surviving monsters back where they started, at full health. */
export function resetMonsters(world: World): void {
  for (const monster of world.monsters) {
    monster.pos = { ...monster.home };
    monster.hp = monster.maxHp;
    monster.aggro = false;
    monster.returning = false;
    monster.windup = 0;
    monster.cooldown = 0;
    monster.waypoint = null;
  }
}
