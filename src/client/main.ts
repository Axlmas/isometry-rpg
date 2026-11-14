import Phaser from 'phaser';
import { I18n, LOCALES, PSEUDO_LOCALE, SOURCE_LOCALE, pickLocale } from '../i18n';
import { type World, MAX_LEVEL, SKILLS, createWorld, isAlive, xpToNextLevel } from '../sim';
import { InventoryPanel } from './inventoryPanel';
import { ITEM_NAME } from './itemText';
import { DungeonScene } from './DungeonScene';
import { Hud } from './hud';
import { characterOf, loadLocale, loadWorld, openStorage, saveLocale, saveWorld } from './save';
import { SkillBar } from './skillBar';
import { SKILL_NAME } from './skillText';
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
  hud.setMana(w.player.mp, w.player.maxMp);
  hud.setProgress(w.player.level, w.player.xp, w.player.level < MAX_LEVEL ? xpToNextLevel(w.player.level) : 0, w.dungeonLevel);
  skillBar.update(w);
  hud.setMonsters(w.monsters.length);
  hud.setDeathVisible(!isAlive(w));
  inventory.update(w);
}

const scene = new DungeonScene(world, {
  onStats: showStats,
  onCheckpoint: persist,
  onDeath: (w, xpLost) => {
    hud.setXpLost(xpLost);
    showStats(w);
  },
  onTick: (w) => skillBar.update(w),
  onLevelUp: (level, unlocked) => {
    hud.log(i18n.t('log.levelUp', { level }));
    for (const id of unlocked) hud.log(i18n.t('log.skillUnlocked', { skill: i18n.t(SKILL_NAME[id]) }));
  },
  onSkillDenied: (id, reason) => {
    if (reason === 'mana') hud.log(i18n.t('log.noMana'), true);
    else if (reason === 'cooldown') hud.log(i18n.t('log.skillCooling'), true);
    else hud.log(i18n.t('log.skillLocked', { level: SKILLS[id].unlockLevel }), true);
  },
  onPickup: (itemId, count) => {
    if (itemId === 'coins') {
      hud.log(i18n.t('log.coins', { count }));
      return;
    }
    const item = i18n.t(ITEM_NAME[itemId]);
    hud.log(count > 1 ? i18n.t('log.pickedMany', { item, count }) : i18n.t('log.picked', { item }));
  },
  onInventoryFull: () => hud.log(i18n.t('log.full'), true),
  onToggleInventory: () => inventory.toggle(),
  formatNumber: (value) =>
    new Intl.NumberFormat(i18n.locale === PSEUDO_LOCALE ? SOURCE_LOCALE : i18n.locale).format(value),
});

const skillBar = new SkillBar(i18n, (id) => scene.useSkill(id, false));
const inventory = new InventoryPanel(i18n, (command) => scene.send(command));

const hud = new Hud({
  i18n,
  canSave: storage !== null,
  onLanguageToggle: () => {
    const next = selectable[(selectable.indexOf(i18n.locale) + 1) % selectable.length] as string;
    i18n.setLocale(next);
    saveLocale(storage, next);
    hud.render();
    inventory.render(true);
    skillBar.update();
  },
  onNewDungeon: () => {
    // The hero keeps their belongings; only the dungeon is replaced.
    world = createWorld(newSeed(), characterOf(world));
    scene.setWorld(world);
    showStats(world);
    persist();
  },
  onRespawn: () => scene.send({ type: 'respawn' }),
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
