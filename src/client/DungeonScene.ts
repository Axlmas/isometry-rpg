import Phaser from 'phaser';
import {
  type Command, type GameEvent, type GroundLoot, type ItemId, type Monster, type Npc, type Point, type Quality, type SkillId, type World, type ZoneKind,
  ITEMS, isUnique, PLAYER_ATTACK_ARC, SKILLS, classSkills, weaponInHand, PLAYER_ATTACK_RANGE, TICK_MS, TILE_FLOOR, TILE_ROCK, TILE_RUIN, TILE_WATER, fractal2,
  isAlive, isMoving, isRoad, isWalkable, regionAt, step, tileAt,
} from '../sim';
import { TILE_HEIGHT, TILE_WIDTH, screenToWorld, tileToScreen } from './iso';
import { QUALITY_COLOR } from './itemText';
import { sound, unlockSound } from './sound';
import { WATER_COLOR } from './zoneText';
import { QUICK_KEYS } from './hotbar';
import { NPC_LOOK } from './npcText';
import { type AnimationName, MONSTER_SHEET, NPC_SHEET, createAnimations, createCharacter, directionOf, hasAnimation, hasSheet, heroLook, heroSheet, playCharacter, preloadSheets } from './sheets';
import { SKILL_SLOTS } from './skillText';
import { drawHeroFigure, drawMonsterFigure, drawNpcFigure, drawShadow, drawWeapon } from './sprites';
import { EXIT_COLOR, REGION_LOOK, ROAD_COLOR } from './zoneText';

