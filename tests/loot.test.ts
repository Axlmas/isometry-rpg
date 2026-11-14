import { describe, expect, it } from 'vitest';
import {
  type ItemId, type Monster, type World, DROP_COINS, EQUIP_SLOTS, INVENTORY_SLOTS, ITEMS, MONSTER_DAMAGE,
  PLAYER_MAX_HP, STARTING_WEAPON, UNARMED_DAMAGE, addItem, characterOf, createWorld, droppableEquipment,
  isItemId, playerDamage, playerDefense, step,
} from '../src/sim';

function openWorld(seed = 5): World {
  const world = createWorld(seed);
  const { map } = world;
  for (let y = 1; y < map.height - 1; y++) {
    for (let x = 1; x < map.width - 1; x++) map.tiles[y * map.width + x] = 0;
  }
  world.monsters = [];
  world.monsterTotal = 0;
  return world;
}
const fillBag = (world: World) => {
  while (world.player.inventory.length < INVENTORY_SLOTS) world.player.inventory.push({ itemId: 'ironSword', count: 1 });
};
const putLoot = (world: World, itemId: ItemId, count: number, dx: number) => {
  world.loot.push({ id: world.nextLootId++, itemId, count, pos: { x: world.spawn.x + dx, y: world.spawn.y }, ignored: false });
};

describe('item catalogue', () => {
  it('is internally consistent', () => {
    for (const [id, def] of Object.entries(ITEMS)) {
      expect(def.id).toBe(id);
      if (def.kind === 'equipment' && def.slot === 'weapon') {
        expect(def.damage[0]).toBeGreaterThan(0);
        expect(def.damage[1]).toBeGreaterThanOrEqual(def.damage[0]);
      }
      if (def.kind === 'equipment' && def.slot !== 'weapon') expect(def.defense).toBeGreaterThan(0);
    }
    expect(isItemId('ironSword')).toBe(true);
    expect(isItemId('toString')).toBe(false);
    expect(isItemId(7)).toBe(false);
  });
  it('never drops the starting weapon and has drops for every grade', () => {
    expect(droppableEquipment('none')).not.toContain(STARTING_WEAPON);
    expect(droppableEquipment('none').length).toBeGreaterThan(0);
    expect(droppableEquipment('d').length).toBeGreaterThan(0);
  });
  it('makes D-grade weapons stronger than plain ones', () => {
    const best = (grade: 'none' | 'd') => Math.max(...Object.values(ITEMS).map((d) => (d.kind === 'equipment' && d.slot === 'weapon' && d.grade === grade ? d.damage[1] : 0)));
    expect(best('d')).toBeGreaterThan(best('none'));
  });
});

describe('a new hero', () => {
  it('starts with the training weapon, no armour, no coins and an empty bag', () => {
    const { player } = createWorld(1);
    expect(player.equipment).toEqual({ weapon: STARTING_WEAPON, helmet: null, armor: null, boots: null });
    expect(player.inventory).toEqual([]);
    expect(player.coins).toBe(0);
    expect(playerDefense(player)).toBe(0);
  });
});

describe('monster drops', () => {
  it('always include coins within the stated range and sometimes an item', () => {
    let materials = 0;
    let equipment = 0;
    const kills = 300;
    for (let seed = 0; seed < kills; seed++) {
      const world = openWorld(seed);
      const template = createWorld(seed).monsters[0] as Monster;
      world.monsters = [{ ...template, hp: 1, pos: { x: world.spawn.x + 1, y: world.spawn.y }, home: { ...world.spawn } }];
      step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
      for (let i = 0; i < 5 && world.monsters.length > 0; i++) step(world);
      expect(world.monsters).toEqual([]);
      const coins = world.loot.filter((l) => l.itemId === 'coins');
      expect(coins).toHaveLength(1);
      expect(coins[0]?.count).toBeGreaterThanOrEqual(DROP_COINS[0]);
      expect(coins[0]?.count).toBeLessThanOrEqual(DROP_COINS[1]);
      const others = world.loot.filter((l) => l.itemId !== 'coins');
      expect(others.length).toBeLessThanOrEqual(1);
      for (const loot of others) {
        if (ITEMS[loot.itemId].kind === 'material') materials += 1;
        else equipment += 1;
        expect(loot.itemId).not.toBe(STARTING_WEAPON);
      }
    }
    // Loose bounds around the configured 40% and 24%: this guards against a broken table, not the exact odds.
    expect(materials / kills).toBeGreaterThan(0.25);
    expect(materials / kills).toBeLessThan(0.55);
    expect(equipment / kills).toBeGreaterThan(0.12);
    expect(equipment / kills).toBeLessThan(0.38);
  });
});

