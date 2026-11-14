import { describe, expect, it } from 'vitest';
import { type KeyValueStore, SAVE_VERSION, loadLocale, loadWorld, parseSave, saveLocale, saveWorld, serializeWorld } from '../src/client/save';
import { createWorld, step } from '../src/sim';

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
    step(world, [{ type: 'moveTo', x: world.spawn.x + 1, y: world.spawn.y + 1 }]);
    for (let i = 0; i < 50; i++) step(world);

    const store = memoryStore();
    expect(saveWorld(store, world)).toBe(true);
    const loaded = loadWorld(store);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.world.map).toEqual(world.map);
    expect(loaded.world.player.pos).toEqual(world.player.pos);
    expect(loaded.world.player.tilesWalked).toBe(world.player.tilesWalked);
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
      JSON.stringify({ ...good, tilesWalked: -5 }),
      JSON.stringify({ ...good, tilesWalked: 1.5 }),
    ];
    for (const raw of cases) expect(parseSave(raw).status, raw).toBe('damaged');
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
