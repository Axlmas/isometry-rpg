import { EXIT_RANGE } from './balance';
import type { World } from './world';
import type { ZoneExit } from './zones';

/** The exit the hero is standing at, if any. */
export function nearestExit(world: World): ZoneExit | null {
  const { player } = world;
  let best: ZoneExit | null = null;
  let bestDistance = EXIT_RANGE;
  for (const exit of world.exits) {
    const distance = Math.hypot(player.pos.x - exit.pos.x, player.pos.y - exit.pos.y);
    if (distance <= bestDistance) {
      best = exit;
      bestDistance = distance;
    }
  }
  return best;
}

/** Asks to leave through the nearest exit. The rules only announce it; the client builds the next zone. */
export function travel(world: World): void {
  const exit = nearestExit(world);
  if (exit) world.events.push({ type: 'travel', to: exit.to });
}