describe('picking up', () => {
  it('collects loot the hero walks over and reports it', () => {
    const world = openWorld();
    putLoot(world, 'coins', 7, 2);
    putLoot(world, 'leather', 2, 3);
    step(world);
    expect(world.player.coins).toBe(0); // too far
    step(world, [{ type: 'moveTo', x: world.spawn.x + 3, y: world.spawn.y }]);
    const picked: unknown[] = [];
    for (let i = 0; i < 60; i++) {
      step(world);
      picked.push(...world.events.filter((e) => e.type === 'itemPicked'));
    }
    expect(world.player.coins).toBe(7);
    expect(world.player.inventory).toEqual([{ itemId: 'leather', count: 2 }]);
    expect(world.loot).toEqual([]);
    expect(picked).toEqual([{ type: 'itemPicked', itemId: 'coins', count: 7 }, { type: 'itemPicked', itemId: 'leather', count: 2 }]);
  });

  it('stacks materials and keeps equipment one per slot', () => {
    const { player } = openWorld();
    expect(addItem(player, 'coal', 60)).toBe(0);
    expect(addItem(player, 'coal', 60)).toBe(0);
    expect(addItem(player, 'ironSword', 1)).toBe(0);
    expect(addItem(player, 'ironSword', 1)).toBe(0);
    expect(player.inventory).toEqual([
      { itemId: 'coal', count: 99 }, { itemId: 'coal', count: 21 },
      { itemId: 'ironSword', count: 1 }, { itemId: 'ironSword', count: 1 },
    ]);
  });

  it('leaves loot on the floor when the bag is full, says so once, and still takes coins', () => {
    const world = openWorld();
    fillBag(world);
    putLoot(world, 'ironHelm', 1, 0.2);
    putLoot(world, 'coins', 5, 0.2);
    let notices = 0;
    for (let i = 0; i < 40; i++) {
      step(world);
      notices += world.events.filter((e) => e.type === 'inventoryFull').length;
    }
    expect(notices).toBe(1);
    expect(world.player.coins).toBe(5);
    expect(world.loot.map((l) => l.itemId)).toEqual(['ironHelm']);
    // After making room and walking away and back, it is picked up.
    step(world, [{ type: 'drop', index: 0 }]);
    step(world, [{ type: 'moveTo', x: world.spawn.x + 3, y: world.spawn.y }]);
    for (let i = 0; i < 40; i++) step(world);
    step(world, [{ type: 'moveTo', x: world.spawn.x + 0.2, y: world.spawn.y }]);
    for (let i = 0; i < 40; i++) step(world);
    expect(world.player.inventory.some((s) => s.itemId === 'ironHelm')).toBe(true);
  });

  it('partly takes a stack that does not fully fit', () => {
    const world = openWorld();
    fillBag(world);
    world.player.inventory[0] = { itemId: 'bone', count: 98 };
    putLoot(world, 'bone', 2, 0.1);
    step(world);
    expect(world.player.inventory[0]).toEqual({ itemId: 'bone', count: 99 });
    expect(world.loot[0]?.count).toBe(1);
  });

  it('does not let a dead hero pick things up', () => {
    const world = openWorld();
    world.player.hp = 0;
    putLoot(world, 'coins', 5, 0);
    step(world);
    expect(world.player.coins).toBe(0);
  });
});

