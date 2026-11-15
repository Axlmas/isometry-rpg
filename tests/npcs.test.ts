import { describe, expect, it } from 'vitest';
import {
  type ItemTarget, type Monster, type NpcKind, type World, ENCHANT_CHANCE, ENCHANT_MAX, ENCHANT_SAFE, GUARD_RANGE,
  INVENTORY_SLOTS, ITEMS, NPC_RANGE, SHOP_STOCK, SKILL_IDS, SKILL_PRICE, addItem, buyPrice, characterOf,
  circleFree, countItem, createWorld, crystalsFor, enchantChance, isNear, knows, nearestNpc, newCharacter,
  playerDamage, playerDefense, regionAt, scrollFor, step,
} from '../src/sim';

const village = (level = 1, seed = 5): World => createWorld(seed, { ...newCharacter('trainingSword'), level }, undefined, 'overworld');
const npcOf = (world: World, kind: NpcKind) => world.npcs.find((npc) => npc.kind === kind)!;
/** A hero standing next to the villager of the given trade. */
function visiting(kind: NpcKind, level = 1, seed = 5): World {
  const world = village(level, seed);
  const npc = npcOf(world, kind);
  world.player.pos = { x: npc.pos.x, y: npc.pos.y + 1 };
  return world;
}
const types = (world: World) => world.events.map((e) => e.type);

describe('the people of the village', () => {
  const world = village();

  it('are the alchemist, the outfitter, the blacksmith, the trainer, the hunter and two guards', () => {
    expect(world.npcs.map((npc) => npc.kind).sort()).toEqual(['alchemist', 'blacksmith', 'guard', 'guard', 'hunter', 'outfitter', 'trainer']);
    expect(new Set(world.npcs.map((npc) => npc.id)).size).toBe(world.npcs.length);
  });

  it('all stand on free ground inside the village, not on top of each other', () => {
    for (const npc of world.npcs) {
      expect(regionAt('overworld', npc.pos).id).toBe('village');
      expect(circleFree(world.map, npc.pos, 0.3)).toBe(true);
      for (const other of world.npcs) {
        if (other.id > npc.id) expect(Math.hypot(other.pos.x - npc.pos.x, other.pos.y - npc.pos.y)).toBeGreaterThan(NPC_RANGE);
      }
    }
  });

  it('are not found in the mines', () => {
    expect(createWorld(1).npcs).toEqual([]);
  });

  it('can be talked to only from close by', () => {
    expect(nearestNpc(world)).toBeNull(); // a new hero stands in the middle of the square
    expect(nearestNpc(visiting('trainer'))?.kind).toBe('trainer');
    expect(isNear(visiting('blacksmith'), 'blacksmith')).toBe(true);
    expect(isNear(visiting('blacksmith'), 'trainer')).toBe(false);
  });
});

describe('merchants', () => {
  it('each sell their own goods and nothing else', () => {
    const stocked = Object.values(SHOP_STOCK).flat();
    expect(new Set(stocked).size).toBe(stocked.length); // no item is sold by two merchants
    for (const itemId of stocked) expect(buyPrice(itemId)).toBeGreaterThan(0);

    const world = visiting('alchemist');
    world.player.coins = 10000;
    step(world, [{ type: 'buy', itemId: 'healthPotion', count: 1 }, { type: 'buy', itemId: 'ironSword', count: 1 }]);
    expect(world.events).toEqual([{ type: 'bought', itemId: 'healthPotion', count: 1, cost: 25 }, { type: 'tradeDenied', reason: 'notSold' }]);
    expect(world.player.inventory).toEqual([{ itemId: 'healthPotion', count: 1 }]);

    const atOutfitter = visiting('outfitter');
    atOutfitter.player.coins = 10000;
    step(atOutfitter, [{ type: 'buy', itemId: 'ironSword', count: 1 }]);
    expect(atOutfitter.player.inventory).toEqual([{ itemId: 'ironSword', count: 1 }]);
  });

  it('all buy from the bag, but the trainer and the guards do not trade', () => {
    for (const kind of ['alchemist', 'outfitter', 'blacksmith'] as const) {
      const world = visiting(kind);
      addItem(world.player, 'ironOre', 4);
      step(world, [{ type: 'sell', index: 0, count: 4 }]);
      expect(world.player.coins, kind).toBe(16);
    }
    for (const kind of ['trainer', 'hunter', 'guard'] as const) {
      const world = visiting(kind);
      world.player.coins = 1000;
      addItem(world.player, 'ironOre', 4);
      step(world, [{ type: 'sell', index: 0, count: 4 }, { type: 'buy', itemId: 'healthPotion', count: 1 }]);
      expect(types(world), kind).toEqual(['tradeDenied', 'tradeDenied']);
      expect(world.player.coins).toBe(1000);
    }
  });
});

