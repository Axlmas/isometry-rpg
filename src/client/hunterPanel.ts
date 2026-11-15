import type { I18n } from '../i18n';
import { type ItemId, type MonsterKind, type World, DROP_TABLES, REGIONS, isNear } from '../sim';
import { itemIcon } from './itemIcon';
import { element, itemName, make } from './itemView';
import { MONSTER_NAME } from './npcText';
import { REGION_NAME } from './zoneText';

/** Where each kind of monster lives, in the order the hero meets them. */
const HABITAT: ReadonlyArray<{ kind: MonsterKind; region: keyof typeof REGIONS }> = [
  { kind: 'wolf', region: 'moor' },
  { kind: 'boar', region: 'hollow' },
  { kind: 'grunt', region: 'mines' },
];

/**
 * The hunter's window: for every monster, where it lives, how strong it is
 * and what it leaves behind, with the chance of each thing. Read straight
 * from the drop tables the rules use, so it cannot go out of date.
 */
export class HunterPanel {
  private drawnLocale = '';

  constructor(
    private readonly i18n: I18n,
    private readonly onToggle: (open: boolean) => void,
  ) {
    element('hunter-close').addEventListener('click', () => this.toggle(false));
  }

  get isOpen(): boolean {
    return !element('hunter').hidden;
  }

  toggle(open = !this.isOpen): void {
    if (open !== this.isOpen) this.onToggle(open);
    element('hunter').hidden = !open;
    if (open) this.render();
  }

  /** Closes the window when the hero walks away. */
  update(world: World): void {
    if (this.isOpen && (!isNear(world, 'hunter') || world.player.hp <= 0)) this.toggle(false);
  }

  render(force = false): void {
    const { i18n } = this;
    if (!this.isOpen || (!force && this.drawnLocale === i18n.locale)) return;
    this.drawnLocale = i18n.locale;
    const percent = new Intl.NumberFormat(i18n.locale === 'en-XA' ? 'en' : i18n.locale, { maximumFractionDigits: 1 });

    element('hunter-list').replaceChildren(
      ...HABITAT.map(({ kind, region }) => {
        const table = DROP_TABLES[kind];
        const levels = REGIONS[region].levels;
        const block = make('li', 'bestiary');
        const where = i18n.t(REGION_NAME[region]);
        block.append(
          make('strong', 'item-name', i18n.t(MONSTER_NAME[kind])),
          make('span', 'item-detail', levels ? i18n.t('hunter.where', { zone: where, min: levels[0], max: levels[1] }) : i18n.t('hunter.whereAny', { zone: where })),
          make('span', 'item-price', i18n.t('hunter.coins', { min: table.coins[0], max: table.coins[1] })),
        );
        const drops = make('ul', 'item-list');
        for (const entry of table.drops) {
          // Each item of a line is equally likely, so its own chance is the line's chance shared out.
          const each = entry.chance / entry.items.length;
          const counted = new Map<ItemId, number>();
          for (const itemId of entry.items) counted.set(itemId, (counted.get(itemId) ?? 0) + each);
          for (const [itemId, chance] of counted) {
            const row = make('li', 'drop-row');
            const name = itemName(i18n, itemId as Exclude<ItemId, 'coins'>);
            const amount = entry.count[1] > 1 ? i18n.t('hunter.amount', { item: name, min: entry.count[0], max: entry.count[1] }) : name;
            row.append(itemIcon(itemId), make('span', 'drop-name', amount), make('span', 'drop-chance', i18n.t('hunter.chance', { chance: percent.format(chance) })));
            drops.append(row);
          }
        }
        block.append(drops);
        return block;
      }),
    );
  }
}
