import { describe, expect, it } from 'vitest';
import {
  type World, type ZoneKind, EXIT_RANGE, MONSTER_KINDS, PLAYER_MAX_HP, ZONE_KINDS, characterOf, circleFree, createWorld,
  findPath, isNearMerchant, isWalkable, monsterMaxHp, monsterXp, nearestExit, newCharacter, step, travelerOf,
} from '../src/sim';

const zone = (kind: ZoneKind, seed = 1, from: ZoneKind | null = null, level = 1): World =>
  createWorld(seed, { ...newCharacter('trainingSword'), level }, undefined, kind, from);
const tile = (p: { x: number; y: number }) => ({ x: Math.round(p.x), y: Math.round(p.y) });

describe('every zone', () => {
  it('lets the hero walk from the arrival point to every exit, merchant and monster', () => {
    for (const kind of ZONE_KINDS) {
      for (const seed of [1, 2, 3, 77, 4242]) {
        const world = zone(kind, seed);
        expect(circleFree(world.map, world.player.pos, 0.3)).toBe(true);
        const targets = [...world.exits.map((e) => e.pos), ...world.monsters.map((m) => m.pos)];
        if (world.merchant) targets.push(world.merchant);
        for (const target of targets) {
          expect(isWalkable(world.map, target.x, target.y)).toBe(true);
          expect(findPath(world.map, tile(world.player.pos), tile(target)), `${kind} seed ${seed}`).not.toBeNull();
        }
      }
    }
  });

  it('has a way out', () => {
    for (const kind of ZONE_KINDS) expect(zone(kind).exits.length).toBeGreaterThan(0);
  });

  it('is built the same way from the same seed', () => {
    for (const kind of ZONE_KINDS) expect(zone(kind, 9)).toEqual(zone(kind, 9));
  });
});

describe('village', () => {
  it('is safe, has the merchant and leads to the field', () => {
    const world = zone('village');
    expect(world.monsters).toEqual([]);
    expect(world.merchant).not.toBeNull();
    expect(world.exits.map((e) => e.to)).toEqual(['field']);
    // A hero standing still in the village is never hurt.
    for (let i = 0; i < 400; i++) step(world);
    expect(world.player.hp).toBe(PLAYER_MAX_HP);
  });

  it('is the same whatever the seed', () => {
    expect(zone('village', 1).map).toEqual(zone('village', 999).map);
  });
});

describe('field', () => {
  it('connects the village and the dungeon and is home to wolves', () => {
    const world = zone('field');
    expect(world.exits.map((e) => e.to).sort()).toEqual(['dungeon', 'village']);
    expect(world.merchant).toBeNull();
    expect(world.monsters.length).toBeGreaterThan(0);
    expect(world.monsters.every((m) => m.kind === 'wolf')).toBe(true);
  });

  it('has weaker, faster and less rewarding monsters than the dungeon', () => {
    expect(monsterMaxHp(3, 'wolf')).toBeLessThan(monsterMaxHp(3, 'grunt'));
    expect(monsterXp(3, 'wolf')).toBeLessThan(monsterXp(3, 'grunt'));
    expect(MONSTER_KINDS.wolf.speed).toBeGreaterThan(MONSTER_KINDS.grunt.speed);
    expect(zone('field', 1, null, 3).monsters[0]?.maxHp).toBe(monsterMaxHp(3, 'wolf'));
  });

  it('keeps wolves slower than the hero, so running away is possible', () => {
    const world = zone('field', 3);
    for (const monster of world.monsters) monster.aggro = true;
    step(world, [{ type: 'moveDir', dx: -1, dy: 0 }]);
    const wolf = world.monsters[0];
    if (!wolf) return;
    const before = { ...wolf.pos };
    step(world);
    expect(Math.hypot(wolf.pos.x - before.x, wolf.pos.y - before.y)).toBeLessThan((4.5 * 50) / 1000);
  });
});

describe('dungeon', () => {
  it('has no merchant and leads back to the field', () => {
    const world = zone('dungeon');
    expect(world.merchant).toBeNull();
    expect(isNearMerchant(world)).toBe(false);
    expect(world.exits.map((e) => e.to)).toEqual(['field']);
    expect(world.monsters.every((m) => m.kind === 'grunt')).toBe(true);
  });
});

describe('travel', () => {
  it('is announced only when the hero stands at an exit', () => {
    const world = zone('village');
    step(world, [{ type: 'travel' }]);
    expect(world.events).toEqual([]); // the new hero starts in the middle of the village
    expect(nearestExit(world)).toBeNull();
    const gate = world.exits[0]!;
    world.player.pos = { x: gate.pos.x - EXIT_RANGE + 0.1, y: gate.pos.y };
    step(world, [{ type: 'travel' }]);
    expect(world.events).toEqual([{ type: 'travel', to: 'field' }]);
  });

  it('is not possible for a dead hero', () => {
    const world = zone('dungeon');
    world.player.hp = 0;
    step(world, [{ type: 'travel' }]);
    expect(world.events).toEqual([]);
  });

  it('puts the hero at the exit that leads back where they came from', () => {
    const field = zone('field', 5, 'dungeon');
    const door = field.exits.find((e) => e.to === 'dungeon')!;
    expect(field.player.pos).toEqual(door.pos);
    expect(nearestExit(field)?.to).toBe('dungeon');
    const fromVillage = zone('field', 5, 'village');
    expect(nearestExit(fromVillage)?.to).toBe('village');
    const village = zone('village', 5, 'field');
    expect(nearestExit(village)?.to).toBe('field');
  });

  it('keeps monsters away from where the hero arrives', () => {
    for (const from of ['village', 'dungeon'] as const) {
      const field = zone('field', 8, from);
      for (const monster of field.monsters) {
        expect(Math.hypot(monster.pos.x - field.player.pos.x, monster.pos.y - field.player.pos.y)).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it('carries current health and mana when walking, and restores them when resting', () => {
    const world = zone('field');
    world.player.hp = 33;
    world.player.mp = 7;
    const walking = createWorld(2, travelerOf(world), undefined, 'dungeon', 'field');
    expect(walking.player).toMatchObject({ hp: 33, mp: 7 });
    const resting = createWorld(2, characterOf(world), undefined, 'village', 'field');
    expect(resting.player).toMatchObject({ hp: PLAYER_MAX_HP, mp: resting.player.maxMp });
  });

  it('never lets carried-over health be impossible', () => {
    const hero = { ...newCharacter('trainingSword'), hp: 99999, mp: -5 };
    expect(createWorld(1, hero).player).toMatchObject({ hp: PLAYER_MAX_HP, mp: 0 });
    expect(createWorld(1, { ...hero, hp: 0 }).player.hp).toBe(1);
    expect(createWorld(1, { ...hero, hp: Number.NaN }).player.hp).toBeGreaterThan(0);
  });
});
