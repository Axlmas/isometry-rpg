import type { I18n } from '../i18n';
import {
  type Command, type EquipSlot, type ItemDef, type ItemId, type ItemMods, type World,
  CLASSES, EQUIP_SLOTS, INVENTORY_SLOTS, ITEMS, attackCooldown, critChance, gearStats, playerDamage, playerDefense, sellPrice, worthOf,
  PLAYER_ATTACK_COOLDOWN,
} from '../sim';
import { itemIcon } from './itemIcon';
import { GRADE_NAME, SLOT_NAME, WEAPON_NAME } from './itemText';
import { affixText, element, gearColor, gearKind, gearScore, itemEffect, itemName, make, uniqueAffixes } from './itemView';

/** An item as the panel shows it: what it is, how many, and what makes this copy special. */
interface Shown {
  itemId: ItemId;
  count: number;
  enchant: number;
  mods: ItemMods | null;
}

/** Which cell the player has picked: a worn slot or a place in the bag. */
type Selection = { kind: 'slot'; slot: EquipSlot } | { kind: 'bag'; index: number } | null;

interface Cell {
  root: HTMLButtonElement;
  /** What the cell showed last time, so it is only redrawn when that changes. */
  shown: string;
}

/**
 * The bag as a grid of icons, with the worn equipment above it. Hovering a
 * cell shows what the item is; clicking picks it and offers actions below
 * the grid; double-clicking does the obvious thing (wear, take off, drink).
 * Reads the world, changes it only by sending commands.
 */
export class InventoryPanel {
  private world: World | null = null;
  private drawnRevision = -1;
  private selection: Selection = null;
  /** The item that was in the picked cell, to notice when an action puts something else there. */
  private selectedItem: string | null = null;
  private readonly slotCells = new Map<EquipSlot, Cell>();
  private readonly bagCells: Cell[] = [];

  constructor(
    private readonly i18n: I18n,
    private readonly send: (command: Command) => void,
  ) {
    element('inventory-open').addEventListener('click', () => this.toggle());
    element('inventory-close').addEventListener('click', () => this.toggle(false));

    // The cells are created once and only their contents change afterwards.
    // Replacing a button between a mouse press and its release would lose the click.
    const worn = element('equipment-grid');
    for (const slot of EQUIP_SLOTS) {
      const cell = this.createCell({ kind: 'slot', slot });
      this.slotCells.set(slot, cell);
      worn.append(cell.root);
    }
    const bag = element('bag-grid');
    for (let index = 0; index < INVENTORY_SLOTS; index++) {
      const cell = this.createCell({ kind: 'bag', index });
      this.bagCells.push(cell);
      bag.append(cell.root);
    }
  }

  get isOpen(): boolean {
    return !element('inventory').hidden;
  }

  toggle(open = !this.isOpen): void {
    element('inventory').hidden = !open;
    element('inventory-open').setAttribute('aria-expanded', String(open));
    if (!open) this.hideTooltip();
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
    element('hero-stats').textContent = i18n.t('inventory.stats', { min, max, defense: playerDefense(player), crit: critChance(player) });
    const gear = gearStats(player);
    const haste = Math.round((PLAYER_ATTACK_COOLDOWN / attackCooldown(player) - 1) * 100);
    element('hero-bonus').textContent = i18n.t('inventory.bonus', { power: gear.power, haste, speed: gear.speed });
    element('coins').textContent = i18n.t('hud.coins', { count: player.coins });

    if (!this.isOpen || (!force && player.revision === this.drawnRevision)) return;
    this.drawnRevision = player.revision;

    for (const slot of EQUIP_SLOTS) {
      const label = i18n.t(SLOT_NAME[slot]);
      const item = this.itemAt({ kind: 'slot', slot });
      this.fillCell(this.slotCells.get(slot) as Cell, item, item ? `${label}: ${this.spoken(item)}` : `${label}: ${i18n.t('inventory.emptySlot')}`, force, label);
    }
    this.bagCells.forEach((cell, index) => {
      const item = this.itemAt({ kind: 'bag', index });
      this.fillCell(cell, item, item ? this.spoken(item) : i18n.t('inventory.emptyCell'), force);
    });
    element('inventory-count').textContent = i18n.t('inventory.bag', { used: player.inventory.length, total: INVENTORY_SLOTS });

    // An action may have moved or removed the picked item; do not leave the selection on something else.
    if (this.selection && this.identity(this.itemAt(this.selection)) !== this.selectedItem) this.selection = null;
    this.showSelection();
  }

  // ------------------------------------------------------------------ cells

  private createCell(where: NonNullable<Selection>): Cell {
    const root = make('button', 'cell');
    root.type = 'button';
    root.addEventListener('click', () => {
      const item = this.itemAt(where);
      this.selection = item ? where : null;
      this.selectedItem = this.identity(item);
      this.showSelection();
    });
    root.addEventListener('dblclick', () => this.act(where));
    for (const type of ['mouseenter', 'focus'] as const) root.addEventListener(type, () => this.showTooltip(where, root));
    for (const type of ['mouseleave', 'blur'] as const) root.addEventListener(type, () => this.hideTooltip());
    return { root, shown: '' };
  }

