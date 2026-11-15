import { type I18n, type MessageKey, LOCALES } from '../i18n';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

export interface HudOptions {
  i18n: I18n;
  canSave: boolean;
  /** Open the help window; meant for a player's first launch. */
  showControls: boolean;
  onLanguageToggle(): void;
  onRespawn(): void;
}

/** The HTML layer above the game canvas. All its text comes from the i18n catalogue. */
export class Hud {
  private readonly i18n: I18n;
  private canSave: boolean;
  private health = { current: 0, max: 1 };
  private mana = { current: 0, max: 1 };
  private progress = { level: 1, xp: 0, needed: 1 };
  private xpLost = 0;
  private shownTarget = '';
  private toastTimer: number | undefined;
  private bannerTimer: number | undefined;

  constructor(options: HudOptions) {
    this.i18n = options.i18n;
    this.canSave = options.canSave;

    const help = element('help');
    const setHelp = (open: boolean) => {
      help.hidden = !open;
      element('help-open').setAttribute('aria-expanded', String(open));
    };
    element('help-open').addEventListener('click', () => setHelp(help.hasAttribute('hidden')));
    element('help-close').addEventListener('click', () => setHelp(false));
    setHelp(options.showControls);
    element('language').addEventListener('click', options.onLanguageToggle);
    element('error-reload').addEventListener('click', () => window.location.reload());
    element('death-respawn').addEventListener('click', options.onRespawn);

    this.render();
  }

  /** Fills one of the bars: the short numbers inside it, the full sentence for screen readers. */
  private setBar(id: 'health' | 'mana' | 'xp', current: number, max: number, spoken: string, shown: string): void {
    const meter = element(id);
    meter.setAttribute('aria-valuenow', String(current));
    meter.setAttribute('aria-valuemax', String(max));
    meter.setAttribute('aria-valuetext', spoken);
    element(`${id}-fill`).style.inlineSize = `${max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 100}%`;
    element(`${id}-text`).textContent = shown;
  }

  setHealth(current: number, max: number): void {
    this.health = { current, max };
    this.setBar('health', current, max, this.i18n.t('hud.health', { current, max }), this.i18n.t('hud.bar', { current, max }));
  }

  setMana(current: number, max: number): void {
    this.mana = { current, max };
    this.setBar('mana', current, max, this.i18n.t('hud.mana', { current, max }), this.i18n.t('hud.bar', { current, max }));
  }

  /** `needed` is zero at the maximum level. */
  setProgress(level: number, xp: number, needed: number): void {
    this.progress = { level, xp, needed };
    const { i18n } = this;
    const badge = element('level');
    badge.textContent = i18n.t('hud.levelShort', { level });
    badge.setAttribute('aria-label', i18n.t('hud.level', { level }));
    const spoken = needed > 0 ? i18n.t('hud.xp', { current: xp, needed }) : i18n.t('hud.xpMax');
    // Shown to the hundredth of a percent: on a long level, every kill should still move the number.
    const percent = needed > 0 ? ((xp / needed) * 100).toFixed(2) : '';
    this.setBar('xp', xp, needed, spoken, needed > 0 ? i18n.t('hud.xpPercent', { percent }) : i18n.t('hud.xpMax'));
  }

  /** Opens the help window, for a player who has just made a hero. */
  showHelp(): void {
    element('help').hidden = false;
    element('help-open').setAttribute('aria-expanded', 'true');
  }

  /** Shows whom the hero is fighting or pointing at; null hides the frame. */
  setTarget(target: { name: string; level: number; hp: number; maxHp: number } | null): void {
    const frame = element('target');
    if (frame.hidden !== (target === null)) frame.hidden = target === null;
    if (!target) return;
    const state = `${target.name}/${target.level}/${target.hp}/${target.maxHp}`;
    if (state === this.shownTarget) return;
    this.shownTarget = state;
    element('target-name').textContent = target.name;
    const badge = element('target-level');
    badge.textContent = this.i18n.t('hud.levelShort', { level: target.level });
    badge.setAttribute('aria-label', this.i18n.t('hud.level', { level: target.level }));
    element('target-fill').style.inlineSize = `${Math.max(0, Math.min(100, (target.hp / target.maxHp) * 100))}%`;
    element('target-text').textContent = this.i18n.t('hud.bar', { current: target.hp, max: target.maxHp });
  }

