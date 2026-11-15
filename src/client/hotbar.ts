import type { I18n } from '../i18n';
import { type ClassId, type Command, type ItemId, type SkillId, type World, SKILLS, TICK_MS, chargeForWeapon, classSkills, countItem } from '../sim';
import { itemIcon } from './itemIcon';
import { element, itemEffect, itemName, make } from './itemView';
import { skillIcon } from './skillIcon';
import { SKILL_INFO, SKILL_NAME, SKILL_SLOTS } from './skillText';

/** Physical keys (KeyboardEvent.code) of the potion and charge slots. */
export const QUICK_KEYS = { healthPotion: 'Digit1', manaPotion: 'Digit2', charges: 'KeyF' } as const;

interface Slot {
  root: HTMLButtonElement;
  icon: HTMLElement;
  count: HTMLElement;
  shade: HTMLElement;
  /** Lines for the hint shown when the cursor is over the slot. */
  describe: () => string[];
}

/**
 * The row of square slots at the bottom of the screen: skills, potions and
 * the weapon-charge switch. Each shows its key, an icon, what is left and a
 * countdown while it cannot be used; pointing at a slot explains it.
 */
export class Hotbar {
  /** One slot per skill key; which skill sits in it depends on the hero's class. */
  private readonly skillSlots: Slot[] = [];
  private skillIds: SkillId[] = [];
  private shownClass: ClassId | null = null;
  private readonly potions: Record<'healthPotion' | 'manaPotion', Slot>;
  private readonly charges: Slot;
  private chargeIcon: ItemId | null = null;
  private world: World | null = null;

  constructor(
    private readonly i18n: I18n,
    onSkill: (slot: number) => void,
    send: (command: Command) => void,
  ) {
    const bar = element('skills');
    SKILL_SLOTS.forEach((key, index) => {
      this.skillSlots.push(this.createSlot(bar, key.label, () => onSkill(index), () => this.describeSkill(this.skillIds[index] as SkillId)));
    });
    bar.append(make('span', 'bar-gap'));
    const potion = (id: 'healthPotion' | 'manaPotion', key: string): Slot => {
      const slot = this.createSlot(bar, key, () => send({ type: 'use', itemId: id }), () => [itemName(this.i18n, id), itemEffect(this.i18n, id)]);
      slot.icon.replaceChildren(itemIcon(id));
      return slot;
    };
    this.potions = { healthPotion: potion('healthPotion', '1'), manaPotion: potion('manaPotion', '2') };
    this.charges = this.createSlot(bar, 'F', () => send({ type: 'toggleCharges' }), () => [
      this.i18n.t('quick.charges'),
      this.i18n.t('inventory.charge'),
      this.world?.player.chargesOn ? this.i18n.t('quick.stateOn') : this.i18n.t('quick.stateOff'),
    ]);
  }

  private createSlot(bar: HTMLElement, key: string, onClick: () => void, describe: () => string[]): Slot {
    const root = make('button', 'slot');
    root.type = 'button';
    const icon = make('span', 'slot-icon');
    const count = make('span', 'slot-count');
    const shade = make('span', 'slot-shade');
    shade.hidden = true;
    root.append(icon, make('kbd', '', key), count, shade);
    root.addEventListener('click', () => {
      onClick();
      root.blur(); // Otherwise Space would press the button again instead of attacking.
    });
    const slot: Slot = { root, icon, count, shade, describe };
    for (const type of ['mouseenter', 'focus'] as const) root.addEventListener(type, () => this.showTooltip(slot));
    for (const type of ['mouseleave', 'blur'] as const) root.addEventListener(type, () => (element('tooltip').hidden = true));
    bar.append(root);
    return slot;
  }

  private describeSkill(id: SkillId): string[] {
    const { i18n, world } = this;
    const def = SKILLS[id];
    const lines = [i18n.t(SKILL_NAME[id]), i18n.t(SKILL_INFO[id]), i18n.t('skills.cost', { cost: def.manaCost })];
    if (world && world.player.level < def.unlockLevel) lines.push(i18n.t('skills.locked', { level: def.unlockLevel }));
    else if (world && !world.player.skills.includes(id)) lines.push(i18n.t('skills.unlearned'));
    return lines;
  }

  private showTooltip(slot: Slot): void {
    const tooltip = element('tooltip');
    const [name, ...rest] = slot.describe();
    tooltip.replaceChildren(make('strong', 'item-name', name), ...rest.map((line) => make('span', 'item-detail', line)));
    tooltip.hidden = false;
    // Above the slot, kept on the screen.
    const at = slot.root.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - box.width - 8, at.left + at.width / 2 - box.width / 2))}px`;
    tooltip.style.top = `${Math.max(8, at.top - box.height - 8)}px`;
  }

  /** Cheap enough to call on every tick: the page is only touched when something changes. */
  update(world: World = this.world as World): void {
    if (!world) return;
    this.world = world;
    const { player } = world;
    const set = (slot: Slot, label: string, count: string, shade: string, classes: Record<string, boolean>) => {
      if (slot.root.getAttribute('aria-label') !== label) slot.root.setAttribute('aria-label', label);
      if (slot.count.textContent !== count) slot.count.textContent = count;
      if (slot.shade.textContent !== shade) slot.shade.textContent = shade;
      if (slot.shade.hidden !== (shade === '')) slot.shade.hidden = shade === '';
      for (const [name, on] of Object.entries(classes)) slot.root.classList.toggle(name, on);
    };
    const seconds = (ticks: number): string => (ticks > 0 ? String(Math.ceil((ticks * TICK_MS) / 1000)) : '');

    if (player.cls !== this.shownClass) {
      // A different hero: put that class's skills into the slots.
      this.shownClass = player.cls;
      this.skillIds = classSkills(player.cls);
      this.skillSlots.forEach((slot, index) => slot.icon.replaceChildren(skillIcon(this.skillIds[index] as SkillId)));
    }
    for (const [index, id] of this.skillIds.entries()) {
      const def = SKILLS[id];
      const locked = player.level < def.unlockLevel || !player.skills.includes(id);
      const cooling = player.skillCooldowns[id];
      const noMana = player.mp < def.manaCost;
      set(this.skillSlots[index] as Slot, this.describeSkill(id).join('. '), '', locked ? '' : seconds(cooling), {
        locked,
        unavailable: !locked && cooling > 0,
        'no-mana': !locked && cooling === 0 && noMana,
      });
    }
    for (const id of ['healthPotion', 'manaPotion'] as const) {
      const count = countItem(player, id);
      const label = `${itemName(this.i18n, id)}. ${this.i18n.t('quick.count', { count })}`;
      set(this.potions[id], label, String(count), count > 0 ? seconds(player.potionCooldown) : '', { unavailable: count === 0 });
    }
    const chargeId = chargeForWeapon(player);
    if (chargeId !== this.chargeIcon) {
      this.chargeIcon = chargeId;
      this.charges.icon.replaceChildren(itemIcon(chargeId ?? 'chargePlain'));
    }
    const count = chargeId ? countItem(player, chargeId) : 0;
    const state = player.chargesOn ? this.i18n.t('quick.on', { count }) : this.i18n.t('quick.off', { count });
    set(this.charges, `${this.i18n.t('quick.charges')}. ${state}`, String(count), '', { unavailable: count === 0, active: player.chargesOn });
  }
}
