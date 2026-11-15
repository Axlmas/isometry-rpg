import Phaser from 'phaser';
import {
  type Command, type GameEvent, type GroundLoot, type ItemId, type Monster, type Npc, type Point, type Quality, type SkillId, type World, type ZoneKind,
  ITEMS, PLAYER_ATTACK_ARC, SKILLS, classSkills, weaponInHand, PLAYER_ATTACK_RANGE, TICK_MS, TILE_WALL,
  isAlive, isMoving, isRoad, isWalkable, regionAt, step, tileAt,
} from '../sim';
import { TILE_HEIGHT, TILE_WIDTH, screenToWorld, tileToScreen } from './iso';
import { QUALITY_COLOR } from './itemText';
import { QUICK_KEYS } from './hotbar';
import { NPC_LOOK } from './npcText';
import { type AnimationName, HERO_SHEET, MONSTER_SHEET, NPC_SHEET, createAnimations, createCharacter, directionOf, hasSheet, playCharacter, preloadSheets } from './sheets';
import { SKILL_SLOTS } from './skillText';
import { drawHeroFigure, drawMonsterFigure, drawNpcFigure, drawShadow, drawWeapon } from './sprites';
import { EXIT_COLOR, REGION_LOOK, ROAD_COLOR } from './zoneText';

const WALL_HEIGHT = 30;
const HALF_W = TILE_WIDTH / 2;
const HALF_H = TILE_HEIGHT / 2;
/** While the pointer is held down, the destination follows it at this interval. */
const HOLD_REPEAT_MS = 120;
/** Keyboard attacks aim at the nearest monster within this distance. */
const AUTO_AIM_RANGE = PLAYER_ATTACK_RANGE + 1;
const EFFECT_DEPTH = 100000;
/** How much bigger an elder monster is drawn. */
const ELDER_SCALE = 1.35;
/** Screens with more pixels per inch get a larger canvas, so the picture stays sharp. Capped to keep it fast. */
export const RENDER_SCALE = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
/** Obstacle pictures are painted this many times larger than shown, so they stay sharp when the camera zooms in. */
const TEXTURE_SCALE = 2;
/** How long a monster stays the target after the hero's last hit on it. */
const TARGET_MEMORY_MS = 5000;
/** Colour of a blow strengthened by a weapon charge, and of the blade while charges are on. */
const CHARGE_COLOR = 0x7fe9ff;

// Physical key positions (KeyboardEvent.code), so controls work on any
// keyboard layout, including Cyrillic. Values are directions on the screen.
const KEY_DIRECTIONS: Record<string, readonly [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};
const ATTACK_KEY = 'Space';
const INVENTORY_KEY = 'KeyI';
/** One key for whatever is next to the hero: a villager, a doorway. */
const INTERACT_KEY = 'KeyT';
/** Keys that send one command when pressed. */
const COMMAND_KEYS: Record<string, Command> = {
  [QUICK_KEYS.healthPotion]: { type: 'use', itemId: 'healthPotion' },
  [QUICK_KEYS.manaPotion]: { type: 'use', itemId: 'manaPotion' },
  [QUICK_KEYS.charges]: { type: 'toggleCharges' },
};
/** Skill keys by position: the class decides which skill each one uses. */
const SKILL_SLOT_BY_KEY = new Map<string, number>(SKILL_SLOTS.map((slot, index) => [slot.code, index]));

export interface SceneEvents {
  /** Health, the number of monsters or the hero's belongings changed. */
  onStats(world: World): void;
  /** A good moment to save: the hero stopped, killed a monster or respawned. */
  onCheckpoint(world: World): void;
  onDeath(world: World, xpLost: number): void;
  /** Called after every rule tick, for things that count down (skill cooldowns). */
  onTick(world: World): void;
  onLevelUp(level: number, unlocked: SkillId[]): void;
  onSkillDenied(id: SkillId, reason: 'locked' | 'unlearned' | 'cooldown' | 'mana'): void;
  onPickup(itemId: ItemId, count: number, quality: Quality | null): void;
  onXp(amount: number): void;
  onInventoryFull(): void;
  onToggleInventory(): void;
  onInteract(): void;
  /** The monster the hero is fighting or pointing at changed, or its health did; null when there is none. */
  onTarget(monster: Monster | null): void;
  /** The pictures are loaded and the world is on screen. */
  onReady(): void;
  /** The hero walked through an exit. */
  onTravel(to: ZoneKind): void;
  /** The hero asked to rise after dying. */
  onRespawn(): void;
  /** Something the player should be told in words: a refusal, a purchase, a sale. */
  onNotice(event: GameEvent): void;
  /** Formats a number for the player's language. */
  formatNumber(value: number): string;
}

interface MonsterSprite {
  container: Phaser.GameObjects.Container;
  /** Holds the body so it can be mirrored and bobbed without moving the health bar. */
  figure: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Graphics;
  /** The animated picture, for monsters that have a sprite sheet; the rest are drawn into `body`. */
  sprite: Phaser.GameObjects.Sprite | null;
  /** The direction it last faced, kept while it stands still. */
  direction: number;
  bar: Phaser.GameObjects.Graphics;
  previous: Point;
  lastHp: number;
}

/**
 * Draws the world and turns player input into commands. It contains no game
 * rules: everything that changes the world goes through `step` from src/sim.
 */
export class DungeonScene extends Phaser.Scene {
  private world: World;
  private readonly events_: SceneEvents;
  private pending: Command[] = [];
  private accumulator = 0;
  private lastFrameAt = performance.now();
  private previous: Point = { x: 0, y: 0 };
  private wasMoving = false;
  private lastStats = '';
  private readonly heldKeys = new Set<string>();
  private holdTimer = 0;
  private peaceful = false;
  /** True while a screen covers the game (creating a hero): nothing moves and no input is taken. */
  private paused = false;
  private savedRevision = 0;
  private mapObjects: Phaser.GameObjects.GameObject[] = [];
  private floorTextures: string[] = [];
  /** For each obstacle picture: where the tile centre sits, as a share of the picture's height. */
  private readonly obstacleOrigins = new Map<string, number>();
  private readonly monsterSprites = new Map<number, MonsterSprite>();
  private readonly lootSprites = new Map<number, Phaser.GameObjects.Graphics>();
  private readonly projectileSprites = new Map<number, Phaser.GameObjects.Graphics>();
  private hero!: Phaser.GameObjects.Container;
  private heroFigure!: Phaser.GameObjects.Container;
  private weapon!: Phaser.GameObjects.Graphics;
  private heroBody!: Phaser.GameObjects.Graphics;
  /** The hero's animated picture, when the sheet for the class is available. */
  private heroSprite: Phaser.GameObjects.Sprite | null = null;
  private heroSheet = '';
  /** A one-off animation in progress (a blow, a flinch, dying) and when it ends. */
  private heroAction: { animation: AnimationName; until: number } | null = null;
  /** What the hero figure was last drawn from, so it is redrawn only when the look changes. */
  private shownLook = '';
  /** Extra turn of the blade during a swing, in radians; eased back to zero. */
  private swing = 0;
  private targetRing!: Phaser.GameObjects.Graphics;
  private targetId: number | null = null;
  private targetUntil = 0;
  private shownTarget = '';
  private marker!: Phaser.GameObjects.Graphics;

  constructor(world: World, events: SceneEvents) {
    super('dungeon');
    this.world = world;
    this.events_ = events;
  }

  preload(): void {
    preloadSheets(this);
  }

