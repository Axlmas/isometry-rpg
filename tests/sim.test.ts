import { describe, expect, it } from 'vitest';
import {
  type GridMap, type Tile, TICK_MS, PLAYER_RADIUS, PLAYER_SPEED, TILE_FLOOR, TILE_WALL,
  circleFree, clearLine, pushOutOfWalls,
  createRng, createWorld as createWorldWithMonsters, findPath, isMoving, isWalkable, step, tileAt,
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

describe('collision', () => {
  const map = mapFrom(['#####', '#...#', '#.#.#', '#...#', '#####']);
  it('knows where a circle fits', () => {
    expect(circleFree(map, { x: 1, y: 1 }, 0.3)).toBe(true);
    expect(circleFree(map, { x: 0.8, y: 1 }, 0.3)).toBe(true); // exactly touching
    expect(circleFree(map, { x: 0.79, y: 1 }, 0.3)).toBe(false);
    expect(circleFree(map, { x: 2, y: 2 }, 0.3)).toBe(false);
  });
  it('pushes a circle out of walls, including from inside one and from a corner', () => {
    expect(pushOutOfWalls(map, { x: 0.6, y: 1 }, 0.3)).toEqual({ x: 0.8, y: 1 });
    for (const p of [{ x: 0.6, y: 0.6 }, { x: 2.1, y: 2 }, { x: 1.45, y: 1.45 }, { x: 3.4, y: 3.45 }]) {
      expect(circleFree(map, pushOutOfWalls(map, p, 0.3), 0.3)).toBe(true);
    }
  });
  it('leaves a free circle where it is', () => {
    expect(pushOutOfWalls(map, { x: 1.1, y: 2.9 }, 0.3)).toEqual({ x: 1.1, y: 2.9 });
  });
  it('sees straight lines only where the circle fits all the way', () => {
    expect(clearLine(map, { x: 1, y: 1 }, { x: 3, y: 1 }, 0.3)).toBe(true);
    expect(clearLine(map, { x: 1, y: 1 }, { x: 3, y: 3 }, 0.3)).toBe(false);
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
  // These tests are about movement; monsters are covered in combat.test.ts.
  const createWorld = (seed: number) => {
    const world = createWorldWithMonsters(seed);
    world.monsters = [];
    return world;
  };

  it('builds the same dungeon from the same seed', () => {
    expect(createWorld(123)).toEqual(createWorld(123));
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

  const settle = (world: ReturnType<typeof createWorld>, max = 2000) => {
    for (let i = 0; i < max && isMoving(world); i++) step(world);
  };
  const farthestFloor = (world: ReturnType<typeof createWorld>) => {
    let target = world.spawn;
    for (let y = 1; y < world.map.height; y++) {
      for (let x = 1; x < world.map.width; x++) if (isWalkable(world.map, x, y)) target = { x, y };
    }
    return target;
  };

  it('walks to the exact point that was requested, not to a tile centre', () => {
    const world = createWorld(5);
    const goal = { x: world.spawn.x + 0.8, y: world.spawn.y - 0.35 }; // free: next to spawn
    step(world, [{ type: 'moveTo', ...goal }]);
    expect(isMoving(world)).toBe(true);
    settle(world);
    expect(world.player.pos.x).toBeCloseTo(goal.x, 9);
    expect(world.player.pos.y).toBeCloseTo(goal.y, 9);
    expect(world.player.distance).toBeCloseTo(Math.hypot(0.8, 0.35), 9);
  });

  it('takes a straight line when nothing is in the way', () => {
    const world = createWorld(5);
    step(world, [{ type: 'moveTo', x: world.spawn.x + 1, y: world.spawn.y + 0.5 }]);
    expect(world.player.path).toHaveLength(1);
  });

  it('never exceeds the speed limit and never overlaps a wall on a long route', () => {
    for (const seed of [77, 78, 79]) {
      const world = createWorld(seed);
      const target = farthestFloor(world);
      step(world, [{ type: 'moveTo', ...target }]);
      const limit = (PLAYER_SPEED * TICK_MS) / 1000 + 1e-9;
      for (let i = 0; i < 2000 && isMoving(world); i++) {
        const before = { ...world.player.pos };
        step(world);
        const { pos } = world.player;
        expect(Math.hypot(pos.x - before.x, pos.y - before.y)).toBeLessThanOrEqual(limit);
        expect(circleFree(world.map, pos, PLAYER_RADIUS)).toBe(true);
      }
      expect(world.player.pos).toEqual(target);
    }
  });

  it('stops next to the wall when the requested point is too close to it', () => {
    const world = createWorld(5);
    const edge = { x: 1, y: world.spawn.y }; // row through spawn; x = 0 is the border wall
    if (!isWalkable(world.map, 1, world.spawn.y)) return;
    step(world, [{ type: 'moveTo', x: 0.55, y: edge.y }]);
    settle(world);
    expect(world.player.pos.x).toBeCloseTo(0.5 + PLAYER_RADIUS, 9);
  });

  it('ignores orders that point at walls, outside the map or nowhere', () => {
    const world = createWorld(5);
    step(world, [
      { type: 'moveTo', x: 0, y: 0 },
      { type: 'moveTo', x: -3, y: 400 },
      { type: 'moveTo', x: Number.NaN, y: 2 },
      { type: 'moveTo', x: Infinity, y: 2 },
    ]);
    expect(isMoving(world)).toBe(false);
    expect(world.player.pos).toEqual(world.spawn);
  });

  it('walks in a held direction at the same speed whatever the input size', () => {
    for (const [dx, dy] of [[1, 0], [1000, 0], [0.001, 0], [3, 4]] as const) {
      const world = createWorld(5);
      step(world, [{ type: 'moveDir', dx, dy }]);
      expect(world.player.distance).toBeCloseTo((PLAYER_SPEED * TICK_MS) / 1000, 9);
    }
  });

  it('stops when the direction is released or invalid', () => {
    const world = createWorld(5);
    step(world, [{ type: 'moveDir', dx: 1, dy: 0 }]);
    step(world, [{ type: 'moveDir', dx: 0, dy: 0 }]);
    const at = { ...world.player.pos };
    step(world);
    expect(world.player.pos).toEqual(at);
    step(world, [{ type: 'moveDir', dx: Number.NaN, dy: 1 }]);
    expect(isMoving(world)).toBe(false);
  });

  it('cannot be pushed through walls by holding a direction, and slides along them', () => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0.2]] as const) {
      const world = createWorld(99);
      step(world, [{ type: 'moveDir', dx, dy }]);
      for (let i = 0; i < 600; i++) {
        step(world);
        expect(circleFree(world.map, world.player.pos, PLAYER_RADIUS)).toBe(true);
      }
      const { pos } = world.player;
      expect(pos.x).toBeGreaterThan(0.5);
      expect(pos.x).toBeLessThan(world.map.width - 1.5);
      expect(pos.y).toBeGreaterThan(0.5);
      expect(pos.y).toBeLessThan(world.map.height - 1.5);
    }
  });

  it('lets a held direction override a walk order and the other way round', () => {
    const world = createWorld(5);
    step(world, [{ type: 'moveTo', ...farthestFloor(world) }]);
    step(world, [{ type: 'moveDir', dx: 1, dy: 0 }]);
    expect(world.player.path).toEqual([]);
    step(world, [{ type: 'moveTo', x: world.spawn.x, y: world.spawn.y }]);
    expect(world.player.moveDir).toEqual({ x: 0, y: 0 });
    settle(world);
    expect(world.player.pos).toEqual(world.spawn);
  });

  it('replays identically from the same seed and commands', () => {
    const run = () => {
      const world = createWorld(2024);
      step(world, [{ type: 'moveTo', x: world.spawn.x + 0.7, y: world.spawn.y + 1.2 }]);
      for (let i = 0; i < 7; i++) step(world);
      step(world, [{ type: 'moveDir', dx: -1, dy: 0.3 }]);
      for (let i = 0; i < 30; i++) step(world);
      step(world, [{ type: 'moveTo', x: world.spawn.x - 1, y: world.spawn.y }]);
      for (let i = 0; i < 40; i++) step(world);
      return world;
    };
    expect(run()).toEqual(run());
  });
});
