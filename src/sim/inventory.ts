import { CRIT_BASE, CRIT_MAX, PLAYER_ATTACK_COOLDOWN, PLAYER_ATTACK_COOLDOWN_MIN, INVENTORY_SLOTS, LOOT_PICKUP_RADIUS, PLAYER_RADIUS, POTION_COOLDOWN, UNARMED_DAMAGE } from './balance';
import { pushOutOfWalls } from './collision';
import type { Point } from './grid';
import { ENCHANT_ARMOR_BONUS, ENCHANT_WEAPON_BONUS } from './balance';
import { type EquipSlot, type ItemDef, type ItemId, CHARGE_FOR_GRADE, EQUIP_SLOTS, ITEMS, JEWELLERY_SLOTS, maxStackOf } from './items';
import { type ClassId, type RaceId, type WeaponType, CLASSES } from './classes';
import { type RecipeId, learnRecipe } from './crafting';
import { type ItemMods, type StatId, QUALITY, copyMods } from './mods';
import { heroMaxHp, heroMaxMp } from './progression';
import type { SkillId } from './skills';
import type { Player, World } from './world';

export interface ItemStack {
  itemId: ItemId;
  count: number;
  /** Enchantment level of a piece of equipment; left out when it is zero. */
  enchant?: number;
  /** Quality and random properties of a piece of equipment; left out for a plain one. */
  mods?: ItemMods;
}

/** One piece of equipment as a bag stack, leaving out whatever it does not have. */
export function gearStack(itemId: ItemId, enchant = 0, mods?: ItemMods | null): ItemStack {
  const stack: ItemStack = { itemId, count: 1 };
  if (enchant > 0) stack.enchant = enchant;
  if (mods) stack.mods = mods;
  return stack;
}

export const NO_GEAR: Readonly<Record<EquipSlot, null>> = { weapon: null, helmet: null, armor: null, gloves: null, boots: null, ring: null, amulet: null };
export const NO_ENCHANT: Readonly<Record<EquipSlot, number>> = { weapon: 0, helmet: 0, armor: 0, gloves: 0, boots: 0, ring: 0, amulet: 0 };

/** Everything the hero keeps when moving on to another dungeon. */
export interface Character {
  /** A human warrior when left out. */
  race?: RaceId;
  cls?: ClassId;
  level: number;
  /** Experience gained towards the next level. */
  xp: number;
  coins: number;
  inventory: ItemStack[];
  /** Slots left out are empty. */
  equipment: Partial<Record<EquipSlot, ItemId | null>>;
  /** Enchantment level of each worn item; zero when left out. */
  equipmentEnchant?: Partial<Record<EquipSlot, number>>;
  /** Quality and properties of each worn item; plain when left out. */
  equipmentMods?: Partial<Record<EquipSlot, ItemMods | null>>;
  /** Skills learned from the trainer; none when left out. */
  skills?: SkillId[];
  /** Recipes learned from recipe items; none when left out. */
  recipes?: RecipeId[];
  /** Current health and mana, when they should carry over; otherwise the hero arrives fully restored. */
  hp?: number;
  mp?: number;
}

/** What `level` points of enchantment add to an item's damage (weapons) or defence (armour). */
export function enchantBonus(def: Extract<ItemDef, { kind: 'equipment' }>, level: number): number {
  return level * (def.slot === 'weapon' ? ENCHANT_WEAPON_BONUS[def.grade] : ENCHANT_ARMOR_BONUS);
}

/** A new hero of the given race and class, with that class's starting weapon. */
export function newHero(race: RaceId, cls: ClassId): Character {
  return { ...newCharacter(CLASSES[cls].startingWeapon), race, cls };
}

export function newCharacter(startingWeapon: ItemId): Character {
  return { level: 1, xp: 0, coins: 0, inventory: [], equipment: { ...NO_GEAR, weapon: startingWeapon } };
}

export function characterOf(world: World): Character {
  const { race, cls, level, xp, coins, inventory, equipment, equipmentEnchant, equipmentMods, skills, recipes } = world.player;
  return {
    race, cls, level, xp, coins,
    inventory: inventory.map((stack) => ({ ...stack })),
    equipment: { ...equipment },
    equipmentEnchant: { ...equipmentEnchant },
    equipmentMods: { ...equipmentMods },
    skills: [...skills],
    recipes: [...recipes],
  };
}

/** Like `characterOf`, but the hero also keeps their current health and mana: for walking between zones. */
export function travelerOf(world: World): Character {
  return { ...characterOf(world), hp: world.player.hp, mp: world.player.mp };
}

export function playerDamage(player: Player): readonly [number, number] {
  const weapon = player.equipment.weapon;
  const def = weapon ? ITEMS[weapon] : null;
  if (!def || def.kind !== 'equipment' || def.slot !== 'weapon') return UNARMED_DAMAGE;
  return weaponDamage(def, player.equipmentEnchant.weapon, player.equipmentMods.weapon);
}

