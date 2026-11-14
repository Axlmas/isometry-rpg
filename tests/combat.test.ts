import { describe, expect, it } from 'vitest';
import {
  type Monster, type World, MONSTER_ATTACK_COOLDOWN, MONSTER_ATTACK_WINDUP, MONSTER_COUNT, MONSTER_DAMAGE,
  MONSTER_MAX_HP, MONSTER_MIN_SPAWN_DISTANCE, MONSTER_RADIUS, PLAYER_ATTACK_COOLDOWN, PLAYER_ATTACK_WINDUP,
  PLAYER_MAX_HP, PLAYER_REGEN_DELAY, circleFree, createWorld, isAlive, isWalkable, step,
} from '../src/sim';

// The damage of the weapon every hero starts with.
const PLAYER_DAMAGE = [9, 14] as const;

/** A world with exactly the given monsters, placed relative to the hero. */
function arena(offsets: Array<[number, number]>, seed = 5): World {
  const world = createWorld(seed);
  // An open room, so that a pillar from the seed cannot get in the way of a test.
  const { map } = world;
  for (let y = 1; y < map.height - 1; y++) {
    for (let x = 1; x < map.width - 1; x++) map.tiles[y * map.width + x] = 0;
  }
  const template = world.monsters[0] as Monster;
  world.monsters = offsets.map(([dx, dy], id) => ({
    ...template,
    id,
    home: { x: world.spawn.x + dx, y: world.spawn.y + dy },
    pos: { x: world.spawn.x + dx, y: world.spawn.y + dy },
  }));
  world.monsterTotal = offsets.length;
  return world;
}
const run = (world: World, ticks: number) => {
  for (let i = 0; i < ticks; i++) step(world);
};
const land = (world: World) => run(world, PLAYER_ATTACK_WINDUP); // ticks until a started blow lands

describe('dungeon population', () => {
  it('places the same monsters for the same seed, on floor, away from the entrance', () => {
    for (const seed of [1, 2, 3, 4242]) {
      const world = createWorld(seed);
      expect(world.monsters).toEqual(createWorld(seed).monsters);
      expect(world.monsters).toHaveLength(MONSTER_COUNT);
      expect(world.monsterTotal).toBe(MONSTER_COUNT);
      expect(new Set(world.monsters.map((m) => `${m.pos.x},${m.pos.y}`)).size).toBe(MONSTER_COUNT);
      for (const monster of world.monsters) {
        expect(isWalkable(world.map, monster.pos.x, monster.pos.y)).toBe(true);
        expect(Math.hypot(monster.pos.x - world.spawn.x, monster.pos.y - world.spawn.y)).toBeGreaterThanOrEqual(MONSTER_MIN_SPAWN_DISTANCE);
      }
    }
  });
});

