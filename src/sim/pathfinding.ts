import { type GridMap, type Point, isWalkable } from './grid';

// Neighbour order is fixed so that equal-cost paths are always resolved the
// same way; the result must be deterministic.
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [0, 1], [-1, 0], [0, -1],
  [1, 1], [-1, 1], [-1, -1], [1, -1],
];

/**
 * Shortest path on the tile grid with 8-directional movement.
 *
 * Returns the tiles to visit, excluding `start` and including `goal`.
 * Returns an empty array when start equals goal and `null` when the goal is a
 * wall or cannot be reached.
 */
export function findPath(map: GridMap, start: Point, goal: Point): Point[] | null {
  if (!isWalkable(map, start.x, start.y) || !isWalkable(map, goal.x, goal.y)) return null;
  if (start.x === goal.x && start.y === goal.y) return [];

  const size = map.width * map.height;
  const cost = new Array<number>(size).fill(Infinity);
  const previous = new Array<number>(size).fill(-1);
  const done = new Array<boolean>(size).fill(false);
  const startIndex = start.y * map.width + start.x;
  const goalIndex = goal.y * map.width + goal.x;
  cost[startIndex] = 0;

  // Plain Dijkstra with a linear scan: rooms are a few hundred tiles, so a
  // priority queue would add code without a measurable benefit.
  for (;;) {
    let current = -1;
    let best = Infinity;
    for (let i = 0; i < size; i++) {
      const c = cost[i] as number;
      if (!done[i] && c < best) {
        best = c;
        current = i;
      }
    }
    if (current === -1) return null;
    if (current === goalIndex) break;
    done[current] = true;

    const cx = current % map.width;
    const cy = (current - cx) / map.width;
    for (const [dx, dy] of DIRECTIONS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(map, nx, ny)) continue;
      // A diagonal step is allowed only when both adjacent tiles are free,
      // otherwise the character would clip through wall corners.
      if (dx !== 0 && dy !== 0 && (!isWalkable(map, cx + dx, cy) || !isWalkable(map, cx, cy + dy))) continue;
      const next = ny * map.width + nx;
      const stepCost = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
      if (best + stepCost < (cost[next] as number)) {
        cost[next] = best + stepCost;
        previous[next] = current;
      }
    }
  }

  const path: Point[] = [];
  for (let i = goalIndex; i !== startIndex; i = previous[i] as number) {
    const x = i % map.width;
    path.push({ x, y: (i - x) / map.width });
  }
  return path.reverse();
}
