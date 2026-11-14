import type { I18n } from '../i18n';
import { type Command, type ItemId, type World, TICK_MS, chargeForWeapon, countItem } from '../sim';
import { itemName } from './itemView';

/** Physical keys (KeyboardEvent.code) of the quick slots. */
export const QUICK_KEYS = { healthPotion: 'Digit1', manaPotion: 'Digit2', charges: 'KeyF' } as const;

interface Slot {
  root: HTMLButtonElement;
  name: HTMLElement;
  state: HTMLElement;
}

/** Potions and weapon charges next to the skills: how many are left and one key to use them. */
export class QuickBar {
  private readonly slots: Record<'healthPotion' | 'manaPotion' | 'charges', Slot>;
  private world: World | null = null;

  constructor(
    private readonly i18n: I18n,
    send: (command: Command) => void,
  ) {
    const bar = document.getElementById('skills');
    if (!bar) throw new Error('Missing element #skills');
    bar.append(Object.assign(document.createElement('span'), { className: 'bar-gap' }));
    const slot = (label: string, command: Command): Slot => {
      const root = document.createElement('button');
      root.type = 'button';
      root.className = 'skill quick';
      const key = document.createElement('kbd');
      key.textContent = label;
      const name = document.createElement('span');
      name.className = 'skill-name';
      const state = document.createElement('span');
      state.className = 'skill-state';
      root.append(key, name, state);
      root.addEventListener('click', () => {
        send(command);
        root.blur(); // Otherwise Space would press the button again instead of attacking.
      });
      bar.append(root);
      return { root, name, state };
    };
    this.slots = {
      healthPotion: slot('1', { type: 'use', itemId: 'healthPotion' }),
      manaPotion: slot('2', { type: 'use', itemId: 'manaPotion' }),
      charges: slot('F', { type: 'toggleCharges' }),
    };
  }

  /** Cheap enough to call on every tick: the page is only touched when a text changes. */
  update(world: World = this.world as World): void {
    if (!world) return;
    this.world = world;
    const { i18n } = this;
    const { player } = world;
    const set = (slot: Slot, name: string, state: string, dim: boolean, active = false) => {
      if (slot.name.textContent !== name) slot.name.textContent = name;
      if (slot.state.textContent !== state) slot.state.textContent = state;
      slot.root.classList.toggle('unavailable', dim);
      slot.root.classList.toggle('active', active);
    };
    for (const id of ['healthPotion', 'manaPotion'] as const) {
      const count = countItem(player, id);
      const cooling = player.potionCooldown;
      const state =
        cooling > 0 && count > 0
          ? i18n.t('skills.cooldown', { seconds: Math.ceil((cooling * TICK_MS) / 1000) })
          : i18n.t('quick.count', { count });
      set(this.slots[id], itemName(i18n, id), state, count === 0 || cooling > 0);
    }
    const chargeId: ItemId | null = chargeForWeapon(player);
    const count = chargeId ? countItem(player, chargeId) : 0;
    const state = player.chargesOn ? i18n.t('quick.on', { count }) : i18n.t('quick.off', { count });
    set(this.slots.charges, i18n.t('quick.charges'), state, count === 0, player.chargesOn);
  }
}
