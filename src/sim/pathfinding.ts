import { type GridMap, type Point, isWalkable } from './grid';

// Neighbour order is fixed so that equal-cost paths are always resolved the
// same way; the result must be deterministic.
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [0, 1], [-1, 0], [0, -1],
  [1, 1], [-1, 1], [-1, -1], [1, -1],
];

/** Octile distance: the exact cost of a path on an empty grid with 8-directional movement. */
function heuristic(x: number, y: number, goal: Point): number {
  const dx = Math.abs(x - goal.x);
  const dy = Math.abs(y - goal.y);
  return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

/**
 * Shortest path on the tile grid with 8-directional movement (A*).
 *
 * Returns the tiles to visit, excluding `start` and including `goal`.
 * Returns an empty array when start equals goal and `null` when the goal is a
 * wall or cannot be reached.
 *
 * `maxNodes` limits how many tiles are examined; when the limit is hit the
 * search gives up and returns `null`. Monsters use a small limit so that a
 * hero behind a long wall does not make every one of them search the world.
 */
export function findPath(map: GridMap, start: Point, goal: Point, maxNodes = Infinity): Point[] | null {
  if (!isWalkable(map, start.x, start.y) || !isWalkable(map, goal.x, goal.y)) return null;
  if (start.x === goal.x && start.y === goal.y) return [];

  const { width } = map;
  const startIndex = start.y * width + start.x;
  const goalIndex = goal.y * width + goal.x;
  const cost = new Map<number, number>([[startIndex, 0]]);
  const previous = new Map<number, number>();
  const done = new Set<number>();

  // A binary heap of [priority, order, tile]. `order` breaks ties by age, so
  // the result does not depend on how the heap happens to arrange equals.
  const heap: Array<[number, number, number]> = [[heuristic(start.x, start.y, goal), 0, startIndex]];
  let order = 1;
  const less = (a: [number, number, number], b: [number, number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const push = (entry: [number, number, number]) => {
    let i = heap.push(entry) - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!less(heap[i] as [number, number, number], heap[parent] as [number, number, number])) break;
      [heap[i], heap[parent]] = [heap[parent] as [number, number, number], heap[i] as [number, number, number]];
      i = parent;
    }
  };
  const pop = (): [number, number, number] => {
    const top = heap[0] as [number, number, number];
    const last = heap.pop() as [number, number, number];
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < heap.length && less(heap[left] as [number, number, number], heap[smallest] as [number, number, number])) smallest = left;
        if (right < heap.length && less(heap[right] as [number, number, number], heap[smallest] as [number, number, number])) smallest = right;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest] as [number, number, number], heap[i] as [number, number, number]];
        i = smallest;
      }
    }
    return top;
  };

  let examined = 0;
  while (heap.length > 0) {
    const current = pop()[2];
    if (done.has(current)) continue;
    if (current === goalIndex) {
      const path: Point[] = [];
      for (let i = goalIndex; i !== startIndex; i = previous.get(i) as number) {
        const x = i % width;
        path.push({ x, y: (i - x) / width });
      }
      return path.reverse();
    }
    done.add(current);
    examined += 1;
    if (examined > maxNodes) return null;

    const cx = current % width;
    const cy = (current - cx) / width;
    const base = cost.get(current) as number;
    for (const [dx, dy] of DIRECTIONS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(map, nx, ny)) continue;
      // A diagonal step is allowed only when both adjacent tiles are free,
      // otherwise the character would clip through wall corners.
      if (dx !== 0 && dy !== 0 && (!isWalkable(map, cx + dx, cy) || !isWalkable(map, cx, cy + dy))) continue;
      const next = ny * width + nx;
      if (done.has(next)) continue;
      const nextCost = base + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
      if (nextCost < (cost.get(next) ?? Infinity)) {
        cost.set(next, nextCost);
        previous.set(next, current);
        push([nextCost + heuristic(nx, ny, goal), order++, next]);
      }
    }
  }
  return null;
}