describe('hero attack', () => {
  it('damages a monster in front, within the damage range, after the wind-up', () => {
    const world = arena([[1, 0]]);
    step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
    expect(world.events).toContainEqual({ type: 'playerSwing', dir: { x: 1, y: 0 }, charged: false });
    if (PLAYER_ATTACK_WINDUP > 1) expect(world.monsters[0]?.hp).toBe(MONSTER_MAX_HP);
    land(world);
    const dealt = MONSTER_MAX_HP - (world.monsters[0] as Monster).hp;
    expect(dealt).toBeGreaterThanOrEqual(PLAYER_DAMAGE[0]);
    expect(dealt).toBeLessThanOrEqual(PLAYER_DAMAGE[1]);
  });

  it('misses monsters behind the hero or out of reach', () => {
    const world = arena([[-1, 0], [3, 0]]);
    step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
    land(world);
    expect(world.monsters.map((m) => m.hp)).toEqual([MONSTER_MAX_HP, MONSTER_MAX_HP]);
  });

  it('hits every monster inside the swing', () => {
    const world = arena([[1, 0.3], [1, -0.3]]);
    step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
    land(world);
    for (const monster of world.monsters) expect(monster.hp).toBeLessThan(MONSTER_MAX_HP);
  });

  it('does not hit through a wall', () => {
    const world = arena([[2, 0]]);
    const { spawn, map } = world;
    map.tiles[spawn.y * map.width + spawn.x + 1] = 1;
    (world.monsters[0] as Monster).pos = { x: spawn.x + 1.75, y: spawn.y };
    world.player.pos = { x: spawn.x + 0.2, y: spawn.y };
    step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
    land(world);
    expect(world.monsters[0]?.hp).toBe(MONSTER_MAX_HP);
  });

  it('cannot be repeated faster than the cooldown, however often it is ordered', () => {
    const world = arena([]);
    let swings = 0;
    const ticks = PLAYER_ATTACK_COOLDOWN * 5;
    for (let i = 0; i < ticks; i++) {
      step(world, [{ type: 'attack', dx: 1, dy: 0 }, { type: 'attack', dx: 0, dy: 1 }]);
      swings += world.events.filter((e) => e.type === 'playerSwing').length;
    }
    expect(swings).toBe(5);
  });

  it('ignores an attack with no usable direction', () => {
    const world = arena([]);
    step(world, [{ type: 'attack', dx: 0, dy: 0 }, { type: 'attack', dx: Number.NaN, dy: 1 }]);
    expect(world.events).toEqual([]);
    expect(world.player.attackCooldown).toBe(0);
  });

  it('kills a monster, removes it and reports it', () => {
    const world = arena([[1, 0]]);
    let died = false;
    for (let i = 0; i < 400 && world.monsters.length > 0; i++) {
      const monster = world.monsters[0] as Monster;
      step(world, [{ type: 'attack', dx: monster.pos.x - world.player.pos.x, dy: monster.pos.y - world.player.pos.y }]);
      died ||= world.events.some((e) => e.type === 'monsterHit' && e.died);
      world.player.hp = world.player.maxHp; // this test is about the monster
    }
    expect(world.monsters).toEqual([]);
    expect(died).toBe(true);
    expect(world.monsterTotal).toBe(1);
  });

  it('knocks the monster back without pushing it into a wall', () => {
    const world = arena([[1, 0]]);
    const before = (world.monsters[0] as Monster).pos.x;
    step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
    for (let i = 0; i < PLAYER_ATTACK_WINDUP; i++) {
      step(world);
      if (world.events.some((e) => e.type === 'monsterHit')) break;
    }
    const monster = world.monsters[0] as Monster;
    expect(monster.pos.x).toBeGreaterThan(before - 0.2);
    expect(circleFree(world.map, monster.pos, MONSTER_RADIUS)).toBe(true);
  });
});

describe('monsters', () => {
  it('stay put until the hero comes close', () => {
    const world = createWorld(11);
    const before = world.monsters.map((m) => ({ ...m.pos }));
    run(world, 100);
    expect(world.monsters.map((m) => m.pos)).toEqual(before);
    expect(world.player.hp).toBe(PLAYER_MAX_HP);
  });

  it('notice the hero, come closer and hurt them after a warning', () => {
    const world = arena([[4, 0]]);
    let warnedAt = -1;
    let hitAt = -1;
    for (let i = 0; i < 400 && hitAt < 0; i++) {
      step(world);
      if (warnedAt < 0 && world.events.some((e) => e.type === 'monsterWindup')) warnedAt = world.tick;
      if (world.events.some((e) => e.type === 'playerHit')) hitAt = world.tick;
    }
    expect(warnedAt).toBeGreaterThan(0);
    expect(hitAt - warnedAt).toBe(MONSTER_ATTACK_WINDUP);
    const lost = PLAYER_MAX_HP - world.player.hp;
    expect(lost).toBeGreaterThanOrEqual(MONSTER_DAMAGE[0]);
    expect(lost).toBeLessThanOrEqual(MONSTER_DAMAGE[1]);
  });

  it('miss when the hero steps away during the warning', () => {
    const world = arena([[0.9, 0]]);
    step(world);
    expect(world.events).toContainEqual({ type: 'monsterWindup', id: 0 });
    step(world, [{ type: 'moveDir', dx: -1, dy: 0 }]);
    run(world, MONSTER_ATTACK_WINDUP);
    expect(world.player.hp).toBe(PLAYER_MAX_HP);
  });

  it('wait between attacks', () => {
    const world = arena([[0.9, 0]]);
    const hits: number[] = [];
    for (let i = 0; i < 100; i++) {
      step(world);
      if (world.events.some((e) => e.type === 'playerHit')) hits.push(world.tick);
    }
    expect(hits.length).toBeGreaterThan(1);
    for (let i = 1; i < hits.length; i++) {
      expect((hits[i] as number) - (hits[i - 1] as number)).toBeGreaterThanOrEqual(MONSTER_ATTACK_COOLDOWN + MONSTER_ATTACK_WINDUP);
    }
  });

  it('have their attack interrupted by a hit', () => {
    const world = arena([[0.9, 0]]);
    step(world);
    expect(world.monsters[0]?.windup).toBeGreaterThan(0);
    step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
    land(world);
    expect(world.player.hp).toBe(PLAYER_MAX_HP);
  });

  it('find their way around walls and never stand in a wall or in each other', () => {
    for (const seed of [21, 22, 23]) {
      const world = createWorld(seed);
      for (const monster of world.monsters) monster.aggro = true;
      for (let i = 0; i < 600; i++) {
        step(world);
        world.player.hp = world.player.maxHp; // keep the hero alive as bait
        for (const monster of world.monsters) expect(circleFree(world.map, monster.pos, MONSTER_RADIUS)).toBe(true);
      }
      const near = world.monsters.filter((m) => Math.hypot(m.pos.x - world.player.pos.x, m.pos.y - world.player.pos.y) < 3);
      expect(near.length).toBe(world.monsters.length);
      for (const a of world.monsters) {
        for (const b of world.monsters) {
          if (a.id < b.id) expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y)).toBeGreaterThan(MONSTER_RADIUS);
        }
      }
    }
  });
});

