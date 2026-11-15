import { describe, expect, it } from 'vitest';
import {
  type ClassId, type Monster, type RaceId, type World, CLASSES, CLASS_IDS, ITEMS, PLAYER_ATTACK_WINDUP, PLAYER_SPEED, RACES, RACE_IDS,
  RANGED, SKILLS, SKILL_IDS, SKILL_PRICE, TICK_MS, addItem, characterOf, classSkills, createWorld, heroMaxHp, heroMaxMp,
  maxHpAtLevel, newHero, step, weaponInHand,
} from '../src/sim';

/** A hero of the given class in an open room, knowing every skill of the class, with monsters placed around. */
function arena(cls: ClassId, offsets: Array<[number, number]> = [], level = 10, race: RaceId = 'human'): World {
  const world = createWorld(5, { ...newHero(race, cls), level, skills: classSkills(cls) });
  const { map } = world;
  for (let y = 1; y < map.height - 1; y++) {
    for (let x = 1; x < map.width - 1; x++) map.tiles[y * map.width + x] = 0;
  }
  const template = createWorld(5).monsters[0] as Monster;
  world.monsters = offsets.map(([dx, dy], id) => ({
    ...template, id, hp: 10000, maxHp: 10000,
    home: { x: world.spawn.x + dx, y: world.spawn.y + dy },
    pos: { x: world.spawn.x + dx, y: world.spawn.y + dy },
  }));
  world.monsterTotal = offsets.length;
  return world;
}
const run = (world: World, ticks: number) => {
  for (let i = 0; i < ticks; i++) step(world);
};
const hurt = (world: World) => world.monsters.filter((m) => m.hp < m.maxHp).map((m) => m.id);
const types = (world: World) => world.events.map((e) => e.type);

describe('races and classes', () => {
  it('give every combination its own health and mana, around the human warrior baseline', () => {
    expect(heroMaxHp(1, 'human', 'warrior')).toBe(maxHpAtLevel(1));
    for (const race of RACE_IDS) {
      for (const cls of CLASS_IDS) {
        const world = createWorld(1, newHero(race, cls));
        expect(world.player).toMatchObject({ race, cls, maxHp: heroMaxHp(1, race, cls), maxMp: heroMaxMp(1, race, cls) });
        expect(world.player.hp).toBe(world.player.maxHp);
        expect(world.player.maxHp).toBeGreaterThan(50);
      }
    }
    expect(heroMaxHp(5, 'human', 'warrior')).toBeGreaterThan(heroMaxHp(5, 'human', 'archer'));
    expect(heroMaxHp(5, 'human', 'archer')).toBeGreaterThan(heroMaxHp(5, 'human', 'mage'));
    expect(heroMaxMp(5, 'human', 'mage')).toBeGreaterThan(heroMaxMp(5, 'human', 'warrior'));
    expect(heroMaxMp(5, 'elf', 'mage')).toBeGreaterThan(heroMaxMp(5, 'human', 'mage'));
    expect(heroMaxHp(5, 'elf', 'mage')).toBeLessThan(heroMaxHp(5, 'human', 'mage'));
  });

  it('start each class with its own weapon and no other belongings', () => {
    for (const cls of CLASS_IDS) {
      const { player } = createWorld(1, newHero('human', cls));
      expect(player.equipment.weapon).toBe(CLASSES[cls].startingWeapon);
      expect(weaponInHand(player)).toBe(CLASSES[cls].weapon);
      expect(player).toMatchObject({ level: 1, xp: 0, coins: 0, inventory: [], skills: [], recipes: [] });
    }
  });

  it('keep growing by the class on level-up', () => {
    const world = createWorld(1, newHero('elf', 'mage'));
    step(world, []);
    world.dev = true;
    step(world, [{ type: 'dev', action: 'levelUp' }]);
    expect(world.player.level).toBe(2);
    expect(world.player.maxHp).toBe(heroMaxHp(2, 'elf', 'mage'));
    expect(world.player.maxMp).toBe(heroMaxMp(2, 'elf', 'mage'));
  });

  it('let an elf walk faster than a human', () => {
    const walked = (race: RaceId) => {
      const world = arena('warrior', [], 1, race);
      step(world, [{ type: 'moveDir', dx: 1, dy: 0 }]);
      return world.player.distance;
    };
    expect(walked('human')).toBeCloseTo((PLAYER_SPEED * TICK_MS) / 1000, 9);
    expect(walked('elf')).toBeCloseTo((PLAYER_SPEED * RACES.elf.speed * TICK_MS) / 1000, 9);
  });

  it('keep race and class when the hero moves to another map', () => {
    const world = createWorld(1, newHero('elf', 'archer'));
    expect(createWorld(2, characterOf(world), 4, 'overworld').player).toMatchObject({ race: 'elf', cls: 'archer' });
  });

  it('give each class three skills of its own, opening at levels 2, 4 and 6, at the same prices', () => {
    const all = CLASS_IDS.flatMap((cls) => classSkills(cls));
    expect([...all].sort()).toEqual([...SKILL_IDS].sort());
    for (const cls of CLASS_IDS) {
      const skills = classSkills(cls);
      expect(skills.map((id) => SKILLS[id].unlockLevel)).toEqual([2, 4, 6]);
      expect(skills.map((id) => SKILL_PRICE[id])).toEqual([60, 250, 600]);
      expect(skills.every((id) => SKILLS[id].cls === cls)).toBe(true);
    }
  });
});

