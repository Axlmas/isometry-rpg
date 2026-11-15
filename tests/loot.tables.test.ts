import { describe, expect, it } from 'vitest';
import { type Monster, type MonsterKind, DROP_TABLES, ITEMS, MONSTER_KINDS, STARTING_WEAPONS, createWorld, step } from '../src/sim';

const KINDS = Object.keys(MONSTER_KINDS) as MonsterKind[];

describe('drop tables', () => {
  it('exist for every kind of monster and are well formed', () => {
    for (const kind of KINDS) {
      const table = DROP_TABLES[kind];
      expect(table.coins[0]).toBeGreaterThan(0);
      expect(table.coins[1]).toBeGreaterThanOrEqual(table.coins[0]);
      expect(table.drops.reduce((sum, entry) => sum + entry.chance, 0)).toBeLessThanOrEqual(100);
      for (const entry of table.drops) {
        expect(entry.chance).toBeGreaterThan(0);
        expect(entry.items.length).toBeGreaterThan(0);
        expect(entry.count[0]).toBeGreaterThan(0);
        expect(entry.count[1]).toBeGreaterThanOrEqual(entry.count[0]);
        for (const itemId of entry.items) {
          expect(ITEMS[itemId], `${kind}: ${itemId}`).toBeDefined();
          expect(STARTING_WEAPONS).not.toContain(itemId);
          expect(itemId).not.toBe('coins');
        }
      }
    }
  });

  it('make deeper monsters richer, and keep graded gear and recipes in the mines', () => {
    const average = (kind: MonsterKind) => (DROP_TABLES[kind].coins[0] + DROP_TABLES[kind].coins[1]) / 2;
    expect(average('boar')).toBeGreaterThan(average('wolf'));
    expect(average('grunt')).toBeGreaterThan(average('boar'));
    const drops = (kind: MonsterKind) => DROP_TABLES[kind].drops.flatMap((entry) => [...entry.items]);
    const graded = (kind: MonsterKind) => drops(kind).some((id) => { const d = ITEMS[id]; return d.kind === 'equipment' && d.grade === 'd'; });
    expect(graded('grunt')).toBe(true);
    expect(graded('wolf') || graded('boar')).toBe(false);
    expect(drops('grunt').some((id) => ITEMS[id].kind === 'recipe')).toBe(true);
    expect(drops('grunt')).toContain('ironOre');
    expect(drops('wolf')).toContain('leather');
    expect(drops('wolf')).not.toContain('ironOre');
  });

  it('are what monsters actually drop, about as often as written', () => {
    for (const kind of KINDS) {
      const table = DROP_TABLES[kind];
      const allowed = new Set(table.drops.flatMap((entry) => [...entry.items]));
      const expected = table.drops.reduce((sum, entry) => sum + entry.chance, 0) / 100;
      let withItem = 0;
      const kills = 400;
      for (let seed = 0; seed < kills; seed++) {
        const world = createWorld(seed);
        const { map } = world;
        for (let y = 1; y < map.height - 1; y++) for (let x = 1; x < map.width - 1; x++) map.tiles[y * map.width + x] = 0;
        const template = world.monsters[0] as Monster;
        world.monsters = [{ ...template, kind, elder: false, hp: 1, pos: { x: world.spawn.x + 1, y: world.spawn.y }, home: { ...world.spawn } }];
        step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
        for (let i = 0; i < 5 && world.monsters.length > 0; i++) step(world);
        expect(world.monsters).toEqual([]);
        const coins = world.loot.filter((l) => l.itemId === 'coins');
        expect(coins).toHaveLength(1);
        expect(coins[0]!.count).toBeGreaterThanOrEqual(table.coins[0]);
        expect(coins[0]!.count).toBeLessThanOrEqual(table.coins[1]);
        // The trophy is rolled apart from the table and has a test of its own.
        const others = world.loot.filter((l) => l.itemId !== 'coins' && l.itemId !== table.rare.itemId);
        expect(others.length).toBeLessThanOrEqual(1);
        for (const loot of others) expect(allowed.has(loot.itemId), `${kind} dropped ${loot.itemId}`).toBe(true);
        withItem += others.length;
      }
      // Loose bounds: this guards against a broken table, not the exact odds.
      expect(withItem / kills, kind).toBeGreaterThan(expected - 0.1);
      expect(withItem / kills, kind).toBeLessThan(expected + 0.1);
    }
  });
});
