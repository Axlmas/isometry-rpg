import type { I18n } from '../i18n';
import { type ClassId, type RaceId, CLASS_IDS, RACE_IDS } from '../sim';
import { element, make } from './itemView';
import { CLASS_INFO, CLASS_NAME, RACE_INFO, RACE_NAME } from './skillText';

/** The screen where a new hero is made: pick a race and a class, then start. */
export class CreationScreen {
  private race: RaceId = 'human';
  private cls: ClassId = 'warrior';

  constructor(
    private readonly i18n: I18n,
    private readonly onStart: (race: RaceId, cls: ClassId) => void,
  ) {
    element('creation-start').addEventListener('click', () => {
      this.hide();
      this.onStart(this.race, this.cls);
    });
  }

  get isOpen(): boolean {
    return !element('creation').hidden;
  }

  show(): void {
    element('creation').hidden = false;
    this.render();
    element('creation-start').focus();
  }

  hide(): void {
    element('creation').hidden = true;
  }

  render(): void {
    if (!this.isOpen) return;
    const { i18n } = this;
    const option = <T extends string>(id: T, chosen: T, name: string, info: string, pick: (id: T) => void): HTMLButtonElement => {
      const button = make('button', 'choice');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(id === chosen));
      button.append(make('strong', '', name), make('span', 'item-detail', info));
      button.addEventListener('click', () => {
        pick(id);
        this.render();
      });
      return button;
    };
    element('creation-races').replaceChildren(
      ...RACE_IDS.map((id) => option(id, this.race, i18n.t(RACE_NAME[id]), i18n.t(RACE_INFO[id]), (picked) => (this.race = picked))),
    );
    element('creation-classes').replaceChildren(
      ...CLASS_IDS.map((id) => option(id, this.cls, i18n.t(CLASS_NAME[id]), i18n.t(CLASS_INFO[id]), (picked) => (this.cls = picked))),
    );
  }
}