describe('weapons by class', () => {
  it('cannot be worn by another class', () => {
    const world = arena('mage');
    addItem(world.player, 'ironSword', 1);
    addItem(world.player, 'huntingBow', 1);
    addItem(world.player, 'oakStaff', 1);
    step(world, [{ type: 'equip', index: 0 }, { type: 'equip', index: 1 }]);
    expect(world.events).toEqual([{ type: 'equipDenied', itemId: 'ironSword' }, { type: 'equipDenied', itemId: 'huntingBow' }]);
    expect(world.player.equipment.weapon).toBe('apprenticeStaff');
    step(world, [{ type: 'equip', index: 2 }]);
    expect(world.player.equipment.weapon).toBe('oakStaff');
  });

  it('exist for every class in both grades, the graded one stronger', () => {
    for (const cls of CLASS_IDS) {
      const type = CLASSES[cls].weapon;
      const best = (grade: 'none' | 'd') => Math.max(0, ...Object.values(ITEMS).map((d) => (d.kind === 'equipment' && d.slot === 'weapon' && d.weaponType === type && d.grade === grade ? d.damage[1] : 0)));
      expect(best('none')).toBeGreaterThan(0);
      expect(best('d')).toBeGreaterThan(best('none'));
    }
  });

  it('armour is for everyone', () => {
    const world = arena('mage');
    addItem(world.player, 'chainShirt', 1);
    step(world, [{ type: 'equip', index: 0 }]);
    expect(world.player.equipment.armor).toBe('chainShirt');
  });
});

describe('ranged attacks', () => {
  it('loose a missile that flies, hits the first monster in its way and stops', () => {
    for (const cls of ['archer', 'mage'] as const) {
      const world = arena(cls, [[4, 0], [6, 0]]);
      step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
      expect(types(world)).toEqual(['playerShot']);
      run(world, PLAYER_ATTACK_WINDUP);
      expect(world.projectiles).toHaveLength(1);
      expect(hurt(world)).toEqual([]); // still in flight
      run(world, 20);
      expect(hurt(world)).toEqual([0]);
      expect(world.projectiles).toEqual([]);
    }
  });

  it('reach far, but not forever', () => {
    const world = arena('archer', [[RANGED.bow.range - 1, 0], [RANGED.bow.range + 2, 3]]);
    step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
    run(world, 40);
    expect(hurt(world)).toEqual([0]);
    const far = arena('archer', [[RANGED.bow.range + 1.5, 0]]);
    step(far, [{ type: 'attack', dx: 1, dy: 0 }]);
    run(far, 40);
    expect(hurt(far)).toEqual([]);
    expect(far.projectiles).toEqual([]);
  });

  it('are stopped by walls', () => {
    const world = arena('archer', [[4, 0]]);
    const { spawn, map } = world;
    map.tiles[spawn.y * map.width + spawn.x + 2] = 1;
    step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
    run(world, 30);
    expect(hurt(world)).toEqual([]);
    expect(world.projectiles).toEqual([]);
  });

  it('miss a monster that is not in the line of fire', () => {
    const world = arena('archer', [[4, 1.2]]);
    step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
    run(world, 30);
    expect(hurt(world)).toEqual([]);
  });

  it('give experience and loot for a kill like any other blow', () => {
    const world = arena('mage', [[3, 0]]);
    world.monsters[0]!.hp = 1;
    step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
    run(world, 20);
    expect(world.monsters).toEqual([]);
    expect(world.player.xp).toBeGreaterThan(0);
    expect(world.loot.length).toBeGreaterThan(0);
  });

  it('an archer or a mage with empty hands still has fists', () => {
    const world = arena('archer', [[1, 0], [4, 0]]);
    step(world, [{ type: 'unequip', slot: 'weapon' }, { type: 'attack', dx: 1, dy: 0 }]);
    expect(types(world)).toEqual(['playerSwing']);
    run(world, 10);
    expect(hurt(world)).toEqual([0]);
  });
});

