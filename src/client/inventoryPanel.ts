import type { I18n } from '../i18n';
import {
  type Command, type ItemDef, type ItemId, type World,
  EQUIP_SLOTS, INVENTORY_SLOTS, ITEMS, playerDamage, playerDefense,
} from '../sim';
import { GRADE_COLOR, GRADE_NAME, ITEM_NAME, SLOT_NAME } from './itemText';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The bag and worn equipment. Reads the world, changes it only by sending commands. */
export class InventoryPanel {
  private world: World | null = null;
  private drawnRevision = -1;

  constructor(
    private readonly i18n: I18n,
    private readonly send: (command: Command) => void,
  ) {
    element('inventory-open').addEventListener('click', () => this.toggle());
    element('inventory-close').addEventListener('click', () => this.toggle(false));
  }

  get isOpen(): boolean {
    return !element('inventory').hidden;
  }

  toggle(open = !this.isOpen): void {
    element('inventory').hidden = !open;
    element('inventory-open').setAttribute('aria-expanded', String(open));
    if (open) this.render(true);
  }

  /** Call whenever the world may have changed; redraws only when the belongings did. */
  update(world: World): void {
    const changed = world !== this.world;
    this.world = world;
    this.render(changed);
  }

  /** `force` redraws even if nothing changed, for example after a language switch. */
  render(force = false): void {
    const { world, i18n } = this;
    if (!world) return;
    const { player } = world;
    const [min, max] = playerDamage(player);
    element('hero-stats').textContent = i18n.t('inventory.stats', { min, max, defense: playerDefense(player) });
    element('coins').textContent = i18n.t('hud.coins', { count: player.coins });

    if (!this.isOpen || (!force && player.revision === this.drawnRevision)) return;
    this.drawnRevision = player.revision;

    const worn = element('equipment-list');
    worn.replaceChildren(
      ...EQUIP_SLOTS.map((slot) => {
        const row = make('li', 'item-row');
        const itemId = player.equipment[slot];
        row.append(make('span', 'slot-name', i18n.t(SLOT_NAME[slot])));
        if (!itemId) {
          row.append(make('span', 'item-empty', i18n.t('inventory.emptySlot')));
          return row;
        }
        row.append(this.describe(itemId, 1), this.button('inventory.unequip', { type: 'unequip', slot }));
        return row;
      }),
    );

    element('inventory-count').textContent = i18n.t('inventory.bag', { used: player.inventory.length, total: INVENTORY_SLOTS });
    element('inventory-empty').hidden = player.inventory.length > 0;
    element('inventory-list').replaceChildren(
      ...player.inventory.map((stack, index) => {
        const row = make('li', 'item-row');
        row.append(this.describe(stack.itemId, stack.count));
        const def = ITEMS[stack.itemId];
        if (def.kind === 'equipment') {
          if (this.isBetter(def)) row.append(make('span', 'item-better', i18n.t('inventory.better')));
          row.append(this.button('inventory.equip', { type: 'equip', index }));
        }
        row.append(this.button('inventory.drop', { type: 'drop', index }));
        return row;
      }),
    );
  }

  private button(key: 'inventory.equip' | 'inventory.unequip' | 'inventory.drop', command: Command): HTMLButtonElement {
    const text =
      key === 'inventory.equip' ? this.i18n.t('inventory.equip')
      : key === 'inventory.unequip' ? this.i18n.t('inventory.unequip')
      : this.i18n.t('inventory.drop');
    const button = make('button', 'small', text);
    button.type = 'button';
    button.addEventListener('click', () => this.send(command));
    return button;
  }

  /** Name, grade and numbers of an item, as one block. */
  private describe(itemId: ItemId, count: number): HTMLElement {
    const { i18n } = this;
    const def = ITEMS[itemId];
    const block = make('span', 'item-info');
    if (def.kind === 'currency') return block; // Coins are never in the bag.
    const name = i18n.t(ITEM_NAME[itemId as keyof typeof ITEM_NAME]);
    const title = make('span', 'item-name', count > 1 ? i18n.t('inventory.stack', { item: name, count }) : name);
    block.append(title);
    if (def.kind === 'equipment') {
      title.style.color = `#${GRADE_COLOR[def.grade].toString(16).padStart(6, '0')}`;
      const numbers =
        def.slot === 'weapon'
          ? i18n.t('inventory.damage', { min: def.damage[0], max: def.damage[1] })
          : i18n.t('inventory.defense', { value: def.defense });
      block.append(make('span', 'item-detail', `${i18n.t(GRADE_NAME[def.grade])} · ${numbers}`));
    } else {
      block.append(make('span', 'item-detail', i18n.t('inventory.material')));
    }
    return block;
  }

  private isBetter(def: Extract<ItemDef, { kind: 'equipment' }>): boolean {
    const wornId = this.world?.player.equipment[def.slot];
    if (!wornId) return true;
    const worn = ITEMS[wornId];
    if (worn.kind !== 'equipment') return true;
    if (def.slot === 'weapon' && worn.slot === 'weapon') {
      return def.damage[0] + def.damage[1] > worn.damage[0] + worn.damage[1];
    }
    return def.slot !== 'weapon' && worn.slot !== 'weapon' && def.defense > worn.defense;
  }
}