const WALL_HEIGHT = 30;
/** Houses stand taller than the people who live in them. */
const HOUSE_HEIGHT = 78;
const HALF_W = TILE_WIDTH / 2;
const HALF_H = TILE_HEIGHT / 2;
/** While the pointer is held down, the destination follows it at this interval. */
const HOLD_REPEAT_MS = 120;
/** Keyboard attacks aim at the nearest monster within this distance. */
const AUTO_AIM_RANGE = PLAYER_ATTACK_RANGE + 1;
const EFFECT_DEPTH = 100000;
/** How much bigger an elder monster is drawn. */
const ELDER_SCALE = 1.35;
/** Some kinds are the same beast, younger or heavier. */
const KIND_SCALE: Partial<Record<Monster['kind'], number>> = { wolfPup: 0.72, tusker: 1.22 };
const monsterScale = (monster: Monster): number => (KIND_SCALE[monster.kind] ?? 1) * (monster.elder ? ELDER_SCALE : 1);
/** Screens with more pixels per inch get a larger canvas, so the picture stays sharp. Capped to keep it fast. */
export const RENDER_SCALE = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
/** Obstacle pictures are painted this many times larger than shown, so they stay sharp when the camera zooms in. */
const TEXTURE_SCALE = 2;
/** How long a monster stays the target after the hero's last hit on it. */
const TARGET_MEMORY_MS = 5000;
/** Colour of a blow strengthened by a weapon charge, and of the blade while charges are on. */
const CHARGE_COLOR = 0x7fe9ff;
const SHORE_COLOR: readonly [number, number, number] = [116, 108, 82];

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
  /** The words for a run of kills, like "Streak 4: +9% experience". */
  streakText(streak: number): string;
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
  /** What bleeds out of it when it is hit. */
  blood: number;
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
  /** The monster the hero has been told to keep fighting: he walks up to it and strikes until one of them falls. */
  private lockedId: number | null = null;
  private lockTimer = 0;
  private enchantGlow: Phaser.GameObjects.Graphics | null = null;
  private shownEnchant = -1;
  private targetUntil = 0;
  private shownTarget = '';
  private marker!: Phaser.GameObjects.Graphics;
  /** Figures in the middle of a hit flash, with the alpha they should return to. */
  private readonly flashing = new Map<Phaser.GameObjects.Container, number>();

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
      unlockSound();
      if (this.paused || !this.isOnGame(pointer)) return;
      this.holdTimer = 0;
      if (this.isMoveOrder(pointer)) {
        this.lockedId = null;
        this.orderMoveTo(pointer);
        return;
      }
      // A click on a monster picks it as the target: the hero goes after it and keeps striking by himself.
      const picked = this.monsterUnder(pointer);
      this.lockedId = picked?.id ?? null;
      if (!picked) this.orderAttackAt(pointer);
    });

    // Listening on the window keeps controls working even when a HUD button has focus.
    const onKeyDown = (event: KeyboardEvent) => {
      unlockSound();
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

    // A soft darkening towards the edges of the screen and a slightly cool cast pull the picture together.
    const holder = this.game.canvas.parentElement;
    if (holder && !holder.querySelector('.vignette')) {
      const shade = document.createElement('div');
      shade.className = 'vignette';
      shade.setAttribute('aria-hidden', 'true');
      shade.style.cssText =
        'position:absolute;inset:0;pointer-events:none;' +
        'background:radial-gradient(ellipse at 50% 46%, rgba(0,0,0,0) 42%, rgba(4,6,10,0.34) 78%, rgba(2,3,6,0.62) 100%),linear-gradient(rgba(20,28,44,0.10), rgba(34,24,12,0.10));';
      holder.append(shade);
    }
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
    this.lockedId = null;
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
    this.hero.setAlpha(isAlive(world) || hasSheet(this, heroSheet(world.player.cls, 0)) ? 1 : 0.35);
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
    } else if (held && pointer.leftButtonDown() && this.lockedId === null && this.world.player.attackCooldown === 0) {
      this.orderAttackAt(pointer);
    }
    // Space picks the nearest monster as the target, like a click on it would.
    if (this.heldKeys.has(ATTACK_KEY) && !this.peaceful && this.lockedMonster() === null) {
      const nearest = this.nearestMonster(AUTO_AIM_RANGE + 6);
      if (nearest) this.lockedId = nearest.id;
      else if (this.world.player.attackCooldown === 0) this.orderAutoAttack();
    }
    // Taking the hero by the reins (walking keys) calls the fight off.
    if (this.hasDirectionKeys()) this.lockedId = null;
    this.fightLocked(delta);
  }

  private lockedMonster(): Monster | null {
    if (this.lockedId === null) return null;
    return this.world.monsters.find((monster) => monster.id === this.lockedId) ?? null;
  }

  private nearestMonster(within: number, hostileOnly = false): Monster | null {
    const { pos } = this.world.player;
    let best: Monster | null = null;
    let bestDistance = within;
    for (const monster of this.world.monsters) {
      if (hostileOnly && !monster.aggro) continue;
      const distance = Math.hypot(monster.pos.x - pos.x, monster.pos.y - pos.y);
      if (distance < bestDistance) {
        best = monster;
        bestDistance = distance;
      }
    }
    return best;
  }

  private monsterUnder(pointer: Phaser.Input.Pointer): Monster | null {
    const cursor = this.pointerInWorld(pointer).world;
    let best: Monster | null = null;
    let bestDistance = 0.9;
    for (const monster of this.world.monsters) {
      // The picture stands above the tile, so the middle of the body is a little "up" from its feet.
      const distance = Math.min(
        Math.hypot(monster.pos.x - cursor.x, monster.pos.y - cursor.y),
        Math.hypot(monster.pos.x - 0.45 - cursor.x, monster.pos.y - 0.45 - cursor.y),
      );
      if (distance < bestDistance) {
        best = monster;
        bestDistance = distance;
      }
    }
    return best;
  }

  /**
   * Keeps fighting the picked monster: walks into reach, strikes whenever the
   * weapon is ready, and when the monster falls turns to whoever else is
   * attacking. This is only a hand on the same controls a player has.
   */
  private fightLocked(delta: number): void {
    const { player } = this.world;
    if (this.lockedId === null) return;
    if (!isAlive(this.world) || this.peaceful) {
      this.lockedId = null;
      return;
    }
    let target = this.lockedMonster();
    if (!target) {
      // The target is dead or gone: defend against the next attacker, if there is one.
      target = this.nearestMonster(8, true);
      this.lockedId = target?.id ?? null;
      if (!target) return;
    }
    const dx = target.pos.x - player.pos.x;
    const dy = target.pos.y - player.pos.y;
    const distance = Math.hypot(dx, dy);
    const held = weaponInHand(player);
    const reach = held === 'bow' ? 6.5 : held === 'staff' ? 5.5 : PLAYER_ATTACK_RANGE + 0.15;
    this.lockTimer += delta;
    if (distance <= reach) {
      // Stand and strike.
      if (isMoving(this.world)) this.pending.push({ type: 'moveTo', x: player.pos.x, y: player.pos.y });
      if (player.attackCooldown === 0 && player.pendingAttack === null) this.pending.push({ type: 'attack', dx, dy });
    } else if (this.lockTimer >= 200) {
      this.lockTimer = 0;
      this.pending.push({ type: 'moveTo', x: target.pos.x, y: target.pos.y });
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
        sound.swing();
        if (event.charged) this.showChargeBurst(event.dir);
        return false;
      case 'playerShot':
        this.swingBlade();
        sound.shot(this.world.player.cls === 'mage');
        if (event.charged) this.showChargeBurst(event.dir);
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
        if (this.world.player.streak >= 2) this.floatText(this.hero.x, this.hero.y - 86, this.events_.streakText(this.world.player.streak), '#e8c36a');
        return false;
      case 'levelUp':
        sound.levelUp();
        this.showRing(0xe8c36a);
        this.events_.onLevelUp(event.level, event.unlocked);
        return true;
      case 'skillDenied':
        this.events_.onSkillDenied(event.id, event.reason);
        return false;
      case 'itemUsed':
        sound.potion();
        return true;
      case 'bought':
      case 'sold':
        this.events_.onNotice(event);
        return true;
      case 'masteryUp':
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
        this.showBlood(at, sprite?.blood ?? 0x9c1f1a, event.crit || event.died);
        sound.hit(event.crit);
        if (event.died) sound.kill();
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
        sound.hurt();
        this.showBlood({ x: this.hero.x, y: this.hero.y }, 0x9c1f1a, false);
        this.floatNumber(this.hero.x, this.hero.y - 60, event.damage, '#ff7a6b');
        this.flash(this.hero);
        this.heroActs('hit', 250);
        this.showSparks(this.hero.x, this.hero.y - 24, 0xff7a6b);
        this.cameras.main.shake(90, 0.004);
        return false;
      case 'playerDied':
        sound.death();
        this.lockedId = null;
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
        if (event.itemId === 'coins') sound.coins();
        else if (event.quality === 'rare' || event.quality === 'epic' || isUnique(event.itemId)) sound.treasure();
        else sound.pickup();
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
    this.floatText(x, y, this.events_.formatNumber(value), color, big ? 26 : 18);
  }

  private floatText(x: number, y: number, words: string, color: string, size = 13): void {
    const text = this.add
      .text(x, y, words, {
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        fontSize: `${size}px`,
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
    // A second hit may land while the first flash is still on, so the alpha to
    // return to is remembered once per target, not read back from a dimmed figure.
    if (!this.flashing.has(target)) this.flashing.set(target, target.alpha);
    const restore = this.flashing.get(target) ?? 1;
    target.setAlpha(0.4);
    this.time.delayedCall(70, () => {
      this.flashing.delete(target);
      if (target.active) target.setAlpha(restore);
    });
  }

  /**
   * Blood: drops fly out of the wound and fall, and a stain is left on the
   * ground for a while. Cosmetic only, so it may use the browser's own randomness.
   */
  private showBlood(at: Point, color: number, heavy: boolean): void {
    const drops = heavy ? 12 : 6;
    for (let i = 0; i < drops; i++) {
      const angle = Math.random() * Math.PI * 2;
      const reach = (heavy ? 26 : 16) * (0.4 + Math.random() * 0.6);
      const drop = this.add.circle(at.x, at.y - 22, 1.2 + Math.random() * 1.8, color).setDepth(EFFECT_DEPTH - 1);
      this.tweens.add({
        targets: drop,
        x: at.x + Math.cos(angle) * reach,
        duration: 300 + Math.random() * 140,
        ease: 'Quad.easeOut',
      });
      // Up a little, then down to the ground.
      this.tweens.add({
        targets: drop,
        y: { from: at.y - 22, to: at.y - 2 + Math.sin(angle) * reach * 0.4 },
        duration: 300 + Math.random() * 140,
        ease: 'Back.easeIn',
        onComplete: () => drop.destroy(),
      });
    }
    const stain = this.add.graphics({ x: at.x + (Math.random() - 0.5) * 14, y: at.y + (Math.random() - 0.5) * 6 }).setDepth(-900);
    stain.fillStyle(color, 0.5).fillEllipse(0, 0, heavy ? 30 : 16, heavy ? 13 : 7);
    stain.fillStyle(color, 0.4).fillEllipse(heavy ? 12 : 7, 3, 9, 4).fillEllipse(-8, -3, 7, 3);
    this.mapObjects.push(stain);
    this.tweens.add({ targets: stain, alpha: 0, delay: 6000, duration: 4000, onComplete: () => stain.active && stain.destroy() });
  }

  /**
   * A tempered weapon glows: faintly from +3, stronger with every level, and
   * its colour deepens from blue through violet to red-gold at the top.
   */
  private showEnchantGlow(level: number): void {
    if (level === this.shownEnchant) return;
    this.shownEnchant = level;
    this.enchantGlow?.destroy();
    this.enchantGlow = null;
    if (level < 3) return;
    const color = level >= 9 ? 0xffb347 : level >= 7 ? 0xff5a4a : level >= 5 ? 0xa56bff : 0x4f9dff;
    const strength = Math.min(1, (level - 2) / 8);
    const glow = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    for (let i = 5; i >= 1; i--) glow.fillStyle(color, 0.05 + strength * 0.07).fillEllipse(0, -30, 16 + i * (9 + strength * 6), 22 + i * (11 + strength * 7));
    glow.fillStyle(0xffffff, 0.12 + strength * 0.2).fillEllipse(0, -30, 12, 20);
    this.hero.addAt(glow, 1);
    this.enchantGlow = glow;
    this.tweens.add({ targets: glow, alpha: { from: 0.55, to: 1 }, duration: 900 - strength * 400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  /** A weapon charge going off: a bright streak along the blow and a ring of sparks at the weapon. */
  private showChargeBurst(dir: Point): void {
    sound.charge();
    const aim = tileToScreen(dir.x, dir.y);
    const length = Math.hypot(aim.x, aim.y) || 1;
    const ux = aim.x / length;
    const uy = aim.y / length;
    const x = this.hero.x + ux * 14;
    const y = this.hero.y - 30 + uy * 14;
    const flash = this.add.graphics({ x, y }).setDepth(EFFECT_DEPTH).setBlendMode(Phaser.BlendModes.ADD);
    flash.fillStyle(0xffffff, 0.95).fillCircle(0, 0, 9);
    flash.fillStyle(CHARGE_COLOR, 0.55).fillCircle(0, 0, 20);
    flash.lineStyle(3, 0xffffff, 0.9).lineBetween(0, 0, ux * 62, uy * 62);
    flash.lineStyle(8, CHARGE_COLOR, 0.35).lineBetween(0, 0, ux * 62, uy * 62);
    this.tweens.add({ targets: flash, alpha: 0, scale: 1.5, duration: 190, ease: 'Quad.easeOut', onComplete: () => flash.destroy() });
    for (let i = 0; i < 10; i++) {
      const angle = Math.atan2(uy, ux) + (Math.random() - 0.5) * 1.6;
      const spark = this.add.rectangle(x, y, 2.5, 2.5, i % 2 ? 0xffffff : CHARGE_COLOR).setDepth(EFFECT_DEPTH).setBlendMode(Phaser.BlendModes.ADD);
      const reach = 30 + Math.random() * 46;
      this.tweens.add({ targets: spark, x: x + Math.cos(angle) * reach, y: y + Math.sin(angle) * reach, alpha: 0, duration: 240 + Math.random() * 160, ease: 'Quad.easeOut', onComplete: () => spark.destroy() });
    }
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
    this.showEnchantGlow(player.equipment.weapon ? player.equipmentEnchant.weapon : 0);
    // What the hero wears on the body decides which of the class's looks is shown.
    const wanted = heroSheet(cls, heroLook(equipment.armor));
    const sheet = hasSheet(this, wanted) ? wanted : heroSheet(cls, 0);
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
      // A look without a death of its own: the hero is laid on the ground and dimmed.
      const fallen = animation === 'death' && !hasAnimation(this, sheet, 'death');
      sprite.setAngle(fallen ? 82 : 0).setAlpha(fallen ? 0.75 : 1);
      playCharacter(this, sprite, sheet, fallen ? 'idle' : animation, directionOf(facing.x, facing.y));
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
    target = this.lockedMonster() ?? target;
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
    const body = createCharacter(this, sheet).setPosition(at.x, at.y).setDepth(from.container.depth - 0.5);
    // The same size as it was alive (a young one small, an elder large).
    body.setScale(body.scaleX * Math.abs(from.figure.scaleY));
    if (hasAnimation(this, sheet, 'death')) playCharacter(this, body, sheet, 'death', from.direction);
    else {
      playCharacter(this, body, sheet, 'idle', from.direction);
      body.setAngle(80);
    }
    // The body lies for a moment before it fades: a kill should be seen.
    this.tweens.add({ targets: body, alpha: 0, delay: 2200, duration: 900, onComplete: () => body.destroy() });
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
    figure.setScale(monsterScale(monster));
    return { container, figure, body, sprite, direction: 1, bar, previous: { ...monster.pos }, lastHp: -1, blood: monster.kind === 'grunt' ? 0x5a6b3a : 0x9c1f1a };
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
        const size = monsterScale(monster);
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
      sign.fillStyle(0x14110d).fillCircle(0, -88, 5.5);
      sign.fillStyle(NPC_LOOK[npc.kind].sign).fillCircle(0, -88, 4.2);
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
            const tile = tileAt(map, x, y);
            const isWall = tile !== TILE_FLOOR;
            // Trees and boulders stand on grass, so the ground is drawn under them too.
            if (isWall && look.walls !== 'trees') continue;
            const c = tileToScreen(x, y);
            if (tile === TILE_WATER) {
              this.paintWater(brush, c.x - minX, c.y - minY, x, y);
              continue;
            }
            const road = !isWall && isRoad(zone, x, y);
            // The ground turns to wet sand at the water's edge.
            const shore = !road && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => tileAt(map, x + (dx as number), y + (dy as number)) === TILE_WATER);
            const base = road ? ROAD_COLOR : shore ? SHORE_COLOR : look.floor;
            this.paintGround(brush, c.x - minX, c.y - minY, x, y, base, look.walls, road || shore ? null : regionAt(zone, { x, y }).id);
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
        const tile = tileAt(map, x, y);
        if (tile === TILE_FLOOR || tile === TILE_WATER) continue;
        const region = regionAt(zone, { x, y }).id;
        const walls = REGION_LOOK[region].walls;
        let key: string;
        if (tile === TILE_ROCK) key = `rock${(x * 7 + y * 13) % 3}`;
        else if (tile === TILE_RUIN) key = (x * 5 + y * 3) % 3 === 0 ? 'ruinLow' : 'ruin';
        // Firs in the dark thicket, a mix on the moor, broad-leaved trees elsewhere.
        else if (walls === 'trees' && (region === 'thicket' || (region === 'moor' && (x * 31 + y * 17) % 3 === 0))) key = `fir${(x * 11 + y * 5) % 2}`;
        else if (walls === 'trees') key = `tree${(x * 31 + y * 17) % 3}`;
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
  private paintGround(g: Phaser.GameObjects.Graphics, px: number, py: number, x: number, y: number, base: readonly [number, number, number], walls: 'stone' | 'trees' | 'wood', region: string | null = null): void {
    const hash = (n: number): number => {
      const v = Math.sin(x * 127.1 + y * 311.7 + n * 74.7) * 43758.5453;
      return v - Math.floor(v);
    };
    // Broad patches of lighter and darker ground, and a little grain from tile to tile.
    const patch = walls === 'trees' ? (fractal2(x / 7, y / 7, 77) - 0.5) * 30 : 0;
    const shade = Math.round((hash(0) - 0.5) * 9 + patch);
    const clamp = (v: number): number => Math.max(0, Math.min(255, v));
    const color = Phaser.Display.Color.GetColor(clamp(base[0] + shade * 0.8), clamp(base[1] + shade), clamp(base[2] + shade * 0.6));
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
    // What grows here: heather on the moor, flowers on the meadow, ferns in the thicket.
    if (region !== null && hash(40) > 0.72) {
      const fx = px + (hash(41) - 0.5) * HALF_W;
      const fy = py + (hash(42) - 0.5) * HALF_H;
      if (region === 'moor') g.fillStyle(0x7d5c8c, 0.8).fillCircle(fx, fy, 1.6).fillCircle(fx + 2.5, fy - 1, 1.3).fillCircle(fx - 2, fy + 1, 1.2);
      else if (region === 'pasture') g.fillStyle(hash(43) > 0.5 ? 0xd8cf8a : 0xc9c9c0, 0.85).fillCircle(fx, fy, 1.2).fillCircle(fx + 4, fy + 2, 1);
      else if (region === 'thicket') g.lineStyle(1, 0x2f4a30, 0.9).lineBetween(fx, fy, fx - 4, fy - 4).lineBetween(fx, fy, fx + 4, fy - 4).lineBetween(fx, fy, fx, fy - 6);
      else g.fillStyle(0x4a4630, 0.6).fillEllipse(fx, fy, 6, 2.5);
    }
    if (walls === 'stone') {
      // Flagstones: a faint joint along two edges.
      g.lineStyle(1, dark, 0.5).lineBetween(px - HALF_W, py, px, py + HALF_H).lineBetween(px, py + HALF_H, px + HALF_W, py);
    }
  }

  /** Still water: a dark surface with a few pale ripples. */
  private paintWater(g: Phaser.GameObjects.Graphics, px: number, py: number, x: number, y: number): void {
    const hash = (n: number): number => {
      const v = Math.sin(x * 91.3 + y * 47.9 + n * 13.1) * 43758.5453;
      return v - Math.floor(v);
    };
    const depth = (fractal2(x / 4, y / 4, 55) - 0.5) * 18;
    g.fillStyle(Phaser.Display.Color.GetColor(WATER_COLOR[0] + depth * 0.4, WATER_COLOR[1] + depth, WATER_COLOR[2] + depth));
    g.fillPoints([{ x: px, y: py - HALF_H - 0.6 }, { x: px + HALF_W + 1, y: py }, { x: px, y: py + HALF_H + 0.6 }, { x: px - HALF_W - 1, y: py }], true);
    g.lineStyle(1, 0xa9c8d2, 0.35);
    for (let i = 0; i < 2; i++) {
      const rx = px + (hash(i) - 0.5) * HALF_W;
      const ry = py + (hash(i + 5) - 0.5) * HALF_H;
      g.lineBetween(rx - 5, ry, rx + 5, ry);
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
      block(key, HOUSE_HEIGHT, (g, c) => {
        // Plastered walls with dark timbers under a tiled roof.
        this.drawBlock(g, c, HOUSE_HEIGHT, 0xb9a887, 0x94836a, 0x9c4636);
        g.lineStyle(2, 0x4a3524, 0.9);
        g.lineBetween(c.x - HALF_W, c.y - HOUSE_HEIGHT, c.x - HALF_W, c.y).lineBetween(c.x, c.y - HOUSE_HEIGHT + HALF_H, c.x, c.y + HALF_H).lineBetween(c.x + HALF_W, c.y - HOUSE_HEIGHT, c.x + HALF_W, c.y);
        g.lineBetween(c.x - HALF_W, c.y - HOUSE_HEIGHT / 2, c.x, c.y - HOUSE_HEIGHT / 2 + HALF_H).lineBetween(c.x, c.y - HOUSE_HEIGHT / 2 + HALF_H, c.x + HALF_W, c.y - HOUSE_HEIGHT / 2);
        // Rows of tiles on the roof.
        g.lineStyle(1, 0x6e2d22, 0.8);
        for (let i = 1; i < 4; i++) {
          const k = i / 4;
          g.lineBetween(c.x - HALF_W + HALF_W * k, c.y - HOUSE_HEIGHT - HALF_H * k, c.x + HALF_W * k, c.y - HOUSE_HEIGHT + HALF_H - HALF_H * k);
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
      bake(`rock${variant}`, 64, 52, 40, (g) => this.drawRock(g, { x: 32, y: 40 }, variant));
    }
    for (let variant = 0; variant < 2; variant++) {
      bake(`fir${variant}`, 64, 112, 100, (g) => this.drawFir(g, { x: 32, y: 100 }, variant));
    }
    // What is left of an old hall: weathered blocks, some fallen to half their height, moss on top.
    for (const [key, height] of [['ruin', 34], ['ruinLow', 16]] as const) {
      block(key, height, (g, c) => {
        this.drawBlock(g, c, height, 0x5d5a52, 0x45433d, 0x6c7a58);
        g.lineStyle(1, 0x2c2b27, 0.7).lineBetween(c.x - HALF_W, c.y - height / 2, c.x, c.y - height / 2 + HALF_H).lineBetween(c.x, c.y - height / 2 + HALF_H, c.x + HALF_W, c.y - height / 2);
        g.fillStyle(0x4f6a3e, 0.8).fillEllipse(c.x - 8, c.y - height - 2, 18, 7).fillEllipse(c.x + 12, c.y - height + 3, 12, 5);
      });
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
    // Deep, greyed greens: woods seen on an overcast day rather than a picture-book lawn.
    const greens = [[0x1c3524, 0x27482c, 0x35603a, 0x4c7a4a], [0x223a22, 0x2f5230, 0x426b3c, 0x5c8450], [0x182f22, 0x213f29, 0x2f5735, 0x436f45]][variant] as number[];
    g.fillStyle(0x000000, 0.3).fillEllipse(c.x + 6, c.y + 2, 50, 20);
    // trunk
    g.fillStyle(0x33261b).fillRect(c.x - 4, c.y - 26, 8, 26);
    g.fillStyle(0x4d3a28).fillRect(c.x - 4, c.y - 26, 3, 26);
    g.lineStyle(1, 0x14110d, 0.7).strokeRect(c.x - 4, c.y - 26, 8, 26);
    // crown: a dark underside, then lighter clumps towards the top left, where the light comes from
    const top = c.y - 30 - size;
    g.fillStyle(0x0e1711, 0.85).fillCircle(c.x, top + 4, size + 1.5).fillCircle(c.x - size * 0.7, top + 12, size * 0.75 + 1.2).fillCircle(c.x + size * 0.7, top + 12, size * 0.75 + 1.2);
    g.fillStyle(greens[0] as number).fillCircle(c.x, top + 4, size + 0.5).fillCircle(c.x - size * 0.7, top + 12, size * 0.75).fillCircle(c.x + size * 0.7, top + 12, size * 0.75);
    g.fillStyle(greens[1] as number).fillCircle(c.x - 2, top + 1, size * 0.9).fillCircle(c.x - size * 0.7, top + 9, size * 0.6);
    g.fillStyle(greens[2] as number).fillCircle(c.x - 5, top - 3, size * 0.62).fillCircle(c.x + size * 0.45, top + 5, size * 0.4);
    g.fillStyle(greens[3] as number, 0.8).fillCircle(c.x - 8, top - 6, size * 0.3);
    // A scatter of leaf-sized flecks breaks up the round clumps.
    for (let i = 0; i < 26; i++) {
      const a = i * 2.399;
      const r = size * (0.25 + ((i * 37) % 70) / 100);
      g.fillStyle(i % 3 === 0 ? (greens[3] as number) : (greens[0] as number), 0.55).fillCircle(c.x - 2 + Math.cos(a) * r, top + 5 + Math.sin(a) * r * 0.8, 1.6);
    }
  }

  /** A fir: tiers of dark boughs narrowing to a point. */
  private drawFir(g: Phaser.GameObjects.Graphics, c: Point, variant: number): void {
    const height = 74 + variant * 14;
    const greens = variant === 0 ? [0x14281d, 0x1d3a27, 0x2a4f33] : [0x172b22, 0x21402c, 0x305839];
    g.fillStyle(0x000000, 0.3).fillEllipse(c.x + 5, c.y + 2, 40, 16);
    g.fillStyle(0x2c2018).fillRect(c.x - 3, c.y - 16, 6, 16);
    const tiers = 5;
    for (let i = 0; i < tiers; i++) {
      const k = i / tiers;
      const y = c.y - 12 - (height - 12) * k;
      const half = 22 * (1 - k * 0.78);
      const tall = (height - 12) / tiers + 12;
      g.fillStyle(0x0c1510, 0.9).fillTriangle(c.x - half - 1.5, y + 1, c.x + half + 1.5, y + 1, c.x, y - tall - 1.5);
      g.fillStyle(greens[0] as number).fillTriangle(c.x - half, y, c.x + half, y, c.x, y - tall);
      g.fillStyle(greens[1] as number).fillTriangle(c.x - half, y, c.x + half * 0.15, y, c.x, y - tall);
      g.fillStyle(greens[2] as number, 0.8).fillTriangle(c.x - half * 0.8, y - 2, c.x - half * 0.2, y - 2, c.x - 1, y - tall * 0.8);
    }
  }

  /** A boulder: an uneven lump with a lit side, a shadowed side and a patch of moss or lichen. */
  private drawRock(g: Phaser.GameObjects.Graphics, c: Point, variant: number): void {
    const w = 20 + variant * 4;
    const h = 16 + variant * 7;
    g.fillStyle(0x000000, 0.3).fillEllipse(c.x + 4, c.y + 3, w * 2.3, 14);
    const outline = [
      { x: c.x - w, y: c.y }, { x: c.x - w * 0.8, y: c.y - h * 0.7 }, { x: c.x - w * 0.2, y: c.y - h },
      { x: c.x + w * 0.55, y: c.y - h * 0.85 }, { x: c.x + w, y: c.y - h * 0.3 }, { x: c.x + w * 0.85, y: c.y + 5 }, { x: c.x - w * 0.5, y: c.y + 7 },
    ];
    g.fillStyle(0x56574f).fillPoints(outline, true);
    // The side away from the light.
    g.fillStyle(0x3c3d38).fillPoints([{ x: c.x + w * 0.1, y: c.y - h * 0.95 }, { x: c.x + w * 0.55, y: c.y - h * 0.85 }, { x: c.x + w, y: c.y - h * 0.3 }, { x: c.x + w * 0.85, y: c.y + 5 }, { x: c.x + w * 0.2, y: c.y + 6 }], true);
    g.fillStyle(0x787a70, 0.9).fillPoints([{ x: c.x - w * 0.75, y: c.y - h * 0.65 }, { x: c.x - w * 0.2, y: c.y - h * 0.95 }, { x: c.x + w * 0.05, y: c.y - h * 0.6 }, { x: c.x - w * 0.5, y: c.y - h * 0.35 }], true);
    g.lineStyle(1, 0x1e1f1c, 0.8).strokePoints(outline, true, true);
    g.lineStyle(1, 0x2a2b27, 0.6).lineBetween(c.x - w * 0.3, c.y - h * 0.5, c.x + w * 0.1, c.y - h * 0.1);
    g.fillStyle(variant === 1 ? 0x8a8f6a : 0x4a6238, 0.75).fillEllipse(c.x - w * 0.35, c.y - h * 0.85, w * 0.7, 5);
  }
}