  create(): void {
    createAnimations(this);
    this.marker = this.add.graphics().setDepth(-500).setVisible(false);
    this.marker.lineStyle(2, 0xe8c36a, 0.9).strokeEllipse(0, 0, 26, 13);
    this.marker.fillStyle(0xe8c36a, 0.35).fillEllipse(0, 0, 26, 13);
    this.targetRing = this.add.graphics().setDepth(-450).setVisible(false);
    this.targetRing.lineStyle(2, 0xe0503f, 0.9).strokeEllipse(0, 0, 40, 20);
    this.hero = this.createHero();
    this.cameras.main.startFollow(this.hero, false, 0.12, 0.12);

    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.paused || !this.isOnGame(pointer)) return;
      this.holdTimer = 0;
      if (this.isMoveOrder(pointer)) this.orderMoveTo(pointer);
      else this.orderAttackAt(pointer);
    });

    // Listening on the window keeps controls working even when a HUD button has focus.
    const onKeyDown = (event: KeyboardEvent) => {
      const skill = SKILL_SLOT_BY_KEY.get(event.code);
      const command = COMMAND_KEYS[event.code];
      const known =
        event.code in KEY_DIRECTIONS || event.code === ATTACK_KEY || event.code === INVENTORY_KEY ||
        event.code === INTERACT_KEY || skill !== undefined || command !== undefined;
      if (!known || this.paused || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === INVENTORY_KEY) {
        if (!event.repeat) this.events_.onToggleInventory();
        return;
      }
      if (skill !== undefined) {
        if (!event.repeat) this.useSkillSlot(skill, true);
        return;
      }
      if (event.code === INTERACT_KEY) {
        if (!event.repeat) this.events_.onInteract();
        return;
      }
      if (command !== undefined) {
        if (!event.repeat) this.pending.push(command);
        return;
      }
      if (event.code === ATTACK_KEY && event.target instanceof HTMLButtonElement) return; // Space presses the focused button.
      event.preventDefault(); // Arrow keys and space must not scroll the page.
      if (this.heldKeys.has(event.code)) return;
      this.heldKeys.add(event.code);
      if (event.code !== ATTACK_KEY) this.sendKeyDirection();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (this.heldKeys.delete(event.code) && event.code !== ATTACK_KEY) this.sendKeyDirection();
    };
    // If the window loses focus, key releases are never delivered.
    const onBlur = () => {
      if (this.heldKeys.size === 0) return;
      this.heldKeys.clear();
      this.sendKeyDirection();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    });

    this.scale.on('resize', this.fitCamera, this);
    this.fitCamera();
    this.setWorld(this.world);
    this.events_.onReady();
  }

  /** Replaces the world being shown, for example when a new dungeon starts. */
  setWorld(world: World): void {
    this.world = world;
    // Asked before the pictures have loaded (a quick click on a slow connection):
    // remember the world, and `create` will draw it when the scene is ready.
    if (!this.marker) return;
    this.pending = [];
    this.accumulator = 0;
    this.lastFrameAt = performance.now();
    this.previous = { ...world.player.pos };
    this.wasMoving = false;
    this.savedRevision = world.player.revision;
    this.lastStats = '';
    this.heldKeys.clear();
    this.marker.setVisible(false);
    for (const object of this.mapObjects) object.destroy();
    this.cameras.main.setBackgroundColor(world.zone === 'dungeon' ? 0x12141a : 0x16201a);
    this.mapObjects = this.drawMap();
    for (const npc of world.npcs) this.mapObjects.push(this.drawNpc(npc));
    for (const exit of world.exits) this.mapObjects.push(this.drawExit(exit.pos, EXIT_COLOR[exit.leadsTo]));
    for (const sprite of this.monsterSprites.values()) sprite.container.destroy();
    this.monsterSprites.clear();
    this.syncMonsters(1);
    for (const sprite of this.lootSprites.values()) sprite.destroy();
    this.lootSprites.clear();
    this.syncLoot();
    for (const sprite of this.projectileSprites.values()) sprite.destroy();
    this.projectileSprites.clear();
    this.shownLook = '';
    this.placeHero(world.player.pos);
    this.heroAction = isAlive(world) ? null : { animation: 'death', until: Infinity };
    this.hero.setAlpha(isAlive(world) || hasSheet(this, HERO_SHEET[world.player.cls]) ? 1 : 0.35);
    this.cameras.main.centerOn(this.hero.x, this.hero.y);
    this.reportStats();
  }

  /** While true (the hero is talking to someone), attacks and strike skills are not sent. Walking still works. */
  setPeaceful(peaceful: boolean): void {
    this.peaceful = peaceful;
  }

  /** Freezes or resumes the game; used while the hero is being created. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.heldKeys.clear();
    this.pending = [];
    this.lastFrameAt = performance.now();
  }

  /** Sends a command from outside the scene, for example from a HUD button. */
  send(command: Command): void {
    this.pending.push(command);
  }

  /**
   * Uses a skill. From the keyboard it is aimed at the cursor; from a HUD
   * button the cursor is on the button, so the hero aims at the nearest monster.
   */
  /** Uses the skill on the given key (0 for Q, 1 for E, 2 for R): which skill that is depends on the hero's class. */
  useSkillSlot(slot: number, aimAtCursor: boolean): void {
    const id = classSkills(this.world.player.cls)[slot];
    if (id) this.useSkill(id, aimAtCursor);
  }

  useSkill(id: SkillId, aimAtCursor: boolean): void {
    const { kind } = SKILLS[id].effect;
    if (this.peaceful && (kind === 'strike' || kind === 'shot' || kind === 'nova')) return;
    const { pos } = this.world.player;
    let dir: Point;
    if (aimAtCursor) {
      const { world } = this.pointerInWorld(this.input.activePointer);
      dir = { x: world.x - pos.x, y: world.y - pos.y };
    } else {
      dir = this.autoAim();
    }
    this.pending.push({ type: 'skill', id, dx: dir.x, dy: dir.y });
  }

  override update(): void {
    // Phaser smooths and clamps its own frame delta, which makes the game run
    // slow on devices with an uneven frame rate. The real clock does not.
    const now = performance.now();
    const delta = now - this.lastFrameAt;
    this.lastFrameAt = now;
    if (this.paused) return;

    this.readHeldInput(delta);

    // Rules run in fixed ticks; a long pause (hidden tab) must not turn into
    // a burst of hundreds of ticks.
    this.accumulator = Math.min(this.accumulator + delta, TICK_MS * 5);
    while (this.accumulator >= TICK_MS) {
      this.previous = { ...this.world.player.pos };
      for (const monster of this.world.monsters) {
        const sprite = this.monsterSprites.get(monster.id);
        if (sprite) sprite.previous = { ...monster.pos };
      }
      step(this.world, this.pending);
      this.pending = [];
      this.accumulator -= TICK_MS;
      this.afterTick();
    }
    // Draw between the last two ticks so movement is smooth at any frame rate.
    const alpha = this.accumulator / TICK_MS;
    const { pos } = this.world.player;
    this.placeHero({
      x: this.previous.x + (pos.x - this.previous.x) * alpha,
      y: this.previous.y + (pos.y - this.previous.y) * alpha,
    });
    this.animateHero();
    this.syncProjectiles(alpha);
    this.syncMonsters(alpha);
    this.updateTarget();
    this.syncLoot();
  }

  // ---------------------------------------------------------------- input

  /** Touch has one "button", so it walks; with a mouse the right button walks and the left attacks. */
  private isMoveOrder(pointer: Phaser.Input.Pointer): boolean {
    return pointer.wasTouch || pointer.rightButtonDown();
  }

  /**
   * Phaser also hears presses outside the canvas. A press that started on a
   * HUD button or panel belongs to the interface and must not move or attack.
   */
  private isOnGame(pointer: Phaser.Input.Pointer): boolean {
    return pointer.downElement === this.game.canvas;
  }

  private readHeldInput(delta: number): void {
    const pointer = this.input.activePointer;
    const held = pointer.isDown && this.isOnGame(pointer);
    if (held && this.isMoveOrder(pointer)) {
      // Holding the right button or a finger keeps the hero walking towards it.
      if (!this.hasDirectionKeys()) {
        this.holdTimer += delta;
        if (this.holdTimer >= HOLD_REPEAT_MS) {
          this.holdTimer = 0;
          this.orderMoveTo(pointer);
        }
      }
    } else if (held && pointer.leftButtonDown() && this.world.player.attackCooldown === 0) {
      this.orderAttackAt(pointer);
    }
    if (this.heldKeys.has(ATTACK_KEY) && this.world.player.attackCooldown === 0 && !this.peaceful) {
      this.orderAutoAttack();
    }
  }

  private hasDirectionKeys(): boolean {
    for (const code of this.heldKeys) if (code in KEY_DIRECTIONS) return true;
    return false;
  }

  private pointerInWorld(pointer: Phaser.Input.Pointer): { screen: Point; world: Point } {
    // The pointer's stored world position goes stale while the camera moves.
    const at = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    return { screen: { x: at.x, y: at.y }, world: screenToWorld(at.x, at.y) };
  }

  private orderMoveTo(pointer: Phaser.Input.Pointer): void {
    const { screen, world } = this.pointerInWorld(pointer);
    if (!isAlive(this.world) || !isWalkable(this.world.map, Math.round(world.x), Math.round(world.y))) return;
    this.pending.push({ type: 'moveTo', x: world.x, y: world.y });
    this.marker.setPosition(screen.x, screen.y).setVisible(true);
  }

  private orderAttackAt(pointer: Phaser.Input.Pointer): void {
    if (this.peaceful) return;
    const { world } = this.pointerInWorld(pointer);
    const { pos } = this.world.player;
    this.pending.push({ type: 'attack', dx: world.x - pos.x, dy: world.y - pos.y });
  }

  /** Without a cursor (keyboard) the hero strikes at the nearest monster, or straight ahead. */
  private orderAutoAttack(): void {
    const dir = this.autoAim();
    this.pending.push({ type: 'attack', dx: dir.x, dy: dir.y });
  }

  private autoAim(): Point {
    const { pos, facing } = this.world.player;
    let dir = facing;
    let best = AUTO_AIM_RANGE;
    for (const monster of this.world.monsters) {
      const distance = Math.hypot(monster.pos.x - pos.x, monster.pos.y - pos.y);
      if (distance < best && distance > 0) {
        best = distance;
        dir = { x: monster.pos.x - pos.x, y: monster.pos.y - pos.y };
      }
    }
    return dir;
  }

  private sendKeyDirection(): void {
    let sx = 0;
    let sy = 0;
    for (const code of this.heldKeys) {
      const direction = KEY_DIRECTIONS[code];
      if (!direction) continue;
      sx += direction[0];
      sy += direction[1];
    }
    // "Up" means up on the screen, which is a diagonal on the isometric grid.
    const dir = screenToWorld(Math.sign(sx) * HALF_W, Math.sign(sy) * HALF_H);
    this.pending.push({ type: 'moveDir', dx: dir.x, dy: dir.y });
    if (sx !== 0 || sy !== 0) this.marker.setVisible(false);
  }

  // ------------------------------------------------------- after each tick

  private afterTick(): void {
    let checkpoint = false;
    for (const event of this.world.events) checkpoint = this.showEvent(event) || checkpoint;

    const moving = isMoving(this.world);
    if (this.wasMoving && !moving) {
      this.marker.setVisible(false);
      checkpoint = true;
    }
    this.wasMoving = moving;

    // Coins, the bag or the equipment changed: worth saving at once.
    if (this.world.player.revision !== this.savedRevision) {
      this.savedRevision = this.world.player.revision;
      checkpoint = true;
    }
    this.reportStats();
    this.events_.onTick(this.world);
    if (checkpoint) this.events_.onCheckpoint(this.world);
  }

  private reportStats(): void {
    const { hp, mp, revision } = this.world.player;
    const stats = `${hp}/${mp}/${this.world.monsters.length}/${revision}`;
    if (stats === this.lastStats) return;
    this.lastStats = stats;
    this.events_.onStats(this.world);
  }

  /** Plays the visual for one rule event. Returns true when the game should be saved. */
  private showEvent(event: GameEvent): boolean {
    switch (event.type) {
      case 'playerSwing':
        this.showSwing(event.dir, PLAYER_ATTACK_ARC, PLAYER_ATTACK_RANGE, event.charged ? CHARGE_COLOR : 0xffffff);
        this.swingBlade();
        return false;
      case 'playerShot':
        this.swingBlade();
        return false;
      case 'projectileEnded': {
        const at = tileToScreen(event.pos.x, event.pos.y);
        this.showSparks(at.x, at.y - 14, event.kind === 'bolt' ? 0xb9a0ff : 0xe8d9b0);
        return false;
      }
      case 'equipDenied':
        this.events_.onNotice(event);
        return false;
      case 'skillUsed': {
        const { effect } = SKILLS[event.id];
        if (effect.kind === 'nova') {
          this.showSwing(event.dir, Math.PI * 2, effect.radius, 0x9fe0ff);
          this.heroActs('attack', 400);
        }
        if (effect.kind === 'haste') this.showRing(0x9ff0d0);
        if (effect.kind === 'shot') this.swingBlade();
        if (effect.kind === 'strike') {
          this.showSwing(event.dir, effect.arc, effect.range, event.charged ? CHARGE_COLOR : 0xffb347);
          this.swingBlade();
        }
        return false;
      }
      case 'playerHealed':
        this.floatNumber(this.hero.x, this.hero.y - 60, event.amount, '#7fe0a0');
        this.showRing(0x7fe0a0);
        return false;
      case 'xpGained':
        this.events_.onXp(event.amount);
        return false;
      case 'levelUp':
        this.showRing(0xe8c36a);
        this.events_.onLevelUp(event.level, event.unlocked);
        return true;
      case 'skillDenied':
        this.events_.onSkillDenied(event.id, event.reason);
        return false;
      case 'itemUsed':
        return true;
      case 'bought':
      case 'sold':
        this.events_.onNotice(event);
        return true;
      case 'skillLearned':
      case 'recipeLearned':
      case 'crafted':
      case 'craftFailed':
      case 'enchanted':
      case 'enchantFailed':
      case 'crystallized':
        this.events_.onNotice(event);
        return true;
      case 'useDenied':
      case 'chargesEmpty':
      case 'tradeDenied':
      case 'learnDenied':
      case 'recipeDenied':
      case 'craftDenied':
      case 'enchantDenied':
      case 'crystallizeDenied':
        this.events_.onNotice(event);
        return false;
      case 'guardStrike': {
        const at = tileToScreen(event.pos.x, event.pos.y);
        this.floatNumber(at.x, at.y - 40, event.damage, '#cfd3dc');
        this.showGuardStrike(event.npcId, at);
        if (event.died) this.showPuff(at.x, at.y - 10);
        return false;
      }
      case 'monsterHit': {
        const at = tileToScreen(event.pos.x, event.pos.y);
        this.floatNumber(at.x, at.y - (event.crit ? 52 : 40), event.damage, event.crit ? '#ff9a3c' : '#ffe9a8', event.crit);
        if (event.crit) this.cameras.main.shake(60, 0.0025);
        const sprite = this.monsterSprites.get(event.id);
        if (sprite) this.flash(sprite.container);
        if (event.died && sprite?.sprite) this.showFallen(sprite, at);
        this.showSparks(at.x, at.y - 16, 0xfff0c0);
        this.targetId = event.id;
        this.targetUntil = performance.now() + TARGET_MEMORY_MS;
        if (event.died) this.showPuff(at.x, at.y - 10);
        return event.died;
      }
      case 'monsterWindup':
        return false; // Drawn every frame from the monster's state.
      case 'playerHit':
        this.floatNumber(this.hero.x, this.hero.y - 60, event.damage, '#ff7a6b');
        this.flash(this.hero);
        this.heroActs('hit', 250);
        this.showSparks(this.hero.x, this.hero.y - 24, 0xff7a6b);
        this.cameras.main.shake(90, 0.004);
        return false;
      case 'playerDied':
        this.marker.setVisible(false);
        this.heroAction = { animation: 'death', until: Infinity };
        // The fallen sprite lies on the ground; a figure drawn from shapes is faded instead.
        if (!this.heroSprite) this.hero.setAlpha(0.35);
        this.events_.onDeath(this.world, event.xpLost);
        return true;
      case 'playerRespawned':
        this.events_.onRespawn();
        return false; // Saved by whoever handles the respawn.
      case 'travel':
        this.events_.onTravel(event.to);
        return false;
      case 'lootDropped':
        return false; // Drawn every frame from the world's loot list.
      case 'itemPicked':
        this.events_.onPickup(event.itemId, event.count, event.quality ?? null);
        return true;
      case 'inventoryFull':
        this.events_.onInventoryFull();
        return false;
    }
  }

  // --------------------------------------------------------------- effects

  /** A fading shape on the floor showing where a blow lands. `arc` is its full width in radians. */
  private showSwing(dir: Point, arc: number, range: number, color: number): void {
    const { pos } = this.world.player;
    const centre = tileToScreen(pos.x, pos.y);
    const angle = Math.atan2(dir.y, dir.x);
    const full = arc >= Math.PI * 2;
    const points: Point[] = full ? [] : [{ x: 0, y: 0 }];
    const segments = full ? 28 : 10;
    for (let i = 0; i <= segments; i++) {
      const a = angle - arc / 2 + (arc * i) / segments;
      const edge = tileToScreen(pos.x + Math.cos(a) * range, pos.y + Math.sin(a) * range);
      points.push({ x: edge.x - centre.x, y: edge.y - centre.y });
    }
    const shape = this.add.graphics({ x: centre.x, y: centre.y }).setDepth(-400);
    shape.fillStyle(color, 0.4).fillPoints(points, true);
    this.tweens.add({ targets: shape, alpha: 0, duration: 220, onComplete: () => shape.destroy() });
  }

  /** A ring that grows out from the hero: healing, a new level. */
  private showRing(color: number): void {
    const ring = this.add.graphics({ x: this.hero.x, y: this.hero.y }).setDepth(-300);
    ring.lineStyle(4, color, 0.9).strokeEllipse(0, 0, 40, 20);
    this.tweens.add({ targets: ring, scale: 3, alpha: 0, duration: 500, ease: 'Quad.easeOut', onComplete: () => ring.destroy() });
  }

  private floatNumber(x: number, y: number, value: number, color: string, big = false): void {
    const text = this.add
      .text(x, y, this.events_.formatNumber(value), {
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        fontSize: big ? '26px' : '18px',
        fontStyle: 'bold',
        color,
        stroke: '#12141a',
        strokeThickness: 4,
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(EFFECT_DEPTH);
    this.tweens.add({ targets: text, y: y - 34, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: () => text.destroy() });
  }

  private flash(target: Phaser.GameObjects.Container): void {
    const restore = target.alpha;
    target.setAlpha(0.4);
    this.time.delayedCall(70, () => target.active && target.setAlpha(restore));
  }

  private showPuff(x: number, y: number): void {
    const puff = this.add.graphics({ x, y }).setDepth(EFFECT_DEPTH);
    puff.fillStyle(0xc9b8a8, 0.8).fillCircle(0, 0, 14);
    this.tweens.add({ targets: puff, scale: 2.2, alpha: 0, duration: 320, onComplete: () => puff.destroy() });
  }

  // --------------------------------------------------------------- drawing

  private fitCamera(): void {
    const { width, height } = this.scale;
    // Sizes here are in screen pixels; the canvas itself is RENDER_SCALE times larger.
    const zoom = Phaser.Math.Clamp(Math.min(width, height) / RENDER_SCALE / 600, 0.75, 1.5);
    this.cameras.main.setZoom(zoom * RENDER_SCALE);
  }

  private placeHero(pos: Point): void {
    const at = tileToScreen(pos.x, pos.y);
    this.hero.setPosition(at.x, at.y);
    // Objects further down the screen are drawn on top; walls use the same x + y scale.
    this.hero.setDepth(pos.x + pos.y);
  }

  private createHero(): Phaser.GameObjects.Container {
    const shadow = this.add.graphics();
    drawShadow(shadow, 30);
    this.heroBody = this.add.graphics();
    this.weapon = this.add.graphics({ x: 0, y: -20 });
    this.heroFigure = this.add.container(0, 0, [this.heroBody, this.weapon]);
    return this.add.container(0, 0, [shadow, this.heroFigure]);
  }

  /** Starts the quick turn of the blade that accompanies a blow. */
  private swingBlade(): void {
    this.heroActs('attack', 400);
    this.swing = 1.6;
    this.tweens.add({
      targets: this,
      swing: -0.9,
      duration: 110,
      ease: 'Quad.easeOut',
      onComplete: () => this.tweens.add({ targets: this, swing: 0, duration: 140 }),
    });
  }

  /** Starts a one-off animation of the hero's sprite; a blow or dying is not cut short by a flinch. */
  private heroActs(animation: AnimationName, ms: number): void {
    const busy = this.heroAction !== null && performance.now() < this.heroAction.until;
    if (animation === 'hit' && busy) return;
    this.heroAction = { animation, until: performance.now() + ms };
  }

  /** Shows the hero: an animated sprite of the class when there is one, otherwise a figure drawn from shapes. */
  private animateHero(): void {
    const { player } = this.world;
    const { facing, chargesOn, equipment, race, cls } = player;
    const sheet = HERO_SHEET[cls];
    if (hasSheet(this, sheet)) {
      if (sheet !== this.heroSheet) {
        this.heroSprite?.destroy();
        this.heroSprite = createCharacter(this, sheet);
        this.heroFigure.add(this.heroSprite);
        this.heroSheet = sheet;
        this.heroBody.clear();
        this.weapon.clear();
      }
      const sprite = this.heroSprite as Phaser.GameObjects.Sprite;
      if (this.heroAction && this.heroAction.animation !== 'death' && performance.now() >= this.heroAction.until) this.heroAction = null;
      const animation: AnimationName = !isAlive(this.world) ? 'death' : this.heroAction ? this.heroAction.animation : isMoving(this.world) ? 'run' : 'idle';
      playCharacter(this, sprite, sheet, animation, directionOf(facing.x, facing.y));
      // A charged weapon gives the hero a cold glow.
      if (chargesOn) sprite.setTint(0xd8f6ff);
      else sprite.clearTint();
      return;
    }

    const look = `${race}/${cls}/${equipment.weapon}/${equipment.helmet}/${equipment.armor}/${equipment.boots}/${chargesOn}`;
    if (look !== this.shownLook) {
      this.shownLook = look;
      // Worn pieces are painted in the colour of their material: leather brown, graded steel blue-grey.
      const colour = (itemId: ItemId | null): number | null => {
        if (!itemId) return null;
        const def = ITEMS[itemId];
        return def.kind === 'equipment' && def.grade === 'd' ? 0x8fa8c8 : 0x9a6a3a;
      };
      drawHeroFigure(this.heroBody, { race, cls, armor: colour(equipment.armor), helmet: colour(equipment.helmet), boots: colour(equipment.boots) });
      const weapon = equipment.weapon ? ITEMS[equipment.weapon] : null;
      const steel = weapon && weapon.kind === 'equipment' && weapon.grade === 'd' ? 0x9fc4f2 : equipment.weapon === 'ironSword' ? 0xd9dde6 : 0xb98d57;
      drawWeapon(this.weapon, weaponInHand(player), steel, chargesOn);
    }
    const tip = tileToScreen(facing.x, facing.y);
    this.weapon.setRotation(Math.atan2(tip.y, tip.x) + this.swing);
    const walking = isMoving(this.world) && isAlive(this.world);
    this.heroFigure.y = walking ? -Math.abs(Math.sin(performance.now() / 95)) * 2.2 : 0;
  }

  /**
   * The target is the monster under the cursor, or else the one the hero hit
   * last. It gets a red ring on the ground and its name and health are
   * reported for the target frame.
   */
  private updateTarget(): void {
    const { monsters } = this.world;
    let target: Monster | null = null;
    const pointer = this.input.activePointer;
    if (!pointer.wasTouch && this.isOverGame(pointer)) {
      const cursor = this.pointerInWorld(pointer).world;
      let best = 0.9;
      for (const monster of monsters) {
        const distance = Math.hypot(monster.pos.x - cursor.x, monster.pos.y - cursor.y);
        if (distance < best) {
          best = distance;
          target = monster;
        }
      }
    }
    if (!target && this.targetId !== null && performance.now() < this.targetUntil) {
      target = monsters.find((monster) => monster.id === this.targetId) ?? null;
    }
    const sprite = target ? this.monsterSprites.get(target.id) : undefined;
    this.targetRing.setVisible(sprite !== undefined);
    if (sprite) this.targetRing.setPosition(sprite.container.x, sprite.container.y);

    const shown = target ? `${target.id}/${target.hp}` : '';
    if (shown === this.shownTarget) return;
    this.shownTarget = shown;
    this.events_.onTarget(target);
  }

  /** True when the cursor is over the game itself and not over a window or button of the interface. */
  private isOverGame(pointer: Phaser.Input.Pointer): boolean {
    const event = pointer.event as MouseEvent | undefined;
    return event?.target === this.game.canvas;
  }

  /** A monster with a sprite sheet falls where it stood, lies for a moment and fades away. */
  private showFallen(from: MonsterSprite, at: Point): void {
    const sheet = from.sprite?.texture.key;
    if (!sheet) return;
    const body = createCharacter(this, sheet).setPosition(at.x, at.y).setDepth(from.container.depth);
    playCharacter(this, body, sheet, 'death', from.direction);
    this.tweens.add({ targets: body, alpha: 0, delay: 900, duration: 500, onComplete: () => body.destroy() });
  }

  /** A few bright specks flying out from a blow. */
  private showSparks(x: number, y: number, color: number): void {
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.8; // Cosmetic only; not a game rule.
      const speck = this.add.rectangle(x, y, 3, 3, color).setDepth(EFFECT_DEPTH);
      this.tweens.add({
        targets: speck,
        x: x + Math.cos(angle) * 22,
        y: y + Math.sin(angle) * 14 - 6,
        alpha: 0,
        duration: 260,
        ease: 'Quad.easeOut',
        onComplete: () => speck.destroy(),
      });
    }
  }

  private createMonsterSprite(monster: Monster): MonsterSprite {
    const body = this.add.graphics();
    const bar = this.add.graphics();
    const sheet = MONSTER_SHEET[monster.kind];
    const sprite = hasSheet(this, sheet) ? createCharacter(this, sheet) : null;
    const figure = this.add.container(0, 0, sprite ? [body, sprite] : [body]);
    const container = this.add.container(0, 0, [figure, bar]);
    // An elder is plainly bigger than its kin.
    if (monster.elder) figure.setScale(ELDER_SCALE);
    return { container, figure, body, sprite, direction: 1, bar, previous: { ...monster.pos }, lastHp: -1 };
  }

  private drawMonsterBody(sprite: MonsterSprite, kind: Monster['kind'], windingUp: boolean): void {
    const g = sprite.body;
    g.clear();
    // The warning before a blow: the monster turns bright and a ring appears under it.
    if (windingUp) g.lineStyle(2.5, 0xffb347, 1).strokeEllipse(0, 0, 44, 22);
    if (sprite.sprite) {
      // An animated monster keeps its picture; only a shadow and the warning ring are drawn under it.
      drawShadow(g, 30);
      if (windingUp) sprite.sprite.setTint(0xffb080);
      else sprite.sprite.clearTint();
      return;
    }
    drawMonsterFigure(g, kind, windingUp);
  }

  private syncMonsters(alpha: number): void {
    const alive = new Set<number>();
    for (const monster of this.world.monsters) {
      alive.add(monster.id);
      let sprite = this.monsterSprites.get(monster.id);
      if (!sprite) {
        sprite = this.createMonsterSprite(monster);
        this.monsterSprites.set(monster.id, sprite);
      }
      const x = sprite.previous.x + (monster.pos.x - sprite.previous.x) * alpha;
      const y = sprite.previous.y + (monster.pos.y - sprite.previous.y) * alpha;
      const at = tileToScreen(x, y);
      // Monsters are drawn facing right; mirror them when they move or look the other way on the screen.
      const stepping = Math.hypot(monster.pos.x - sprite.previous.x, monster.pos.y - sprite.previous.y) > 0.001;
      const sheet = MONSTER_SHEET[monster.kind];
      if (sprite.sprite && sheet) {
        // It looks at the hero while hunting, otherwise where it walks.
        const look = monster.aggro
          ? { x: this.world.player.pos.x - x, y: this.world.player.pos.y - y }
          : { x: monster.pos.x - sprite.previous.x, y: monster.pos.y - sprite.previous.y };
        if (Math.hypot(look.x, look.y) > 0.001) sprite.direction = directionOf(look.x, look.y);
        playCharacter(this, sprite.sprite, sheet, monster.windup > 0 ? 'attack' : stepping ? 'run' : 'idle', sprite.direction);
      } else {
        const heading = monster.aggro ? tileToScreen(this.world.player.pos.x - x, this.world.player.pos.y - y).x : at.x - sprite.container.x;
        const size = monster.elder ? ELDER_SCALE : 1;
        if (Math.abs(heading) > 0.3) sprite.figure.setScale(heading < 0 ? -size : size, size);
        sprite.figure.y = stepping ? -Math.abs(Math.sin(performance.now() / 90 + monster.id)) * 2 : 0;
      }
      sprite.container.setPosition(at.x, at.y).setDepth(x + y);

      const windingUp = monster.windup > 0;
      const key = monster.hp * 2 + (windingUp ? 1 : 0);
      if (key !== sprite.lastHp) {
        sprite.lastHp = key;
        this.drawMonsterBody(sprite, monster.kind, windingUp);
        // An elder's golden tint and ring mark it from afar.
        if (monster.elder) {
          sprite.body.lineStyle(2, 0xe8c36a, 0.9).strokeEllipse(0, 0, 52, 26);
          if (!windingUp) sprite.sprite?.setTint(0xffd98a);
        }
        sprite.bar.clear();
        const top = monster.elder ? -48 * ELDER_SCALE : -48;
        if (monster.hp < monster.maxHp || monster.elder) {
          const half = monster.elder ? 22 : 15;
          sprite.bar.fillStyle(0x000000, 0.9).fillRect(-half, top, half * 2, 5);
          sprite.bar.fillStyle(monster.elder ? 0xe8a23a : 0xd0463f).fillRect(-half + 1, top + 1, (half * 2 - 2) * (monster.hp / monster.maxHp), 3);
        }
      }
    }
    for (const [id, sprite] of this.monsterSprites) {
      if (alive.has(id)) continue;
      sprite.container.destroy();
      this.monsterSprites.delete(id);
    }
  }

  /** A glowing patch between two posts: a way out of the zone. */
  private drawExit(pos: Point, color: number): Phaser.GameObjects.Graphics {
    const at = tileToScreen(pos.x, pos.y);
    const g = this.add.graphics({ x: at.x, y: at.y }).setDepth(pos.x + pos.y - 0.4);
    g.fillStyle(color, 0.3).fillEllipse(0, 0, 56, 28);
    g.lineStyle(3, color, 0.9).strokeEllipse(0, 0, 56, 28);
    g.fillStyle(0x3a3530).fillRect(-30, -40, 7, 42).fillRect(23, -40, 7, 42);
    g.fillStyle(color).fillCircle(-26.5, -44, 5).fillCircle(26.5, -44, 5);
    return g;
  }

  private drawNpc(npc: Npc): Phaser.GameObjects.GameObject {
    const at = tileToScreen(npc.pos.x, npc.pos.y);
    const depth = npc.pos.x + npc.pos.y;
    const sheet = NPC_SHEET[npc.kind];
    if (!hasSheet(this, sheet)) {
      const g = this.add.graphics({ x: at.x, y: at.y }).setDepth(depth);
      drawNpcFigure(g, npc.kind);
      return g;
    }
    const shadow = this.add.graphics();
    drawShadow(shadow, 30);
    const sprite = createCharacter(this, sheet);
    playCharacter(this, sprite, sheet, 'idle', 1);
    // Each villager breathes out of step with the others.
    sprite.anims.setProgress((npc.id * 0.37) % 1);
    const parts: Phaser.GameObjects.GameObject[] = [shadow, sprite];
    if (npc.kind !== 'guard') {
      // A sign over the head marks someone worth talking to.
      const sign = this.add.graphics();
      sign.fillStyle(0x14110d).fillCircle(0, -64, 5.5);
      sign.fillStyle(NPC_LOOK[npc.kind].sign).fillCircle(0, -64, 4.2);
      parts.push(sign);
    }
    return this.add.container(at.x, at.y, parts).setDepth(depth);
  }

  /** A quick line from the guard to the monster he struck. */
  private showGuardStrike(npcId: number, target: Point): void {
    const guard = this.world.npcs.find((npc) => npc.id === npcId);
    if (!guard) return;
    const from = tileToScreen(guard.pos.x, guard.pos.y);
    const line = this.add.graphics().setDepth(EFFECT_DEPTH);
    line.lineStyle(3, 0xffffff, 0.8).lineBetween(from.x + 12, from.y - 62, target.x, target.y - 14);
    this.tweens.add({ targets: line, alpha: 0, duration: 160, onComplete: () => line.destroy() });
  }

  /** Arrows and bolts in flight, drawn a little ahead of their last known place so they move smoothly between ticks. */
  private syncProjectiles(alpha: number): void {
    const flying = new Set<number>();
    for (const missile of this.world.projectiles) {
      flying.add(missile.id);
      let sprite = this.projectileSprites.get(missile.id);
      if (!sprite) {
        sprite = this.add.graphics();
        const tip = tileToScreen(missile.dir.x, missile.dir.y);
        const length = Math.hypot(tip.x, tip.y) || 1;
        const ux = tip.x / length;
        const uy = tip.y / length;
        if (missile.kind === 'arrow') {
          sprite.lineStyle(3.5, 0x14110d, 1).lineBetween(-ux * 12, -uy * 12, ux * 8, uy * 8);
          sprite.lineStyle(2, missile.charged ? CHARGE_COLOR : 0xe8d9b0, 1).lineBetween(-ux * 12, -uy * 12, ux * 8, uy * 8);
          sprite.fillStyle(0xcfd3dc).fillCircle(ux * 9, uy * 9, 2.2);
        } else {
          const colour = missile.splash > 0 ? 0xff8a3d : missile.charged ? CHARGE_COLOR : 0xb9a0ff;
          sprite.fillStyle(colour, 0.3).fillCircle(0, 0, 10);
          sprite.fillStyle(colour).fillCircle(0, 0, 5.5);
          sprite.fillStyle(0xffffff, 0.9).fillCircle(-1, -1, 2.2);
          sprite.fillStyle(colour, 0.5).fillCircle(-ux * 8, -uy * 8, 3.5);
        }
        this.projectileSprites.set(missile.id, sprite);
      }
      const ahead = (missile.speed * TICK_MS * alpha) / 1000;
      const x = missile.pos.x + missile.dir.x * ahead;
      const y = missile.pos.y + missile.dir.y * ahead;
      const at = tileToScreen(x, y);
      // Missiles fly at chest height.
      sprite.setPosition(at.x, at.y - 20).setDepth(x + y + 0.1);
    }
    for (const [id, sprite] of this.projectileSprites) {
      if (flying.has(id)) continue;
      sprite.destroy();
      this.projectileSprites.delete(id);
    }
  }

  private createLootSprite(loot: GroundLoot): Phaser.GameObjects.Graphics {
    const at = tileToScreen(loot.pos.x, loot.pos.y);
    const g = this.add.graphics({ x: at.x, y: at.y }).setDepth(loot.pos.x + loot.pos.y - 0.2);
    const def = ITEMS[loot.itemId];
    g.fillStyle(0x000000, 0.3).fillEllipse(0, 2, 20, 9);
    if (def.kind === 'currency') {
      g.fillStyle(0xb8862b).fillEllipse(0, 0, 16, 8);
      g.fillStyle(0xf2c94c).fillEllipse(0, -3, 16, 8);
    } else if (def.kind === 'material') {
      g.fillStyle(0x8a6a45).fillRoundedRect(-7, -12, 14, 13, 4);
      g.fillStyle(0x5f4830).fillRect(-4, -14, 8, 3);
    } else if (def.kind === 'recipe') {
      g.fillStyle(0xefe6cf).fillRect(-6, -15, 12, 15);
      g.lineStyle(1, 0x3f6fb0, 1).lineBetween(-3, -10, 3, -10).lineBetween(-3, -6, 3, -6);
    } else if (def.kind === 'scroll') {
      g.fillStyle(0xe8dcc0).fillRoundedRect(-7, -14, 14, 14, 2);
      g.fillStyle(def.grade === 'd' ? 0x5fa8ff : 0xb89f73).fillRect(-8, -15, 16, 3).fillRect(-8, -2, 16, 3);
    } else if (def.kind === 'consumable') {
      // A small flask: red for health, blue for mana, pale for charges.
      const color = def.effect.kind === 'heal' ? 0xd9534f : def.effect.kind === 'mana' ? 0x4f8fe0 : CHARGE_COLOR;
      g.fillStyle(color).fillCircle(0, -6, 6);
      g.fillStyle(0xcfd3dc).fillRect(-2, -15, 4, 5);
    } else {
      // Equipment glows in the colour of its grade so it stands out from afar.
      const quality = loot.mods?.quality ?? 'common';
      const color = QUALITY_COLOR[quality];
      // The better the find, the wider its glow.
      g.fillStyle(color, quality === 'common' ? 0.2 : 0.35).fillCircle(0, -8, quality === 'epic' ? 20 : quality === 'rare' ? 17 : 13);
      g.fillStyle(color).fillPoints([{ x: 0, y: -18 }, { x: 7, y: -8 }, { x: 0, y: 2 }, { x: -7, y: -8 }], true);
      g.lineStyle(1.5, 0x12141a, 0.9).strokePoints([{ x: 0, y: -18 }, { x: 7, y: -8 }, { x: 0, y: 2 }, { x: -7, y: -8 }], true, true);
    }
    // A short hop makes a fresh drop noticeable.
    this.tweens.add({ targets: g, y: at.y - 10, duration: 140, yoyo: true, ease: 'Quad.easeOut' });
    return g;
  }

  private syncLoot(): void {
    const present = new Set<number>();
    for (const loot of this.world.loot) {
      present.add(loot.id);
      if (!this.lootSprites.has(loot.id)) this.lootSprites.set(loot.id, this.createLootSprite(loot));
    }
    for (const [id, sprite] of this.lootSprites) {
      if (present.has(id)) continue;
      sprite.destroy();
      this.lootSprites.delete(id);
    }
  }

  /**
   * Draws the map. The ground is baked into a few large pictures and every
   * obstacle is a small ready-made picture, because a world of thousands of
   * tiles drawn shape by shape on every frame would be far too slow.
   */
  private drawMap(): Phaser.GameObjects.GameObject[] {
    const { map, zone } = this.world;
    const objects: Phaser.GameObjects.GameObject[] = [];
    this.ensureObstacleTextures();
    for (const key of this.floorTextures) this.textures.remove(key);
    this.floorTextures = [];

    const CHUNK = 20;
    for (let cy = 0; cy < map.height; cy += CHUNK) {
      for (let cx = 0; cx < map.width; cx += CHUNK) {
        const w = Math.min(CHUNK, map.width - cx);
        const h = Math.min(CHUNK, map.height - cy);
        // The corner of the smallest screen rectangle that holds this chunk's tiles.
        const minX = (cx - (cy + h - 1)) * HALF_W - HALF_W;
        const maxX = (cx + w - 1 - cy) * HALF_W + HALF_W;
        const minY = (cx + cy) * HALF_H - HALF_H;
        const maxY = (cx + w - 1 + cy + h - 1) * HALF_H + HALF_H;
        const brush = this.make.graphics({}, false);
        for (let y = cy; y < cy + h; y++) {
          for (let x = cx; x < cx + w; x++) {
            const look = REGION_LOOK[regionAt(zone, { x, y }).id];
            const isWall = tileAt(map, x, y) === TILE_WALL;
            // Trees stand on grass, so the ground is drawn under them too.
            if (isWall && look.walls !== 'trees') continue;
            const c = tileToScreen(x, y);
            this.paintGround(brush, c.x - minX, c.y - minY, x, y, !isWall && isRoad(zone, x, y) ? ROAD_COLOR : look.floor, look.walls);
          }
        }
        const key = `floor-${cx}-${cy}`;
        brush.generateTexture(key, maxX - minX, maxY - minY);
        brush.destroy();
        this.floorTextures.push(key);
        objects.push(this.add.image(minX, minY, key).setOrigin(0).setDepth(-1000));
      }
    }

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (tileAt(map, x, y) !== TILE_WALL) continue;
        const walls = REGION_LOOK[regionAt(zone, { x, y }).id].walls;
        let key: string;
        if (walls === 'trees') key = `tree${(x * 31 + y * 17) % 3}`;
        else if (walls === 'stone') key = 'stone';
        // The outer ring of the village is the palisade; walls inside it are houses.
        else if (this.touchesAnotherRegion(x, y)) key = 'palisade';
        // A few houses show a lit window on the side that faces the square.
        else key = (x * 13 + y * 7) % 3 === 0 ? 'houseLit' : 'house';
        const c = tileToScreen(x, y);
        const origin = this.obstacleOrigins.get(key) as number;
        objects.push(this.add.image(c.x, c.y, key).setOrigin(0.5, origin).setScale(1 / TEXTURE_SCALE).setDepth(x + y));
      }
    }
    return objects;
  }

  private touchesAnotherRegion(x: number, y: number): boolean {
    const { zone } = this.world;
    const here = regionAt(zone, { x, y });
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (regionAt(zone, { x: x + dx, y: y + dy }) !== here) return true;
      }
    }
    return false;
  }

  /**
   * Paints one tile of ground: a base colour that varies a little from tile
   * to tile, and a few specks (grass blades, pebbles, cracks) so that the
   * ground does not look like a board. All variation is cosmetic and comes
   * from the tile's coordinates, not from the game's random generator.
   */
  private paintGround(g: Phaser.GameObjects.Graphics, px: number, py: number, x: number, y: number, base: readonly [number, number, number], walls: 'stone' | 'trees' | 'wood'): void {
    const hash = (n: number): number => {
      const v = Math.sin(x * 127.1 + y * 311.7 + n * 74.7) * 43758.5453;
      return v - Math.floor(v);
    };
    const shade = Math.round((hash(0) - 0.5) * 12);
    const color = Phaser.Display.Color.GetColor(base[0] + shade, base[1] + shade, base[2] + shade);
    // Slightly larger than the tile so that neighbours overlap and no seams show.
    g.fillStyle(color);
    g.fillPoints([{ x: px, y: py - HALF_H - 0.6 }, { x: px + HALF_W + 1, y: py }, { x: px, y: py + HALF_H + 0.6 }, { x: px - HALF_W - 1, y: py }], true);
    const light = Phaser.Display.Color.GetColor(Math.min(255, base[0] + 26), Math.min(255, base[1] + 26), Math.min(255, base[2] + 22));
    const dark = Phaser.Display.Color.GetColor(Math.max(0, base[0] - 22), Math.max(0, base[1] - 22), Math.max(0, base[2] - 20));
    for (let i = 1; i <= 5; i++) {
      // A point inside the diamond: start from a point in the square and fold it in.
      const u = hash(i) - 0.5;
      const v = hash(i + 10) - 0.5;
      const sx = px + (u - v) * HALF_W * 0.9;
      const sy = py + (u + v) * HALF_H * 0.9;
      const bright = hash(i + 20) > 0.5;
      g.fillStyle(bright ? light : dark, 0.55);
      if (walls === 'trees') g.fillRect(sx, sy - 2, 1.2, 3); // a blade of grass
      else if (walls === 'wood') g.fillEllipse(sx, sy, 3.5, 1.8); // a pebble on packed earth
      else g.fillRect(sx - 2.5, sy, 5, 1); // a crack in stone
    }
    if (walls === 'stone') {
      // Flagstones: a faint joint along two edges.
      g.lineStyle(1, dark, 0.5).lineBetween(px - HALF_W, py, px, py + HALF_H).lineBetween(px, py + HALF_H, px + HALF_W, py);
    }
  }

  /** Paints each kind of obstacle once into a small picture that is then reused for every tile. */
  private ensureObstacleTextures(): void {
    if (this.obstacleOrigins.size > 0) return;
    const bake = (key: string, width: number, height: number, originY: number, paint: (g: Phaser.GameObjects.Graphics) => void) => {
      const brush = this.make.graphics({}, false);
      brush.scaleCanvas(TEXTURE_SCALE, TEXTURE_SCALE);
      paint(brush);
      brush.generateTexture(key, width * TEXTURE_SCALE, height * TEXTURE_SCALE);
      brush.destroy();
      // Where the centre of the tile is inside the picture, as a share of its height.
      this.obstacleOrigins.set(key, originY / height);
    };
    const block = (key: string, height: number, paint: (g: Phaser.GameObjects.Graphics, c: Point, top: number) => void) =>
      bake(key, TILE_WIDTH, height + TILE_HEIGHT + 12, height + HALF_H + 12, (g) => paint(g, { x: HALF_W, y: height + HALF_H + 12 }, HALF_H + 12));

    block('stone', WALL_HEIGHT, (g, c) => {
      this.drawBlock(g, c, WALL_HEIGHT, 0x4f463d, 0x39312b, 0x6f6257);
      g.lineStyle(1, 0x2a2420, 0.7).lineBetween(c.x - HALF_W, c.y - 14, c.x, c.y - 14 + HALF_H).lineBetween(c.x, c.y - 10 + HALF_H, c.x + HALF_W, c.y - 10);
      g.lineStyle(1, 0x8a7c6e, 0.6).strokePoints([{ x: c.x - HALF_W, y: c.y - WALL_HEIGHT }, { x: c.x, y: c.y - WALL_HEIGHT + HALF_H }, { x: c.x + HALF_W, y: c.y - WALL_HEIGHT }], false);
    });
    block('palisade', 36, (g, c) => {
      this.drawBlock(g, c, 36, 0x6f4d2c, 0x523820, 0x86603a);
      // Stakes: vertical joints on both faces and a row of points on top.
      g.lineStyle(1, 0x2f2012, 0.8);
      for (let i = 1; i < 4; i++) {
        const dx = (HALF_W * i) / 4;
        g.lineBetween(c.x - HALF_W + dx, c.y - 36 + dx / 2, c.x - HALF_W + dx, c.y + dx / 2);
        g.lineBetween(c.x + dx, c.y - 36 + HALF_H - dx / 2, c.x + dx, c.y + HALF_H - dx / 2);
      }
      g.fillStyle(0x86603a);
      for (let i = 0; i < 4; i++) {
        const lx = c.x - HALF_W + (HALF_W * (i + 0.5)) / 4;
        const ly = c.y - 36 + ((i + 0.5) * HALF_H) / 4;
        g.fillTriangle(lx - 4, ly, lx + 4, ly + 2, lx, ly - 9);
        const rx = c.x + (HALF_W * (i + 0.5)) / 4;
        const ry = c.y - 36 + HALF_H - ((i + 0.5) * HALF_H) / 4;
        g.fillTriangle(rx - 4, ry + 2, rx + 4, ry, rx, ry - 9);
      }
    });
    for (const [key, lit] of [['house', false], ['houseLit', true]] as const) {
      block(key, 44, (g, c) => {
        // Plastered walls with dark timbers under a tiled roof.
        this.drawBlock(g, c, 44, 0xb9a887, 0x94836a, 0x9c4636);
        g.lineStyle(2, 0x4a3524, 0.9);
        g.lineBetween(c.x - HALF_W, c.y - 44, c.x - HALF_W, c.y).lineBetween(c.x, c.y - 44 + HALF_H, c.x, c.y + HALF_H).lineBetween(c.x + HALF_W, c.y - 44, c.x + HALF_W, c.y);
        g.lineBetween(c.x - HALF_W, c.y - 22, c.x, c.y - 22 + HALF_H).lineBetween(c.x, c.y - 22 + HALF_H, c.x + HALF_W, c.y - 22);
        // Rows of tiles on the roof.
        g.lineStyle(1, 0x6e2d22, 0.8);
        for (let i = 1; i < 4; i++) {
          const k = i / 4;
          g.lineBetween(c.x - HALF_W + HALF_W * k, c.y - 44 - HALF_H * k, c.x + HALF_W * k, c.y - 44 + HALF_H - HALF_H * k);
        }
        if (lit) {
          // A window with a warm light on the left wall.
          g.fillStyle(0x2a1d12).fillPoints([{ x: c.x - 24, y: c.y - 20 }, { x: c.x - 10, y: c.y - 13 }, { x: c.x - 10, y: c.y - 1 }, { x: c.x - 24, y: c.y - 8 }], true);
          g.fillStyle(0xf2c66a).fillPoints([{ x: c.x - 22, y: c.y - 17 }, { x: c.x - 12, y: c.y - 12 }, { x: c.x - 12, y: c.y - 3 }, { x: c.x - 22, y: c.y - 8 }], true);
        }
      });
    }
    for (let variant = 0; variant < 3; variant++) {
      bake(`tree${variant}`, 76, 96, 84, (g) => this.drawTree(g, { x: 38, y: 84 }, variant));
    }
  }

  /** A box standing on a tile: left face, right face and top, each in its own colour. */
  private drawBlock(g: Phaser.GameObjects.Graphics, c: Point, height: number, left: number, right: number, top: number): void {
    const t = c.y - height;
    g.fillStyle(left);
    g.fillPoints([{ x: c.x - HALF_W, y: t }, { x: c.x, y: t + HALF_H }, { x: c.x, y: c.y + HALF_H }, { x: c.x - HALF_W, y: c.y }], true);
    g.fillStyle(right);
    g.fillPoints([{ x: c.x, y: t + HALF_H }, { x: c.x + HALF_W, y: t }, { x: c.x + HALF_W, y: c.y }, { x: c.x, y: c.y + HALF_H }], true);
    g.fillStyle(top);
    g.fillPoints([{ x: c.x, y: t - HALF_H }, { x: c.x + HALF_W, y: t }, { x: c.x, y: t + HALF_H }, { x: c.x - HALF_W, y: t }], true);
  }

  /** A tree with a layered crown. `variant` (0-2) changes its size and tint so a forest does not look stamped. */
  private drawTree(g: Phaser.GameObjects.Graphics, c: Point, variant: number): void {
    const size = 17 + variant * 3;
    const greens = [[0x24512e, 0x2f6b3a, 0x448a4c, 0x63a862], [0x29582f, 0x357a41, 0x4c9a54, 0x70b56b], [0x1f4a2b, 0x2a5f34, 0x3d7f47, 0x599c5c]][variant] as number[];
    g.fillStyle(0x000000, 0.28).fillEllipse(c.x + 4, c.y + 1, 46, 19);
    // trunk
    g.fillStyle(0x4a3220).fillRect(c.x - 4, c.y - 26, 8, 26);
    g.fillStyle(0x6b4a2c).fillRect(c.x - 4, c.y - 26, 3, 26);
    g.lineStyle(1.5, 0x14110d, 0.9).strokeRect(c.x - 4, c.y - 26, 8, 26);
    // crown: a dark underside, then lighter clumps towards the top left, where the light comes from
    const top = c.y - 30 - size;
    g.fillStyle(0x14110d, 0.9).fillCircle(c.x, top + 4, size + 2.5).fillCircle(c.x - size * 0.7, top + 12, size * 0.75 + 2).fillCircle(c.x + size * 0.7, top + 12, size * 0.75 + 2);
    g.fillStyle(greens[0] as number).fillCircle(c.x, top + 4, size + 1).fillCircle(c.x - size * 0.7, top + 12, size * 0.75).fillCircle(c.x + size * 0.7, top + 12, size * 0.75);
    g.fillStyle(greens[1] as number).fillCircle(c.x - 2, top + 1, size * 0.9).fillCircle(c.x - size * 0.7, top + 9, size * 0.6);
    g.fillStyle(greens[2] as number).fillCircle(c.x - 5, top - 3, size * 0.62).fillCircle(c.x + size * 0.45, top + 5, size * 0.4);
    g.fillStyle(greens[3] as number, 0.9).fillCircle(c.x - 8, top - 6, size * 0.3);
  }
}
