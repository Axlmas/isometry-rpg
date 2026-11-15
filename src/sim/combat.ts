import {
  CRIT_MULTIPLIER, STREAK_CAP, STREAK_WINDOW, STREAK_XP, ELDER, ELDER_AGGRO, ELDER_CHANCE, MASTERY_DAMAGE, MASTERY_RARE, WANDER_RADIUS, WANDER_REST, WANDER_SPEED,
  MONSTER_ATTACK_COOLDOWN, MONSTER_ATTACK_REACH, MONSTER_ATTACK_START,
  MONSTER_ATTACK_WINDUP, MONSTER_DAMAGE, MONSTER_KNOCKBACK, MONSTER_RADIUS, MONSTER_REPATH_INTERVAL,
  MONSTER_KINDS, MONSTER_LEASH, MONSTER_RESPAWN_CLEARANCE, MONSTER_RESPAWN_TIME, MIN_DAMAGE_TAKEN, PLAYER_RADIUS, TICK_MS,
} from './balance';
import { clearLine, pushOutOfWalls } from './collision';
import type { Point } from './grid';
import { critChance, dropLoot, gearStats, masteryTier, playerDamage, playerDefense } from './inventory';
import { DROP_TABLES, ITEMS } from './items';
import { rollMods } from './mods';
import { guardDuty } from './npcs';
import { findPath } from './pathfinding';
import { applyDeathPenalty, damageBonusAtLevel, grantXp, monsterDamageBonus, monsterMaxHp, monsterXp } from './progression';
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

/** Rolls what a dead monster leaves behind, by its kind's drop table, and puts it on the floor. */
function dropMonsterLoot(world: World, monster: Monster): void {
  const table = DROP_TABLES[monster.kind];
  dropLoot(world, 'coins', roll(world, table.coins) * (monster.elder ? ELDER.coins : 1), monster.pos);
  // An elder rolls the table more than once.
  for (let i = 0; i < (monster.elder ? ELDER.drops : 1); i++) {
    // One roll decides which line of the table comes up, if any.
    let chance = roll(world, [1, 100]);
    for (const entry of table.drops) {
      if (chance <= entry.chance) {
        const itemId = pick(world, entry.items);
        const count = roll(world, entry.count);
        const def = ITEMS[itemId];
        // Every dropped piece of equipment is its own: quality and properties are rolled here.
        const rng = createRng(world.rngState);
        const mods = def.kind === 'equipment' ? rollMods(rng, def, monster.elder) : undefined;
        world.rngState = rng.state;
        // Placed slightly apart from the coins so every drop is visible.
        dropLoot(world, itemId, count, { x: monster.pos.x + 0.35 - i * 0.7, y: monster.pos.y + 0.1 }, false, 0, mods);
        break;
      }
      chance -= entry.chance;
    }
  }
  // The trophy is rolled apart from everything else. Knowing the beast well makes it a little likelier.
  const { rare } = table;
  const tier = masteryTier(world.player.kills[monster.kind]);
  const found = monster.elder ? roll(world, [1, 100]) <= rare.elderChance : roll(world, [1, 1000]) <= rare.chance + tier * MASTERY_RARE;
  if (found) {
    const def = ITEMS[rare.itemId];
    const rng = createRng(world.rngState);
    const mods = def.kind === 'equipment' ? rollMods(rng, def, true) : undefined;
    world.rngState = rng.state;
    dropLoot(world, rare.itemId, 1, { x: monster.pos.x, y: monster.pos.y + 0.45 }, false, 0, mods);
  }
}

/** Removes dead monsters. In the open world they come back after a while; a dungeon stays cleared. */
export function buryTheDead(world: World): void {
  if (world.zone === 'overworld') {
    for (const monster of world.monsters) {
      if (monster.hp === 0) world.respawns.push({ ticks: MONSTER_RESPAWN_TIME, monster });
    }
  }
  world.monsters = world.monsters.filter((monster) => monster.hp > 0);
}

/** What a streak of this many kills multiplies experience by. */
export function streakBonus(streak: number): number {
  return 1 + Math.min(STREAK_CAP, Math.max(0, streak - 1)) * STREAK_XP;
}

/**
 * The hero damages one monster: rolls the weapon's damage, applies the
 * multiplier and pushes the monster along `push`; a critical blow also interrupts its attack.
 * Returns the experience earned (zero unless it died). The caller removes
 * the dead and grants the experience once all hits of the tick are done.
 */