describe('the trainer', () => {
  it('teaches a skill for coins once the hero has the level', () => {
    const world = visiting('trainer', 2);
    world.player.coins = 100;
    expect(knows(world, 'heavyBlow')).toBe(false);
    step(world, [{ type: 'learn', id: 'heavyBlow' }]);
    expect(world.events).toEqual([{ type: 'skillLearned', id: 'heavyBlow' }]);
    expect(world.player.coins).toBe(100 - SKILL_PRICE.heavyBlow);
    expect(knows(world, 'heavyBlow')).toBe(true);
    // Learning twice costs nothing more.
    step(world, [{ type: 'learn', id: 'heavyBlow' }]);
    expect(world.events).toEqual([]);
    expect(world.player.coins).toBe(100 - SKILL_PRICE.heavyBlow);
  });

  it('refuses, taking nothing, without the level, the coins or the hero at his side', () => {
    const young = visiting('trainer', 1);
    young.player.coins = 10000;
    step(young, [{ type: 'learn', id: 'heavyBlow' }]);
    expect(young.events).toEqual([{ type: 'learnDenied', id: 'heavyBlow', reason: 'level' }]);

    const poor = visiting('trainer', 10);
    poor.player.coins = SKILL_PRICE.sweep - 1;
    step(poor, [{ type: 'learn', id: 'sweep' }]);
    expect(poor.events).toEqual([{ type: 'learnDenied', id: 'sweep', reason: 'coins' }]);
    expect(poor.player.coins).toBe(SKILL_PRICE.sweep - 1);

    const far = village(10);
    far.player.coins = 10000;
    step(far, [{ type: 'learn', id: 'sweep' }, { type: 'learn', id: 'fireball' as never }]);
    expect(far.events).toEqual([{ type: 'learnDenied', id: 'sweep', reason: 'far' }]);
    expect(far.player.skills).toEqual([]);
  });

  it('is the only way to a skill: level alone is not enough', () => {
    const world = village(10);
    step(world, [{ type: 'skill', id: 'heavyBlow', dx: 1, dy: 0 }]);
    expect(world.events).toEqual([{ type: 'skillDenied', id: 'heavyBlow', reason: 'unlearned' }]);
    expect(world.player.mp).toBe(world.player.maxMp);
  });

  it('prices every skill', () => {
    const prices = SKILL_IDS.map((id) => SKILL_PRICE[id]);
    expect(prices.every((price) => price > 0)).toBe(true);
  });

  it('teaches for good: skills stay with the hero on other maps', () => {
    const world = visiting('trainer', 2);
    world.player.coins = 100;
    step(world, [{ type: 'learn', id: 'heavyBlow' }]);
    const mines = createWorld(3, characterOf(world), 4);
    expect(mines.player.skills).toEqual(['heavyBlow']);
    step(mines, [{ type: 'skill', id: 'heavyBlow', dx: 1, dy: 0 }]);
    expect(types(mines)).toContain('skillUsed');
  });
});

