import type { I18n } from '../i18n';
import { type ItemId, ITEMS, RECIPES, enchantBonus } from '../sim';
import { itemIcon } from './itemIcon';
import { GRADE_COLOR, GRADE_NAME, ITEM_NAME, type RecipeItemId } from './itemText';

export function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

export function make<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The item's name; an enchanted item gets its level after the name, like "Iron Sword +3". */
export function itemName(i18n: I18n, itemId: Exclude<ItemId, 'coins'>, enchant = 0): string {
  const def = ITEMS[itemId];
  // A recipe is named after what it makes: "Recipe: Chain Shirt".
  if (def.kind === 'recipe') {
    const made = RECIPES[def.recipe].output.itemId as Exclude<ItemId, 'coins' | RecipeItemId>;
    return i18n.t('item.recipe', { item: i18n.t(ITEM_NAME[made]) });
  }
  const name = i18n.t(ITEM_NAME[itemId as Exclude<ItemId, 'coins' | RecipeItemId>]);
  return enchant > 0 ? i18n.t('item.enchanted', { item: name, level: enchant }) : name;
}

/** One line saying what an item is for, with its numbers. Enchantment is already counted in. */
export function itemEffect(i18n: I18n, itemId: ItemId, enchant = 0): string {
  const def = ITEMS[itemId];
  switch (def.kind) {
    case 'equipment': {
      const bonus = enchantBonus(def, enchant);
      return def.slot === 'weapon'
        ? i18n.t('inventory.damage', { min: def.damage[0] + bonus, max: def.damage[1] + bonus })
        : i18n.t('inventory.defense', { value: def.defense + bonus });
    }
    case 'material':
      if (itemId === 'crystalD') return i18n.t('inventory.crystal');
      return itemId === 'steelIngot' || itemId === 'tannedLeather' || itemId === 'cord' ? i18n.t('inventory.worked') : i18n.t('inventory.material');
    case 'recipe':
      return i18n.t('inventory.recipe');
    case 'scroll':
      return def.target === 'weapon' ? i18n.t('inventory.scrollWeapon') : i18n.t('inventory.scrollArmor');
    case 'consumable':
      if (def.effect.kind === 'heal') return i18n.t('inventory.heal', { amount: def.effect.amount });
      if (def.effect.kind === 'mana') return i18n.t('inventory.manaRestore', { amount: def.effect.amount });
      return i18n.t('inventory.charge');
    case 'currency':
      return '';
  }
}

/** Icon, name, kind and numbers of an item as one block: a row in the merchant's window. */
export function describeItem(i18n: I18n, itemId: ItemId, count: number, enchant = 0): HTMLElement {
  const def = ITEMS[itemId];
  const block = make('span', 'item-info');
  if (def.kind === 'currency') return block; // Coins are never listed as an item.
  const name = itemName(i18n, itemId as Exclude<ItemId, 'coins'>, enchant);
  const title = make('span', 'item-name', count > 1 ? i18n.t('inventory.stack', { item: name, count }) : name);
  block.append(title);
  const effect = itemEffect(i18n, itemId, enchant);
  if (def.kind === 'equipment' || def.kind === 'scroll') {
    if (def.kind === 'equipment') title.style.color = `#${GRADE_COLOR[def.grade].toString(16).padStart(6, '0')}`;
    block.append(make('span', 'item-detail', `${i18n.t(GRADE_NAME[def.grade])} · ${effect}`));
  } else {
    block.append(make('span', 'item-detail', effect));
  }
  const row = make('span', 'item-with-icon');
  row.append(itemIcon(itemId), block);
  return row;
}