  private fillCell(cell: Cell, item: Shown | null, spoken: string, force: boolean, emptyLabel = ''): void {
    const itemId = item?.itemId ?? null;
    const count = item?.count ?? 0;
    const enchant = item?.enchant ?? 0;
    const shown = `${this.identity(item) ?? ''}/${count}/${emptyLabel}`;
    if (!force && shown === cell.shown) return;
    cell.shown = shown;
    cell.root.setAttribute('aria-label', spoken);
    cell.root.classList.toggle('empty', itemId === null);
    if (itemId === null) {
      // An empty worn slot says what belongs there; an empty bag cell is just empty.
      cell.root.replaceChildren(...(emptyLabel ? [make('span', 'cell-label', emptyLabel)] : []));
      delete cell.root.dataset.quality;
      return;
    }
    const def = ITEMS[itemId];
    if (def.kind === 'equipment') cell.root.dataset.quality = uniqueAffixes(def).length > 0 ? 'trophy' : (item?.mods?.quality ?? 'common');
    else delete cell.root.dataset.quality;
    const parts: HTMLElement[] = [itemIcon(itemId)];
    if (def.kind === 'equipment' && def.grade === 'd') parts.push(make('span', 'cell-grade', this.i18n.t('grade.dShort')));
    if (count > 1) parts.push(make('span', 'cell-count', String(count)));
    if (enchant > 0) parts.push(make('span', 'cell-enchant', `+${enchant}`));
    cell.root.replaceChildren(...parts);
  }

  private itemAt(where: NonNullable<Selection>): Shown | null {
    const player = this.world?.player;
    if (!player) return null;
    if (where.kind === 'slot') {
      const itemId = player.equipment[where.slot];
      return itemId ? { itemId, count: 1, enchant: player.equipmentEnchant[where.slot], mods: player.equipmentMods[where.slot] } : null;
    }
    const stack = player.inventory[where.index];
    return stack ? { itemId: stack.itemId, count: stack.count, enchant: stack.enchant ?? 0, mods: stack.mods ?? null } : null;
  }

  /** Tells one item from another, so the selection is dropped when a different item lands in the picked cell. */
  private identity(item: Shown | null): string | null {
    if (!item) return null;
    const mods = item.mods ? `${item.mods.quality}:${item.mods.affixes.map((affix) => `${affix.stat}${affix.value}`).join(',')}` : '';
    return `${item.itemId}+${item.enchant}/${mods}`;
  }

  /** The obvious thing to do with an item, and its name as a translation key; null when there is none. */
  private primary(where: NonNullable<Selection>): { command: Command; label: string; hint: string } | null {
    const item = this.itemAt(where);
    if (!item) return null;
    const { i18n } = this;
    if (where.kind === 'slot') {
      return { command: { type: 'unequip', slot: where.slot }, label: i18n.t('inventory.unequip'), hint: i18n.t('tooltip.unequip') };
    }
    const def = ITEMS[item.itemId];
    if (def.kind === 'equipment') {
      return { command: { type: 'equip', index: where.index }, label: i18n.t('inventory.equip'), hint: i18n.t('tooltip.equip') };
    }
    if (def.kind === 'consumable' && def.effect.kind !== 'charge') {
      return { command: { type: 'use', itemId: item.itemId }, label: i18n.t('inventory.use'), hint: i18n.t('tooltip.use') };
    }
    if (def.kind === 'recipe') {
      return { command: { type: 'use', itemId: item.itemId }, label: i18n.t('inventory.learn'), hint: i18n.t('tooltip.learn') };
    }
    return null;
  }

  private act(where: NonNullable<Selection>): void {
    const action = this.primary(where);
    if (action) this.send(action.command);
  }

  // ------------------------------------------------------- item description