  /** How much experience the last death cost; shown on the defeat screen. */
  setXpLost(amount: number): void {
    this.xpLost = amount;
    element('death-xp').textContent = this.i18n.t('death.xpLost', { count: amount });
  }

  /** `danger` is the line describing the region's monsters; `monsters` is null where they are not counted. */
  setZone(zone: string, danger: string, monsters: number | null): void {
    element('zone').textContent = this.i18n.t('hud.zone', { zone, danger });
    const label = element('monsters');
    label.hidden = monsters === null;
    if (monsters !== null) {
      label.textContent = this.i18n.t('hud.monsters', { count: monsters });
      label.classList.toggle('cleared', monsters === 0);
    }
  }

  /** Announces that the hero has entered a region: its name in large letters for a few seconds. */
  showBanner(zone: string, danger: string): void {
    const banner = element('banner');
    element('banner-title').textContent = zone;
    element('banner-detail').textContent = danger;
    banner.hidden = false;
    // Restart the fade animation even if the banner is already on screen.
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => (banner.hidden = true), 3500);
  }

  /** A one-line reminder of what the interaction key does here; null hides it. */
  setPrompt(text: string | null): void {
    const prompt = element('prompt');
    if (prompt.hidden !== (text === null)) prompt.hidden = text === null;
    if (text !== null && prompt.textContent !== text) prompt.textContent = text;
  }

  /** The hero's name line in the status frame: race and class until heroes can be named. */
  setHero(text: string): void {
    element('hero-name').textContent = text;
  }

  setDeathVisible(visible: boolean): void {
    const screen = element('death');
    if (screen.hidden === !visible) return;
    screen.hidden = !visible;
    if (visible) element('death-respawn').focus();
  }

  /** Call when saving stops working mid-session (for example, storage is full). */
  setCanSave(canSave: boolean): void {
    if (this.canSave === canSave) return;
    this.canSave = canSave;
    this.render();
  }

  /** Adds a line to the system messages. The window keeps the last few; older ones fade out with time. */
  log(text: string, warning = false): void {
    const list = element('log');
    const line = document.createElement('li');
    line.textContent = text;
    if (warning) line.className = 'warning';
    list.append(line);
    while (list.children.length > 7) list.firstElementChild?.remove();
    window.setTimeout(() => line.remove(), 20000);
  }

  toast(key: MessageKey): void {
    const toast = element('toast');
    toast.textContent = this.i18n.t(key);
    toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (toast.hidden = true), 6000);
  }

  showFatalError(): void {
    element('error-body').textContent = this.i18n.t(this.canSave ? 'error.body' : 'error.bodyNoSave');
    element('error').hidden = false;
  }

  /** Re-applies every text; called at start and after a language change. */
  render(): void {
    const { i18n } = this;
    const info = LOCALES[i18n.locale];
    document.documentElement.lang = i18n.locale;
    document.documentElement.dir = info?.dir ?? 'ltr';
    document.title = i18n.t('game.title');

    for (const node of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
      node.textContent = i18n.t(node.dataset.i18n as MessageKey);
    }
    element('language').textContent = i18n.t('hud.language', { language: info?.name ?? i18n.locale });
    const status = element('save-status');
    status.textContent = i18n.t(this.canSave ? 'hud.autosave' : 'hud.autosaveOff');
    status.classList.toggle('warning', !this.canSave);
    element('error-body').textContent = i18n.t(this.canSave ? 'error.body' : 'error.bodyNoSave');
    this.setHealth(this.health.current, this.health.max);
    this.setMana(this.mana.current, this.mana.max);
    this.setProgress(this.progress.level, this.progress.xp, this.progress.needed);
    this.setXpLost(this.xpLost);
  }
}