describe('equipment', () => {
  it('swaps a worn item with the one from the bag and changes the numbers', () => {
    const world = openWorld();
    addItem(world.player, 'soldierBlade', 1);
    addItem(world.player, 'chainShirt', 1);
    step(world, [{ type: 'equip', index: 0 }]);
    expect(world.player.equipment.weapon).toBe('soldierBlade');
    expect(world.player.inventory[0]).toEqual({ itemId: STARTING_WEAPON, count: 1 });
    expect(playerDamage(world.player)).toEqual([16, 23]);
    step(world, [{ type: 'equip', index: 1 }]);
    expect(world.player.equipment.armor).toBe('chainShirt');
    expect(world.player.inventory).toHaveLength(1);
    expect(playerDefense(world.player)).toBe(3);
  });

  it('fights bare-handed without a weapon', () => {
    const world = openWorld();
    step(world, [{ type: 'unequip', slot: 'weapon' }]);
    expect(world.player.equipment.weapon).toBeNull();
    expect(world.player.inventory).toEqual([{ itemId: STARTING_WEAPON, count: 1 }]);
    expect(playerDamage(world.player)).toEqual(UNARMED_DAMAGE);
  });

  it('refuses to take an item off into a full bag', () => {
    const world = openWorld();
    fillBag(world);
    step(world, [{ type: 'unequip', slot: 'weapon' }]);
    expect(world.player.equipment.weapon).toBe(STARTING_WEAPON);
    expect(world.events).toContainEqual({ type: 'inventoryFull' });
  });

  it('ignores impossible orders', () => {
    const world = openWorld();
    addItem(world.player, 'leather', 3);
    const before = JSON.stringify(world.player);
    step(world, [
      { type: 'equip', index: 0 }, // a material
      { type: 'equip', index: 5 }, { type: 'equip', index: -1 }, { type: 'equip', index: 0.5 }, { type: 'equip', index: Number.NaN },
      { type: 'drop', index: 9 }, { type: 'drop', index: -1 },
      { type: 'unequip', slot: 'helmet' }, // nothing worn there
      { type: 'unequip', slot: 'cloak' as never },
    ]);
    expect(JSON.stringify({ ...world.player, ticksSinceHurt: 0 })).toBe(before);
  });

  it('reduces damage taken by the defence, but never below one', () => {
    const hit = (armour: boolean) => {
      const world = openWorld(3);
      const template = createWorld(3).monsters[0] as Monster;
      world.monsters = [{ ...template, pos: { x: world.spawn.x + 0.9, y: world.spawn.y }, home: { ...world.spawn } }];
      if (armour) world.player.equipment = { weapon: STARTING_WEAPON, helmet: 'ironHelm', armor: 'chainShirt', boots: 'ironGreaves' };
      for (let i = 0; i < 40 && world.player.hp === PLAYER_MAX_HP; i++) step(world);
      return PLAYER_MAX_HP - world.player.hp;
    };
    const bare = hit(false);
    const armoured = hit(true);
    expect(bare).toBeGreaterThanOrEqual(MONSTER_DAMAGE[0]);
    expect(armoured).toBe(Math.max(1, bare - 7));
  });
});

describe('dropping', () => {
  it('puts the stack at the hero’s feet and does not pick it straight back up', () => {
    const world = openWorld();
    addItem(world.player, 'thread', 4);
    step(world, [{ type: 'drop', index: 0 }]);
    for (let i = 0; i < 20; i++) step(world);
    expect(world.player.inventory).toEqual([]);
    expect(world.loot).toHaveLength(1);
    expect(world.loot[0]).toMatchObject({ itemId: 'thread', count: 4 });
  });
});

describe('moving on to the next dungeon', () => {
  it('keeps coins, bag and equipment but not the old dungeon', () => {
    const world = openWorld(1);
    world.player.coins = 55;
    addItem(world.player, 'coal', 3);
    world.player.equipment.helmet = 'leatherCap';
    world.player.hp = 12;
    const next = createWorld(2, characterOf(world));
    expect(next.player.coins).toBe(55);
    expect(next.player.inventory).toEqual([{ itemId: 'coal', count: 3 }]);
    expect(next.player.equipment.helmet).toBe('leatherCap');
    expect(next.player.hp).toBe(PLAYER_MAX_HP);
    expect(next.loot).toEqual([]);
    // The copy is independent of the old world.
    next.player.inventory[0]!.count = 1;
    next.player.equipment.helmet = null;
    expect(world.player.inventory[0]?.count).toBe(3);
    expect(world.player.equipment.helmet).toBe('leatherCap');
    expect(EQUIP_SLOTS.every((slot) => slot in next.player.equipment)).toBe(true);
  });
});