/** Damage of one weapon: its own, raised by its quality, plus its enchantment. */
export function weaponDamage(def: Extract<ItemDef, { slot: 'weapon' }>, enchant: number, mods?: ItemMods | null): readonly [number, number] {
  const quality = 1 + (mods ? QUALITY[mods.quality].damage : 0);
  const bonus = enchantBonus(def, enchant);
  return [Math.round(def.damage[0] * quality) + bonus, Math.round(def.damage[1] * quality) + bonus];
}

/** Defence of one piece of armour, not counting its random properties. */
export function armorDefense(def: Extract<ItemDef, { kind: 'equipment' }>, enchant: number, mods?: ItemMods | null): number {
  if (def.slot === 'weapon') return 0;
  // Quality hardens armour; jewellery has nothing to harden.
  const quality = mods && !JEWELLERY_SLOTS.includes(def.slot) ? QUALITY[mods.quality].defense : 0;
  return def.defense + quality + enchantBonus(def, enchant);
}

/** What all the worn items' random properties add up to. */
export function gearStats(player: Player): Record<StatId, number> {
  const total: Record<StatId, number> = { hp: 0, mp: 0, power: 0, defense: 0, crit: 0, haste: 0, speed: 0 };
  for (const slot of EQUIP_SLOTS) {
    const mods = player.equipment[slot] ? player.equipmentMods[slot] : null;
    if (mods) for (const affix of mods.affixes) total[affix.stat] += affix.value;
  }
  return total;
}

/** Chance of a critical blow, in percent. */
export function critChance(player: Player): number {
  return Math.min(CRIT_MAX, CRIT_BASE + gearStats(player).crit);
}

/** Ticks between two attacks: gear that quickens the hand shortens it. */
export function attackCooldown(player: Player): number {
  return Math.max(PLAYER_ATTACK_COOLDOWN_MIN, Math.round(PLAYER_ATTACK_COOLDOWN / (1 + gearStats(player).haste / 100)));
}

/** Recomputes maximum health and mana from level and gear; call after either changes. */
export function refreshVitals(player: Player): void {
  const gear = gearStats(player);
  player.maxHp = heroMaxHp(player.level, player.race, player.cls) + gear.hp;
  player.maxMp = heroMaxMp(player.level, player.race, player.cls) + gear.mp;
  // A dead hero stays dead; a living one never drops to zero by taking a ring off.
  if (player.hp > 0) player.hp = Math.max(1, Math.min(player.hp, player.maxHp));
  player.mp = Math.min(player.mp, player.maxMp);
}

/** The kind of weapon in the hero's hand, or null when unarmed. */
export function weaponInHand(player: Player): WeaponType | null {
  const weapon = player.equipment.weapon;
  const def = weapon ? ITEMS[weapon] : null;
  return def && def.kind === 'equipment' && def.slot === 'weapon' ? def.weaponType : null;
}

export function playerDefense(player: Player): number {
  let total = gearStats(player).defense;
  for (const slot of EQUIP_SLOTS) {
    const itemId = player.equipment[slot];
    const def = itemId ? ITEMS[itemId] : null;
    if (def && def.kind === 'equipment') total += armorDefense(def, player.equipmentEnchant[slot], player.equipmentMods[slot]);
  }
  return total;
}

/**
 * Adds items to the purse or the inventory. Returns how many did not fit.
 * Materials fill existing stacks first, then free slots.
 * `enchant` and `mods` are the enchantment level and properties of a piece of equipment.
 */
export function addItem(player: Player, itemId: ItemId, count: number, enchant = 0, mods?: ItemMods | null): number {
  const def = ITEMS[itemId];
  let left = count;
  if (def.kind === 'currency') {
    player.coins += left;
    left = 0;
  } else {
    const maxStack = maxStackOf(itemId);
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
      player.inventory.push(maxStack === 1 ? gearStack(itemId, enchant, copyMods(mods)) : { itemId, count: moved });
      left -= moved;
    }
  }
  if (left !== count) player.revision += 1;
  return left;
}

export function countItem(player: Player, itemId: ItemId): number {
  let total = 0;
  for (const stack of player.inventory) if (stack.itemId === itemId) total += stack.count;
  return total;
}

/** True when `count` of the item would fit in the bag as it is now. */
export function canFit(player: Player, itemId: ItemId, count: number): boolean {
  if (ITEMS[itemId].kind === 'currency') return true;
  const maxStack = maxStackOf(itemId);
  let room = (INVENTORY_SLOTS - player.inventory.length) * maxStack;
  if (maxStack > 1) {
    for (const stack of player.inventory) if (stack.itemId === itemId) room += maxStack - stack.count;
  }
  return room >= count;
}

/** Takes items out of the bag, emptying later stacks first. Returns false, changing nothing, if there are too few. */
export function removeItem(player: Player, itemId: ItemId, count: number): boolean {
  if (count <= 0 || countItem(player, itemId) < count) return false;
  let left = count;
  for (let i = player.inventory.length - 1; i >= 0 && left > 0; i--) {
    const stack = player.inventory[i] as ItemStack;
    if (stack.itemId !== itemId) continue;
    const taken = Math.min(left, stack.count);
    stack.count -= taken;
    left -= taken;
    if (stack.count === 0) player.inventory.splice(i, 1);
  }
  player.revision += 1;
  return true;
}