export function hitMonster(world: World, monster: Monster, multiplier: number, push: Point): number {
  const { player, map } = world;
  const crit = roll(world, [1, 100]) <= critChance(player);
  const mastery = 1 + masteryTier(player.kills[monster.kind]) * MASTERY_DAMAGE;
  const power = (1 + gearStats(player).power / 100) * (crit ? CRIT_MULTIPLIER : 1) * mastery;
  const damage = Math.max(1, Math.round(roll(world, playerDamage(player)) * damageBonusAtLevel(player.level) * multiplier * power));
  monster.hp = Math.max(0, monster.hp - damage);
  monster.aggro = true;
  monster.returning = false;
  // Only a critical blow staggers a monster out of its own attack, and an elder not even then.
  if (crit && !monster.elder) monster.windup = 0;
  const length = Math.hypot(push.x, push.y);
  // An elder is too heavy to be pushed about.
  if (length > 0 && !monster.elder) {
    monster.pos = pushOutOfWalls(
      map,
      { x: monster.pos.x + (push.x / length) * MONSTER_KNOCKBACK, y: monster.pos.y + (push.y / length) * MONSTER_KNOCKBACK },
      MONSTER_RADIUS,
    );
  }
  world.events.push({ type: 'monsterHit', id: monster.id, damage, pos: { ...monster.pos }, died: monster.hp === 0, crit });
  if (monster.hp > 0) return 0;
  dropMonsterLoot(world, monster);
  // Every kill by the hero's own hand counts towards knowing this kind of beast.
  const before = masteryTier(player.kills[monster.kind]);
  player.kills[monster.kind] += 1;
  const tier = masteryTier(player.kills[monster.kind]);
  if (tier > before) world.events.push({ type: 'masteryUp', kind: monster.kind, tier });
  player.revision += 1;
  // Killing without long pauses pays: each kill of a streak gives a little more experience.
  player.streak = player.streakTicks > 0 ? player.streak + 1 : 1;
  player.streakTicks = STREAK_WINDOW;
  return Math.round(monsterXp(monster.level, monster.kind, monster.elder) * streakBonus(player.streak));
}

/**
 * The hero damages every monster within `radius` of a point, unless a wall is
 * in the way, and slows them for `slow` ticks. `except` skips one monster
 * (the one a missile already hit). With `settle` the dead are removed and the
 * experience granted here; without it the caller does that. Returns the
 * experience earned.
 */
export function hitMonstersAround(world: World, centre: Point, radius: number, multiplier: number, slow: number, except = -1, settle = true): number {
  let xp = 0;
  for (const monster of world.monsters) {
    if (monster.hp <= 0 || monster.id === except) continue;
    const dx = monster.pos.x - centre.x;
    const dy = monster.pos.y - centre.y;
    if (Math.hypot(dx, dy) > radius + MONSTER_RADIUS) continue;
    if (!clearLine(world.map, centre, monster.pos, 0.05)) continue;
    xp += hitMonster(world, monster, multiplier, { x: dx, y: dy });
    if (slow > 0) monster.slowTicks = slow;
  }
  if (settle) {
    buryTheDead(world);
    grantXp(world, xp);
  }
  return xp;
}

/**
 * Lands the hero's melee blow. An ordinary blow hits one monster, the nearest
 * inside the swing; a sweeping one hits every monster inside it.
 */
export function resolvePlayerAttack(world: World, attack: PendingAttack): void {
  const { player, map } = world;
  const { dir } = attack;
  const halfArc = attack.arc / 2;
  const inSwing: Array<{ monster: Monster; distance: number; push: Point }> = [];
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
    inSwing.push({ monster, distance, push: { x: dx, y: dy } });
  }
  inSwing.sort((a, b) => a.distance - b.distance || a.monster.id - b.monster.id);
  let xp = 0;
  for (const { monster, push } of attack.cleave ? inSwing : inSwing.slice(0, 1)) xp += hitMonster(world, monster, attack.multiplier, push);
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
function walkTowards(world: World, monster: Monster, target: Point, stopAt: number, pace = 1): void {
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
  // A chilled monster walks at half speed.
  const speed = MONSTER_KINDS[monster.kind].speed * (monster.slowTicks > 0 ? 0.5 : 1) * pace;
  const move = Math.min((speed * TICK_MS) / 1000, reach);
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
  monster.called = false;
  monster.stroll = null;
  monster.returning = true;
  monster.windup = 0;
  monster.waypoint = null;
}

