import Phaser from 'phaser';
import { I18n, LOCALES, PSEUDO_LOCALE, SOURCE_LOCALE, pickLocale } from '../i18n';
import { type World, createWorld, isAlive } from '../sim';
import { DungeonScene } from './DungeonScene';
import { Hud } from './hud';
import { loadLocale, loadWorld, openStorage, saveLocale, saveWorld } from './save';
import './style.css';

const storage = openStorage();

// Technical details go to the console for developers, never to the screen.
const i18n = new I18n({ onProblem: (problem) => console.warn(`[i18n] ${problem}`) });
const params = new URLSearchParams(window.location.search);
// `?pseudo` switches to the generated test locale to check layouts.
const selectable = Object.keys(LOCALES);
i18n.setLocale(params.has('pseudo') ? PSEUDO_LOCALE : pickLocale([loadLocale(storage), ...navigator.languages]));

function newSeed(): number {
  // Picking the seed is not a game rule, so a non-deterministic source is fine here.
  return crypto.getRandomValues(new Uint32Array(1))[0] as number;
}

const loaded = loadWorld(storage);
let world: World = loaded.status === 'ok' ? loaded.world : createWorld(newSeed());

function persist(): void {
  if (storage) hud.setCanSave(saveWorld(storage, world));
}

function showStats(w: World): void {
  hud.setHealth(w.player.hp, w.player.maxHp);
  hud.setMonsters(w.monsters.length);
  hud.setDeathVisible(!isAlive(w));
}

const scene = new DungeonScene(world, {
  onStats: showStats,
  onCheckpoint: persist,
  onDeath: showStats,
  formatNumber: (value) =>
    new Intl.NumberFormat(i18n.locale === PSEUDO_LOCALE ? SOURCE_LOCALE : i18n.locale).format(value),
});

const hud = new Hud({
  i18n,
  canSave: storage !== null,
  onLanguageToggle: () => {
    const next = selectable[(selectable.indexOf(i18n.locale) + 1) % selectable.length] as string;
    i18n.setLocale(next);
    saveLocale(storage, next);
    hud.render();
  },
  onNewDungeon: () => {
    world = createWorld(newSeed());
    scene.setWorld(world);
    showStats(world);
    persist();
  },
  onRespawn: () => scene.send({ type: 'respawn' }),
  onAttackHeld: (held) => scene.setAttackHeld(held),
});

showStats(world);
if (loaded.status === 'damaged') hud.toast('toast.saveDamaged');
persist();
window.addEventListener('pagehide', persist);

let failed = false;
function onFatalError(error: unknown): void {
  console.error(error);
  if (failed) return;
  failed = true;
  hud.showFatalError();
}
window.addEventListener('error', (event) => onFatalError(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => onFatalError(event.reason));

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#12141a',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  // Keeps the browser's own context menu and page scroll out of the way.
  disableContextMenu: true,
  banner: false,
  scene,
});
