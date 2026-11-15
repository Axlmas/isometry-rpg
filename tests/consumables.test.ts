import { describe, expect, it } from 'vitest';
import {
  type Monster, type World, CHARGE_DAMAGE_MULTIPLIER, INVENTORY_SLOTS, ITEMS, NPC_RANGE, PLAYER_ATTACK_WINDUP,
  POTION_COOLDOWN, SHOP_STOCK, addItem, buyPrice, canFit, circleFree, countItem, createWorld, isNearMerchant,
  newCharacter, removeItem, sellPrice, step,
} from '../src/sim';

function arena(offsets: Array<[number, number]> = [], level = 1, zone: 'dungeon' | 'overworld' = 'dungeon'): World {
  const world = createWorld(5, { ...newCharacter('trainingSword'), level, skills: ['heavyBlow', 'sweep', 'secondWind'] }, undefined, zone);
  if (zone === 'overworld') return world;
  const { map } = world;
  for (let y = 1; y < map.height - 1; y++) {
    for (let x = 1; x < map.width - 1; x++) map.tiles[y * map.width + x] = 0;
  }
  const template = createWorld(5).monsters[0] as Monster;
  world.monsters = offsets.map(([dx, dy], id) => ({
    ...template, id, hp: 10000, maxHp: 10000,
    home: { x: world.spawn.x + dx, y: world.spawn.y + dy },
    pos: { x: world.spawn.x + dx, y: world.spawn.y + dy },
  }));
  world.monsterTotal = offsets.length;
  return world;
}
const land = (world: World) => {
  for (let i = 0; i < PLAYER_ATTACK_WINDUP; i++) step(world);
};
const types = (world: World) => world.events.map((e) => e.type);

describe('bag helpers', () => {
  it('count, fit and remove across stacks', () => {
    const { player } = arena();
    addItem(player, 'coal', 150);
    expect(countItem(player, 'coal')).toBe(150);
    expect(removeItem(player, 'coal', 151)).toBe(false);
    expect(countItem(player, 'coal')).toBe(150);
    expect(removeItem(player, 'coal', 60)).toBe(true);
    expect(player.inventory).toEqual([{ itemId: 'coal', count: 90 }]);
    while (player.inventory.length < INVENTORY_SLOTS) player.inventory.push({ itemId: 'ironSword', count: 1 });
    expect(canFit(player, 'coal', 9)).toBe(true);
    expect(canFit(player, 'coal', 10)).toBe(false);
    expect(canFit(player, 'ironHelm', 1)).toBe(false);
    expect(canFit(player, 'coins', 10 ** 6)).toBe(true);
  });
});

describe('potions', () => {
  it('restore health or mana, are used up and share a cooldown', () => {
    const world = arena();
    addItem(world.player, 'healthPotion', 2);
    addItem(world.player, 'manaPotion', 1);
    world.player.hp = 10;
    world.player.mp = 0;
    step(world, [{ type: 'use', itemId: 'healthPotion' }]);
    expect(world.player.hp).toBe(70);
    expect(countItem(world.player, 'healthPotion')).toBe(1);
    expect(types(world)).toEqual(['playerHealed', 'itemUsed']);

    step(world, [{ type: 'use', itemId: 'manaPotion' }]);
    expect(world.events).toEqual([{ type: 'useDenied', itemId: 'manaPotion', reason: 'cooldown' }]);
    expect(countItem(world.player, 'manaPotion')).toBe(1);

    for (let i = 0; i < POTION_COOLDOWN; i++) step(world);
    const before = world.player.mp;
    step(world, [{ type: 'use', itemId: 'manaPotion' }]);
    expect(world.player.mp).toBeGreaterThanOrEqual(Math.min(world.player.maxMp, before + 40));
    expect(countItem(world.player, 'manaPotion')).toBe(0);
  });

  it('never heal above the maximum', () => {
    const world = arena();
    addItem(world.player, 'healthPotion', 1);
    world.player.hp = world.player.maxHp - 5;
    step(world, [{ type: 'use', itemId: 'healthPotion' }]);
    expect(world.player.hp).toBe(world.player.maxHp);
  });

  it('are refused, and kept, when there are none or they are not needed', () => {
    const world = arena();
    step(world, [{ type: 'use', itemId: 'healthPotion' }]);
    expect(world.events).toEqual([{ type: 'useDenied', itemId: 'healthPotion', reason: 'none' }]);
    addItem(world.player, 'healthPotion', 1);
    step(world, [{ type: 'use', itemId: 'healthPotion' }]);
    expect(world.events).toEqual([{ type: 'useDenied', itemId: 'healthPotion', reason: 'notNeeded' }]);
    expect(countItem(world.player, 'healthPotion')).toBe(1);
  });

  it('ignore things that are not potions and do nothing for the dead', () => {
    const world = arena();
    addItem(world.player, 'coal', 1);
    addItem(world.player, 'chargePlain', 5);
    step(world, [
      { type: 'use', itemId: 'coal' }, { type: 'use', itemId: 'chargePlain' }, { type: 'use', itemId: 'ironSword' },
      { type: 'use', itemId: 'toString' as never }, { type: 'use', itemId: 'coins' },
    ]);
    expect(world.events).toEqual([]);
    addItem(world.player, 'healthPotion', 1);
    world.player.hp = 0;
    step(world, [{ type: 'use', itemId: 'healthPotion' }]);
    expect(world.player.hp).toBe(0);
    expect(countItem(world.player, 'healthPotion')).toBe(1);
  });
});

