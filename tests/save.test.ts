import { describe, expect, it } from 'vitest';
import { type KeyValueStore, SAVE_VERSION, loadLocale, loadWorld, parseSave, saveLocale, saveWorld, serializeWorld } from '../src/client/save';
import { createWorld, newCharacter, step } from '../src/sim';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const brokenStore: KeyValueStore = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('quota exceeded'); },
  removeItem: () => { throw new Error('blocked'); },
};

describe('save', () => {
  it('restores the dungeon, position and step count', () => {
    const world = createWorld(31337);
    step(world, [{ type: 'moveTo', x: world.spawn.x + 0.6, y: world.spawn.y + 0.85 }]);
    for (let i = 0; i < 50; i++) step(world);
    expect(Number.isInteger(world.player.pos.x)).toBe(false);

    const store = memoryStore();
    expect(saveWorld(store, world)).toBe(true);
    const loaded = loadWorld(store);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.world.map).toEqual(world.map);
    expect(loaded.world.player.pos).toEqual(world.player.pos);
    expect(loaded.world.player.distance).toBe(world.player.distance);
    expect(loaded.world.rngState).toBe(world.rngState);
  });

  it('remembers health and which monsters are dead; survivors are back at full health', () => {
    const world = createWorld(31337);
    world.player.hp = 37;
    world.monsters = world.monsters.filter((m) => m.id !== 2 && m.id !== 5);
    (world.monsters[0] as { hp: number }).hp = 1;
    const loaded = parseSave(serializeWorld(world));
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.world.player.hp).toBe(37);
    expect(loaded.world.monsters.map((m) => m.id)).toEqual([0, 1, 3, 4, 6, 7, 8]);
    expect(loaded.world.monsters.every((m) => m.hp === m.maxHp)).toBe(true);
    expect(loaded.world.monsterTotal).toBe(9);
  });

  it('remembers coins, bag, worn equipment and loot on the floor', () => {
    const world = createWorld(31337);
    world.player.coins = 123;
    world.player.inventory = [{ itemId: 'coal', count: 40 }, { itemId: 'ironSword', count: 1 }];
    world.player.equipment = { weapon: 'soldierBlade', helmet: null, armor: 'chainShirt', boots: null };
    world.loot = [{ id: 7, itemId: 'coins', count: 9, pos: { x: world.spawn.x + 0.5, y: world.spawn.y }, ignored: true }];
    const loaded = parseSave(serializeWorld(world));
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.world.player.coins).toBe(123);
    expect(loaded.world.player.inventory).toEqual(world.player.inventory);
    expect(loaded.world.player.equipment).toEqual(world.player.equipment);
    expect(loaded.world.loot).toEqual([{ id: 0, itemId: 'coins', count: 9, pos: { x: world.spawn.x + 0.5, y: world.spawn.y }, ignored: false }]);
  });

  it('remembers level, experience, mana and the dungeon level', () => {
    const world = createWorld(31337, { ...newCharacter('trainingSword'), level: 5, xp: 77 }, 3);
    world.player.mp = 11;
    const loaded = parseSave(serializeWorld(world));
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.world.player).toMatchObject({ level: 5, xp: 77, mp: 11, maxHp: world.player.maxHp, maxMp: world.player.maxMp });
    expect(loaded.world.dungeonLevel).toBe(3);
    expect(loaded.world.monsters[0]?.maxHp).toBe(world.monsters[0]?.maxHp);
  });

  it('remembers consumables and whether charges are switched on', () => {
    const world = createWorld(31337);
    world.player.inventory = [{ itemId: 'chargePlain', count: 5000 }, { itemId: 'healthPotion', count: 12 }];
    world.player.chargesOn = true;
    const loaded = parseSave(serializeWorld(world));
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.world.player.inventory).toEqual(world.player.inventory);
    expect(loaded.world.player.chargesOn).toBe(true);
    const good = JSON.parse(serializeWorld(world)) as Record<string, unknown>;
    for (const change of [{ chargesOn: 'yes' }, { chargesOn: 1 }, { inventory: [{ id: 'healthPotion', count: 100 }] }, { inventory: [{ id: 'chargeD', count: 10000 }] }]) {
      expect(parseSave(JSON.stringify({ ...good, ...change })).status, JSON.stringify(change)).toBe('damaged');
    }
  });

  it('remembers which map the hero is on and where', () => {
    const dungeon = createWorld(31337, undefined, 4, 'dungeon');
    dungeon.monsters = dungeon.monsters.filter((m) => m.id !== 3);
    const loadedDungeon = parseSave(serializeWorld(dungeon));
    expect(loadedDungeon.status === 'ok' && loadedDungeon.world).toMatchObject({ zone: 'dungeon', dungeonLevel: 4, map: dungeon.map });
    expect(loadedDungeon.status === 'ok' && loadedDungeon.world.monsters.map((m) => m.id)).toEqual([0, 1, 2, 4, 5, 6, 7, 8]);

    const overworld = createWorld(31337, undefined, undefined, 'overworld');
    overworld.player.pos = { x: 45.5, y: 29.25 }; // on the road, out on the moor
    overworld.monsters = overworld.monsters.slice(3); // killed monsters come back, so they are not remembered
    const loaded = parseSave(serializeWorld(overworld));
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.world.zone).toBe('overworld');
    expect(loaded.world.player.pos).toEqual({ x: 45.5, y: 29.25 });
    expect(loaded.world.monsters).toHaveLength(overworld.monsterTotal);

    const good = JSON.parse(serializeWorld(createWorld(1))) as Record<string, unknown>;
    for (const zone of ['village', 'field', 'castle', null, 3, undefined]) {
      expect(parseSave(JSON.stringify({ ...good, zone })).status, String(zone)).toBe('damaged');
    }
  });

  it('moves heroes saved in the old separate village or field into the open-world village', () => {
    const v7 = { ...(JSON.parse(serializeWorld(createWorld(1))) as Record<string, unknown>), version: 7 };
    for (const zone of ['village', 'field']) {
      const loaded = parseSave(JSON.stringify({ ...v7, zone, x: 3, y: 17, dead: [1, 2], loot: [{ id: 'coal', count: 1, x: 5, y: 17 }] }));
      expect(loaded.status, zone).toBe('ok');
      if (loaded.status !== 'ok') continue;
      const fresh = createWorld(1, undefined, undefined, 'overworld');
      expect(loaded.world.zone).toBe('overworld');
      expect(loaded.world.player.pos).toEqual(fresh.spawn);
      expect(loaded.world.loot).toEqual([]);
    }
    const kept = parseSave(JSON.stringify({ ...v7, zone: 'dungeon' }));
    expect(kept.status === 'ok' && kept.world.zone).toBe('dungeon');
  });

  it('rejects saves with impossible progress', () => {
    const good = JSON.parse(serializeWorld(createWorld(1))) as Record<string, unknown>;
    const cases: Array<Record<string, unknown>> = [
      { level: 0 }, { level: 21 }, { level: 2.5 }, { level: '20' },
      { xp: -1 }, { xp: 50 }, // level 1 needs 50, so 50 would already be level 2
      { level: 20, xp: 1 },
      { mp: 41 }, { mp: -1 }, { mp: 1.5 },
      { dungeonLevel: 0 }, { dungeonLevel: 99 }, { dungeonLevel: null },
      { level: 20, hp: 9999 },
    ];
    for (const change of cases) expect(parseSave(JSON.stringify({ ...good, ...change })).status, JSON.stringify(change)).toBe('damaged');
    expect(parseSave(JSON.stringify({ ...good, level: 20, xp: 0, hp: 385, mp: 154 })).status).toBe('ok');
  });

  it('rejects saves with impossible belongings', () => {
    const good = JSON.parse(serializeWorld(createWorld(1))) as Record<string, unknown>;
    const sword = { id: 'ironSword', count: 1 };
    const cases: Array<Record<string, unknown>> = [
      { coins: -1 }, { coins: 1.5 }, { coins: '999' },
      { inventory: 'everything' },
      { inventory: [{ id: 'godSword', count: 1 }] },
      { inventory: [{ id: 'ironSword', count: 2 }] }, // equipment does not stack
      { inventory: [{ id: 'coal', count: 100 }] }, // above the stack limit
      { inventory: [{ id: 'coal', count: 0 }] },
      { inventory: [{ id: 'coins', count: 5 }] }, // coins are not carried in the bag
      { inventory: Array.from({ length: 25 }, () => sword) }, // more than the bag holds
      { equipment: { weapon: 'ironHelm', helmet: null, armor: null, boots: null } }, // wrong slot
      { equipment: { weapon: 'coal', helmet: null, armor: null, boots: null } },
      { equipment: { weapon: null, helmet: null, armor: null, boots: null, cloak: 'ironHelm' } },
      { equipment: { weapon: null } },
      { equipment: null },
      { loot: [{ id: 'coal', count: 1, x: 0, y: 0 }] }, // inside a wall
      { loot: [{ id: 'coal', count: 1, x: 'a', y: 2 }] },
      { loot: [{ id: 'nope', count: 1, x: 12, y: 12 }] },
      { loot: {} },
    ];
    for (const change of cases) expect(parseSave(JSON.stringify({ ...good, ...change })).status, JSON.stringify(change)).toBe('damaged');
  });

  it('keeps the hero dead if the game was closed on the defeat screen', () => {
    const world = createWorld(8);
    world.player.hp = 0;
    const loaded = parseSave(serializeWorld(world));
    expect(loaded.status === 'ok' && loaded.world.player.hp).toBe(0);
  });

  it('reports no save on first launch', () => {
    expect(loadWorld(memoryStore()).status).toBe('none');
    expect(loadWorld(null).status).toBe('none');
  });

  it('rejects damaged, edited and outdated saves', () => {
    const good = JSON.parse(serializeWorld(createWorld(1))) as Record<string, unknown>;
    const cases: string[] = [
      'not json',
      'null',
      '[]',
      JSON.stringify({ ...good, version: SAVE_VERSION + 1 }),
      JSON.stringify({ ...good, seed: 'abc' }),
      JSON.stringify({ ...good, x: 0, y: 0 }), // inside a wall
      JSON.stringify({ ...good, x: 1e9 }),
      JSON.stringify({ ...good, x: 0.7 }), // overlapping a wall
      JSON.stringify({ ...good, x: null }),
      JSON.stringify({ ...good, y: '3' }),
      JSON.stringify({ ...good, distance: -5 }),
      JSON.stringify({ ...good, distance: 1e999 }),
      JSON.stringify({ ...good, version: 1 }), // v1 needs tilesWalked
      JSON.stringify({ ...good, hp: 101 }),
      JSON.stringify({ ...good, hp: -1 }),
      JSON.stringify({ ...good, hp: 50.5 }),
      JSON.stringify({ ...good, hp: undefined }),
      JSON.stringify({ ...good, dead: [9] }),
      JSON.stringify({ ...good, dead: [1, 1] }),
      JSON.stringify({ ...good, dead: 'all' }),
      JSON.stringify({ ...good, dead: [0.5] }),
      JSON.stringify({ ...good, rngState: -1 }),
      JSON.stringify({ ...good, rngState: 2 ** 40 }),
    ];
    for (const raw of cases) expect(parseSave(raw).status, raw).toBe('damaged');
  });

  it('upgrades saves from earlier versions to a fresh start in the same dungeon', () => {
    const fresh = createWorld(1);
    for (const old of [
      { version: 1, seed: 1, x: 9, y: 9, tilesWalked: 12 },
      { version: 2, seed: 1, x: 9.4, y: 8.1, distance: 12 },
      { version: 3, seed: 1, x: null, y: null, distance: 12, hp: 100, dead: [], rngState: null },
      { version: 4, seed: 1, x: null, y: null, distance: 12, hp: 100, dead: [], rngState: null, coins: 0, inventory: [],
        equipment: { weapon: 'trainingSword', helmet: null, armor: null, boots: null }, loot: [] },
      { version: 5, seed: 1, x: null, y: null, distance: 12, hp: 100, dead: [], rngState: null, coins: 0, inventory: [],
        equipment: { weapon: 'trainingSword', helmet: null, armor: null, boots: null }, loot: [], level: 1, xp: 0, mp: null, dungeonLevel: 1 },
      { version: 6, seed: 1, x: null, y: null, distance: 12, hp: 100, dead: [], rngState: null, coins: 0, inventory: [],
        equipment: { weapon: 'trainingSword', helmet: null, armor: null, boots: null }, loot: [], level: 1, xp: 0, mp: null, dungeonLevel: 1, chargesOn: false },
    ]) {
      const loaded = parseSave(JSON.stringify(old));
      expect(loaded.status).toBe('ok');
      if (loaded.status !== 'ok') continue;
      expect(loaded.world.player.distance).toBe(12);
      expect(loaded.world.player.pos).toEqual(fresh.spawn);
      expect(loaded.world.player.hp).toBe(fresh.player.maxHp);
      expect(loaded.world.monsters).toEqual(fresh.monsters);
      expect(loaded.world.player.equipment).toEqual(fresh.player.equipment);
      expect(loaded.world.player.inventory).toEqual([]);
      expect(loaded.world.player).toMatchObject({ level: 1, xp: 0, mp: fresh.player.maxMp });
      expect(loaded.world.dungeonLevel).toBe(1);
      expect(loaded.world.player.chargesOn).toBe(false);
      expect(loaded.world.zone).toBe('dungeon');
    }
  });

  it('survives storage that throws', () => {
    expect(saveWorld(brokenStore, createWorld(1))).toBe(false);
    expect(saveWorld(null, createWorld(1))).toBe(false);
    expect(loadWorld(brokenStore).status).toBe('damaged');
    expect(loadLocale(brokenStore)).toBeNull();
    expect(() => saveLocale(brokenStore, 'ru')).not.toThrow();
  });

  it('remembers the chosen language', () => {
    const store = memoryStore();
    expect(loadLocale(store)).toBeNull();
    saveLocale(store, 'ru');
    expect(loadLocale(store)).toBe('ru');
  });
});
