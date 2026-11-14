import Phaser from 'phaser';
import {
  type Command, type GameEvent, type GroundLoot, type ItemId, type Monster, type Point, type SkillId, type World, type ZoneKind,
  ITEMS, PLAYER_ATTACK_ARC, SKILLS, SKILL_IDS, PLAYER_ATTACK_RANGE, TICK_MS, TILE_WALL,
  isAlive, isMoving, isRoad, isWalkable, regionAt, step, tileAt,
} from '../sim';
import { TILE_HEIGHT, TILE_WIDTH, screenToWorld, tileToScreen } from './iso';
import { GRADE_COLOR } from './itemText';
import { QUICK_KEYS } from './quickBar';
import { SKILL_KEYS } from './skillText';
import { EXIT_COLOR, REGION_LOOK, ROAD_COLOR } from './zoneText';

const WALL_HEIGHT = 30;
const HALF_W = TILE_WIDTH / 2;
const HALF_H = TILE_HEIGHT / 2;
/** While the pointer is held down, the destination follows it at this interval. */
const HOLD_REPEAT_MS = 120;
/** Keyboard attacks aim at the nearest monster within this distance. */
const AUTO_AIM_RANGE = PLAYER_ATTACK_RANGE + 1;
const EFFECT_DEPTH = 100000;
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
/** One key for whatever is next to the hero: the merchant, an exit. */
const INTERACT_KEY = 'KeyT';
/** Keys that send one command when pressed. */
const COMMAND_KEYS: Record<string, Command> = {
  [QUICK_KEYS.healthPotion]: { type: 'use', itemId: 'healthPotion' },
  [QUICK_KEYS.manaPotion]: { type: 'use', itemId: 'manaPotion' },
  [QUICK_KEYS.charges]: { type: 'toggleCharges' },
};
const SKILL_BY_KEY = new Map<string, SkillId>(SKILL_IDS.map((id) => [SKILL_KEYS[id].code, id]));

export interface SceneEvents {
  /** Health, the number of monsters or the hero's belongings changed. */
  onStats(world: World): void;
  /** A good moment to save: the hero stopped, killed a monster or respawned. */
  onCheckpoint(world: World): void;
  onDeath(world: World, xpLost: number): void;
  /** Called after every rule tick, for things that count down (skill cooldowns). */
  onTick(world: World): void;
  onLevelUp(level: number, unlocked: SkillId[]): void;
  onSkillDenied(id: SkillId, reason: 'locked' | 'cooldown' | 'mana'): void;
  onPickup(itemId: ItemId, count: number): void;
  onInventoryFull(): void;
  onToggleInventory(): void;
  onInteract(): void;
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
  body: Phaser.GameObjects.Graphics;
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
  private savedRevision = 0;
  private mapObjects: Phaser.GameObjects.GameObject[] = [];
  private floorTextures: string[] = [];
  /** For each obstacle picture: where the tile centre sits, as a share of the picture's height. */
  private readonly obstacleOrigins = new Map<string, number>();
  private readonly monsterSprites = new Map<number, MonsterSprite>();
  private readonly lootSprites = new Map<number, Phaser.GameObjects.Graphics>();
  private hero!: Phaser.GameObjects.Container;
  private weapon!: Phaser.GameObjects.Graphics;
  private marker!: Phaser.GameObjects.Graphics;

  constructor(world: World, events: SceneEvents) {
    super('dungeon');
    this.world = world;
    this.events_ = events;
  }

