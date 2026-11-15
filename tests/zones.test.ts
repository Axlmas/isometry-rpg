import { describe, expect, it } from 'vitest';
import {
  type Monster, type World, type ZoneKind, EXIT_RANGE, MINES_MIN_LEVEL, PLAYER_SPEED, REGION_SITES, TILE_ROCK, TILE_RUIN, TILE_WATER, MONSTER_KINDS, MONSTER_LEASH,
  MONSTER_RESPAWN_TIME, PLAYER_MAX_HP, REGIONS, WORLD_HEIGHT, WORLD_WIDTH, characterOf, circleFree,
  createWorld, findPath, isRoad, isWalkable, minesLevelFor, monsterMaxHp, monsterXp, nearestExit,
  newCharacter, regionAt, step, travelerOf,
} from '../src/sim';

const build = (zone: ZoneKind, seed = 1, from: ZoneKind | null = null, level = 1): World =>
  createWorld(seed, { ...newCharacter('trainingSword'), level }, minesLevelFor(level), zone, from);
const tile = (p: { x: number; y: number }) => ({ x: Math.round(p.x), y: Math.round(p.y) });
const run = (world: World, ticks: number) => {
  for (let i = 0; i < ticks; i++) step(world);
};
/** A lone wolf placed relative to the hero, on ground cleared for the purpose out on the moor. */
function meadow(dx: number, dy: number): { world: World; monster: Monster } {
  const world = build('overworld');
  const { map } = world;
  const at = { x: 60, y: 24 };
  for (let y = at.y - 20; y <= at.y + 20; y++) {
    for (let x = at.x - 8; x <= at.x + 17; x++) map.tiles[y * map.width + x] = 0;
  }
  world.player.pos = { ...at };
  const monster: Monster = { ...(world.monsters[0] as Monster), id: 0, kind: 'wolf', elder: false, rest: 100000, home: { x: at.x + dx, y: at.y + dy }, pos: { x: at.x + dx, y: at.y + dy } };
  world.monsters = [monster];
  return { world, monster };
}

describe('open world', () => {
  const world = build('overworld');

  it('is one large map, the same whatever the seed', () => {
    expect(world.map.width).toBe(WORLD_WIDTH);
    expect(world.map.height).toBe(WORLD_HEIGHT);
    const other = build('overworld', 987654);
    expect(other.map).toEqual(world.map);
    expect(other.monsters).toEqual(world.monsters);
  });

  it('starts a new hero in the village, next to no danger', () => {
    expect(regionAt('overworld', world.player.pos)).toBe(REGIONS.village);
    expect(circleFree(world.map, world.player.pos, 0.3)).toBe(true);
    for (const monster of world.monsters) {
      expect(Math.hypot(monster.pos.x - world.player.pos.x, monster.pos.y - world.player.pos.y)).toBeGreaterThan(8);
    }
  });

  it('lets the hero walk from the village square to every villager, every monster and the mines', () => {
    const from = tile(world.player.pos);
    const targets = [...world.npcs.map((n) => n.pos), ...world.exits.map((e) => e.pos), ...world.monsters.map((m) => m.home)];
    for (const target of targets) {
      expect(isWalkable(world.map, target.x, target.y)).toBe(true);
      expect(findPath(world.map, from, tile(target))).not.toBeNull();
    }
  });

  it('has a winding road from the village gate to the mine door with nothing on it', () => {
    const door = world.exits[0]!.pos;
    const rows = new Set<number>();
    for (let x = 34; x <= door.x; x++) {
      const road = [];
      for (let y = 0; y < WORLD_HEIGHT; y++) if (isRoad('overworld', x, y)) road.push(y);
      expect(road.length).toBeGreaterThanOrEqual(2);
      for (const y of road) expect(isWalkable(world.map, x, y)).toBe(true);
      rows.add(road[0]!);
    }
    // It bends: the road does not keep to one row.
    expect(rows.size).toBeGreaterThan(5);
    expect(isRoad('overworld', door.x, door.y)).toBe(true);
    expect(isRoad('dungeon', 12, door.y)).toBe(false);
  });

  it('is shaped by nature, not by a ruler: wavering borders, water, boulders and a ruin', () => {
    const count = (kind: number) => world.map.tiles.filter((t) => t === kind).length;
    expect(count(TILE_WATER)).toBeGreaterThan(100);
    expect(count(TILE_ROCK)).toBeGreaterThan(20);
    expect(count(TILE_RUIN)).toBeGreaterThan(8);
    // Where the moor gives way to the hollow differs from column to column.
    const ends = new Set<number>();
    for (let x = 52; x < 88; x++) {
      let y = 10;
      while (y < WORLD_HEIGHT && regionAt('overworld', { x, y }).id === 'moor') y += 1;
      ends.add(y);
    }
    expect(ends.size).toBeGreaterThan(6);
    // Between a third and two thirds of the wilds is open ground: woods with room to walk.
    const open = world.map.tiles.filter((t) => t === 0).length / world.map.tiles.length;
    expect(open).toBeGreaterThan(0.4);
    expect(open).toBeLessThan(0.8);
  });
});

