import { INVENTORY_SLOTS, LOOT_PICKUP_RADIUS, PLAYER_RADIUS, UNARMED_DAMAGE } from './balance';
import { pushOutOfWalls } from './collision';
import type { Point } from './grid';
import { type EquipSlot, type ItemId, EQUIP_SLOTS, ITEMS } from './items';
import type { Player, World } from './world';

export interface ItemStack {
  itemId: ItemId;
  count: number;
}

/** Everything the hero keeps when moving on to another dungeon. */
export interface Character {
  level: number;
  /** Experience gained towards the next level. */
  xp: number;
  coins: number;
  inventory: ItemStack[];
  equipment: Record<EquipSlot, ItemId | null>;
}

export function newCharacter(startingWeapon: ItemId): Character {
  return { level: 1, xp: 0, coins: 0, inventory: [], equipment: { weapon: startingWeapon, helmet: null, armor: null, boots: null } };
}

export function characterOf(world: World): Character {
  const { level, xp, coins, inventory, equipment } = world.player;
  return { level, xp, coins, inventory: inventory.map((stack) => ({ ...stack })), equipment: { ...equipment } };
}

export function playerDamage(player: Player): readonly [number, number] {
  const weapon = player.equipment.weapon;
  const def = weapon ? ITEMS[weapon] : null;
  return def && def.kind === 'equipment' && def.slot === 'weapon' ? def.damage : UNARMED_DAMAGE;
}

export function playerDefense(player: Player): number {
  let total = 0;
  for (const slot of EQUIP_SLOTS) {
    const itemId = player.equipment[slot];
    const def = itemId ? ITEMS[itemId] : null;
    if (def && def.kind === 'equipment' && def.slot !== 'weapon') total += def.defense;
  }
  return total;
}

/**
 * Adds items to the purse or the inventory. Returns how many did not fit.
 * Materials fill existing stacks first, then free slots.
 */
export function addItem(player: Player, itemId: ItemId, count: number): number {
  const def = ITEMS[itemId];
  let left = count;
  if (def.kind === 'currency') {
    player.coins += left;
    left = 0;
  } else {
    const maxStack = def.kind === 'material' ? def.maxStack : 1;
    if (maxStack > 1) {
      for (const stack of player.inventory) {
        if (left === 0) break;
        if (stack.itemId !== itemId) continue;
        const moved = Math.min(left, maxStack - stack.count);
        stack.count += moved;
        left -= moved;
      }
    }
    while (left > 0 && player.inventory.length < INVENTORY_SLOTS) {
      const moved = Math.min(left, maxStack);
      player.inventory.push({ itemId, count: moved });
      left -= moved;
    }
  }
  if (left !== count) player.revision += 1;
  return left;
}

/** Puts an item on the floor. `ignored` keeps the hero from picking it right back up. */
export function dropLoot(world: World, itemId: ItemId, count: number, at: Point, ignored = false): void {
  const id = world.nextLootId;
  world.nextLootId += 1;
  world.loot.push({ id, itemId, count, pos: pushOutOfWalls(world.map, at, PLAYER_RADIUS), ignored });
  world.events.push({ type: 'lootDropped', id });
}

/** The hero collects whatever lies within reach. */
export function pickUpLoot(world: World): void {
  const { player } = world;
  let reportedFull = false;
  for (const loot of world.loot) {
    const near = Math.hypot(loot.pos.x - player.pos.x, loot.pos.y - player.pos.y) <= LOOT_PICKUP_RADIUS;
    if (!near) {
      loot.ignored = false; // The hero walked away; next time they come back, try again.
      continue;
    }
    if (loot.ignored) continue;
    const left = addItem(player, loot.itemId, loot.count);
    if (left < loot.count) world.events.push({ type: 'itemPicked', itemId: loot.itemId, count: loot.count - left });
    loot.count = left;
    if (left > 0) {
      // No room: leave it and say so once, not on every tick the hero stands here.
      loot.ignored = true;
      if (!reportedFull) world.events.push({ type: 'inventoryFull' });
      reportedFull = true;
    }
  }
  world.loot = world.loot.filter((loot) => loot.count > 0);
}

/** Wears the item in the given inventory slot; whatever was worn takes its place. */
export function equipFromInventory(world: World, index: number): void {
  const { player } = world;
  const stack = Number.isInteger(index) ? player.inventory[index] : undefined;
  if (!stack) return;
  const def = ITEMS[stack.itemId];
  if (def.kind !== 'equipment') return;
  const previous = player.equipment[def.slot];
  player.equipment[def.slot] = stack.itemId;
  if (previous) player.inventory[index] = { itemId: previous, count: 1 };
  else player.inventory.splice(index, 1);
  player.revision += 1;
}

export function unequip(world: World, slot: EquipSlot): void {
  const { player } = world;
  if (!EQUIP_SLOTS.includes(slot)) return;
  const itemId = player.equipment[slot];
  if (!itemId) return;
  if (player.inventory.length >= INVENTORY_SLOTS) {
    world.events.push({ type: 'inventoryFull' });
    return;
  }
  player.equipment[slot] = null;
  player.inventory.push({ itemId, count: 1 });
  player.revision += 1;
}

/** Drops a whole inventory slot at the hero's feet. */
export function dropFromInventory(world: World, index: number): void {
  const { player } = world;
  const stack = Number.isInteger(index) ? player.inventory[index] : undefined;
  if (!stack) return;
  player.inventory.splice(index, 1);
  player.revision += 1;
  dropLoot(world, stack.itemId, stack.count, player.pos, true);
}
