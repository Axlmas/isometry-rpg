import { describe, expect, it } from 'vitest';
import {
  type NpcKind, type RecipeId, type World, INVENTORY_SLOTS, ITEMS, MATERIAL_IDS, RECIPES, RECIPE_IDS, RECIPE_ITEMS, SHOP_STOCK,
  QUALITIES, QUALITY, addItem, buyPrice, characterOf, countItem, createWorld, hasIngredients, knowsRecipe, newCharacter, sellPrice, step,
} from '../src/sim';

function at(kind: NpcKind | null, seed = 5): World {
  const world = createWorld(seed, newCharacter('trainingSword'), undefined, 'overworld');
  const npc = world.npcs.find((n) => n.kind === kind);
  if (npc) world.player.pos = { x: npc.pos.x, y: npc.pos.y + 1 };
  return world;
}
const give = (world: World, id: RecipeId, times = 1) => {
  for (const input of RECIPES[id].inputs) addItem(world.player, input.itemId, input.count * times);
};
const types = (world: World) => world.events.map((e) => e.type);

describe('recipes', () => {
  it('only ask for things that exist and can be obtained, and make things that exist', () => {
    const craftable = new Set(RECIPE_IDS.map((id) => RECIPES[id].output.itemId));
    const sold = new Set(Object.values(SHOP_STOCK).flat());
    for (const id of RECIPE_IDS) {
      const recipe = RECIPES[id];
      expect(recipe.id).toBe(id);
      expect(ITEMS[recipe.output.itemId]).toBeDefined();
      expect(recipe.output.count).toBeGreaterThan(0);
      expect(recipe.chance).toBeGreaterThan(0);
      expect(recipe.chance).toBeLessThanOrEqual(100);
      expect(recipe.inputs.length).toBeGreaterThan(0);
      for (const input of recipe.inputs) {
        expect(input.count).toBeGreaterThan(0);
        // Dropped by monsters, made by another recipe, or sold: never out of reach.
        const obtainable = MATERIAL_IDS.includes(input.itemId) || craftable.has(input.itemId) || sold.has(input.itemId);
        expect(obtainable, `${id} needs ${input.itemId}`).toBe(true);
        expect(input.itemId).not.toBe(recipe.output.itemId);
      }
    }
  });

  it('form a chain: raw materials, worked materials, graded equipment', () => {
    for (const id of ['steelIngot', 'tannedLeather', 'cord'] as const) {
      expect(RECIPES[id].mustLearn).toBe(false);
      expect(RECIPES[id].chance).toBe(100);
      for (const input of RECIPES[id].inputs) expect(MATERIAL_IDS).toContain(input.itemId);
    }
    for (const id of ['soldierBlade', 'ironHelm', 'chainShirt', 'ironGreaves'] as const) {
      const recipe = RECIPES[id];
      expect(recipe.mustLearn).toBe(true);
      expect(recipe.chance).toBeLessThan(100);
      const made = ITEMS[recipe.output.itemId];
      expect(made.kind === 'equipment' && made.grade).toBe('d');
      expect(recipe.inputs.some((input) => input.itemId === 'crystalD')).toBe(true);
      expect(recipe.inputs.some((input) => ['steelIngot', 'tannedLeather', 'cord'].includes(input.itemId))).toBe(true);
    }
  });

  it('each learnable recipe has exactly one recipe item, and the blacksmith sells it', () => {
    const learnable = RECIPE_IDS.filter((id) => RECIPES[id].mustLearn).sort();
    const taught = RECIPE_ITEMS.map((itemId) => {
      const def = ITEMS[itemId];
      return def.kind === 'recipe' ? def.recipe : null;
    }).sort();
    expect(taught).toEqual(learnable);
    for (const itemId of RECIPE_ITEMS) expect(SHOP_STOCK.blacksmith).toContain(itemId);
  });

  it('cannot be turned into a money machine', () => {
    // Buying every ingredient and selling the result does not pay. Plain goods never do, even when the
    // work always succeeds; equipment comes out in random quality, so there it is the average that counts.
    const cost = (itemId: keyof typeof ITEMS): number => buyPrice(itemId);
    const averageWorth = QUALITIES.reduce((sum, quality) => sum + (QUALITY[quality].weight / 100) * QUALITY[quality].worth, 0);
    for (const id of RECIPE_IDS) {
      const { inputs, output, chance } = RECIPES[id];
      const spent = inputs.reduce((sum, input) => sum + cost(input.itemId) * input.count, 0);
      expect(sellPrice(output.itemId) * output.count, id).toBeLessThanOrEqual(spent);
      if (ITEMS[output.itemId].kind === 'equipment') {
        expect(sellPrice(output.itemId) * averageWorth * (chance / 100), id).toBeLessThanOrEqual(spent);
      }
    }
  });
});