  create(): void {
    this.marker = this.add.graphics().setDepth(-500).setVisible(false);
    this.marker.lineStyle(2, 0xe8c36a, 0.9).strokeEllipse(0, 0, 26, 13);
    this.marker.fillStyle(0xe8c36a, 0.35).fillEllipse(0, 0, 26, 13);
    this.hero = this.createHero();
    this.cameras.main.startFollow(this.hero, false, 0.12, 0.12);

    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.isOnGame(pointer)) return;
      this.holdTimer = 0;
      if (this.isMoveOrder(pointer)) this.orderMoveTo(pointer);
      else this.orderAttackAt(pointer);
    });

    // Listening on the window keeps controls working even when a HUD button has focus.
    const onKeyDown = (event: KeyboardEvent) => {
      const skill = SKILL_BY_KEY.get(event.code);
      const command = COMMAND_KEYS[event.code];
      const known =
        event.code in KEY_DIRECTIONS || event.code === ATTACK_KEY || event.code === INVENTORY_KEY ||
        event.code === INTERACT_KEY || skill !== undefined || command !== undefined;
      if (!known || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === INVENTORY_KEY) {
        if (!event.repeat) this.events_.onToggleInventory();
        return;
      }
      if (skill !== undefined) {
        if (!event.repeat) this.useSkill(skill, true);
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
  }

  /** Replaces the world being shown, for example when a new dungeon starts. */
  setWorld(world: World): void {
    this.world = world;
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
    if (world.merchant) this.mapObjects.push(this.drawMerchant(world.merchant));
    for (const exit of world.exits) this.mapObjects.push(this.drawExit(exit.pos, EXIT_COLOR[exit.leadsTo]));
    for (const sprite of this.monsterSprites.values()) sprite.container.destroy();
    this.monsterSprites.clear();
    this.syncMonsters(1);
    for (const sprite of this.lootSprites.values()) sprite.destroy();
    this.lootSprites.clear();
    this.syncLoot();
    this.placeHero(world.player.pos);
    this.hero.setAlpha(isAlive(world) ? 1 : 0.35);
    this.cameras.main.centerOn(this.hero.x, this.hero.y);
    this.reportStats();
  }

  /** While true (the hero is talking to someone), attacks and strike skills are not sent. Walking still works. */
  setPeaceful(peaceful: boolean): void {
    this.peaceful = peaceful;
  }

  /** Sends a command from outside the scene, for example from a HUD button. */
  send(command: Command): void {
    this.pending.push(command);
  }

  /**
   * Uses a skill. From the keyboard it is aimed at the cursor; from a HUD
   * button the cursor is on the button, so the hero aims at the nearest monster.
   */
  useSkill(id: SkillId, aimAtCursor: boolean): void {
    if (this.peaceful && SKILLS[id].effect.kind === 'strike') return;
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
    this.drawWeapon();
    this.syncMonsters(alpha);
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
        return false;
      case 'skillUsed': {
        const { effect } = SKILLS[event.id];
        if (effect.kind === 'strike') this.showSwing(event.dir, effect.arc, effect.range, event.charged ? CHARGE_COLOR : 0xffb347);
        return false;
      }
      case 'playerHealed':
        this.floatNumber(this.hero.x, this.hero.y - 60, event.amount, '#7fe0a0');
        this.showRing(0x7fe0a0);
        return false;
      case 'xpGained':
        return false; // The experience bar shows it.
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
      case 'useDenied':
      case 'chargesEmpty':
      case 'tradeDenied':
        this.events_.onNotice(event);
        return false;
      case 'monsterHit': {
        const at = tileToScreen(event.pos.x, event.pos.y);
        this.floatNumber(at.x, at.y - 40, event.damage, '#ffe9a8');
        const sprite = this.monsterSprites.get(event.id);
        if (sprite) this.flash(sprite.container);
        if (event.died) this.showPuff(at.x, at.y - 10);
        return event.died;
      }
      case 'monsterWindup':
        return false; // Drawn every frame from the monster's state.
      case 'playerHit':
        this.floatNumber(this.hero.x, this.hero.y - 60, event.damage, '#ff7a6b');
        this.flash(this.hero);
        this.cameras.main.shake(90, 0.004);
        return false;
      case 'playerDied':
        this.marker.setVisible(false);
        this.hero.setAlpha(0.35);
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
        this.events_.onPickup(event.itemId, event.count);
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

  private floatNumber(x: number, y: number, value: number, color: string): void {
    const text = this.add
      .text(x, y, this.events_.formatNumber(value), {
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        fontSize: '18px',
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
    const zoom = Phaser.Math.Clamp(Math.min(width, height) / 520, 0.7, 1.5);
    this.cameras.main.setZoom(zoom);
  }

  private placeHero(pos: Point): void {
    const at = tileToScreen(pos.x, pos.y);
    this.hero.setPosition(at.x, at.y);
    // Objects further down the screen are drawn on top; walls use the same x + y scale.
    this.hero.setDepth(pos.x + pos.y);
  }

  private createHero(): Phaser.GameObjects.Container {
    const body = this.add.graphics();
    body.fillStyle(0x000000, 0.35).fillEllipse(0, 0, 30, 14);
    body.fillStyle(0x3f6fb5).fillRoundedRect(-9, -34, 18, 30, 7);
    body.fillStyle(0x2c4f85).fillRoundedRect(-9, -18, 18, 14, { tl: 0, tr: 0, bl: 7, br: 7 });
    body.fillStyle(0xf0d2b0).fillCircle(0, -42, 8);
    this.weapon = this.add.graphics();
    return this.add.container(0, 0, [body, this.weapon]);
  }

  /** A blade that points where the hero is facing, so the attack direction is readable. */
  private drawWeapon(): void {
    const { facing, attackCooldown, chargesOn } = this.world.player;
    const tip = tileToScreen(facing.x, facing.y);
    const length = Math.hypot(tip.x, tip.y) || 1;
    const reach = attackCooldown > 0 ? 30 : 22;
    this.weapon.clear();
    this.weapon.lineStyle(4, chargesOn ? CHARGE_COLOR : 0xd9dde6, 1);
    this.weapon.lineBetween(0, -20, (tip.x / length) * reach, -20 + (tip.y / length) * reach);
  }

  private createMonsterSprite(monster: Monster): MonsterSprite {
    const body = this.add.graphics();
    const bar = this.add.graphics();
    const container = this.add.container(0, 0, [body, bar]);
    return { container, body, bar, previous: { ...monster.pos }, lastHp: -1 };
  }

  private drawMonsterBody(sprite: MonsterSprite, kind: Monster['kind'], windingUp: boolean): void {
    const g = sprite.body;
    g.clear();
    g.fillStyle(0x000000, 0.35).fillEllipse(0, 0, 30, 14);
    // The warning before a blow: the monster turns bright and a ring appears under it.
    if (windingUp) g.lineStyle(3, 0xffb347, 1).strokeEllipse(0, 0, 44, 22);
    if (kind === 'boar') {
      // Broad and dark, with pale tusks.
      g.fillStyle(windingUp ? 0xd8663a : 0x5b4636).fillEllipse(0, -13, 38, 22);
      g.fillStyle(windingUp ? 0xd8663a : 0x6e5744).fillEllipse(13, -13, 16, 14);
      g.fillStyle(0xf4e9c8).fillTriangle(15, -9, 21, -15, 18, -8).fillCircle(13, -17, 1.8);
      return;
    }
    if (kind === 'wolf') {
      // Low and long, with pointed ears.
      g.fillStyle(windingUp ? 0xd8663a : 0x8a8f99).fillEllipse(0, -11, 34, 16);
      g.fillStyle(windingUp ? 0xd8663a : 0x9aa0ab).fillCircle(11, -17, 8);
      g.fillTriangle(6, -22, 9, -30, 12, -22).fillTriangle(12, -22, 15, -30, 18, -22);
      g.fillStyle(0xf4e9c8).fillCircle(9, -18, 1.8).fillCircle(14, -18, 1.8);
      return;
    }
    g.fillStyle(windingUp ? 0xd8663a : 0x7d3b3b).fillRoundedRect(-12, -26, 24, 24, 9);
    g.fillStyle(0xf4e9c8).fillCircle(-5, -17, 3).fillCircle(5, -17, 3);
    g.fillStyle(0x12141a).fillCircle(-5, -17, 1.2).fillCircle(5, -17, 1.2);
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
      sprite.container.setPosition(at.x, at.y).setDepth(x + y);

      const windingUp = monster.windup > 0;
      const key = monster.hp * 2 + (windingUp ? 1 : 0);
      if (key !== sprite.lastHp) {
        sprite.lastHp = key;
        this.drawMonsterBody(sprite, monster.kind, windingUp);
        sprite.bar.clear();
        if (monster.hp < monster.maxHp) {
          sprite.bar.fillStyle(0x12141a, 0.9).fillRect(-16, -38, 32, 6);
          sprite.bar.fillStyle(0xd9534f).fillRect(-15, -37, 30 * (monster.hp / monster.maxHp), 4);
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

  private drawMerchant(merchant: Point): Phaser.GameObjects.Graphics {
    const at = tileToScreen(merchant.x, merchant.y);
    const g = this.add.graphics({ x: at.x, y: at.y }).setDepth(merchant.x + merchant.y);
    g.fillStyle(0x000000, 0.35).fillEllipse(0, 0, 32, 15);
    g.fillStyle(0x3e7d5a).fillRoundedRect(-11, -36, 22, 34, { tl: 9, tr: 9, bl: 4, br: 4 });
    g.fillStyle(0x2c5c42).fillRect(-11, -14, 22, 12);
    g.fillStyle(0xf0d2b0).fillCircle(0, -44, 8);
    g.fillStyle(0x6b4a2a).fillEllipse(0, -51, 22, 8);
    // A coin above his head marks him as someone to trade with.
    g.fillStyle(0xb8862b).fillCircle(0, -66, 7);
    g.fillStyle(0xf2c94c).fillCircle(0, -67, 6);
    return g;
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
    } else if (def.kind === 'consumable') {
      // A small flask: red for health, blue for mana, pale for charges.
      const color = def.effect.kind === 'heal' ? 0xd9534f : def.effect.kind === 'mana' ? 0x4f8fe0 : CHARGE_COLOR;
      g.fillStyle(color).fillCircle(0, -6, 6);
      g.fillStyle(0xcfd3dc).fillRect(-2, -15, 4, 5);
    } else {
      // Equipment glows in the colour of its grade so it stands out from afar.
      const color = GRADE_COLOR[def.grade];
      g.fillStyle(color, 0.25).fillCircle(0, -8, 13);
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
            const px = c.x - minX;
            const py = c.y - minY;
            // Cosmetic variation only; it does not come from the game's RNG.
            const shade = ((x * 7 + y * 13) % 5) * 2;
            const base = !isWall && isRoad(zone, x, y) ? ROAD_COLOR : look.floor;
            const diamond = [{ x: px, y: py - HALF_H }, { x: px + HALF_W, y: py }, { x: px, y: py + HALF_H }, { x: px - HALF_W, y: py }];
            brush.fillStyle(Phaser.Display.Color.GetColor(base[0] + shade, base[1] + shade, base[2] + shade));
            brush.fillPoints(diamond, true);
            brush.lineStyle(1, look.grid, 0.5);
            brush.strokePoints(diamond, true, true);
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
        else key = this.touchesAnotherRegion(x, y) ? 'palisade' : 'house';
        const c = tileToScreen(x, y);
        const origin = this.obstacleOrigins.get(key) as number;
        objects.push(this.add.image(c.x, c.y, key).setOrigin(0.5, origin).setDepth(x + y));
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

  /** Paints each kind of obstacle once into a small picture that is then reused for every tile. */
  private ensureObstacleTextures(): void {
    if (this.obstacleOrigins.size > 0) return;
    const block = (key: string, height: number, left: number, right: number, top: number) => {
      const brush = this.make.graphics({}, false);
      this.drawBlock(brush, { x: HALF_W, y: height + HALF_H }, height, left, right, top);
      brush.generateTexture(key, TILE_WIDTH, height + TILE_HEIGHT);
      brush.destroy();
      // Where the centre of the tile is inside the picture, as a share of its height.
      this.obstacleOrigins.set(key, (height + HALF_H) / (height + TILE_HEIGHT));
    };
    block('stone', WALL_HEIGHT, 0x4a4038, 0x362e28, 0x6b5d50);
    block('palisade', 34, 0x6b4a2a, 0x4f361e, 0x86603a);
    block('house', 44, 0x8c7a5e, 0x6f6049, 0xa34a3a); // a red roof
    for (let variant = 0; variant < 3; variant++) {
      const brush = this.make.graphics({}, false);
      this.drawTree(brush, { x: 32, y: 68 }, variant);
      brush.generateTexture(`tree${variant}`, 64, 80);
      brush.destroy();
      this.obstacleOrigins.set(`tree${variant}`, 68 / 80);
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

  /** `variant` (0-2) changes the size and tint a little so a forest does not look stamped. */
  private drawTree(g: Phaser.GameObjects.Graphics, c: Point, variant: number): void {
    const size = 20 + variant * 3;
    g.fillStyle(0x000000, 0.3).fillEllipse(c.x, c.y, 40, 18);
    g.fillStyle(0x5a3f26).fillRect(c.x - 4, c.y - 22, 8, 22);
    g.fillStyle([0x2f6b3a, 0x357a41, 0x2a5f34][variant] as number).fillCircle(c.x, c.y - 34, size);
    g.fillStyle([0x3d8249, 0x46924f, 0x377843][variant] as number).fillCircle(c.x - 5, c.y - 40, size * 0.6);
  }
}
