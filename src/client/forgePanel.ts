import type { I18n } from '../i18n';
import {
  type Command, type ItemId, type ItemTarget, type World,
  ENCHANT_MAX, EQUIP_SLOTS, ITEMS, RECIPES, RECIPE_IDS, SHOP_STOCK, buyPrice, countItem, crystalsFor, enchantChance,
  hasIngredients, isNear, knowsRecipe, maxStackOf, scrollFor,
} from '../sim';
import { describeItem, element, itemName, make } from './itemView';

type Tab = 'temper' | 'craft' | 'stock';
const TABS: readonly Tab[] = ['temper', 'craft', 'stock'];

/**
 * The blacksmith's window, in three tabs: temper what the hero wears or
 * carries (and break graded equipment into crystals), craft from recipes,
 * and buy scrolls, crystals and recipes.
 */
export class ForgePanel {
  private world: World | null = null;
  private drawnRevision = -1;
  private tab: Tab = 'temper';

  constructor(
    private readonly i18n: I18n,
    private readonly send: (command: Command) => void,
    private readonly onToggle: (open: boolean) => void,
  ) {
    element('forge-close').addEventListener('click', () => this.toggle(false));
    for (const tab of TABS) {
      element(`forge-tab-${tab}`).addEventListener('click', () => {
        this.tab = tab;
        this.render(true);
      });
    }
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
    for (const tab of TABS) {
      element(`forge-tab-${tab}`).setAttribute('aria-selected', String(tab === this.tab));
      element(tab === 'stock' ? 'forge-stock-tab' : `forge-${tab}`).hidden = tab !== this.tab;
    }
    if (this.tab === 'temper') this.renderTemper(world);
    else if (this.tab === 'craft') this.renderCraft(world);
    else this.renderStock(world);
  }

  private renderTemper(world: World): void {
    const { i18n } = this;
    const { player } = world;
    // Everything that can be tempered: worn items first, then the bag.
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
  }

  private renderCraft(world: World): void {
    const { i18n } = this;
    const { player } = world;
    element('forge-recipes').replaceChildren(
      ...RECIPE_IDS.map((id) => {
        const { output, inputs, chance } = RECIPES[id];
        const row = make('li', 'item-row');
        row.append(describeItem(i18n, output.itemId, output.count));
        const note = make('span', 'forge-note');
        for (const input of inputs) {
          const have = countItem(player, input.itemId);
          const name = itemName(i18n, input.itemId as Exclude<ItemId, 'coins'>);
          note.append(make('span', have >= input.count ? 'item-detail' : 'item-detail warning', i18n.t('craft.ingredient', { item: name, have, need: input.count })));
        }
        const known = knowsRecipe(world, id);
        if (!known) note.append(make('span', 'item-detail warning', i18n.t('craft.unknown')));
        else if (chance < 100) note.append(make('span', 'item-detail warning', i18n.t('craft.risky', { chance })));
        row.append(note);
        row.append(this.button(i18n.t('craft.make'), { type: 'craft', recipe: id }, !known || !hasIngredients(world, id), true));
        return row;
      }),
    );
  }

  private renderStock(world: World): void {
    const { i18n } = this;
    const { player } = world;
    element('forge-stock').replaceChildren(
      ...(SHOP_STOCK.blacksmith ?? []).map((itemId) => {
        const row = make('li', 'item-row');
        const price = buyPrice(itemId);
        row.append(describeItem(i18n, itemId, 1), make('span', 'item-price', i18n.t('shop.price', { price })));
        row.append(this.button(i18n.t('shop.buy'), { type: 'buy', itemId, count: 1 }, player.coins < price, false));
        // Crystals are needed by the dozen.
        if (maxStackOf(itemId) > 99) row.append(this.button(i18n.t('shop.buyMany', { count: 10 }), { type: 'buy', itemId, count: 10 }, player.coins < price * 10, false));
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