describe('regions', () => {
  const world = build('overworld');

  it('give every point of the world a region', () => {
    expect(regionAt('overworld', world.player.pos).id).toBe('village');
    for (const id of ['pasture', 'moor', 'hollow', 'thicket'] as const) expect(regionAt('overworld', REGION_SITES[id]).id).toBe(id);
    expect(regionAt('dungeon', { x: 3, y: 3 }).id).toBe('mines');
  });

  it('hold monsters of their own kind and level range, harder further from the village', () => {
    const seen = new Set<string>();
    for (const monster of world.monsters) {
      const region = regionAt('overworld', monster.home);
      seen.add(region.id);
      expect(region.safe).toBe(false);
      expect(monster.kind).toBe(region.monsterKind);
      const [min, max] = region.levels!;
      expect(monster.level).toBeGreaterThanOrEqual(min);
      expect(monster.level).toBeLessThanOrEqual(max);
      expect(monster.maxHp).toBe(monsterMaxHp(monster.level, monster.kind, monster.elder));
    }
    expect([...seen].sort()).toEqual(['hollow', 'moor', 'pasture', 'thicket']);
    expect(REGIONS.moor.levels![0]).toBeGreaterThan(REGIONS.pasture.levels![1]);
    expect(REGIONS.thicket.levels![1]).toBeGreaterThan(REGIONS.hollow.levels![1]);
  });

  it('do not scale the open world to the hero', () => {
    const strong = build('overworld', 1, null, 15);
    expect(strong.monsters.map((m) => m.level)).toEqual(world.monsters.map((m) => m.level));
  });

  it('make each kind of monster different', () => {
    expect(monsterMaxHp(3, 'wolf')).toBeLessThan(monsterMaxHp(3, 'grunt'));
    expect(monsterXp(3, 'wolf')).toBeLessThan(monsterXp(3, 'boar'));
    expect(MONSTER_KINDS.wolf.speed).toBeGreaterThan(MONSTER_KINDS.boar.speed);
    // A wolf cannot be outrun; a boar can.
    expect(MONSTER_KINDS.wolf.speed).toBeGreaterThan(PLAYER_SPEED);
    expect(MONSTER_KINDS.boar.speed).toBeLessThan(PLAYER_SPEED);
    // The first prey of a new hero and the boars mind their own business; wolves and tuskers do not.
    expect([MONSTER_KINDS.wolfPup.aggro, MONSTER_KINDS.boar.aggro]).toEqual([0, 0]);
    expect(Math.min(MONSTER_KINDS.wolf.aggro, MONSTER_KINDS.tusker.aggro)).toBeGreaterThan(3);
  });
});