describe('archer skills', () => {
  it('Power Shot passes through every monster in the line', () => {
    const world = arena('archer', [[2, 0], [4, 0], [6, 0], [4, 2]]);
    step(world, [{ type: 'skill', id: 'powerShot', dx: 1, dy: 0 }]);
    run(world, 30);
    expect(hurt(world)).toEqual([0, 1, 2]);
  });

  it('Volley looses five arrows in a fan', () => {
    const world = arena('archer');
    step(world, [{ type: 'skill', id: 'volley', dx: 1, dy: 0 }]);
    run(world, PLAYER_ATTACK_WINDUP);
    expect(world.projectiles).toHaveLength(5);
    const angles = world.projectiles.map((p) => Math.atan2(p.dir.y, p.dir.x));
    expect(Math.max(...angles) - Math.min(...angles)).toBeCloseTo((50 * Math.PI) / 180, 6);
    expect(angles[2]).toBeCloseTo(0, 6);
  });

  it('Swiftness makes the hero walk faster for a while, then wears off', () => {
    const world = arena('archer');
    step(world, [{ type: 'skill', id: 'swiftness', dx: 0, dy: 0 }, { type: 'moveDir', dx: 1, dy: 0 }]);
    const fast = world.player.distance;
    expect(fast).toBeCloseTo((PLAYER_SPEED * 1.5 * TICK_MS) / 1000, 9);
    world.player.pos = { ...world.spawn };
    run(world, 200);
    const before = world.player.distance;
    world.player.pos = { ...world.spawn };
    step(world);
    expect(world.player.distance - before).toBeCloseTo((PLAYER_SPEED * TICK_MS) / 1000, 9);
  });
});

describe('mage skills', () => {
  it('Fire Bolt bursts and burns those next to its target, but less', () => {
    const world = arena('mage', [[4, 0], [4.8, 0.6], [4, 5]]);
    step(world, [{ type: 'skill', id: 'fireBolt', dx: 1, dy: 0 }]);
    run(world, 30);
    expect(hurt(world)).toEqual([0, 1]);
    const [target, neighbour] = world.monsters as [Monster, Monster];
    expect(target.maxHp - target.hp).toBeGreaterThan(neighbour.maxHp - neighbour.hp);
  });

  it('Frost Nova hits everything around at once and slows it', () => {
    const world = arena('mage', [[2, 0], [-2, 0], [0, 2], [6, 0]]);
    step(world, [{ type: 'skill', id: 'frostNova', dx: 0, dy: 0 }]);
    expect(hurt(world)).toEqual([0, 1, 2]);
    expect(world.monsters.slice(0, 3).every((m) => m.slowTicks > 0)).toBe(true);
    expect(world.monsters[3]!.slowTicks).toBe(0);
    // A slowed monster covers less ground.
    const slowed = world.monsters[0]!;
    const free = world.monsters[3]!;
    free.aggro = true; // too far to have noticed the hero by itself
    const start = [{ ...slowed.pos }, { ...free.pos }];
    step(world);
    const moved = (m: Monster, from: { x: number; y: number }) => Math.hypot(m.pos.x - from.x, m.pos.y - from.y);
    expect(moved(slowed, start[0]!)).toBeLessThan(moved(free, start[1]!));
  });

  it('Mend heals', () => {
    const world = arena('mage');
    world.player.hp = 10;
    step(world, [{ type: 'skill', id: 'mend', dx: 0, dy: 0 }]);
    expect(world.player.hp).toBe(10 + Math.round(world.player.maxHp * 0.35));
  });
});

describe('skills of other classes', () => {
  it('cannot be used or learned', () => {
    const world = arena('warrior');
    step(world, [{ type: 'skill', id: 'fireBolt', dx: 1, dy: 0 }]);
    expect(world.events).toEqual([{ type: 'skillDenied', id: 'fireBolt', reason: 'unlearned' }]);
    const village = createWorld(1, { ...newHero('human', 'warrior'), level: 10 }, undefined, 'overworld');
    const trainer = village.npcs.find((n) => n.kind === 'trainer')!;
    village.player.pos = { x: trainer.pos.x, y: trainer.pos.y + 1 };
    village.player.coins = 5000;
    step(village, [{ type: 'learn', id: 'fireBolt' }]);
    expect(village.events).toEqual([{ type: 'learnDenied', id: 'fireBolt', reason: 'class' }]);
    expect(village.player.coins).toBe(5000);
  });
});

describe('developer shortcuts', () => {
  it('do nothing in an ordinary game', () => {
    const world = createWorld(1, undefined, undefined, 'overworld');
    const before = JSON.stringify(world.player);
    step(world, [{ type: 'dev', action: 'levelUp' }, { type: 'dev', action: 'coins' }, { type: 'dev', action: 'kit' }, { type: 'dev', action: 'teleport', to: 'mines' }]);
    expect(JSON.stringify({ ...world.player, ticksSinceHurt: 0 })).toBe(before);
  });

  it('work in a development game', () => {
    const world = createWorld(1, undefined, undefined, 'overworld', null, true);
    step(world, [{ type: 'dev', action: 'levelUp' }, { type: 'dev', action: 'coins' }, { type: 'dev', action: 'kit' }]);
    expect(world.player.level).toBe(2);
    expect(world.player.coins).toBe(1000);
    expect(world.player.inventory.length).toBeGreaterThan(5);
    step(world, [{ type: 'dev', action: 'teleport', to: 'hollow' }]);
    expect(world.player.pos.x).toBeGreaterThan(58);
    world.player.hp = 3;
    step(world, [{ type: 'dev', action: 'heal' }]);
    expect(world.player.hp).toBe(world.player.maxHp);
  });
});
