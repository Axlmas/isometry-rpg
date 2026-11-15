import Phaser from 'phaser';
import { I18n, LOCALES, PSEUDO_LOCALE, SOURCE_LOCALE, pickLocale } from '../i18n';
import {
  type GameEvent, type ItemId, type Region, type World, type ZoneKind, MAX_LEVEL, RECIPES, SKILLS,
  SHOP_STOCK, characterOf, createWorld, isAlive, minesLevelFor, nearestExit, nearestNpc, regionAt, travelerOf, xpToNextLevel,
} from '../sim';
import { DungeonScene, RENDER_SCALE } from './DungeonScene';
import { ForgePanel } from './forgePanel';
import { Hud } from './hud';
import { InventoryPanel } from './inventoryPanel';
import { itemName } from './itemView';
import { NPC_NAME } from './npcText';
import { loadLocale, loadWorld, openStorage, saveLocale, saveWorld } from './save';
import { ShopPanel } from './shopPanel';
import { Hotbar } from './hotbar';
import { Minimap } from './minimap';
import { MONSTER_NAME } from './npcText';
import { TrainerPanel } from './trainerPanel';
import { SKILL_NAME } from './skillText';
import { REGION_NAME } from './zoneText';
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
// A new hero starts in the village, in the open world.
let world: World = loaded.status === 'ok' ? loaded.world : createWorld(newSeed(), undefined, undefined, 'overworld');
let region: Region | null = null;

function persist(): void {
  if (storage) hud.setCanSave(saveWorld(storage, world));
}

/** What the T key would do right now, shown to the player as a reminder. */
function promptText(w: World): string | null {
  if (!isAlive(w) || isTalking()) return null;
  const npc = nearestNpc(w);
  if (npc) return i18n.t('prompt.talk', { npc: i18n.t(NPC_NAME[npc.kind]) });
  const exit = nearestExit(w);
  return exit ? i18n.t('prompt.travel', { zone: i18n.t(REGION_NAME[exit.leadsTo]) }) : null;
}

function showStats(w: World): void {
  hud.setHealth(w.player.hp, w.player.maxHp);
  hud.setMana(w.player.mp, w.player.maxMp);
  hud.setProgress(w.player.level, w.player.xp, w.player.level < MAX_LEVEL ? xpToNextLevel(w.player.level) : 0);
  showRegion(w, false);
  hud.setDeathVisible(!isAlive(w));
  onTick(w);
  inventory.update(w);
}

/** How dangerous a region is, in words. */
function dangerText(w: World, r: Region): string {
  if (r.safe) return i18n.t('zone.safe');
  if (r.levels === null) return i18n.t('zone.level', { level: w.dungeonLevel });
  return i18n.t('zone.levels', { min: r.levels[0], max: r.levels[1] });
}

/** Keeps the HUD's region line current; `announce` also shows the big banner when the region changed. */
function showRegion(w: World, announce: boolean): void {
  const now = regionAt(w.zone, w.player.pos);
  const changed = now !== region;
  region = now;
  const name = i18n.t(REGION_NAME[now.id]);
  const danger = dangerText(w, now);
  // Monsters are only counted in the dungeon: it can be cleared, the open world cannot.
  hud.setZone(name, danger, w.zone === 'dungeon' ? w.monsters.length : null);
  if (changed && announce) hud.showBanner(name, danger);
}

/** Things that count down or depend on where the hero stands; cheap enough for every tick. */
function onTick(w: World): void {
  if (regionAt(w.zone, w.player.pos) !== region) showRegion(w, true);
  hotbar.update(w);
  shop.update(w);
  trainer.update(w);
  forge.update(w);
  hud.setPrompt(promptText(w));
  // The map does not need to follow every tick.
  if (w.tick % 4 === 0) minimap.draw(w);
}

/** Moves the hero to the other map: into the mines or back out. They arrive as they left. */
function travelTo(to: ZoneKind): void {
  const hero = travelerOf(world);
  world = createWorld(newSeed(), hero, minesLevelFor(hero.level), to, world.zone);
  enterWorld();
}

/** A fallen hero wakes up in the village, restored. */
function wakeInVillage(): void {
  if (world.zone === 'dungeon') world = createWorld(newSeed(), characterOf(world), undefined, 'overworld');
  enterWorld();
}

function enterWorld(): void {
  closeTalk();
  scene.setWorld(world);
  region = null;
  showStats(world);
  showRegion(world, true);
  minimap.draw(world);
  document.getElementById('vignette')?.classList.toggle('dark', world.zone === 'dungeon');
  persist();
}

const isTalking = (): boolean => shop.isOpen || trainer.isOpen || forge.isOpen;

function closeTalk(): void {
  shop.toggle(false);
  trainer.toggle(false);
  forge.toggle(false);
}

