import { type I18n, type MessageKey, LOCALES } from '../i18n';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

export interface HudOptions {
  i18n: I18n;
  canSave: boolean;
  /** Open the controls summary; meant for a player's first launch. */
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
  private toastTimer: number | undefined;
  private bannerTimer: number | undefined;

  constructor(options: HudOptions) {
    this.i18n = options.i18n;
    this.canSave = options.canSave;

    element<HTMLDetailsElement>('controls').open = options.showControls;
    element('language').addEventListener('click', options.onLanguageToggle);
    element('error-reload').addEventListener('click', () => window.location.reload());
    element('death-respawn').addEventListener('click', options.onRespawn);

    this.render();
  }

  setHealth(current: number, max: number): void {
    this.health = { current, max };
    const meter = element('health');
    meter.setAttribute('aria-valuenow', String(current));
    meter.setAttribute('aria-valuemax', String(max));
    meter.setAttribute('aria-valuetext', this.i18n.t('hud.health', { current, max }));
    element('health-fill').style.inlineSize = `${Math.max(0, Math.min(100, (current / max) * 100))}%`;
    element('health-text').textContent = this.i18n.t('hud.health', { current, max });
  }

  setMana(current: number, max: number): void {
    this.mana = { current, max };
    const meter = element('mana');
    const text = this.i18n.t('hud.mana', { current, max });
    meter.setAttribute('aria-valuenow', String(current));
    meter.setAttribute('aria-valuemax', String(max));
    meter.setAttribute('aria-valuetext', text);
    element('mana-fill').style.inlineSize = `${Math.max(0, Math.min(100, (current / max) * 100))}%`;
    element('mana-text').textContent = text;
  }

  /** `needed` is zero at the maximum level. */
  setProgress(level: number, xp: number, needed: number): void {
    this.progress = { level, xp, needed };
    const { i18n } = this;
    element('level').textContent = i18n.t('hud.level', { level });
    element('xp-text').textContent = needed > 0 ? i18n.t('hud.xp', { current: xp, needed }) : i18n.t('hud.xpMax');
    element('xp-fill').style.inlineSize = `${needed > 0 ? Math.min(100, (xp / needed) * 100) : 100}%`;
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

  /** Adds a line to the short list of recent events (pickups and the like). */
  log(text: string, warning = false): void {
    const list = element('log');
    const line = document.createElement('li');
    line.textContent = text;
    if (warning) line.className = 'warning';
    list.append(line);
    while (list.children.length > 5) list.firstElementChild?.remove();
    window.setTimeout(() => line.remove(), 4500);
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
