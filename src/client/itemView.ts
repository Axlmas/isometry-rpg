import type { I18n } from '../i18n';
import { type Affix, type ItemDef, type ItemId, type ItemMods, ITEMS, JEWELLERY_SLOTS, RECIPES, armorDefense, weaponDamage } from '../sim';
import { itemIcon } from './itemIcon';
import { GRADE_NAME, ITEM_NAME, QUALITY_NAME, type RecipeItemId, UNIQUE_CSS, qualityCss } from './itemText';

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
export function itemEffect(i18n: I18n, itemId: ItemId, enchant = 0, mods?: ItemMods | null): string {
  const def = ITEMS[itemId];
  switch (def.kind) {
    case 'equipment': {
      if (def.slot === 'weapon') {
        const [min, max] = weaponDamage(def, enchant, mods);
        return i18n.t('inventory.damage', { min, max });
      }
      const defense = armorDefense(def, enchant, mods);
      // Jewellery protects nothing until it is tempered; its worth is in its properties.
      return JEWELLERY_SLOTS.includes(def.slot) && defense === 0 ? i18n.t('inventory.jewellery') : i18n.t('inventory.defense', { value: defense });
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

/** One random property as a line of text, like "+12 to health". */
export function affixText(i18n: I18n, { stat, value }: Affix): string {
  switch (stat) {
    case 'hp': return i18n.t('stat.hp', { value });
    case 'mp': return i18n.t('stat.mp', { value });
    case 'power': return i18n.t('stat.power', { value });
    case 'defense': return i18n.t('stat.defense', { value });
    case 'crit': return i18n.t('stat.crit', { value });
    case 'haste': return i18n.t('stat.haste', { value });
    case 'speed': return i18n.t('stat.speed', { value });
  }
}

/** The properties a trophy always has; empty for ordinary equipment. */
export function uniqueAffixes(def: Extract<ItemDef, { kind: 'equipment' }>): readonly Affix[] {
  return def.slot !== 'weapon' && def.unique ? def.unique : [];
}

/** The colour of a piece of equipment's name: by quality, or the trophy colour. */
export function gearColor(def: Extract<ItemDef, { kind: 'equipment' }>, mods?: ItemMods | null): string {
  return uniqueAffixes(def).length > 0 ? UNIQUE_CSS : qualityCss(mods?.quality ?? 'common');
}

/** "Helmet · D · Rare": what kind of thing a piece of equipment is. */
export function gearKind(i18n: I18n, kind: string, def: Extract<ItemDef, { kind: 'equipment' }>, mods?: ItemMods | null): string {
  return `${kind} · ${i18n.t(GRADE_NAME[def.grade])} · ${i18n.t(QUALITY_NAME[mods?.quality ?? 'common'])}`;
}

/**
 * A rough single number for how good a piece of equipment is, used only to
 * hint "better than what you wear". The player decides; this just points.
 */
export function gearScore(def: Extract<ItemDef, { kind: 'equipment' }>, enchant: number, mods?: ItemMods | null): number {
  const WEIGHT = { hp: 0.15, mp: 0.08, power: 0.5, defense: 3, crit: 0.6, haste: 0.5, speed: 0.3 } as const;
  let score = 0;
  if (def.slot === 'weapon') {
    const [min, max] = weaponDamage(def, enchant, mods);
    score = (min + max) / 2;
  } else {
    score = armorDefense(def, enchant, mods) * 3;
  }
  for (const affix of [...uniqueAffixes(def), ...(mods?.affixes ?? [])]) score += affix.value * WEIGHT[affix.stat];
  return score;
}

/** Icon, name, kind and numbers of an item as one block: a row in the merchant's window. */
export function describeItem(i18n: I18n, itemId: ItemId, count: number, enchant = 0, mods?: ItemMods | null): HTMLElement {
  const def = ITEMS[itemId];
  const block = make('span', 'item-info');
  if (def.kind === 'currency') return block; // Coins are never listed as an item.
  const name = itemName(i18n, itemId as Exclude<ItemId, 'coins'>, enchant);
  const title = make('span', 'item-name', count > 1 ? i18n.t('inventory.stack', { item: name, count }) : name);
  block.append(title);
  const effect = itemEffect(i18n, itemId, enchant, mods);
  if (def.kind === 'equipment') {
    title.style.color = gearColor(def, mods);
    block.append(make('span', 'item-detail', `${i18n.t(GRADE_NAME[def.grade])} · ${i18n.t(QUALITY_NAME[mods?.quality ?? 'common'])} · ${effect}`));
    const affixes = [...uniqueAffixes(def), ...(mods?.affixes ?? [])];
    if (affixes.length > 0) block.append(make('span', 'item-affix', affixes.map((affix) => affixText(i18n, affix)).join(' · ')));
  } else if (def.kind === 'scroll') {
    block.append(make('span', 'item-detail', `${i18n.t(GRADE_NAME[def.grade])} · ${effect}`));
  } else {
    block.append(make('span', 'item-detail', effect));
  }
  const row = make('span', 'item-with-icon');
  row.append(itemIcon(itemId, mods?.quality), block);
  return row;
}