/**
 * A monster that has just noticed the hero (or been hit) calls for help:
 * others of its kind within earshot join in. Those who answer do not call
 * further, so how many come depends on who stood near whom at that moment.
 */
function raiseAlarm(world: World, caller: Monster): void {
  caller.called = true;
  const earshot = MONSTER_KINDS[caller.kind].social;
  if (earshot <= 0) return;
  for (const other of world.monsters) {
    if (other === caller || other.kind !== caller.kind || other.aggro || other.returning || other.hp <= 0) continue;
    if (Math.hypot(other.pos.x - caller.pos.x, other.pos.y - caller.pos.y) > earshot) continue;
    other.aggro = true;
    other.called = true;
    other.stroll = null;
  }
}

/** An idle monster strolls about its home, so the gaps between monsters never stay the same. */
function wander(world: World, monster: Monster): void {
  if (monster.stroll === null) {
    if (monster.rest > 0) {
      monster.rest -= 1;
      return;
    }
    const angle = (roll(world, [0, 359]) * Math.PI) / 180;
    const reach = (roll(world, [10, 100]) / 100) * WANDER_RADIUS;
    const target = { x: monster.home.x + Math.cos(angle) * reach, y: monster.home.y + Math.sin(angle) * reach };
    monster.rest = roll(world, WANDER_REST);
    // Only a straight, open walk: a stroll is not worth finding a way around a wood for.
    if (clearLine(world.map, monster.pos, target, MONSTER_RADIUS)) monster.stroll = target;
    return;
  }
  const before = monster.pos;
  walkTowards(world, monster, monster.stroll, 0, WANDER_SPEED);
  const left = Math.hypot(monster.stroll.x - monster.pos.x, monster.stroll.y - monster.pos.y);
  if (left < 0.1 || Math.hypot(monster.pos.x - before.x, monster.pos.y - before.y) < 1e-4) monster.stroll = null;
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
    // Each time a monster comes back, it may come back as an elder.
    const elder = roll(world, [1, 100]) <= ELDER_CHANCE;
    const maxHp = monsterMaxHp(monster.level, monster.kind, elder);
    world.monsters.push({
      ...monster,
      elder,
      maxHp,
      pos: { ...monster.home },
      hp: maxHp,
      called: false,
      stroll: null,
      rest: WANDER_REST[0],
      aggro: false,
      returning: false,
      windup: 0,
      cooldown: 0,
      slowTicks: 0,
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
    if (monster.slowTicks > 0) monster.slowTicks -= 1;

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
      else wander(world, monster);
      continue;
    }

    const distance = Math.hypot(player.pos.x - monster.pos.x, player.pos.y - monster.pos.y);
    // Some kinds attack on sight, others only when provoked; an elder of any kind attacks.
    const sight = monster.elder ? Math.max(ELDER_AGGRO, MONSTER_KINDS[monster.kind].aggro) : MONSTER_KINDS[monster.kind].aggro;
    if (!monster.aggro && distance <= sight) monster.aggro = true;
    if (!monster.aggro) {
      wander(world, monster);
      continue;
    }
    monster.stroll = null;
    if (!monster.called) raiseAlarm(world, monster);
    // The leash only matters in the open world; in a dungeon there is nowhere to run.
    if (world.zone === 'overworld' && Math.hypot(monster.home.x - monster.pos.x, monster.home.y - monster.pos.y) > MONSTER_LEASH) {
      giveUp(monster);
      continue;
    }

    if (monster.windup > 0) {
      // It keeps after the hero while it prepares the blow: stepping aside is not enough to avoid it.
      monster.windup -= 1;
      walkTowards(world, monster, player.pos, MONSTER_ATTACK_START * 0.85);
      if (monster.windup === 0) {
        monster.cooldown = MONSTER_ATTACK_COOLDOWN;
        const reach = Math.hypot(player.pos.x - monster.pos.x, player.pos.y - monster.pos.y);
        if (reach <= MONSTER_ATTACK_REACH) hurtPlayer(world, Math.round(roll(world, MONSTER_DAMAGE) * monsterDamageBonus(monster.level, monster.kind, monster.elder)));
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
    monster.called = false;
    monster.stroll = null;
    monster.returning = false;
    monster.windup = 0;
    monster.cooldown = 0;
    monster.waypoint = null;
  }
}
