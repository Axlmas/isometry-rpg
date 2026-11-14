import { describe, expect, it } from 'vitest';
import {
  type Monster, type World, DEATH_XP_LOSS, MAX_LEVEL, MONSTER_MAX_HP, PLAYER_ATTACK_WINDUP, PLAYER_MAX_HP, PLAYER_MAX_MP,
  SKILLS, SKILL_IDS, characterOf, createWorld, damageBonusAtLevel, grantXp, isAlive, maxHpAtLevel, maxMpAtLevel,
  monsterMaxHp, monsterXp, newCharacter, skillsUnlockedAt, step, xpToNextLevel,
} from '../src/sim';

function arena(offsets: Array<[number, number]>, level = 1, dungeonLevel = 1): World {
  const world = createWorld(5, { ...newCharacter('trainingSword'), level }, dungeonLevel);
  const { map } = world;
  for (let y = 1; y < map.height - 1; y++) {
    for (let x = 1; x < map.width - 1; x++) map.tiles[y * map.width + x] = 0;
  }
  const template = world.monsters[0] as Monster;
  world.monsters = offsets.map(([dx, dy], id) => ({
    ...template, id,
    home: { x: world.spawn.x + dx, y: world.spawn.y + dy },
    pos: { x: world.spawn.x + dx, y: world.spawn.y + dy },
  }));
  world.monsterTotal = offsets.length;
  return world;
}
const land = (world: World) => {
  for (let i = 0; i < PLAYER_ATTACK_WINDUP; i++) step(world);
};
const eventsOf = (world: World, type: string) => world.events.filter((e) => e.type === type);

describe('level curve', () => {
  it('asks for more experience at every level and grows the hero', () => {
    for (let level = 1; level < MAX_LEVEL; level++) {
      expect(xpToNextLevel(level + 1)).toBeGreaterThan(xpToNextLevel(level));
      expect(maxHpAtLevel(level + 1)).toBeGreaterThan(maxHpAtLevel(level));
      expect(maxMpAtLevel(level + 1)).toBeGreaterThan(maxMpAtLevel(level));
      expect(damageBonusAtLevel(level + 1)).toBeGreaterThan(damageBonusAtLevel(level));
    }
    expect(maxHpAtLevel(1)).toBe(PLAYER_MAX_HP);
    expect(maxMpAtLevel(1)).toBe(PLAYER_MAX_MP);
    expect(damageBonusAtLevel(1)).toBe(1);
  });

  it('gives every skill an unlock level the hero can reach', () => {
    const unlocked = Array.from({ length: MAX_LEVEL }, (_, i) => skillsUnlockedAt(i + 1)).flat();
    expect([...unlocked].sort()).toEqual([...SKILL_IDS].sort());
  });
});

describe('experience', () => {
  it('comes from kills and is reported', () => {
    const world = arena([[1, 0]]);
    (world.monsters[0] as Monster).hp = 1;
    step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
    let gained = 0;
    for (let i = 0; i < PLAYER_ATTACK_WINDUP; i++) {
      step(world);
      for (const e of world.events) if (e.type === 'xpGained') gained += e.amount;
    }
    expect(gained).toBe(monsterXp(1));
    expect(world.player.xp).toBe(monsterXp(1));
  });

  it('raises the level, restores the hero and announces new skills', () => {
    const world = arena([]);
    world.player.hp = 10;
    world.player.mp = 0;
    grantXp(world, xpToNextLevel(1) + 5);
    expect(world.player.level).toBe(2);
    expect(world.player.xp).toBe(5);
    expect(world.player.maxHp).toBe(maxHpAtLevel(2));
    expect(world.player.hp).toBe(maxHpAtLevel(2));
    expect(world.player.mp).toBe(maxMpAtLevel(2));
    expect(eventsOf(world, 'levelUp')).toEqual([{ type: 'levelUp', level: 2, unlocked: ['heavyBlow'] }]);
  });

  it('can raise several levels at once and stops at the maximum', () => {
    const world = arena([]);
    grantXp(world, xpToNextLevel(1) + xpToNextLevel(2) + xpToNextLevel(3));
    expect(world.player.level).toBe(4);
    expect(eventsOf(world, 'levelUp')).toHaveLength(3);
    grantXp(world, 10 ** 9);
    expect(world.player.level).toBe(MAX_LEVEL);
    expect(world.player.xp).toBe(0);
    world.events = [];
    grantXp(world, 500);
    expect(world.player.xp).toBe(0);
    expect(world.events).toEqual([]);
  });

  it('makes a higher-level hero hit harder with the same weapon', () => {
    const damageAt = (level: number) => {
      const world = arena([[1, 0]], level);
      (world.monsters[0] as Monster).hp = (world.monsters[0] as Monster).maxHp = 10000;
      step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
      land(world);
      return 10000 - (world.monsters[0] as Monster).hp;
    };
    // Same seed, so the same roll: only the level differs.
    expect(damageAt(10)).toBe(Math.round(damageAt(1) * damageBonusAtLevel(10)));
  });
});