describe('guards', () => {
  const withMonster = (distance: number): { world: World; monster: Monster } => {
    const world = village();
    const guard = npcOf(world, 'guard');
    const monster: Monster = { ...(world.monsters[0] as Monster), id: 0, home: { x: 60, y: 29 }, pos: { x: guard.pos.x + distance, y: guard.pos.y } };
    world.monsters = [monster];
    return { world, monster };
  };

  it('strike a monster that comes close and kill it in a few blows', () => {
    const { world } = withMonster(GUARD_RANGE - 0.5);
    world.monsters[0]!.pos.y += 1.5; // out of the second guard's reach, so the blows can be counted
    let strikes = 0;
    for (let i = 0; i < 200 && world.monsters.length > 0; i++) {
      step(world);
      strikes += world.events.filter((e) => e.type === 'guardStrike').length;
    }
    expect(world.monsters).toEqual([]);
    expect(strikes).toBeGreaterThanOrEqual(2);
    expect(strikes).toBeLessThanOrEqual(4);
  });

  it('leave distant monsters alone', () => {
    const { world } = withMonster(GUARD_RANGE + 3);
    const before = world.monsters[0]!.hp;
    for (let i = 0; i < 100; i++) step(world);
    expect(world.monsters[0]?.hp).toBe(before);
  });

  it('give the hero no experience or loot for their kills, and the monster comes back later', () => {
    const { world } = withMonster(1);
    for (let i = 0; i < 200 && world.monsters.length > 0; i++) step(world);
    expect(world.player.xp).toBe(0);
    expect(world.loot).toEqual([]);
    expect(world.respawns).toHaveLength(1);
  });
});

