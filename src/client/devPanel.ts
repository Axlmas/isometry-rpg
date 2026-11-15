import type { I18n } from '../i18n';
import type { Command } from '../sim';
import { element } from './itemView';

/**
 * Shortcuts for testing while the game is being made: start over, gain a
 * level, get coins and materials, jump across the map. Only shown in
 * development builds.
 */
export class DevPanel {
  constructor(i18n: I18n, send: (command: Command) => void, onReset: () => void) {
    void i18n; // Texts come from data-i18n attributes like the rest of the page.
    const panel = element('dev');
    element('dev-open').hidden = false;
    element('dev-open').addEventListener('click', () => (panel.hidden = !panel.hidden));
    element('dev-close').addEventListener('click', () => (panel.hidden = true));
    const actions: Record<string, Command> = {
      'dev-level': { type: 'dev', action: 'levelUp' },
      'dev-coins': { type: 'dev', action: 'coins' },
      'dev-kit': { type: 'dev', action: 'kit' },
      'dev-heal': { type: 'dev', action: 'heal' },
      'dev-clear': { type: 'dev', action: 'clear' },
      'dev-go-village': { type: 'dev', action: 'teleport', to: 'village' },
      'dev-go-moor': { type: 'dev', action: 'teleport', to: 'moor' },
      'dev-go-hollow': { type: 'dev', action: 'teleport', to: 'hollow' },
      'dev-go-mines': { type: 'dev', action: 'teleport', to: 'mines' },
    };
    for (const [id, command] of Object.entries(actions)) element(id).addEventListener('click', () => send(command));
    element('dev-reset').addEventListener('click', () => {
      panel.hidden = true;
      onReset();
    });
  }
}
