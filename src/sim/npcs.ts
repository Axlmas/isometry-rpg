import {
  GUARD_COOLDOWN, GUARD_DAMAGE_SHARE, GUARD_RANGE, MAX_TRADE_COUNT, NPC_RANGE,
} from './balance';
import type { Point } from './grid';
import { addItem, canFit } from './inventory';
import { type ItemId, ITEMS, buyPrice, sellPrice } from './items';
import { type SkillId, SKILLS, isSkillId } from './skills';
import type { World } from './world';

/** NPC kinds are stable IDs: the client maps them to names, looks and windows. */
export type NpcKind = 'alchemist' | 'outfitter' | 'blacksmith' | 'trainer' | 'guard';

export interface Npc {
  id: number;
  kind: NpcKind;
  pos: Point;
  /** Guards only: ticks until the next blow. */
  cooldown: number;
}

/** What each merchant sells, in the order shown. Every merchant buys anything that has a price. */
export const SHOP_STOCK: Readonly<Partial<Record<NpcKind, readonly ItemId[]>>> = {
  alchemist: ['healthPotion', 'manaPotion', 'chargePlain', 'chargeD'],
  outfitter: ['ironSword', 'leatherCap', 'leatherJerkin', 'leatherBoots'],
  blacksmith: ['scrollWeaponPlain', 'scrollArmorPlain', 'scrollWeaponD', 'scrollArmorD'],
};

/** What the trainer asks for teaching each skill, in coins. */
export const SKILL_PRICE: Readonly<Record<SkillId, number>> = { heavyBlow: 60, sweep: 250, secondWind: 600 };

/** The NPC the hero is standing next to, if any; the nearest when there are several. */
export function nearestNpc(world: World): Npc | null {
  const { player } = world;
  let best: Npc | null = null;
  let bestDistance = NPC_RANGE;
  for (const npc of world.npcs) {
    const distance = Math.hypot(player.pos.x - npc.pos.x, player.pos.y - npc.pos.y);
    if (distance <= bestDistance) {
      best = npc;
      bestDistance = distance;
    }
  }
  return best;
}

/** The merchant the hero could trade with right now. */
export function nearestMerchant(world: World): Npc | null {
  const npc = nearestNpc(world);
  return npc && SHOP_STOCK[npc.kind] ? npc : null;
}

export function isNearMerchant(world: World): boolean {
  return nearestMerchant(world) !== null;
}

/** True when the hero stands next to an NPC of this kind. */
export function isNear(world: World, kind: NpcKind): boolean {
  return nearestNpc(world)?.kind === kind;
}

const validCount = (count: number): boolean => Number.isInteger(count) && count >= 1 && count <= MAX_TRADE_COUNT;

/** Buys `count` of an item from the merchant the hero is standing next to. All or nothing. */
export function buy(world: World, itemId: ItemId, count: number): void {
  const { player } = world;
  if (!validCount(count) || !Object.values(SHOP_STOCK).some((stock) => stock.includes(itemId))) return;
  const merchant = nearestMerchant(world);
  if (!merchant) return void world.events.push({ type: 'tradeDenied', reason: 'far' });
  // Each merchant only sells their own goods.
  if (!SHOP_STOCK[merchant.kind]?.includes(itemId)) return void world.events.push({ type: 'tradeDenied', reason: 'notSold' });
  const cost = buyPrice(itemId) * count;
  if (player.coins < cost) return void world.events.push({ type: 'tradeDenied', reason: 'coins' });
  if (!canFit(player, itemId, count)) return void world.events.push({ type: 'tradeDenied', reason: 'full' });
  player.coins -= cost;
  addItem(player, itemId, count);
  world.events.push({ type: 'bought', itemId, count, cost });
}

/** Sells `count` items from one bag slot to any merchant. */
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

/** Whether the hero has been taught a skill. */
export function knows(world: World, id: SkillId): boolean {
  return world.player.skills.includes(id);
}

/** Learns a skill from the trainer for coins. */
export function learn(world: World, id: SkillId): void {
  const { player } = world;
  if (!isSkillId(id) || knows(world, id)) return;
  const deny = (reason: 'far' | 'level' | 'coins') => void world.events.push({ type: 'learnDenied', id, reason });
  if (!isNear(world, 'trainer')) return deny('far');
  if (player.level < SKILLS[id].unlockLevel) return deny('level');
  if (player.coins < SKILL_PRICE[id]) return deny('coins');
  player.coins -= SKILL_PRICE[id];
  player.skills.push(id);
  player.revision += 1;
  world.events.push({ type: 'skillLearned', id });
}

/** Guards strike any monster that comes close. Their kills give the hero nothing. */
export function guardDuty(world: World): void {
  for (const npc of world.npcs) {
    if (npc.kind !== 'guard') continue;
    if (npc.cooldown > 0) {
      npc.cooldown -= 1;
      continue;
    }
    for (const monster of world.monsters) {
      if (Math.hypot(monster.pos.x - npc.pos.x, monster.pos.y - npc.pos.y) > GUARD_RANGE) continue;
      const damage = Math.max(1, Math.round(monster.maxHp * GUARD_DAMAGE_SHARE));
      monster.hp = Math.max(0, monster.hp - damage);
      npc.cooldown = GUARD_COOLDOWN;
      world.events.push({ type: 'guardStrike', npcId: npc.id, monsterId: monster.id, damage, pos: { ...monster.pos }, died: monster.hp === 0 });
      break;
    }
  }
}