describe('dungeon level', () => {
  it('follows the hero by default and makes monsters tougher and more rewarding', () => {
    expect(createWorld(1).dungeonLevel).toBe(1);
    const deep = createWorld(1, { ...newCharacter('trainingSword'), level: 7 });
    expect(deep.dungeonLevel).toBe(7);
    expect(deep.monsters.every((m) => m.maxHp === monsterMaxHp(7) && m.hp === m.maxHp)).toBe(true);
    expect(monsterMaxHp(1)).toBe(MONSTER_MAX_HP);
    expect(monsterMaxHp(7)).toBeGreaterThan(MONSTER_MAX_HP);
    expect(monsterXp(7)).toBeGreaterThan(monsterXp(1));
    expect(deep.player.maxHp).toBe(maxHpAtLevel(7));
  });

  it('makes monsters of a higher-level dungeon hit harder', () => {
    const firstHit = (dungeonLevel: number) => {
      const world = arena([[0.9, 0]], 1, dungeonLevel);
      for (let i = 0; i < 40 && world.player.hp === PLAYER_MAX_HP; i++) step(world);
      return PLAYER_MAX_HP - world.player.hp;
    };
    expect(firstHit(8)).toBeGreaterThan(firstHit(1));
  });

  it('keeps the level and experience when moving to the next dungeon', () => {
    const world = arena([]);
    grantXp(world, xpToNextLevel(1) + 7);
    const next = createWorld(2, characterOf(world));
    expect(next.player.level).toBe(2);
    expect(next.player.xp).toBe(7);
    expect(next.dungeonLevel).toBe(2);
  });
});

describe('death penalty', () => {
  const die = (world: World) => {
    let lost = -1;
    for (let i = 0; i < 5000 && isAlive(world); i++) {
      step(world);
      for (const e of world.events) if (e.type === 'playerDied') lost = e.xpLost;
    }
    return lost;
  };

  it('takes a share of the level’s experience, reports it and never lowers the level', () => {
    const world = arena([[0.9, 0], [0, 0.9]], 3);
    world.player.xp = 200;
    const expected = Math.round(xpToNextLevel(3) * DEATH_XP_LOSS);
    expect(die(world)).toBe(expected);
    expect(world.player.xp).toBe(200 - expected);
    expect(world.player.level).toBe(3);
  });

  it('cannot take more experience than the hero has', () => {
    const world = arena([[0.9, 0], [0, 0.9]], 3);
    world.player.xp = 2;
    expect(die(world)).toBe(2);
    expect(world.player.xp).toBe(0);
  });

  it('restores mana on respawn', () => {
    const world = arena([[0.9, 0], [0, 0.9]]);
    world.player.mp = 0;
    die(world);
    step(world, [{ type: 'respawn' }]);
    expect(world.player.mp).toBe(world.player.maxMp);
  });
});

describe('mana', () => {
  it('comes back over time up to the maximum', () => {
    const world = arena([]);
    world.player.mp = 0;
    for (let i = 0; i < 100; i++) step(world);
    expect(world.player.mp).toBeGreaterThan(0);
    expect(world.player.mp).toBeLessThan(world.player.maxMp);
    for (let i = 0; i < 5000; i++) step(world);
    expect(world.player.mp).toBe(world.player.maxMp);
  });
});

