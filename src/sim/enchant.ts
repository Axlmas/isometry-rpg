import { ENCHANT_CHANCE, ENCHANT_MAX, ENCHANT_SAFE } from './balance';
import { type ItemStack, addItem, canFit, refreshVitals } from './inventory';
import { type EquipSlot, type ItemDef, type ItemId, EQUIP_SLOTS, ITEMS, crystalsFor } from './items';
import { isNear } from './npcs';
import { createRng } from './rng';
import type { World } from './world';

/** An item to work on: one that is worn, or one in the bag. */
export type ItemTarget = { kind: 'slot'; slot: EquipSlot } | { kind: 'bag'; index: number };

type Equipment = Extract<ItemDef, { kind: 'equipment' }>;

/** The scroll that enchants this item: one per grade, separately for weapons and armour. */
export function scrollFor(def: Equipment): ItemId {
  const weapon = def.slot === 'weapon';
  if (def.grade === 'd') return weapon ? 'scrollWeaponD' : 'scrollArmorD';
  return weapon ? 'scrollWeaponPlain' : 'scrollArmorPlain';
}

/** Chance, in percent, that the next enchantment of an item at `level` succeeds. */
export function enchantChance(level: number): number {
  return level < ENCHANT_SAFE ? 100 : ENCHANT_CHANCE;
}

function resolve(world: World, target: ItemTarget): { itemId: ItemId; def: Equipment; level: number } | null {
  const { player } = world;
  let itemId: ItemId | null | undefined;
  let level = 0;
  if (target?.kind === 'slot' && EQUIP_SLOTS.includes(target.slot)) {
    itemId = player.equipment[target.slot];
    level = player.equipmentEnchant[target.slot];
  } else if (target?.kind === 'bag' && Number.isInteger(target.index)) {
    const stack = player.inventory[target.index];
    itemId = stack?.itemId;
    level = stack?.enchant ?? 0;
  }
  if (!itemId) return null;
  const def = ITEMS[itemId];
  return def.kind === 'equipment' ? { itemId, def, level } : null;
}

function removeTarget(world: World, target: ItemTarget): void {
  const { player } = world;
  if (target.kind === 'slot') {
    player.equipment[target.slot] = null;
    player.equipmentEnchant[target.slot] = 0;
    player.equipmentMods[target.slot] = null;
    refreshVitals(player);
  } else {
    player.inventory.splice(target.index, 1);
  }
}

/**
 * Spends a scroll at the blacksmith to raise an item's enchantment by one.
 * Up to the safe level it always works. Above it the attempt may fail, and
 * then the item is destroyed and turns into crystals (if its grade gives any).
 */
export function enchant(world: World, target: ItemTarget): void {
  const { player } = world;
  const item = resolve(world, target);
  if (!item) return;
  const deny = (reason: 'far' | 'scroll' | 'max') => void world.events.push({ type: 'enchantDenied', reason });
  if (!isNear(world, 'blacksmith')) return deny('far');
  if (item.level >= ENCHANT_MAX) return deny('max');
  const scrollIndex = player.inventory.findIndex((stack) => stack.itemId === scrollFor(item.def));
  const scroll = player.inventory[scrollIndex];
  if (!scroll) return deny('scroll');

  const rng = createRng(world.rngState);
  const success = rng.int(1, 100) <= enchantChance(item.level);
  world.rngState = rng.state;

  // The scroll is spent first; removing it may shift the bag, so the target index is corrected.
  scroll.count -= 1;
  let at = target;
  if (scroll.count === 0) {
    player.inventory.splice(scrollIndex, 1);
    if (target.kind === 'bag' && scrollIndex < target.index) at = { kind: 'bag', index: target.index - 1 };
  }
  player.revision += 1;

  if (success) {
    if (at.kind === 'slot') player.equipmentEnchant[at.slot] = item.level + 1;
    else (player.inventory[at.index] as { enchant?: number }).enchant = item.level + 1;
    world.events.push({ type: 'enchanted', itemId: item.itemId, level: item.level + 1 });
    return;
  }
  removeTarget(world, at);
  const crystals = crystalsFor(item.itemId);
  // Crystals that do not fit in the bag fall at the hero's feet rather than vanish.
  const left = crystals > 0 ? addItem(player, 'crystalD', crystals) : 0;
  if (left > 0) world.loot.push({ id: world.nextLootId++, itemId: 'crystalD', count: left, pos: { ...player.pos } });
  world.events.push({ type: 'enchantFailed', itemId: item.itemId, level: item.level, crystals });
}

/** Has the blacksmith break an item from the bag into crystals. Only items of a grade that gives crystals. */
export function crystallize(world: World, index: number): void {
  const { player } = world;
  const item = resolve(world, { kind: 'bag', index });
  if (!item) return;
  const crystals = crystalsFor(item.itemId);
  const deny = (reason: 'far' | 'noCrystals' | 'full') => void world.events.push({ type: 'crystallizeDenied', reason });
  if (!isNear(world, 'blacksmith')) return deny('far');
  if (crystals <= 0) return deny('noCrystals');
  const [taken] = player.inventory.splice(index, 1) as [ItemStack];
  if (!canFit(player, 'crystalD', crystals)) {
    // Put the item back exactly where it was.
    player.inventory.splice(index, 0, taken);
    return deny('full');
  }
  addItem(player, 'crystalD', crystals);
  world.events.push({ type: 'crystallized', itemId: item.itemId, crystals });
}
