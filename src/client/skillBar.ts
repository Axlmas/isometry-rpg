import type { I18n } from '../i18n';
import { type SkillId, type World, SKILLS, SKILL_IDS, TICK_MS } from '../sim';
import { SKILL_INFO, SKILL_KEYS, SKILL_NAME } from './skillText';

/** The row of skill buttons: name, key, cost and whether the skill can be used right now. */
export class SkillBar {
  private readonly buttons = new Map<SkillId, { root: HTMLButtonElement; name: HTMLElement; state: HTMLElement }>();
  private world: World | null = null;

  constructor(
    private readonly i18n: I18n,
    onUse: (id: SkillId) => void,
  ) {
    const bar = document.getElementById('skills');
    if (!bar) throw new Error('Missing element #skills');
    for (const id of SKILL_IDS) {
      const root = document.createElement('button');
      root.type = 'button';
      root.className = 'skill';
      const key = document.createElement('kbd');
      key.textContent = SKILL_KEYS[id].label;
      const name = document.createElement('span');
      name.className = 'skill-name';
      const state = document.createElement('span');
      state.className = 'skill-state';
      root.append(key, name, state);
      root.addEventListener('click', () => {
        onUse(id);
        root.blur(); // Otherwise Space would press the button again instead of attacking.
      });
      bar.append(root);
      this.buttons.set(id, { root, name, state });
    }
  }

  /** Cheap enough to call on every tick: the page is only touched when a text changes. */
  update(world: World = this.world as World): void {
    if (!world) return;
    this.world = world;
    const { i18n } = this;
    const { player } = world;
    for (const id of SKILL_IDS) {
      const def = SKILLS[id];
      const button = this.buttons.get(id);
      if (!button) continue;
      const tooLow = player.level < def.unlockLevel;
      // Unusable until the trainer has taught it.
      const locked = tooLow || !player.skills.includes(id);
      const cooling = player.skillCooldowns[id];
      const noMana = player.mp < def.manaCost;
      const state = tooLow
        ? i18n.t('skills.locked', { level: def.unlockLevel })
        : locked
          ? i18n.t('skills.unlearned')
        : cooling > 0
          ? i18n.t('skills.cooldown', { seconds: Math.ceil((cooling * TICK_MS) / 1000) })
          : i18n.t('skills.cost', { cost: def.manaCost });
      const name = i18n.t(SKILL_NAME[id]);
      if (button.name.textContent !== name) {
        button.name.textContent = name;
        button.root.title = i18n.t(SKILL_INFO[id]);
      }
      if (button.state.textContent !== state) button.state.textContent = state;
      button.root.classList.toggle('locked', locked);
      button.root.classList.toggle('unavailable', !locked && (cooling > 0 || noMana));
      button.root.classList.toggle('no-mana', !locked && cooling === 0 && noMana);
    }
  }
}
