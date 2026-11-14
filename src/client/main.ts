import Phaser from 'phaser';
import { I18n, LOCALES, PSEUDO_LOCALE, SOURCE_LOCALE, pickLocale } from '../i18n';
import {
  type GameEvent, type World, type ZoneKind, MAX_LEVEL, SKILLS,
  characterOf, createWorld, isAlive, isNearMerchant, nearestExit, travelerOf, xpToNextLevel,
} from '../sim';
import { DungeonScene } from './DungeonScene';
import { Hud } from './hud';
import { InventoryPanel } from './inventoryPanel';
import { itemName } from './itemView';
import { QuickBar } from './quickBar';
import { loadLocale, loadWorld, openStorage, saveLocale, saveWorld } from './save';
import { ShopPanel } from './shopPanel';
import { SkillBar } from './skillBar';
import { SKILL_NAME } from './skillText';
import { ZONE_NAME } from './zoneText';
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
// A new hero starts in the village.
let world: World = loaded.status === 'ok' ? loaded.world : createWorld(newSeed(), undefined, undefined, 'village');

function persist(): void {
  if (storage) hud.setCanSave(saveWorld(storage, world));
}

/** What the T key would do right now, shown to the player as a reminder. */
function promptText(w: World): string | null {
  if (!isAlive(w) || shop.isOpen) return null;
  if (isNearMerchant(w)) return i18n.t('prompt.trade');
  const exit = nearestExit(w);
  return exit ? i18n.t('prompt.travel', { zone: i18n.t(ZONE_NAME[exit.to]) }) : null;
}

function showStats(w: World): void {
  hud.setHealth(w.player.hp, w.player.maxHp);
  hud.setMana(w.player.mp, w.player.maxMp);
  hud.setProgress(w.player.level, w.player.xp, w.player.level < MAX_LEVEL ? xpToNextLevel(w.player.level) : 0);
  hud.setZone(i18n.t(ZONE_NAME[w.zone]), w.zone === 'village' ? null : w.dungeonLevel, w.monsters.length);
  hud.setDeathVisible(!isAlive(w));
  onTick(w);
  inventory.update(w);
}

/** Things that count down or depend on where the hero stands; cheap enough for every tick. */
function onTick(w: World): void {
  skillBar.update(w);
  quickBar.update(w);
  shop.update(w);
  hud.setPrompt(promptText(w));
}

/** Moves the hero to another zone. The village restores them; elsewhere they arrive as they left. */
function travelTo(to: ZoneKind): void {
  const hero = to === 'village' ? characterOf(world) : travelerOf(world);
  world = createWorld(newSeed(), hero, undefined, to, world.zone);
  shop.toggle(false);
  scene.setWorld(world);
  showStats(world);
  persist();
}

/** Turns a rule event into a line of text for the player. */
function showNotice(event: GameEvent): void {
  switch (event.type) {
    case 'bought':
      if (event.itemId !== 'coins') hud.log(i18n.t('log.bought', { item: itemName(i18n, event.itemId), count: event.count, cost: event.cost }));
      return;
    case 'sold':
      if (event.itemId !== 'coins') hud.log(i18n.t('log.sold', { item: itemName(i18n, event.itemId), count: event.count, gain: event.gain }));
      return;
    case 'chargesEmpty':
      hud.log(i18n.t('log.noCharges'), true);
      return;
    case 'tradeDenied':
      if (event.reason === 'far') hud.log(i18n.t('log.far'), true);
      else if (event.reason === 'coins') hud.log(i18n.t('log.noCoins'), true);
      else if (event.reason === 'full') hud.log(i18n.t('log.noRoom'), true);
      else hud.log(i18n.t('log.worthless'), true);
      return;
    case 'useDenied':
      if (event.reason === 'cooldown') hud.log(i18n.t('log.potionCooling'), true);
      else if (event.reason === 'notNeeded') hud.log(event.itemId === 'healthPotion' ? i18n.t('log.healthFull') : i18n.t('log.manaFull'), true);
      else if (event.itemId !== 'coins') hud.log(i18n.t('log.noneLeft', { item: itemName(i18n, event.itemId) }), true);
      return;
    default:
      return;
  }
}

const scene = new DungeonScene(world, {
  onStats: showStats,
  onCheckpoint: persist,
  onDeath: (w, xpLost) => {
    hud.setXpLost(xpLost);
    showStats(w);
  },
  // A fallen hero wakes up in the village.
  onRespawn: () => travelTo('village'),
  onTravel: travelTo,
  onTick,
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
    const item = itemName(i18n, itemId);
    hud.log(count > 1 ? i18n.t('log.pickedMany', { item, count }) : i18n.t('log.picked', { item }));
  },
  onInventoryFull: () => hud.log(i18n.t('log.full'), true),
  onToggleInventory: () => inventory.toggle(),
  // One key for whatever is next to the hero: the merchant first, then an exit.
  onInteract: () => {
    if (shop.isOpen || isNearMerchant(world)) shop.toggle();
    else if (nearestExit(world)) scene.send({ type: 'travel' });
    else hud.log(i18n.t('log.nothingNear'), true);
  },
  onNotice: showNotice,
  formatNumber: (value) =>
    new Intl.NumberFormat(i18n.locale === PSEUDO_LOCALE ? SOURCE_LOCALE : i18n.locale).format(value),
});

const skillBar = new SkillBar(i18n, (id) => scene.useSkill(id, false));
const quickBar = new QuickBar(i18n, (command) => scene.send(command));
// The hero does not swing a weapon while talking to the merchant.
const shop = new ShopPanel(i18n, (command) => scene.send(command), (open) => scene.setPeaceful(open));
const inventory = new InventoryPanel(i18n, (command) => scene.send(command));

const hud = new Hud({
  i18n,
  canSave: storage !== null,
  showControls: loaded.status !== 'ok',
  onLanguageToggle: () => {
    const next = selectable[(selectable.indexOf(i18n.locale) + 1) % selectable.length] as string;
    i18n.setLocale(next);
    saveLocale(storage, next);
    hud.render();
    inventory.render(true);
    shop.render(true);
    showStats(world);
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
