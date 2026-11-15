import { MONSTER_RADIUS, TICK_MS } from './balance';
import { RANGED, type WeaponType } from './classes';
import { circleFree } from './collision';
import { buryTheDead, hitMonster, hitMonstersAround } from './combat';
import type { Point } from './grid';
import { grantXp } from './progression';
import type { PendingAttack, World } from './world';

/** An arrow or a bolt of magic in flight. */
export interface Projectile {
  id: number;
  kind: 'arrow' | 'bolt';
  pos: Point;
  /** Unit vector. */
  dir: Point;
  /** Tiles per second. */
  speed: number;
  /** Tiles it can still fly. */
  left: number;
  /** Applied to the hero's weapon damage on a hit. */
  multiplier: number;
  /** Flies on through the monsters it hits. */
  pierce: boolean;
  /** Radius of the burst on impact; zero for none. */
  splash: number;
  /** Monsters already struck, so a piercing missile hits each only once. */
  struck: number[];
  charged: boolean;
}

const HIT_RADIUS = MONSTER_RADIUS + 0.18;
/** A missile is checked for hits every this many tiles of flight, so it cannot skip over a monster. */
const STEP = 0.2;

/** Looses the missiles of a ranged attack: one, or a fan of several. */
export function fire(world: World, weapon: Exclude<WeaponType, 'sword'>, attack: PendingAttack): void {
  const shot = attack.shot ?? { count: 1, spread: 0, pierce: false, splash: 0 };
  const { range, speed, kind } = RANGED[weapon];
  const base = Math.atan2(attack.dir.y, attack.dir.x);
  for (let i = 0; i < shot.count; i++) {
    const offset = shot.count > 1 ? -shot.spread / 2 + (shot.spread * i) / (shot.count - 1) : 0;
    const dir = { x: Math.cos(base + offset), y: Math.sin(base + offset) };
    world.projectiles.push({
      id: world.nextProjectileId++,
      kind,
      // Starts a little in front of the hero, so it does not hit a wall the hero is leaning on.
      pos: { x: world.player.pos.x + dir.x * 0.3, y: world.player.pos.y + dir.y * 0.3 },
      dir,
      speed,
      left: range,
      multiplier: attack.multiplier,
      pierce: shot.pierce,
      splash: shot.splash,
      struck: [],
      charged: attack.charged,
    });
  }
}

/** Advances every missile by one tick: fly, hit monsters, stop at walls or at the end of the range. */
export function updateProjectiles(world: World): void {
  if (world.projectiles.length === 0) return;
  let xp = 0;
  const flying: Projectile[] = [];
  for (const missile of world.projectiles) {
    let distance = Math.min(missile.left, (missile.speed * TICK_MS) / 1000);
    let spent = false;
    while (distance > 0 && !spent) {
      const move = Math.min(STEP, distance);
      distance -= move;
      missile.left -= move;
      missile.pos = { x: missile.pos.x + missile.dir.x * move, y: missile.pos.y + missile.dir.y * move };
      if (!circleFree(world.map, missile.pos, 0.08)) {
        spent = true;
        break;
      }
      for (const monster of world.monsters) {
        if (monster.hp <= 0 || missile.struck.includes(monster.id)) continue;
        if (Math.hypot(monster.pos.x - missile.pos.x, monster.pos.y - missile.pos.y) > HIT_RADIUS) continue;
        missile.struck.push(monster.id);
        xp += hitMonster(world, monster, missile.multiplier, missile.dir);
        // A burst also catches whoever stands near the one that was hit, for somewhat less.
        if (missile.splash > 0) xp += hitMonstersAround(world, monster.pos, missile.splash, missile.multiplier * 0.6, 0, monster.id, false);
        if (!missile.pierce) {
          spent = true;
          break;
        }
      }
    }
    if (spent || missile.left <= 0) world.events.push({ type: 'projectileEnded', id: missile.id, pos: { ...missile.pos }, kind: missile.kind });
    else flying.push(missile);
  }
  world.projectiles = flying;
  buryTheDead(world);
  grantXp(world, xp);
}