describe('the village', () => {
  it('restores a resting hero quickly', () => {
    const world = build('overworld');
    world.player.hp = 1;
    world.player.mp = 0;
    run(world, 60); // three seconds
    expect(world.player.hp).toBeGreaterThan(25);
    expect(world.player.mp).toBeGreaterThan(25);
  });

  it('is never entered by a hunting monster: the chase ends at the gate', () => {
    const world = build('overworld');
    const monster: Monster = { ...(world.monsters[0] as Monster), id: 0, kind: 'wolf', aggro: true };
    monster.pos = { x: world.player.pos.x + 3, y: world.player.pos.y };
    monster.home = { x: 45, y: 41 };
    world.monsters = [monster];
    run(world, 5);
    expect(world.player.hp).toBe(PLAYER_MAX_HP);
    expect(world.monsters[0]).toMatchObject({ aggro: false, returning: true });
  });
});

describe('monsters in the open world', () => {
  it('give up the chase far from home, walk back, heal and can be provoked again', () => {
    const { world } = meadow(4, 0);
    step(world, [{ type: 'moveDir', dx: 1, dy: 0 }]); // run east, past the monster and away
    let gaveUp = false;
    for (let i = 0; i < 400 && !gaveUp; i++) {
      step(world);
      world.player.hp = world.player.maxHp;
      gaveUp = world.monsters[0]!.returning;
    }
    expect(gaveUp).toBe(true);
    const monster = world.monsters[0]!;
    expect(Math.hypot(monster.pos.x - monster.home.x, monster.pos.y - monster.home.y)).toBeGreaterThan(MONSTER_LEASH - 1);
    monster.hp = 1;
    step(world, [{ type: 'moveDir', dx: 0, dy: 0 }]);
    for (let i = 0; i < 400 && world.monsters[0]!.returning; i++) step(world);
    expect(world.monsters[0]).toMatchObject({ returning: false, aggro: false, hp: monster.maxHp });
    expect(Math.hypot(monster.pos.x - monster.home.x, monster.pos.y - monster.home.y)).toBeLessThan(0.5);
  });

  it('ignore the hero while walking home, unless hit', () => {
    const { world } = meadow(1, 0);
    const monster = world.monsters[0]!;
    monster.returning = true;
    monster.home = { x: monster.pos.x + 6, y: monster.pos.y };
    run(world, 10);
    expect(world.player.hp).toBe(PLAYER_MAX_HP);
    world.player.pos = { x: world.monsters[0]!.pos.x - 1, y: world.monsters[0]!.pos.y };
    step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
    run(world, 3);
    expect(world.monsters[0]).toMatchObject({ returning: false, aggro: true });
  });

  it('come back at their place some time after dying, but not under the hero’s feet', () => {
    const { world } = meadow(1, 0);
    world.monsters[0]!.hp = 1;
    step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
    run(world, 3);
    expect(world.monsters).toEqual([]);
    expect(world.respawns).toHaveLength(1);
    run(world, MONSTER_RESPAWN_TIME + 20);
    expect(world.monsters).toEqual([]); // the hero is still standing there
    world.player.pos = { x: world.player.pos.x - 6, y: world.player.pos.y - 10 };
    run(world, 2);
    expect(world.respawns).toEqual([]);
    expect(world.monsters).toHaveLength(1);
    const back = world.monsters[0]!;
    expect(back).toMatchObject({ hp: back.maxHp, aggro: false, returning: false });
    expect(back.pos).toEqual(back.home);
  });

  it('stay dead in a dungeon', () => {
    const world = build('dungeon');
    const victim = world.monsters[0]!;
    victim.pos = { x: world.player.pos.x + 1, y: world.player.pos.y }; // the tiles around the entrance are always free
    victim.hp = 1;
    for (let i = 0; i < 10 && world.monsters.length === 9; i++) {
      const target = world.monsters[0]!;
      step(world, [{ type: 'attack', dx: target.pos.x - world.player.pos.x, dy: target.pos.y - world.player.pos.y }]);
    }
    expect(world.monsters).toHaveLength(8);
    expect(world.respawns).toEqual([]);
  });
});