describe('skills', () => {
  it('are refused below their level, without mana and while cooling down, at no cost', () => {
    const locked = arena([]);
    step(locked, [{ type: 'skill', id: 'heavyBlow', dx: 1, dy: 0 }]);
    expect(locked.events).toEqual([{ type: 'skillDenied', id: 'heavyBlow', reason: 'locked' }]);
    expect(locked.player.mp).toBe(locked.player.maxMp);

    const dry = arena([], 10);
    dry.player.mp = SKILLS.heavyBlow.manaCost - 1;
    step(dry, [{ type: 'skill', id: 'heavyBlow', dx: 1, dy: 0 }]);
    expect(dry.events).toEqual([{ type: 'skillDenied', id: 'heavyBlow', reason: 'mana' }]);
    expect(dry.player.skillCooldowns.heavyBlow).toBe(0);

    const cooling = arena([], 10);
    step(cooling, [{ type: 'skill', id: 'heavyBlow', dx: 1, dy: 0 }]);
    const mpAfterFirst = cooling.player.mp;
    for (let i = 0; i < 5; i++) step(cooling);
    step(cooling, [{ type: 'skill', id: 'heavyBlow', dx: 1, dy: 0 }]);
    expect(cooling.events).toEqual([{ type: 'skillDenied', id: 'heavyBlow', reason: 'cooldown' }]);
    expect(cooling.player.mp).toBeGreaterThanOrEqual(mpAfterFirst);
  });

  it('cost mana, start a cooldown and become usable again after it', () => {
    const world = arena([], 10);
    step(world, [{ type: 'skill', id: 'heavyBlow', dx: 1, dy: 0 }]);
    expect(world.events).toContainEqual({ type: 'skillUsed', id: 'heavyBlow', dir: { x: 1, y: 0 } });
    // Mana may tick back by one point in the same tick.
    expect(world.player.maxMp - world.player.mp).toBeGreaterThanOrEqual(SKILLS.heavyBlow.manaCost - 1);
    expect(world.player.maxMp - world.player.mp).toBeLessThanOrEqual(SKILLS.heavyBlow.manaCost);
    for (let i = 0; i < SKILLS.heavyBlow.cooldown; i++) step(world);
    step(world, [{ type: 'skill', id: 'heavyBlow', dx: 0, dy: 1 }]);
    expect(eventsOf(world, 'skillUsed')).toHaveLength(1);
  });

  it('Heavy Blow hits much harder than a normal attack and reaches further', () => {
    const dealt = (skill: boolean, distance: number) => {
      const world = arena([[distance, 0]], 10);
      (world.monsters[0] as Monster).hp = (world.monsters[0] as Monster).maxHp = 10000;
      step(world, [skill ? { type: 'skill', id: 'heavyBlow', dx: 1, dy: 0 } : { type: 'attack', dx: 1, dy: 0 }]);
      land(world);
      return 10000 - (world.monsters[0] as Monster).hp;
    };
    const normal = dealt(false, 1);
    const heavy = dealt(true, 1);
    expect(Math.abs(heavy - normal * 2.2)).toBeLessThanOrEqual(1); // same roll; only rounding differs
    expect(dealt(false, 1.8)).toBe(0);
    expect(dealt(true, 1.8)).toBeGreaterThan(0);
  });

  it('Heavy Blow is narrow; Sweep hits all around', () => {
    const hits = (id: 'heavyBlow' | 'sweep') => {
      const world = arena([[1, 0], [0, 1], [-1, 0], [0, -1], [0.75, 0.75]], 10);
      step(world, [{ type: 'skill', id, dx: 1, dy: 0 }]);
      let count = 0;
      for (let i = 0; i < PLAYER_ATTACK_WINDUP; i++) {
        step(world);
        count += eventsOf(world, 'monsterHit').length;
      }
      return count;
    };
    expect(hits('heavyBlow')).toBe(1);
    expect(hits('sweep')).toBe(5);
  });

  it('aims where the hero is facing when no direction is given', () => {
    const world = arena([[0, 1]], 10);
    world.player.facing = { x: 0, y: 1 };
    (world.monsters[0] as Monster).hp = (world.monsters[0] as Monster).maxHp = 10000;
    step(world, [{ type: 'skill', id: 'heavyBlow', dx: 0, dy: 0 }]);
    land(world);
    expect((world.monsters[0] as Monster).hp).toBeLessThan(10000);
  });

  it('Second Wind heals a share of health, never above the maximum', () => {
    const world = arena([], 10);
    world.player.hp = 10;
    step(world, [{ type: 'skill', id: 'secondWind', dx: 0, dy: 0 }]);
    const expected = Math.round(world.player.maxHp * 0.35);
    expect(world.events).toContainEqual({ type: 'playerHealed', amount: expected });
    expect(world.player.hp).toBe(10 + expected);

    const healthy = arena([], 10);
    healthy.player.hp = healthy.player.maxHp - 3;
    step(healthy, [{ type: 'skill', id: 'secondWind', dx: 0, dy: 0 }]);
    expect(healthy.player.hp).toBe(healthy.player.maxHp);
  });

  it('cannot be used by a dead hero and ignore unknown skills', () => {
    const world = arena([], 10);
    world.player.hp = 0;
    step(world, [{ type: 'skill', id: 'secondWind', dx: 0, dy: 0 }]);
    expect(world.player.hp).toBe(0);
    const alive = arena([], 10);
    step(alive, [{ type: 'skill', id: 'fireball' as never, dx: 1, dy: 0 }]);
    expect(alive.events).toEqual([]);
  });
});