/** The T key: talk to whoever is next to the hero, otherwise use a doorway. */
function interact(): void {
  if (isTalking()) {
    closeTalk();
    return;
  }
  const npc = nearestNpc(world);
  if (npc?.kind === 'trainer') trainer.toggle(true);
  else if (npc?.kind === 'blacksmith') forge.toggle(true);
  else if (npc?.kind === 'guard') hud.log(i18n.t('log.guard'));
  else if (npc && SHOP_STOCK[npc.kind]) shop.open(npc.kind);
  else if (nearestExit(world)) scene.send({ type: 'travel' });
  else hud.log(i18n.t('log.nothingNear'), true);
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
      if (event.reason === 'far') hud.log(i18n.t('log.tooFar'), true);
      else if (event.reason === 'coins') hud.log(i18n.t('log.noCoins'), true);
      else if (event.reason === 'full') hud.log(i18n.t('log.noRoom'), true);
      else if (event.reason === 'notSold') hud.log(i18n.t('log.notSold'), true);
      else hud.log(i18n.t('log.worthless'), true);
      return;
    case 'skillLearned':
      hud.log(i18n.t('log.skillLearned', { skill: i18n.t(SKILL_NAME[event.id]) }));
      return;
    case 'learnDenied':
      if (event.reason === 'far') hud.log(i18n.t('log.tooFar'), true);
      else if (event.reason === 'coins') hud.log(i18n.t('log.noCoins'), true);
      else hud.log(i18n.t('log.learnLevel'), true);
      return;
    case 'enchanted':
      if (event.itemId !== 'coins') hud.log(i18n.t('log.enchanted', { item: itemName(i18n, event.itemId, event.level) }));
      return;
    case 'enchantFailed':
      if (event.itemId !== 'coins') hud.log(i18n.t('log.enchantFailed', { item: itemName(i18n, event.itemId, event.level), crystals: event.crystals }), true);
      return;
    case 'enchantDenied':
      if (event.reason === 'far') hud.log(i18n.t('log.tooFar'), true);
      else if (event.reason === 'scroll') hud.log(i18n.t('log.noScroll'), true);
      else hud.log(i18n.t('log.enchantMax'), true);
      return;
    case 'crystallized':
      if (event.itemId !== 'coins') hud.log(i18n.t('log.crystallized', { item: itemName(i18n, event.itemId), crystals: event.crystals }));
      return;
    case 'recipeLearned':
      hud.log(i18n.t('log.recipeLearned', { item: itemName(i18n, RECIPES[event.recipe].output.itemId as Exclude<ItemId, 'coins'>) }));
      return;
    case 'recipeDenied':
      hud.log(i18n.t('log.recipeKnown'), true);
      return;
    case 'crafted':
      if (event.itemId !== 'coins') hud.log(i18n.t('log.crafted', { item: itemName(i18n, event.itemId), count: event.count }));
      return;
    case 'craftFailed':
      hud.log(i18n.t('log.craftFailed', { item: itemName(i18n, RECIPES[event.recipe].output.itemId as Exclude<ItemId, 'coins'>) }), true);
      return;
    case 'craftDenied':
      if (event.reason === 'far') hud.log(i18n.t('log.tooFar'), true);
      else if (event.reason === 'full') hud.log(i18n.t('log.noRoom'), true);
      else if (event.reason === 'unknown') hud.log(i18n.t('log.recipeUnknown'), true);
      else hud.log(i18n.t('log.noMaterials'), true);
      return;
    case 'crystallizeDenied':
      if (event.reason === 'far') hud.log(i18n.t('log.tooFar'), true);
      else if (event.reason === 'full') hud.log(i18n.t('log.noRoom'), true);
      else hud.log(i18n.t('log.noCrystals'), true);
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
  onRespawn: wakeInVillage,
  onTravel: travelTo,
  onTick,
  onLevelUp: (level, unlocked) => {
    hud.log(i18n.t('log.levelUp', { level }));
    for (const id of unlocked) hud.log(i18n.t('log.skillAvailable', { skill: i18n.t(SKILL_NAME[id]) }));
  },
  onSkillDenied: (id, reason) => {
    if (reason === 'mana') hud.log(i18n.t('log.noMana'), true);
    else if (reason === 'unlearned') hud.log(i18n.t('log.skillUnlearned'), true);
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
  onInteract: interact,
  onTarget: (monster) =>
    hud.setTarget(monster ? { name: i18n.t(MONSTER_NAME[monster.kind]), level: monster.level, hp: monster.hp, maxHp: monster.maxHp } : null),
  onNotice: showNotice,
  formatNumber: (value) =>
    new Intl.NumberFormat(i18n.locale === PSEUDO_LOCALE ? SOURCE_LOCALE : i18n.locale).format(value),
});

const hotbar = new Hotbar(i18n, (id) => scene.useSkill(id, false), (command) => scene.send(command));
const minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement);
// The hero does not swing a weapon while talking to someone.
const shop = new ShopPanel(i18n, (command) => scene.send(command), () => syncPeace());
const trainer = new TrainerPanel(i18n, (command) => scene.send(command), () => syncPeace());
const forge = new ForgePanel(i18n, (command) => scene.send(command), () => syncPeace());
/** Called just before a window opens or closes, so the check is done a moment later. */
function syncPeace(): void {
  queueMicrotask(() => scene.setPeaceful(isTalking()));
}
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
    trainer.render(true);
    forge.render(true);
    showStats(world);
  },
  onRespawn: () => scene.send({ type: 'respawn' }),
});

showStats(world);
minimap.draw(world);
document.getElementById('vignette')?.classList.toggle('dark', world.zone === 'dungeon');
// Say where the hero is when the game opens.
region = null;
showRegion(world, true);
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

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#12141a',
  // The canvas has RENDER_SCALE times more pixels than the window and is shown scaled down,
  // so the picture is sharp on screens with a high pixel density.
  scale: { mode: Phaser.Scale.NONE, width: window.innerWidth * RENDER_SCALE, height: window.innerHeight * RENDER_SCALE, zoom: 1 / RENDER_SCALE },
  // Keeps the browser's own context menu and page scroll out of the way.
  disableContextMenu: true,
  banner: false,
  scene,
});

window.addEventListener('resize', () => game.scale.resize(window.innerWidth * RENDER_SCALE, window.innerHeight * RENDER_SCALE));