describe('crafting at the blacksmith', () => {
  it('turns the ingredients into the product', () => {
    const world = at('blacksmith');
    give(world, 'steelIngot', 2);
    expect(hasIngredients(world, 'steelIngot')).toBe(true);
    step(world, [{ type: 'craft', recipe: 'steelIngot' }]);
    expect(world.events).toEqual([{ type: 'crafted', recipe: 'steelIngot', itemId: 'steelIngot', count: 1 }]);
    expect(countItem(world.player, 'steelIngot')).toBe(1);
    expect(countItem(world.player, 'ironOre')).toBe(3);
    expect(countItem(world.player, 'coal')).toBe(2);
  });

  it('makes charges by the hundred from crystals', () => {
    const world = at('blacksmith');
    give(world, 'chargeD');
    step(world, [{ type: 'craft', recipe: 'chargeD' }]);
    expect(world.player.inventory).toEqual([{ itemId: 'chargeD', count: 100 }]);
  });

  it('refuses, spending nothing, without the materials, the recipe, the room or the blacksmith', () => {
    const short = at('blacksmith');
    addItem(short.player, 'ironOre', 3);
    addItem(short.player, 'coal', 1);
    step(short, [{ type: 'craft', recipe: 'steelIngot' }]);
    expect(short.events).toEqual([{ type: 'craftDenied', recipe: 'steelIngot', reason: 'materials' }]);
    expect(countItem(short.player, 'ironOre')).toBe(3);

    const untaught = at('blacksmith');
    give(untaught, 'ironHelm');
    step(untaught, [{ type: 'craft', recipe: 'ironHelm' }]);
    expect(untaught.events).toEqual([{ type: 'craftDenied', recipe: 'ironHelm', reason: 'unknown' }]);
    expect(hasIngredients(untaught, 'ironHelm')).toBe(true);

    const far = at(null);
    give(far, 'cord');
    step(far, [{ type: 'craft', recipe: 'cord' }, { type: 'craft', recipe: 'everything' as never }]);
    expect(far.events).toEqual([{ type: 'craftDenied', recipe: 'cord', reason: 'far' }]);
    expect(countItem(far.player, 'thread')).toBe(3);

    const full = at('blacksmith');
    while (full.player.inventory.length < INVENTORY_SLOTS - 1) full.player.inventory.push({ itemId: 'ironSword', count: 1 });
    addItem(full.player, 'thread', 99); // more thread than one cord uses: the slot stays taken
    step(full, [{ type: 'craft', recipe: 'cord' }]);
    expect(full.events).toEqual([{ type: 'craftDenied', recipe: 'cord', reason: 'full' }]);
    expect(countItem(full.player, 'thread')).toBe(99);
  });

  it('sometimes ruins graded work, about three times in ten, and the materials are gone either way', () => {
    let failures = 0;
    const attempts = 300;
    for (let seed = 0; seed < attempts; seed++) {
      const world = at('blacksmith', seed);
      world.player.recipes.push('ironHelm');
      give(world, 'ironHelm');
      step(world, [{ type: 'craft', recipe: 'ironHelm' }]);
      const failed = types(world).includes('craftFailed');
      if (failed) failures += 1;
      expect(world.player.inventory.map((stack) => stack.itemId)).toEqual(failed ? [] : ['ironHelm']);
    }
    expect(failures / attempts).toBeGreaterThan(0.2);
    expect(failures / attempts).toBeLessThan(0.4);
  });

  it('never ruins plain work', () => {
    for (let seed = 0; seed < 60; seed++) {
      const world = at('blacksmith', seed);
      give(world, 'tannedLeather');
      step(world, [{ type: 'craft', recipe: 'tannedLeather' }]);
      expect(types(world)).toEqual(['crafted']);
    }
  });

  it('gives the same result for the same seed', () => {
    const run = () => {
      const world = at('blacksmith', 77);
      world.player.recipes.push('chainShirt');
      give(world, 'chainShirt', 5);
      for (let i = 0; i < 5; i++) step(world, [{ type: 'craft', recipe: 'chainShirt' }]);
      return world.player.inventory;
    };
    expect(run()).toEqual(run());
  });
});

describe('recipe items', () => {
  it('teach the recipe for good and are used up', () => {
    const world = at(null);
    addItem(world.player, 'recipeIronHelm', 2);
    expect(knowsRecipe(world, 'ironHelm')).toBe(false);
    step(world, [{ type: 'use', itemId: 'recipeIronHelm' }]);
    expect(world.events).toEqual([{ type: 'recipeLearned', recipe: 'ironHelm' }]);
    expect(knowsRecipe(world, 'ironHelm')).toBe(true);
    expect(countItem(world.player, 'recipeIronHelm')).toBe(1);
    // A second copy is not wasted on a recipe already known.
    step(world, [{ type: 'use', itemId: 'recipeIronHelm' }]);
    expect(world.events).toEqual([{ type: 'recipeDenied', recipe: 'ironHelm' }]);
    expect(countItem(world.player, 'recipeIronHelm')).toBe(1);
    expect(createWorld(9, characterOf(world)).player.recipes).toEqual(['ironHelm']);
  });

  it('do nothing when the hero has none', () => {
    const world = at(null);
    step(world, [{ type: 'use', itemId: 'recipeChainShirt' }]);
    expect(world.events).toEqual([]);
    expect(world.player.recipes).toEqual([]);
  });

  it('let the whole chain be walked: buy the recipe, work the materials, make the item', () => {
    const world = at('blacksmith', 3);
    world.player.coins = 1000;
    step(world, [{ type: 'buy', itemId: 'recipeIronGreaves', count: 1 }]);
    step(world, [{ type: 'use', itemId: 'recipeIronGreaves' }]);
    addItem(world.player, 'ironOre', 12);
    addItem(world.player, 'coal', 8);
    addItem(world.player, 'leather', 9);
    addItem(world.player, 'bone', 3);
    step(world, [{ type: 'buy', itemId: 'crystalD', count: 8 }]);
    for (let i = 0; i < 4; i++) step(world, [{ type: 'craft', recipe: 'steelIngot' }]);
    for (let i = 0; i < 3; i++) step(world, [{ type: 'craft', recipe: 'tannedLeather' }]);
    expect(hasIngredients(world, 'ironGreaves')).toBe(true);
    step(world, [{ type: 'craft', recipe: 'ironGreaves' }]);
    expect(['crafted', 'craftFailed']).toContain(types(world)[0]);
    expect(countItem(world.player, 'steelIngot')).toBe(0);
  });
});