  /** Everything there is to say about an item, line by line. Used by the tooltip and the panel under the grid. */
  private lines({ itemId, count, enchant, mods }: Shown): { name: string; color: string | null; lines: string[]; affixes: string[]; better: boolean } {
    const { i18n } = this;
    const own = ITEMS[itemId];
    const affixes = [...(own.kind === 'equipment' ? uniqueAffixes(own) : []), ...(mods?.affixes ?? [])].map((affix) => affixText(i18n, affix));
    const def = ITEMS[itemId];
    const base = itemId === 'coins' ? '' : itemName(i18n, itemId, enchant);
    const name = count > 1 ? i18n.t('inventory.stack', { item: base, count }) : base;
    const lines: string[] = [];
    let color: string | null = null;
    let better = false;
    if (def.kind === 'equipment') {
      color = gearColor(def, mods);
      // A weapon says what kind it is, because only one class can use it.
      const kind = def.slot === 'weapon' ? i18n.t(WEAPON_NAME[def.weaponType]) : i18n.t(SLOT_NAME[def.slot]);
      lines.push(uniqueAffixes(def).length > 0 ? `${gearKind(i18n, kind, def, mods)} · ${i18n.t('quality.trophy')}` : gearKind(i18n, kind, def, mods));
      better = this.isBetter(def, enchant, mods);
    } else if (def.kind === 'scroll' || (def.kind === 'consumable' && def.effect.kind === 'charge')) {
      lines.push(i18n.t(GRADE_NAME[def.kind === 'scroll' ? def.grade : (def.effect as { grade: 'none' | 'd' }).grade]));
    }
    lines.push(itemEffect(i18n, itemId, enchant, mods));
    const price = sellPrice(itemId, worthOf(mods));
    const value = price > 0 ? i18n.t('tooltip.sells', { price }) : i18n.t('tooltip.noValue');
    return { name, color, lines: [...lines, ...affixes, value], affixes, better };
  }

  /** The description as one sentence, for screen readers. */
  private spoken(item: Shown): string {
    const { name, lines } = this.lines(item);
    return [name, ...lines].join('. ');
  }

  private describe(item: Shown, worn: boolean): HTMLElement[] {
    const { name, color, lines, affixes, better } = this.lines(item);
    const title = make('strong', 'item-name', name);
    if (color) title.style.color = color;
    const nodes: HTMLElement[] = [title, ...lines.map((line) => make('span', affixes.includes(line) ? 'item-affix' : 'item-detail', line))];
    if (better && !worn) nodes.push(make('span', 'item-better', this.i18n.t('inventory.better')));
    return nodes;
  }

  /** Compares an item, with its enchantment and properties, with what is worn in its slot. */
  private isBetter(def: Extract<ItemDef, { kind: 'equipment' }>, enchant: number, mods: ItemMods | null): boolean {
    const player = this.world?.player;
    if (!player) return false;
    // A weapon the hero's class cannot use is never an improvement.
    if (def.slot === 'weapon' && def.weaponType !== CLASSES[player.cls].weapon) return false;
    const wornId = player.equipment[def.slot];
    if (!wornId) return true;
    const worn = ITEMS[wornId];
    if (worn.kind !== 'equipment') return true;
    return gearScore(def, enchant, mods) > gearScore(worn, player.equipmentEnchant[def.slot], player.equipmentMods[def.slot]);
  }

  // ------------------------------------------------- selection and tooltip

  private showSelection(): void {
    const { selection, i18n } = this;
    for (const [slot, cell] of this.slotCells) cell.root.classList.toggle('selected', selection?.kind === 'slot' && selection.slot === slot);
    this.bagCells.forEach((cell, index) => cell.root.classList.toggle('selected', selection?.kind === 'bag' && selection.index === index));

    const detail = element('item-detail');
    const item = selection ? this.itemAt(selection) : null;
    if (!selection || !item) {
      const empty = (this.world?.player.inventory.length ?? 0) === 0;
      detail.replaceChildren(make('span', 'item-empty', empty ? i18n.t('inventory.empty') : i18n.t('inventory.pick')));
      return;
    }
    const text = make('div', 'detail-text');
    text.append(...this.describe(item, selection.kind === 'slot'));
    const actions = make('div', 'detail-actions');
    const action = this.primary(selection);
    if (action) actions.append(this.button(action.label, action.command, true));
    if (selection.kind === 'bag') actions.append(this.button(i18n.t('inventory.drop'), { type: 'drop', index: selection.index }, false));
    detail.replaceChildren(text, actions);
  }

  private button(text: string, command: Command, primary: boolean): HTMLButtonElement {
    const button = make('button', primary ? 'small primary' : 'small', text);
    button.type = 'button';
    button.addEventListener('click', () => this.send(command));
    return button;
  }

  private showTooltip(where: NonNullable<Selection>, anchor: HTMLElement): void {
    const item = this.itemAt(where);
    const tooltip = element('tooltip');
    if (!item) {
      tooltip.hidden = true;
      return;
    }
    const nodes = this.describe(item, where.kind === 'slot');
    const action = this.primary(where);
    if (action) nodes.push(make('span', 'tooltip-hint', action.hint));
    tooltip.replaceChildren(...nodes);
    tooltip.hidden = false;
    // Beside the cell, on the side away from the screen edge, and never off the screen.
    const cell = anchor.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    const left = cell.left - box.width - 8 >= 8 ? cell.left - box.width - 8 : cell.right + 8;
    const top = Math.max(8, Math.min(window.innerHeight - box.height - 8, cell.top));
    tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - box.width - 8, left))}px`;
    tooltip.style.top = `${top}px`;
  }

  private hideTooltip(): void {
    element('tooltip').hidden = true;
  }
}