describe('death and recovery', () => {
  const kill = (world: World) => {
    for (let i = 0; i < 5000 && isAlive(world); i++) step(world);
    expect(isAlive(world)).toBe(false);
  };

  it('stops the hero and ignores orders after death', () => {
    const world = arena([[0.9, 0], [0, 0.9]]);
    step(world, [{ type: 'moveDir', dx: 0.01, dy: 0 }]);
    let reported = 0;
    for (let i = 0; i < 5000 && isAlive(world); i++) {
      step(world);
      reported += world.events.filter((e) => e.type === 'playerDied').length;
    }
    expect(reported).toBe(1);
    expect(world.player.hp).toBe(0);
    const at = { ...world.player.pos };
    step(world, [{ type: 'moveDir', dx: 1, dy: 0 }, { type: 'moveTo', x: world.spawn.x, y: world.spawn.y }, { type: 'attack', dx: 1, dy: 0 }]);
    run(world, 20);
    expect(world.player.pos).toEqual(at);
    expect(world.events).toEqual([]);
    expect(world.player.hp).toBe(0); // no regeneration while dead
  });

  it('brings the hero back at the entrance and resets the survivors', () => {
    const world = arena([[0.9, 0], [3, 3]]);
    world.player.pos = { x: world.spawn.x - 8, y: world.spawn.y }; // die far from the entrance
    for (const monster of world.monsters) monster.pos = { x: monster.pos.x - 8, y: monster.pos.y };
    world.monsters.forEach((monster) => (monster.home = { x: world.spawn.x + 7, y: world.spawn.y + monster.id }));
    (world.monsters[1] as Monster).hp = 5;
    kill(world);
    step(world, [{ type: 'respawn' }]);
    expect(world.events).toContainEqual({ type: 'playerRespawned' });
    expect(world.player.hp).toBe(PLAYER_MAX_HP);
    expect(world.player.pos).toEqual(world.spawn);
    for (const monster of world.monsters) {
      expect(monster.hp).toBe(monster.maxHp);
      expect(monster.pos).toEqual(monster.home);
    }
  });

  it('ignores respawn while the hero is alive', () => {
    const world = arena([]);
    world.player.hp = 40;
    world.player.pos = { x: world.spawn.x + 1, y: world.spawn.y };
    step(world, [{ type: 'respawn' }]);
    expect(world.player.hp).toBe(40);
    expect(world.player.pos.x).toBe(world.spawn.x + 1);
  });

  it('restores health only after a quiet period and never above the maximum', () => {
    const world = arena([]);
    world.player.hp = 90;
    run(world, PLAYER_REGEN_DELAY - 1);
    expect(world.player.hp).toBe(90);
    run(world, 2000);
    expect(world.player.hp).toBe(PLAYER_MAX_HP);
  });
});

describe('determinism', () => {
  it('replays a whole fight identically from the same seed and commands', () => {
    const fight = () => {
      const world = createWorld(909);
      for (const monster of world.monsters) monster.aggro = true;
      for (let i = 0; i < 800; i++) {
        const target = world.monsters[0];
        step(world, target && i % 3 === 0
          ? [{ type: 'attack', dx: target.pos.x - world.player.pos.x, dy: target.pos.y - world.player.pos.y }]
          : i % 50 === 0 ? [{ type: 'moveDir', dx: i % 100 === 0 ? 1 : -1, dy: 0.5 }] : []);
        if (!isAlive(world)) step(world, [{ type: 'respawn' }]);
      }
      return world;
    };
    expect(fight()).toEqual(fight());
  });
});
