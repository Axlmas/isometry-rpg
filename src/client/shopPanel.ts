import type { I18n } from '../i18n';
import { type Command, type ItemId, type World, SHOP_STOCK, buyPrice, isNearMerchant, maxStackOf, sellPrice } from '../sim';
import { describeItem, element, make } from './itemView';

/** The merchant's window: what he sells and what he will buy from the bag. */
export class ShopPanel {
  private world: World | null = null;
  private drawnRevision = -1;

  constructor(
    private readonly i18n: I18n,
    private readonly send: (command: Command) => void,
    /** Told whenever the window opens or closes. */
    private readonly onToggle: (open: boolean) => void,
  ) {
    element('shop-close').addEventListener('click', () => this.toggle(false));
  }

  get isOpen(): boolean {
    return !element('shop').hidden;
  }

  toggle(open = !this.isOpen): void {
    if (open !== this.isOpen) this.onToggle(open);
    element('shop').hidden = !open;
    if (open) this.render(true);
  }

  /** Call whenever the world may have changed. Closes the window when the hero walks away. */
  update(world: World): void {
    const changed = world !== this.world;
    this.world = world;
    if (this.isOpen && (!isNearMerchant(world) || world.player.hp <= 0)) this.toggle(false);
    this.render(changed);
  }

  render(force = false): void {
    const { world, i18n } = this;
    if (!world || !this.isOpen) return;
    const { player } = world;
    if (!force && player.revision === this.drawnRevision) return;
    this.drawnRevision = player.revision;

    element('shop-coins').textContent = i18n.t('hud.coins', { count: player.coins });
    element('shop-stock').replaceChildren(
      ...SHOP_STOCK.map((itemId) => {
        const row = make('li', 'item-row');
        const price = buyPrice(itemId);
        row.append(describeItem(i18n, itemId, 1), make('span', 'item-price', i18n.t('shop.price', { price })));
        row.append(this.button(i18n.t('shop.buy'), { type: 'buy', itemId, count: 1 }, player.coins < price));
        // Things that stack are usually wanted in bulk: potions by the ten, charges by the hundred.
        const bulk = maxStackOf(itemId) > 99 ? 100 : maxStackOf(itemId) > 1 ? 10 : 0;
        if (bulk > 0) {
          row.append(this.button(i18n.t('shop.buyMany', { count: bulk }), { type: 'buy', itemId, count: bulk }, player.coins < price * bulk));
        }
        return row;
      }),
    );

    element('shop-empty').hidden = player.inventory.length > 0;
    element('shop-bag').replaceChildren(
      ...player.inventory.map((stack, index) => {
        const row = make('li', 'item-row');
        row.append(describeItem(i18n, stack.itemId as ItemId, stack.count));
        const price = sellPrice(stack.itemId);
        if (price <= 0) {
          row.append(make('span', 'item-empty', i18n.t('shop.noValue')));
          return row;
        }
        row.append(make('span', 'item-price', i18n.t('shop.price', { price })));
        row.append(this.button(i18n.t('shop.sell'), { type: 'sell', index, count: 1 }, false));
        if (stack.count > 1) row.append(this.button(i18n.t('shop.sellAll'), { type: 'sell', index, count: stack.count }, false));
        return row;
      }),
    );
  }

  private button(text: string, command: Command, disabled: boolean): HTMLButtonElement {
    const button = make('button', 'small', text);
    button.type = 'button';
    button.disabled = disabled;
    button.addEventListener('click', () => this.send(command));
    return button;
  }
}