describe('weapon charges', () => {
  const blow = (charges: number, on: boolean) => {
    const world = arena([[1, 0]]);
    if (charges > 0) addItem(world.player, 'chargePlain', charges);
    if (on) step(world, [{ type: 'toggleCharges' }]);
    step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
    const swing = world.events.find((e) => e.type === 'playerSwing');
    land(world);
    return { world, dealt: 10000 - (world.monsters[0] as Monster).hp, charged: swing?.type === 'playerSwing' && swing.charged };
  };

  it('make a blow stronger and are spent one per blow', () => {
    const plain = blow(10, false);
    const charged = blow(10, true);
    expect(plain.charged).toBe(false);
    expect(charged.charged).toBe(true);
    expect(countItem(plain.world.player, 'chargePlain')).toBe(10);
    expect(countItem(charged.world.player, 'chargePlain')).toBe(9);
    // Same seed, same roll: only the charge differs.
    expect(charged.dealt).toBe(Math.round(plain.dealt * CHARGE_DAMAGE_MULTIPLIER));
  });

  it('cannot be switched on without charges for the weapon in hand', () => {
    const world = arena();
    step(world, [{ type: 'toggleCharges' }]);
    expect(world.player.chargesOn).toBe(false);
    expect(world.events).toEqual([{ type: 'chargesEmpty' }]);
    addItem(world.player, 'chargeD', 50); // wrong grade for the training sword
    step(world, [{ type: 'toggleCharges' }]);
    expect(world.player.chargesOn).toBe(false);
    step(world, [{ type: 'unequip', slot: 'weapon' }, { type: 'toggleCharges' }]);
    expect(world.player.chargesOn).toBe(false); // bare hands take no charges
  });

  it('switch themselves off, with a notice, when the last one is spent', () => {
    const world = arena([[1, 0]]);
    addItem(world.player, 'chargePlain', 1);
    step(world, [{ type: 'toggleCharges' }]);
    step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
    expect(world.player.inventory).toEqual([]);
    expect(world.player.chargesOn).toBe(true);
    for (let i = 0; i < 20; i++) step(world);
    step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
    expect(world.player.chargesOn).toBe(false);
    expect(types(world)).toEqual(['chargesEmpty', 'playerSwing']);
  });

  it('use the charge of the weapon’s grade', () => {
    const world = arena([[1, 0]]);
    addItem(world.player, 'soldierBlade', 1);
    addItem(world.player, 'chargePlain', 5);
    addItem(world.player, 'chargeD', 5);
    step(world, [{ type: 'equip', index: 0 }, { type: 'toggleCharges' }, { type: 'attack', dx: 1, dy: 0 }]);
    expect(countItem(world.player, 'chargeD')).toBe(4);
    expect(countItem(world.player, 'chargePlain')).toBe(5);
  });

  it('also strengthen strike skills, and can be switched off again', () => {
    const world = arena([[1, 0]], 10);
    addItem(world.player, 'chargePlain', 5);
    step(world, [{ type: 'toggleCharges' }, { type: 'skill', id: 'heavyBlow', dx: 1, dy: 0 }]);
    expect(world.events).toContainEqual({ type: 'skillUsed', id: 'heavyBlow', dir: { x: 1, y: 0 }, charged: true });
    expect(countItem(world.player, 'chargePlain')).toBe(4);
    step(world, [{ type: 'toggleCharges' }]);
    expect(world.player.chargesOn).toBe(false);
  });
});