/** The charge item that fits the weapon in hand, or null when unarmed. */
export function chargeForWeapon(player: Player): ItemId | null {
  const weapon = player.equipment.weapon;
  const def = weapon ? ITEMS[weapon] : null;
  return def && def.kind === 'equipment' ? CHARGE_FOR_GRADE[def.grade] : null;
}

/**
 * Called when a blow starts. If charges are switched on and one fits the
 * weapon, spends it and returns true. Running out switches charges off.
 */
export function spendCharge(world: World): boolean {
  const { player } = world;
  if (!player.chargesOn) return false;
  const itemId = chargeForWeapon(player);
  if (itemId !== null && removeItem(player, itemId, 1)) return true;
  player.chargesOn = false;
  player.revision += 1;
  world.events.push({ type: 'chargesEmpty' });
  return false;
}

export function toggleCharges(world: World): void {
  const { player } = world;
  if (!player.chargesOn) {
    const itemId = chargeForWeapon(player);
    if (itemId === null || countItem(player, itemId) === 0) {
      world.events.push({ type: 'chargesEmpty' });
      return;
    }
  }
  player.chargesOn = !player.chargesOn;
  player.revision += 1;
}

/** Uses an item from the bag: drinks a potion or reads a recipe. */
export function useItem(world: World, itemId: ItemId): void {
  const { player } = world;
  const def = Object.prototype.hasOwnProperty.call(ITEMS, itemId) ? ITEMS[itemId] : null;
  if (def?.kind === 'recipe') return learnRecipe(world, itemId);
  if (!def || def.kind !== 'consumable' || def.effect.kind === 'charge') return;
  const { effect } = def;
  const deny = (reason: 'none' | 'cooldown' | 'notNeeded') => world.events.push({ type: 'useDenied', itemId, reason });
  if (countItem(player, itemId) === 0) return void deny('none');
  if (player.potionCooldown > 0) return void deny('cooldown');
  const missing = effect.kind === 'heal' ? player.maxHp - player.hp : player.maxMp - player.mp;
  if (missing <= 0) return void deny('notNeeded');
  removeItem(player, itemId, 1);
  const amount = Math.min(missing, effect.amount);
  if (effect.kind === 'heal') {
    player.hp += amount;
    world.events.push({ type: 'playerHealed', amount });
  } else {
    player.mp += amount;
  }
  player.potionCooldown = POTION_COOLDOWN;
  world.events.push({ type: 'itemUsed', itemId });
}

/** Puts an item on the floor. `ignored` keeps the hero from picking it right back up. */
export function dropLoot(world: World, itemId: ItemId, count: number, at: Point, ignored = false, enchant = 0, mods?: ItemMods | null): void {
  const id = world.nextLootId;
  world.nextLootId += 1;
  world.loot.push({ id, itemId, count, pos: pushOutOfWalls(world.map, at, PLAYER_RADIUS), ignored, ...(enchant > 0 ? { enchant } : {}), ...(mods ? { mods } : {}) });
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
    const left = addItem(player, loot.itemId, loot.count, loot.enchant ?? 0, loot.mods);
    if (left < loot.count) {
      world.events.push({ type: 'itemPicked', itemId: loot.itemId, count: loot.count - left, ...(loot.mods ? { quality: loot.mods.quality } : {}) });
    }
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
  // A class fights with one kind of weapon only.
  if (def.slot === 'weapon' && def.weaponType !== CLASSES[player.cls].weapon) {
    world.events.push({ type: 'equipDenied', itemId: stack.itemId });
    return;
  }
  const previous = player.equipment[def.slot];
  const previousEnchant = player.equipmentEnchant[def.slot];
  const previousMods = player.equipmentMods[def.slot];
  player.equipment[def.slot] = stack.itemId;
  player.equipmentEnchant[def.slot] = stack.enchant ?? 0;
  player.equipmentMods[def.slot] = stack.mods ?? null;
  if (previous) player.inventory[index] = gearStack(previous, previousEnchant, previousMods);
  else player.inventory.splice(index, 1);
  refreshVitals(player);
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
  player.inventory.push(gearStack(itemId, player.equipmentEnchant[slot], player.equipmentMods[slot]));
  player.equipment[slot] = null;
  player.equipmentEnchant[slot] = 0;
  player.equipmentMods[slot] = null;
  refreshVitals(player);
  player.revision += 1;
}

/** Drops a whole inventory slot at the hero's feet. */
export function dropFromInventory(world: World, index: number): void {
  const { player } = world;
  const stack = Number.isInteger(index) ? player.inventory[index] : undefined;
  if (!stack) return;
  player.inventory.splice(index, 1);
  player.revision += 1;
  dropLoot(world, stack.itemId, stack.count, player.pos, true, stack.enchant ?? 0, stack.mods);
}
