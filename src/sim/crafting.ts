import { addItem, canFit, countItem, removeItem } from './inventory';
import { type ItemId, ITEMS } from './items';
import { isNear } from './npcs';
import { createRng } from './rng';
import type { World } from './world';

/** Recipe IDs are stable: saves refer to them. */
export type RecipeId =
  | 'steelIngot' | 'tannedLeather' | 'cord' | 'chargeD'
  | 'soldierBlade' | 'ironHelm' | 'chainShirt' | 'ironGreaves' | 'longbow' | 'runedStaff';

export interface Recipe {
  id: RecipeId;
  output: { itemId: ItemId; count: number };
  inputs: ReadonlyArray<{ itemId: ItemId; count: number }>;
  /** Chance of success in percent. On failure the ingredients are lost. */
  chance: number;
  /** True when the hero has to learn it from a recipe item first; the rest every blacksmith knows. */
  mustLearn: boolean;
}

const recipe = (id: RecipeId, output: [ItemId, number], chance: number, mustLearn: boolean, ...inputs: Array<[ItemId, number]>): Recipe => ({
  id,
  output: { itemId: output[0], count: output[1] },
  inputs: inputs.map(([itemId, count]) => ({ itemId, count })),
  chance,
  mustLearn,
});

/**
 * The crafting chain: what monsters drop becomes worked materials, and those,
 * together with crystals, become D-grade equipment that no merchant sells.
 */
export const RECIPES: Readonly<Record<RecipeId, Recipe>> = {
  steelIngot: recipe('steelIngot', ['steelIngot', 1], 100, false, ['ironOre', 3], ['coal', 2]),
  tannedLeather: recipe('tannedLeather', ['tannedLeather', 1], 100, false, ['leather', 3], ['bone', 1]),
  cord: recipe('cord', ['cord', 1], 100, false, ['thread', 3]),
  chargeD: recipe('chargeD', ['chargeD', 100], 100, false, ['crystalD', 8], ['coal', 1]),
  soldierBlade: recipe('soldierBlade', ['soldierBlade', 1], 70, true, ['steelIngot', 6], ['tannedLeather', 2], ['cord', 2], ['crystalD', 15]),
  ironHelm: recipe('ironHelm', ['ironHelm', 1], 70, true, ['steelIngot', 4], ['tannedLeather', 2], ['crystalD', 8]),
  chainShirt: recipe('chainShirt', ['chainShirt', 1], 70, true, ['steelIngot', 7], ['cord', 4], ['crystalD', 12]),
  longbow: recipe('longbow', ['longbow', 1], 70, true, ['steelIngot', 2], ['tannedLeather', 2], ['cord', 6], ['crystalD', 18]),
  runedStaff: recipe('runedStaff', ['runedStaff', 1], 70, true, ['steelIngot', 3], ['tannedLeather', 1], ['cord', 3], ['crystalD', 24]),
  ironGreaves: recipe('ironGreaves', ['ironGreaves', 1], 70, true, ['steelIngot', 4], ['tannedLeather', 3], ['crystalD', 8]),
};
export const RECIPE_IDS = Object.keys(RECIPES) as RecipeId[];

export function isRecipeId(value: unknown): value is RecipeId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(RECIPES, value);
}

/** Whether the hero may use a recipe: either everyone knows it or they have learned it. */
export function knowsRecipe(world: World, id: RecipeId): boolean {
  return !RECIPES[id].mustLearn || world.player.recipes.includes(id);
}

/** Whether the bag holds every ingredient. */
export function hasIngredients(world: World, id: RecipeId): boolean {
  return RECIPES[id].inputs.every((input) => countItem(world.player, input.itemId) >= input.count);
}

/** Reads a recipe item from the bag: the hero remembers the recipe for good and the item is used up. */
export function learnRecipe(world: World, itemId: ItemId): void {
  const { player } = world;
  const def = ITEMS[itemId];
  if (def.kind !== 'recipe' || countItem(player, itemId) === 0) return;
  if (player.recipes.includes(def.recipe)) return void world.events.push({ type: 'recipeDenied', recipe: def.recipe });
  removeItem(player, itemId, 1);
  player.recipes.push(def.recipe);
  world.events.push({ type: 'recipeLearned', recipe: def.recipe });
}

/**
 * Crafts at the blacksmith. The ingredients are always spent; whether the
 * item comes out depends on the recipe's chance.
 */
export function craft(world: World, id: RecipeId): void {
  if (!isRecipeId(id)) return;
  const { player } = world;
  const { inputs, output, chance } = RECIPES[id];
  const deny = (reason: 'far' | 'unknown' | 'materials' | 'full') => void world.events.push({ type: 'craftDenied', recipe: id, reason });
  if (!isNear(world, 'blacksmith')) return deny('far');
  if (!knowsRecipe(world, id)) return deny('unknown');
  if (!hasIngredients(world, id)) return deny('materials');
  // Checked before anything is spent. Spending ingredients can only free room, never take it.
  if (!canFit(player, output.itemId, output.count)) return deny('full');

  for (const input of inputs) removeItem(player, input.itemId, input.count);
  const rng = createRng(world.rngState);
  const success = rng.int(1, 100) <= chance;
  world.rngState = rng.state;
  if (!success) return void world.events.push({ type: 'craftFailed', recipe: id });
  addItem(player, output.itemId, output.count);
  world.events.push({ type: 'crafted', recipe: id, itemId: output.itemId, count: output.count });
}
