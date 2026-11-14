import type { I18n } from '../i18n';
import { type ItemId, ITEMS } from '../sim';
import { itemIcon } from './itemIcon';
import { GRADE_COLOR, GRADE_NAME, ITEM_NAME } from './itemText';

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

export function itemName(i18n: I18n, itemId: Exclude<ItemId, 'coins'>): string {
  return i18n.t(ITEM_NAME[itemId]);
}

/** Icon, name, kind and numbers of an item as one block: a row in the merchant's window. */
export function describeItem(i18n: I18n, itemId: ItemId, count: number): HTMLElement {
  const def = ITEMS[itemId];
  const block = make('span', 'item-info');
  if (def.kind === 'currency') return block; // Coins are never listed as an item.
  const name = itemName(i18n, itemId as Exclude<ItemId, 'coins'>);
  const title = make('span', 'item-name', count > 1 ? i18n.t('inventory.stack', { item: name, count }) : name);
  block.append(title);
  let detail: string;
  if (def.kind === 'equipment') {
    title.style.color = `#${GRADE_COLOR[def.grade].toString(16).padStart(6, '0')}`;
    const numbers =
      def.slot === 'weapon'
        ? i18n.t('inventory.damage', { min: def.damage[0], max: def.damage[1] })
        : i18n.t('inventory.defense', { value: def.defense });
    detail = `${i18n.t(GRADE_NAME[def.grade])} · ${numbers}`;
  } else if (def.kind === 'material') {
    detail = i18n.t('inventory.material');
  } else if (def.effect.kind === 'heal') {
    detail = i18n.t('inventory.heal', { amount: def.effect.amount });
  } else if (def.effect.kind === 'mana') {
    detail = i18n.t('inventory.manaRestore', { amount: def.effect.amount });
  } else {
    detail = i18n.t('inventory.charge');
  }
  block.append(make('span', 'item-detail', detail));
  const row = make('span', 'item-with-icon');
  row.append(itemIcon(itemId), block);
  return row;
}
