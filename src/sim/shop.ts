import { EXIT_RANGE, MAX_TRADE_COUNT, MERCHANT_RANGE } from './balance';
import { addItem, canFit } from './inventory';
import { type ItemId, ITEMS, SHOP_STOCK, buyPrice, sellPrice } from './items';
import type { World } from './world';
import type { ZoneExit } from './zones';

export function isNearMerchant(world: World): boolean {
  const { player, merchant } = world;
  if (merchant === null) return false;
  return Math.hypot(player.pos.x - merchant.x, player.pos.y - merchant.y) <= MERCHANT_RANGE;
}

const validCount = (count: number): boolean => Number.isInteger(count) && count >= 1 && count <= MAX_TRADE_COUNT;

/** Buys `count` of an item the merchant stocks. All or nothing. */
export function buy(world: World, itemId: ItemId, count: number): void {
  const { player } = world;
  if (!SHOP_STOCK.includes(itemId) || !validCount(count)) return;
  if (!isNearMerchant(world)) return void world.events.push({ type: 'tradeDenied', reason: 'far' });
  const cost = buyPrice(itemId) * count;
  if (player.coins < cost) return void world.events.push({ type: 'tradeDenied', reason: 'coins' });
  if (!canFit(player, itemId, count)) return void world.events.push({ type: 'tradeDenied', reason: 'full' });
  player.coins -= cost;
  addItem(player, itemId, count);
  world.events.push({ type: 'bought', itemId, count, cost });
}

/** Sells `count` items from one bag slot. */
export function sell(world: World, index: number, count: number): void {
  const { player } = world;
  const stack = Number.isInteger(index) ? player.inventory[index] : undefined;
  if (!stack || !validCount(count) || count > stack.count) return;
  if (!isNearMerchant(world)) return void world.events.push({ type: 'tradeDenied', reason: 'far' });
  const { itemId } = stack;
  const price = sellPrice(itemId);
  if (ITEMS[itemId].kind === 'currency' || price <= 0) return void world.events.push({ type: 'tradeDenied', reason: 'worthless' });
  stack.count -= count;
  if (stack.count === 0) player.inventory.splice(index, 1);
  player.coins += price * count;
  player.revision += 1;
  world.events.push({ type: 'sold', itemId, count, gain: price * count });
}

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