describe('tempering at the blacksmith', () => {
  const WORN: ItemTarget = { kind: 'slot', slot: 'weapon' };
  const forge = (scrolls = 20, seed = 5): World => {
    const world = visiting('blacksmith', 1, seed);
    if (scrolls > 0) addItem(world.player, 'scrollWeaponPlain', scrolls);
    return world;
  };

  it('raises the item by one level, spends a scroll and makes it stronger', () => {
    const world = forge(2);
    const before = playerDamage(world.player);
    step(world, [{ type: 'enchant', target: WORN }]);
    expect(world.events).toEqual([{ type: 'enchanted', itemId: 'trainingSword', level: 1 }]);
    expect(world.player.equipmentEnchant.weapon).toBe(1);
    expect(countItem(world.player, 'scrollWeaponPlain')).toBe(1);
    expect(playerDamage(world.player)).toEqual([before[0] + 1, before[1] + 1]);
  });

  it('never fails up to the safe level', () => {
    expect(enchantChance(0)).toBe(100);
    expect(enchantChance(ENCHANT_SAFE - 1)).toBe(100);
    expect(enchantChance(ENCHANT_SAFE)).toBe(ENCHANT_CHANCE);
    for (let seed = 0; seed < 40; seed++) {
      const world = forge(ENCHANT_SAFE, seed);
      for (let i = 0; i < ENCHANT_SAFE; i++) step(world, [{ type: 'enchant', target: WORN }]);
      expect(world.player.equipmentEnchant.weapon, `seed ${seed}`).toBe(ENCHANT_SAFE);
    }
  });

  it('above the safe level sometimes destroys the item, about one time in three', () => {
    let failures = 0;
    const attempts = 300;
    for (let seed = 0; seed < attempts; seed++) {
      const world = forge(1, seed);
      world.player.equipmentEnchant.weapon = ENCHANT_SAFE;
      step(world, [{ type: 'enchant', target: WORN }]);
      const failed = world.events.some((e) => e.type === 'enchantFailed');
      if (failed) {
        failures += 1;
        expect(world.player.equipment.weapon).toBeNull();
        expect(world.player.equipmentEnchant.weapon).toBe(0);
      } else {
        expect(world.player.equipmentEnchant.weapon).toBe(ENCHANT_SAFE + 1);
      }
      expect(countItem(world.player, 'scrollWeaponPlain')).toBe(0); // the scroll is spent either way
    }
    expect(failures / attempts).toBeGreaterThan(0.24);
    expect(failures / attempts).toBeLessThan(0.44);
  });

  it('leaves crystals when a graded item breaks, and nothing for a plain one', () => {
    const breakOne = (itemId: 'soldierBlade' | 'ironSword', scroll: 'scrollWeaponD' | 'scrollWeaponPlain') => {
      for (let seed = 0; seed < 200; seed++) {
        const world = visiting('blacksmith', 1, seed);
        world.player.equipment.weapon = itemId;
        world.player.equipmentEnchant.weapon = ENCHANT_SAFE;
        addItem(world.player, scroll, 1);
        step(world, [{ type: 'enchant', target: WORN }]);
        const failed = world.events.find((e) => e.type === 'enchantFailed');
        if (failed) return { world, failed };
      }
      throw new Error('no failure in 200 tries');
    };
    const graded = breakOne('soldierBlade', 'scrollWeaponD');
    expect(graded.failed).toEqual({ type: 'enchantFailed', itemId: 'soldierBlade', level: ENCHANT_SAFE, crystals: crystalsFor('soldierBlade') });
    expect(countItem(graded.world.player, 'crystalD')).toBe(crystalsFor('soldierBlade'));
    const plain = breakOne('ironSword', 'scrollWeaponPlain');
    expect(plain.failed).toMatchObject({ crystals: 0 });
    expect(plain.world.player.inventory).toEqual([]);
  });

  it('needs the right scroll: by grade, and separately for weapons and armour', () => {
    expect(scrollFor(ITEMS.ironSword as never)).toBe('scrollWeaponPlain');
    expect(scrollFor(ITEMS.soldierBlade as never)).toBe('scrollWeaponD');
    expect(scrollFor(ITEMS.leatherCap as never)).toBe('scrollArmorPlain');
    expect(scrollFor(ITEMS.chainShirt as never)).toBe('scrollArmorD');
    const world = visiting('blacksmith');
    addItem(world.player, 'scrollArmorPlain', 5);
    addItem(world.player, 'scrollWeaponD', 5);
    step(world, [{ type: 'enchant', target: WORN }]);
    expect(world.events).toEqual([{ type: 'enchantDenied', reason: 'scroll' }]);
    expect(world.player.equipmentEnchant.weapon).toBe(0);
  });

  it('works on items in the bag too, even when the scroll sits before the item', () => {
    const world = forge(1);
    addItem(world.player, 'leatherCap', 1);
    addItem(world.player, 'scrollArmorPlain', 1);
    world.player.inventory = [world.player.inventory[2]!, world.player.inventory[0]!, world.player.inventory[1]!]; // armour scroll, weapon scroll, cap
    step(world, [{ type: 'enchant', target: { kind: 'bag', index: 2 } }]);
    expect(world.player.inventory).toEqual([{ itemId: 'scrollWeaponPlain', count: 1 }, { itemId: 'leatherCap', count: 1, enchant: 1 }]);
  });

  it('stops at the highest level and only works next to the blacksmith', () => {
    const maxed = forge(3);
    maxed.player.equipmentEnchant.weapon = ENCHANT_MAX;
    step(maxed, [{ type: 'enchant', target: WORN }]);
    expect(maxed.events).toEqual([{ type: 'enchantDenied', reason: 'max' }]);
    expect(countItem(maxed.player, 'scrollWeaponPlain')).toBe(3);

    const far = village();
    addItem(far.player, 'scrollWeaponPlain', 3);
    step(far, [{ type: 'enchant', target: WORN }]);
    expect(far.events).toEqual([{ type: 'enchantDenied', reason: 'far' }]);
  });

  it('ignores things that cannot be tempered', () => {
    const world = forge(3);
    addItem(world.player, 'coal', 2);
    step(world, [
      { type: 'enchant', target: { kind: 'bag', index: 0 } }, // the scroll itself
      { type: 'enchant', target: { kind: 'bag', index: 1 } }, // coal
      { type: 'enchant', target: { kind: 'bag', index: 9 } },
      { type: 'enchant', target: { kind: 'slot', slot: 'helmet' } }, // nothing worn
      { type: 'enchant', target: { kind: 'slot', slot: 'cloak' as never } },
      { type: 'enchant', target: null as never },
    ]);
    expect(world.events).toEqual([]);
    expect(countItem(world.player, 'scrollWeaponPlain')).toBe(3);
  });

  it('keeps the level through taking off, putting on and dropping', () => {
    const world = forge(2);
    step(world, [{ type: 'enchant', target: WORN }]);
    step(world, [{ type: 'enchant', target: WORN }]);
    step(world, [{ type: 'unequip', slot: 'weapon' }]);
    expect(world.player.equipmentEnchant.weapon).toBe(0);
    expect(world.player.inventory).toEqual([{ itemId: 'trainingSword', count: 1, enchant: 2 }]);
    addItem(world.player, 'ironSword', 1);
    step(world, [{ type: 'equip', index: 1 }]); // plain iron sword on
    step(world, [{ type: 'equip', index: 0 }]); // swap back: the tempered sword on, the iron one to the bag
    expect(world.player.equipment.weapon).toBe('trainingSword');
    expect(world.player.equipmentEnchant.weapon).toBe(2);
    expect(world.player.inventory).toEqual([{ itemId: 'ironSword', count: 1 }]);
    step(world, [{ type: 'unequip', slot: 'weapon' }]);
    step(world, [{ type: 'drop', index: 1 }]);
    expect(world.loot[0]).toMatchObject({ itemId: 'trainingSword', enchant: 2 });
    step(world, [{ type: 'pickUp', id: world.loot[0]!.id }]);
    expect(world.player.inventory).toContainEqual({ itemId: 'trainingSword', count: 1, enchant: 2 });
  });

  it('adds to armour defence as well', () => {
    const world = visiting('blacksmith');
    world.player.equipment.armor = 'leatherJerkin';
    addItem(world.player, 'scrollArmorPlain', 2);
    const before = playerDefense(world.player);
    step(world, [{ type: 'enchant', target: { kind: 'slot', slot: 'armor' } }]);
    step(world, [{ type: 'enchant', target: { kind: 'slot', slot: 'armor' } }]);
    expect(playerDefense(world.player)).toBe(before + 2);
  });
});

