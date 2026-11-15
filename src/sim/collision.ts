import { type GridMap, type Point, TILE_FLOOR, tileAt } from './grid';

// A tile is a unit square centred on its integer coordinates:
// tile (3, 5) covers x in [2.5, 3.5] and y in [4.5, 5.5].
const HALF_TILE = 0.5;
/** Tolerance so that a circle exactly touching a wall still counts as free. */
const EPSILON = 1e-9;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** True when a circle at `p` with radius `r` does not overlap any wall. */
export function circleFree(map: GridMap, p: Point, r: number): boolean {
  const cx = Math.round(p.x);
  const cy = Math.round(p.y);
  for (let ty = cy - 1; ty <= cy + 1; ty++) {
    for (let tx = cx - 1; tx <= cx + 1; tx++) {
      if (tileAt(map, tx, ty) === TILE_FLOOR) continue;
      const nx = clamp(p.x, tx - HALF_TILE, tx + HALF_TILE);
      const ny = clamp(p.y, ty - HALF_TILE, ty + HALF_TILE);
      if (Math.hypot(p.x - nx, p.y - ny) < r - EPSILON) return false;
    }
  }
  return true;
}

/**
 * Pushes a circle out of any walls it overlaps and returns the new centre.
 * Moving into a wall at an angle therefore slides along it instead of stopping.
 * Requires r < 0.5 and a move shorter than r per call, so the circle can
 * never pass through a wall.
 */
export function pushOutOfWalls(map: GridMap, p: Point, r: number): Point {
  let { x, y } = p;
  // A corner between two walls may need a second pass; three is a safe bound.
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    const cx = Math.round(x);
    const cy = Math.round(y);
    for (let ty = cy - 1; ty <= cy + 1; ty++) {
      for (let tx = cx - 1; tx <= cx + 1; tx++) {
        if (tileAt(map, tx, ty) === TILE_FLOOR) continue;
        const nx = clamp(x, tx - HALF_TILE, tx + HALF_TILE);
        const ny = clamp(y, ty - HALF_TILE, ty + HALF_TILE);
        const dx = x - nx;
        const dy = y - ny;
        const distance = Math.hypot(dx, dy);
        if (distance >= r - EPSILON) continue;
        if (distance > 0) {
          x = nx + (dx / distance) * r;
          y = ny + (dy / distance) * r;
        } else {
          // The centre is inside the wall: leave through the nearest side.
          const toLeft = x - (tx - HALF_TILE);
          const toRight = tx + HALF_TILE - x;
          const toTop = y - (ty - HALF_TILE);
          const toBottom = ty + HALF_TILE - y;
          const nearest = Math.min(toLeft, toRight, toTop, toBottom);
          if (nearest === toLeft) x = tx - HALF_TILE - r;
          else if (nearest === toRight) x = tx + HALF_TILE + r;
          else if (nearest === toTop) y = ty - HALF_TILE - r;
          else y = ty + HALF_TILE + r;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x, y };
}

/** True when a circle can travel in a straight line from `a` to `b`. */
export function clearLine(map: GridMap, a: Point, b: Point, r: number): boolean {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const samples = Math.max(1, Math.ceil(length / 0.1));
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    if (!circleFree(map, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, r)) return false;
  }
  return true;
}