describe('the mines', () => {
  it('are a separate map with no villagers, at least level 4, matching a stronger hero', () => {
    const world = build('dungeon');
    expect(world.npcs).toEqual([]);
    expect(world.dungeonLevel).toBe(MINES_MIN_LEVEL);
    expect(world.monsters.every((m) => m.kind === 'grunt' && m.level === MINES_MIN_LEVEL)).toBe(true);
    expect(build('dungeon', 1, null, 12).monsters[0]?.level).toBe(12);
    expect(world.exits.map((e) => e.to)).toEqual(['overworld']);
  });

  it('differ from seed to seed', () => {
    expect(build('dungeon', 1).map).not.toEqual(build('dungeon', 2).map);
    expect(build('dungeon', 9)).toEqual(build('dungeon', 9));
  });
});

describe('going in and out of the mines', () => {
  it('is announced only when the hero stands at the door', () => {
    const world = build('overworld');
    step(world, [{ type: 'travel' }]);
    expect(world.events).toEqual([]);
    expect(nearestExit(world)).toBeNull();
    const door = world.exits[0]!;
    world.player.pos = { x: door.pos.x - EXIT_RANGE + 0.1, y: door.pos.y };
    step(world, [{ type: 'travel' }]);
    expect(world.events).toEqual([{ type: 'travel', to: 'dungeon' }]);
  });

  it('is not possible for a dead hero', () => {
    const world = build('dungeon');
    world.player.hp = 0;
    step(world, [{ type: 'travel' }]);
    expect(world.events).toEqual([]);
  });

  it('brings the hero out at the mine door, not in the village', () => {
    const outside = build('overworld', 5, 'dungeon');
    expect(outside.player.pos).toEqual(outside.exits[0]!.pos);
    expect(regionAt('overworld', outside.player.pos).id).toBe('thicket');
    expect(nearestExit(outside)?.to).toBe('dungeon');
    for (const monster of outside.monsters) {
      expect(Math.hypot(monster.pos.x - outside.player.pos.x, monster.pos.y - outside.player.pos.y)).toBeGreaterThanOrEqual(5);
    }
  });

  it('carries current health and mana, and a fallen hero wakes restored', () => {
    const world = build('overworld');
    world.player.hp = 33;
    world.player.mp = 7;
    expect(createWorld(2, travelerOf(world), 4, 'dungeon', 'overworld').player).toMatchObject({ hp: 33, mp: 7 });
    const woken = createWorld(2, characterOf(world), 4, 'overworld');
    expect(woken.player).toMatchObject({ hp: PLAYER_MAX_HP, mp: woken.player.maxMp });
    expect(regionAt('overworld', woken.player.pos).id).toBe('village');
  });

  it('never lets carried-over health be impossible', () => {
    const hero = { ...newCharacter('trainingSword'), hp: 99999, mp: -5 };
    expect(createWorld(1, hero).player).toMatchObject({ hp: PLAYER_MAX_HP, mp: 0 });
    expect(createWorld(1, { ...hero, hp: 0 }).player.hp).toBe(1);
    expect(createWorld(1, { ...hero, hp: Number.NaN }).player.hp).toBeGreaterThan(0);
  });
});

describe('dying in the open world', () => {
  it('sends the hero back to the village with full health', () => {
    const { world } = meadow(0.9, 0);
    for (let i = 0; i < 5000 && world.player.hp > 0; i++) step(world);
    expect(world.player.hp).toBe(0);
    step(world, [{ type: 'respawn' }]);
    expect(world.events).toContainEqual({ type: 'playerRespawned' });
    expect(regionAt('overworld', world.player.pos).id).toBe('village');
    expect(world.player.hp).toBe(world.player.maxHp);
  });
});