describe('breaking equipment into crystals', () => {
  it('turns a graded item from the bag into crystals', () => {
    const world = visiting('blacksmith');
    addItem(world.player, 'chainShirt', 1);
    step(world, [{ type: 'crystallize', index: 0 }]);
    expect(world.events).toEqual([{ type: 'crystallized', itemId: 'chainShirt', crystals: crystalsFor('chainShirt') }]);
    expect(world.player.inventory).toEqual([{ itemId: 'crystalD', count: crystalsFor('chainShirt') }]);
    expect(crystalsFor('chainShirt')).toBeGreaterThan(0);
  });

  it('refuses plain items, things that are not equipment and a hero who is elsewhere', () => {
    const world = visiting('blacksmith');
    addItem(world.player, 'ironSword', 1);
    addItem(world.player, 'coal', 3);
    step(world, [{ type: 'crystallize', index: 0 }, { type: 'crystallize', index: 1 }, { type: 'crystallize', index: 5 }]);
    expect(world.events).toEqual([{ type: 'crystallizeDenied', reason: 'noCrystals' }]);
    expect(world.player.inventory).toHaveLength(2);
    const far = village();
    addItem(far.player, 'chainShirt', 1);
    step(far, [{ type: 'crystallize', index: 0 }]);
    expect(far.events).toEqual([{ type: 'crystallizeDenied', reason: 'far' }]);
    expect(far.player.inventory).toEqual([{ itemId: 'chainShirt', count: 1 }]);
  });

  it('is worth less in coins than selling the item, so it is a choice and not a trick', () => {
    for (const def of Object.values(ITEMS)) {
      const crystals = crystalsFor(def.id);
      if (crystals > 0) expect(crystals * Math.floor(buyPrice('crystalD') / 2)).toBeLessThanOrEqual(Math.floor(buyPrice(def.id) / 2));
    }
  });

  it('always has room: one item always becomes one stack', () => {
    const world = visiting('blacksmith');
    while (world.player.inventory.length < INVENTORY_SLOTS) world.player.inventory.push({ itemId: 'chainShirt', count: 1 });
    step(world, [{ type: 'crystallize', index: 3 }]);
    expect(types(world)).toEqual(['crystallized']);
    expect(world.player.inventory).toHaveLength(INVENTORY_SLOTS);
  });
});
