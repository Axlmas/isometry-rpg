import { type I18n, type MessageKey, LOCALES } from '../i18n';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

export interface HudOptions {
  i18n: I18n;
  canSave: boolean;
  onLanguageToggle(): void;
  onNewDungeon(): void;
  onRespawn(): void;
}

/** The HTML layer above the game canvas. All its text comes from the i18n catalogue. */
export class Hud {
  private readonly i18n: I18n;
  private canSave: boolean;
  private health = { current: 0, max: 1 };
  private monsters = 0;
  private toastTimer: number | undefined;

  constructor(options: HudOptions) {
    this.i18n = options.i18n;
    this.canSave = options.canSave;

    const dialog = element<HTMLDialogElement>('confirm-new');
    element('language').addEventListener('click', options.onLanguageToggle);
    element('new-dungeon').addEventListener('click', () => dialog.showModal());
    dialog.addEventListener('close', () => {
      if (dialog.returnValue === 'yes') options.onNewDungeon();
    });
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

  setMonsters(count: number): void {
    this.monsters = count;
    const label = element('monsters');
    label.textContent = this.i18n.t('hud.monsters', { count });
    label.classList.toggle('cleared', count === 0);
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
    this.setMonsters(this.monsters);
  }
}
