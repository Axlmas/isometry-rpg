import type { I18n } from '../i18n';
import { type Command, type World, SKILLS, SKILL_PRICE, classSkills, isNear, knows } from '../sim';
import { element, make } from './itemView';
import { SKILL_INFO, SKILL_NAME, skillKeyLabel } from './skillText';

/** The trainer's window: every skill, what it does, and whether it can be learned now. */
export class TrainerPanel {
  private world: World | null = null;
  private drawn = '';

  constructor(
    private readonly i18n: I18n,
    private readonly send: (command: Command) => void,
    private readonly onToggle: (open: boolean) => void,
  ) {
    element('trainer-close').addEventListener('click', () => this.toggle(false));
  }

  get isOpen(): boolean {
    return !element('trainer').hidden;
  }

  toggle(open = !this.isOpen): void {
    if (open !== this.isOpen) this.onToggle(open);
    element('trainer').hidden = !open;
    if (open) this.render(true);
  }

  /** Call whenever the world may have changed. Closes the window when the hero walks away. */
  update(world: World): void {
    this.world = world;
    if (this.isOpen && (!isNear(world, 'trainer') || world.player.hp <= 0)) this.toggle(false);
    this.render();
  }

  render(force = false): void {
    const { world, i18n } = this;
    if (!world || !this.isOpen) return;
    const { player } = world;
    const state = `${player.cls}/${player.level}/${player.coins}/${player.skills.join()}`;
    if (!force && state === this.drawn) return;
    this.drawn = state;

    element('trainer-coins').textContent = i18n.t('hud.coins', { count: player.coins });
    element('trainer-list').replaceChildren(
      ...classSkills(player.cls).map((id) => {
        const def = SKILLS[id];
        const row = make('li', 'item-row');
        const info = make('span', 'item-info');
        info.append(
          make('span', 'item-name', i18n.t('trainer.skill', { skill: i18n.t(SKILL_NAME[id]), key: skillKeyLabel(id, player.cls) })),
          make('span', 'item-detail', i18n.t(SKILL_INFO[id])),
          make('span', 'item-detail', i18n.t('trainer.numbers', { cost: def.manaCost, level: def.unlockLevel })),
        );
        row.append(info);
        if (knows(world, id)) {
          row.append(make('span', 'item-better', i18n.t('trainer.learned')));
        } else if (player.level < def.unlockLevel) {
          row.append(make('span', 'item-empty', i18n.t('skills.locked', { level: def.unlockLevel })));
        } else {
          const price = SKILL_PRICE[id];
          row.append(make('span', 'item-price', i18n.t('shop.price', { price })));
          const button = make('button', 'small primary', i18n.t('trainer.learn'));
          button.type = 'button';
          button.disabled = player.coins < price;
          button.addEventListener('click', () => this.send({ type: 'learn', id }));
          row.append(button);
        }
        return row;
      }),
    );
  }
}
