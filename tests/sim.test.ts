import { describe, expect, it } from 'vitest';
import {
  type GridMap, type Tile, TICK_MS, PLAYER_SPEED, TILE_FLOOR, TILE_WALL,
  createRng, createWorld, findPath, isMoving, isWalkable, step, tileAt,
} from '../src/sim';

function mapFrom(rows: string[]): GridMap {
  const tiles: Tile[] = rows.flatMap((row) => [...row].map((c) => (c === '#' ? TILE_WALL : TILE_FLOOR)));
  return { width: (rows[0] as string).length, height: rows.length, tiles };
}

describe('rng', () => {
  it('gives the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });
  it('gives different sequences for different seeds', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });
  it('keeps integers inside the requested range', () => {
    const rng = createRng(7);
    for (let i = 0; i < 500; i++) {
      const n = rng.int(3, 6);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
    }
  });
});

describe('grid', () => {
  it('treats everything outside the map and fractional tiles as walls', () => {
    const map = mapFrom(['..', '..']);
    expect(tileAt(map, -1, 0)).toBe(TILE_WALL);
    expect(tileAt(map, 2, 0)).toBe(TILE_WALL);
    expect(isWalkable(map, 0.5, 0)).toBe(false);
    expect(isWalkable(map, Number.NaN, 0)).toBe(false);
  });
});

describe('findPath', () => {
  it('returns an empty path when already there', () => {
    expect(findPath(mapFrom(['..']), { x: 0, y: 0 }, { x: 0, y: 0 })).toEqual([]);
  });
  it('walks diagonally in open space', () => {
    const map = mapFrom(['...', '...', '...']);
    expect(findPath(map, { x: 0, y: 0 }, { x: 2, y: 2 })).toEqual([{ x: 1, y: 1 }, { x: 2, y: 2 }]);
  });
  it('goes around walls', () => {
    const map = mapFrom(['.#.', '.#.', '...']);
    const path = findPath(map, { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(path?.at(-1)).toEqual({ x: 2, y: 0 });
    for (const p of path ?? []) expect(isWalkable(map, p.x, p.y)).toBe(true);
  });
  it('does not cut wall corners', () => {
    const map = mapFrom(['.#', '..']);
    expect(findPath(map, { x: 0, y: 0 }, { x: 1, y: 1 })).toEqual([{ x: 0, y: 1 }, { x: 1, y: 1 }]);
  });
  it('returns null for walls, unreachable tiles and tiles outside the map', () => {
    const map = mapFrom(['.#.']);
    expect(findPath(map, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
    expect(findPath(map, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
    expect(findPath(map, { x: 0, y: 0 }, { x: 99, y: -5 })).toBeNull();
  });
});

describe('world', () => {
  it('builds the same dungeon from the same seed', () => {
    expect(createWorld(123).map).toEqual(createWorld(123).map);
    expect(createWorld(123).map.tiles).not.toEqual(createWorld(124).map.tiles);
  });

  it('makes every floor tile reachable from the spawn point', () => {
    for (const seed of [0, 1, 99, 2 ** 32 - 1]) {
      const world = createWorld(seed);
      expect(isWalkable(world.map, world.spawn.x, world.spawn.y)).toBe(true);
      for (let y = 0; y < world.map.height; y++) {
        for (let x = 0; x < world.map.width; x++) {
          if (isWalkable(world.map, x, y)) expect(findPath(world.map, world.spawn, { x, y })).not.toBeNull();
        }
      }
    }
  });

  it('walks to the requested tile and counts the tiles', () => {
    const world = createWorld(5);
    const goal = { x: world.spawn.x + 1, y: world.spawn.y }; // always free: next to spawn
    step(world, [{ type: 'moveTo', ...goal }]);
    expect(isMoving(world)).toBe(true);
    for (let i = 0; i < 100 && isMoving(world); i++) step(world);
    expect(world.player.pos).toEqual(goal);
    expect(world.player.tilesWalked).toBe(1);
  });

  it('never moves faster than the speed limit and never enters a wall', () => {
    const world = createWorld(77);
    let target = world.spawn;
    for (let y = 1; y < world.map.height; y++) {
      for (let x = 1; x < world.map.width; x++) if (isWalkable(world.map, x, y)) target = { x, y };
    }
    step(world, [{ type: 'moveTo', ...target }]);
    const limit = (PLAYER_SPEED * TICK_MS) / 1000 + 1e-9;
    for (let i = 0; i < 2000 && isMoving(world); i++) {
      const before = { ...world.player.pos };
      step(world);
      const { pos } = world.player;
      expect(Math.hypot(pos.x - before.x, pos.y - before.y)).toBeLessThanOrEqual(limit);
      expect(isWalkable(world.map, Math.round(pos.x), Math.round(pos.y))).toBe(true);
    }
    expect(world.player.pos).toEqual(target);
  });

  it('ignores commands that point at walls or outside the map', () => {
    const world = createWorld(5);
    step(world, [{ type: 'moveTo', x: 0, y: 0 }, { type: 'moveTo', x: -3, y: 400 }, { type: 'moveTo', x: 1.5, y: 2 }]);
    expect(isMoving(world)).toBe(false);
    expect(world.player.pos).toEqual(world.spawn);
  });

  it('stays on the grid when redirected while walking', () => {
    const world = createWorld(5);
    step(world, [{ type: 'moveTo', x: world.spawn.x + 1, y: world.spawn.y }]);
    step(world, [{ type: 'moveTo', x: world.spawn.x, y: world.spawn.y + 1 }]);
    for (let i = 0; i < 200 && isMoving(world); i++) step(world);
    expect(world.player.pos).toEqual({ x: world.spawn.x, y: world.spawn.y + 1 });
  });

  it('replays identically from the same seed and commands', () => {
    const run = () => {
      const world = createWorld(2024);
      step(world, [{ type: 'moveTo', x: world.spawn.x + 1, y: world.spawn.y + 1 }]);
      for (let i = 0; i < 7; i++) step(world);
      step(world, [{ type: 'moveTo', x: world.spawn.x - 1, y: world.spawn.y }]);
      for (let i = 0; i < 40; i++) step(world);
      return world;
    };
    expect(run()).toEqual(run());
  });
});
