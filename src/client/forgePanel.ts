import type { I18n } from '../i18n';
import {
  type Command, type ItemId, type ItemTarget, type World,
  ENCHANT_MAX, EQUIP_SLOTS, ITEMS, SHOP_STOCK, buyPrice, countItem, crystalsFor, enchantChance, isNear, scrollFor,
} from '../sim';
import { describeItem, element, itemName, make } from './itemView';

/**
 * The blacksmith's window: enchant what the hero wears or carries, break
 * graded equipment into crystals, and buy the scrolls enchanting needs.
 */
export class ForgePanel {
  private world: World | null = null;
  private drawnRevision = -1;

  constructor(
    private readonly i18n: I18n,
    private readonly send: (command: Command) => void,
    private readonly onToggle: (open: boolean) => void,
  ) {
    element('forge-close').addEventListener('click', () => this.toggle(false));
  }

  get isOpen(): boolean {
    return !element('forge').hidden;
  }

  toggle(open = !this.isOpen): void {
    if (open !== this.isOpen) this.onToggle(open);
    element('forge').hidden = !open;
    if (open) this.render(true);
  }

  /** Call whenever the world may have changed. Closes the window when the hero walks away. */
  update(world: World): void {
    const changed = world !== this.world;
    this.world = world;
    if (this.isOpen && (!isNear(world, 'blacksmith') || world.player.hp <= 0)) this.toggle(false);
    this.render(changed);
  }

  render(force = false): void {
    const { world, i18n } = this;
    if (!world || !this.isOpen) return;
    const { player } = world;
    if (!force && player.revision === this.drawnRevision) return;
    this.drawnRevision = player.revision;
    element('forge-coins').textContent = i18n.t('hud.coins', { count: player.coins });

    // Everything that can be enchanted: worn items first, then the bag.
    const targets: Array<{ target: ItemTarget; itemId: ItemId; level: number; bagIndex: number | null }> = [];
    for (const slot of EQUIP_SLOTS) {
      const itemId = player.equipment[slot];
      if (itemId) targets.push({ target: { kind: 'slot', slot }, itemId, level: player.equipmentEnchant[slot], bagIndex: null });
    }
    player.inventory.forEach((stack, index) => {
      if (ITEMS[stack.itemId].kind === 'equipment') {
        targets.push({ target: { kind: 'bag', index }, itemId: stack.itemId, level: stack.enchant ?? 0, bagIndex: index });
      }
    });

    element('forge-empty').hidden = targets.length > 0;
    element('forge-items').replaceChildren(
      ...targets.map(({ target, itemId, level, bagIndex }) => {
        const def = ITEMS[itemId];
        const row = make('li', 'item-row');
        row.append(describeItem(i18n, itemId, 1, level));
        if (def.kind !== 'equipment') return row;
        const scroll = scrollFor(def);
        const have = countItem(player, scroll);
        const chance = enchantChance(level);
        const note = make('span', 'forge-note');
        note.append(
          make('span', have > 0 ? 'item-detail' : 'item-detail warning', i18n.t('forge.scroll', { scroll: itemName(i18n, scroll as Exclude<ItemId, 'coins'>), count: have })),
          make('span', chance < 100 ? 'item-detail warning' : 'item-detail', level >= ENCHANT_MAX ? i18n.t('forge.max') : chance < 100 ? i18n.t('forge.risky', { chance }) : i18n.t('forge.safe')),
        );
        row.append(note);
        row.append(this.button(i18n.t('forge.enchant'), { type: 'enchant', target }, have === 0 || level >= ENCHANT_MAX, true));
        const crystals = crystalsFor(itemId);
        // Only items in the bag can be broken up, so nothing worn is destroyed by a slip of the hand.
        if (crystals > 0 && bagIndex !== null) {
          row.append(this.button(i18n.t('forge.crystallize', { count: crystals }), { type: 'crystallize', index: bagIndex }, false, false));
        }
        return row;
      }),
    );

    element('forge-stock').replaceChildren(
      ...(SHOP_STOCK.blacksmith ?? []).map((itemId) => {
        const row = make('li', 'item-row');
        const price = buyPrice(itemId);
        row.append(describeItem(i18n, itemId, 1), make('span', 'item-price', i18n.t('shop.price', { price })));
        row.append(this.button(i18n.t('shop.buy'), { type: 'buy', itemId, count: 1 }, player.coins < price, false));
        return row;
      }),
    );
  }

  private button(text: string, command: Command, disabled: boolean, primary: boolean): HTMLButtonElement {
    const button = make('button', primary ? 'small primary' : 'small', text);
    button.type = 'button';
    button.disabled = disabled;
    button.addEventListener('click', () => this.send(command));
    return button;
  }
}