describe('merchant', () => {
  const alchemist = (world: World) => world.npcs.find((npc) => npc.kind === 'alchemist')!.pos;
  /** A hero standing next to the village alchemist. */
  const shop = (): World => {
    const world = arena([], 1, 'overworld');
    world.player.pos = { x: alchemist(world).x, y: alchemist(world).y + 1 };
    return world;
  };

  it('stands on a free tile in the village', () => {
    const world = arena([], 1, 'overworld');
    expect(circleFree(world.map, alchemist(world), 0.3)).toBe(true);
    expect(isNearMerchant(shop())).toBe(true);
  });

  it('does not trade outside the village', () => {
    const world = arena();
    world.player.coins = 1000;
    step(world, [{ type: 'buy', itemId: 'healthPotion', count: 1 }]);
    expect(world.events).toEqual([{ type: 'tradeDenied', reason: 'far' }]);
  });

  it('sells stock for its price', () => {
    const world = shop();
    world.player.coins = 100;
    step(world, [{ type: 'buy', itemId: 'healthPotion', count: 2 }]);
    expect(world.player.coins).toBe(100 - 2 * buyPrice('healthPotion'));
    expect(countItem(world.player, 'healthPotion')).toBe(2);
    expect(world.events).toEqual([{ type: 'bought', itemId: 'healthPotion', count: 2, cost: 50 }]);
  });

  it('refuses, changing nothing, without coins, room or closeness', () => {
    const poor = shop();
    poor.player.coins = 24;
    step(poor, [{ type: 'buy', itemId: 'healthPotion', count: 1 }]);
    expect(poor.events).toEqual([{ type: 'tradeDenied', reason: 'coins' }]);
    expect(poor.player.coins).toBe(24);

    const full = shop();
    full.player.coins = 10000;
    while (full.player.inventory.length < INVENTORY_SLOTS) full.player.inventory.push({ itemId: 'ironSword', count: 1 });
    step(full, [{ type: 'buy', itemId: 'healthPotion', count: 1 }]);
    expect(full.events).toEqual([{ type: 'tradeDenied', reason: 'full' }]);
    expect(full.player.coins).toBe(10000);

    const far = shop();
    far.player.coins = 10000;
    far.player.pos = { x: alchemist(far).x + NPC_RANGE + 0.5, y: alchemist(far).y + 2 };
    addItem(far.player, 'coal', 3);
    step(far, [{ type: 'buy', itemId: 'healthPotion', count: 1 }, { type: 'sell', index: 0, count: 1 }]);
    expect(types(far)).toEqual(['tradeDenied', 'tradeDenied']);
    expect(far.player.coins).toBe(10000);
    expect(countItem(far.player, 'coal')).toBe(3);
  });

  it('ignores orders for things he does not stock and for impossible amounts', () => {
    const world = shop();
    world.player.coins = 10 ** 9;
    step(world, [
      { type: 'buy', itemId: 'soldierBlade', count: 1 }, { type: 'buy', itemId: 'coins', count: 5 },
      { type: 'buy', itemId: 'healthPotion', count: 0 }, { type: 'buy', itemId: 'healthPotion', count: -3 },
      { type: 'buy', itemId: 'healthPotion', count: 1.5 }, { type: 'buy', itemId: 'healthPotion', count: 10 ** 7 },
      { type: 'buy', itemId: 'nothing' as never, count: 1 },
    ]);
    expect(world.events).toEqual([]);
    expect(world.player.coins).toBe(10 ** 9);
    expect(world.player.inventory).toEqual([]);
  });

  it('buys from the bag at half price', () => {
    const world = shop();
    addItem(world.player, 'ironOre', 10);
    addItem(world.player, 'chainShirt', 1);
    step(world, [{ type: 'sell', index: 0, count: 4 }]);
    expect(world.player.coins).toBe(4 * sellPrice('ironOre'));
    expect(world.player.inventory[0]).toEqual({ itemId: 'ironOre', count: 6 });
    step(world, [{ type: 'sell', index: 1, count: 1 }]);
    expect(world.player.inventory).toEqual([{ itemId: 'ironOre', count: 6 }]);
    expect(world.player.coins).toBe(4 * sellPrice('ironOre') + sellPrice('chainShirt'));
  });

  it('never pays more than he charges, and refuses worthless things and wrong amounts', () => {
    for (const itemId of Object.values(SHOP_STOCK).flat()) expect(sellPrice(itemId)).toBeLessThan(buyPrice(itemId));
    for (const def of Object.values(ITEMS)) expect(sellPrice(def.id) * 2).toBeLessThanOrEqual(buyPrice(def.id));
    const world = shop();
    addItem(world.player, 'chargePlain', 50); // worth 1 coin each, sells for nothing
    addItem(world.player, 'coal', 2);
    step(world, [{ type: 'sell', index: 0, count: 50 }]);
    expect(world.events).toEqual([{ type: 'tradeDenied', reason: 'worthless' }]);
    step(world, [{ type: 'sell', index: 1, count: 3 }, { type: 'sell', index: 7, count: 1 }, { type: 'sell', index: 1, count: 0 }, { type: 'sell', index: -1, count: 1 }]);
    expect(world.events).toEqual([]);
    expect(world.player.coins).toBe(0);
    expect(countItem(world.player, 'coal')).toBe(2);
  });

  it('cannot be used to make coins by buying and selling back', () => {
    const world = shop();
    world.player.coins = 1000;
    for (let i = 0; i < 20; i++) {
      step(world, [{ type: 'buy', itemId: 'healthPotion', count: 1 }]);
      step(world, [{ type: 'sell', index: 0, count: 1 }]);
    }
    expect(world.player.coins).toBeLessThan(1000);
  });
});
