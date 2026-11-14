import Phaser from 'phaser';
import {
  type Command, type GameEvent, type GroundLoot, type ItemId, type Monster, type Point, type World,
  ITEMS, PLAYER_ATTACK_ARC, PLAYER_ATTACK_RANGE, TICK_MS, TILE_WALL,
  isAlive, isMoving, isWalkable, step, tileAt,
} from '../sim';
import { TILE_HEIGHT, TILE_WIDTH, screenToWorld, tileToScreen } from './iso';
import { GRADE_COLOR } from './itemText';

const WALL_HEIGHT = 30;
const HALF_W = TILE_WIDTH / 2;
const HALF_H = TILE_HEIGHT / 2;
/** While the pointer is held down, the destination follows it at this interval. */
const HOLD_REPEAT_MS = 120;
/** Keyboard attacks aim at the nearest monster within this distance. */
const AUTO_AIM_RANGE = PLAYER_ATTACK_RANGE + 1;
const EFFECT_DEPTH = 100000;

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

export interface SceneEvents {
  /** Health, the number of monsters or the hero's belongings changed. */
  onStats(world: World): void;
  /** A good moment to save: the hero stopped, killed a monster or respawned. */
  onCheckpoint(world: World): void;
  onDeath(world: World): void;
  onPickup(itemId: ItemId, count: number): void;
  onInventoryFull(): void;
  onToggleInventory(): void;
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
  private mapObjects: Phaser.GameObjects.GameObject[] = [];
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
      this.holdTimer = 0;
      if (this.isMoveOrder(pointer)) this.orderMoveTo(pointer);
      else this.orderAttackAt(pointer);
    });

    // Listening on the window keeps controls working even when a HUD button has focus.
    const onKeyDown = (event: KeyboardEvent) => {
      const known = event.code in KEY_DIRECTIONS || event.code === ATTACK_KEY || event.code === INVENTORY_KEY;
      if (!known || event.ctrlKey || event.metaKey || event.altKey) return;
      if (document.querySelector('dialog[open]')) return; // Keys belong to the dialog.
      if (event.code === INVENTORY_KEY) {
        if (!event.repeat) this.events_.onToggleInventory();
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
    this.lastStats = '';
    this.heldKeys.clear();
    this.marker.setVisible(false);
    for (const object of this.mapObjects) object.destroy();
    this.mapObjects = this.drawMap();
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

  /** Sends a command from outside the scene, for example from a HUD button. */
  send(command: Command): void {
    this.pending.push(command);
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

  private readHeldInput(delta: number): void {
    const pointer = this.input.activePointer;
    if (pointer.isDown && this.isMoveOrder(pointer)) {
      // Holding the right button or a finger keeps the hero walking towards it.
      if (!this.hasDirectionKeys()) {
        this.holdTimer += delta;
        if (this.holdTimer >= HOLD_REPEAT_MS) {
          this.holdTimer = 0;
          this.orderMoveTo(pointer);
        }
      }
    } else if (pointer.isDown && pointer.leftButtonDown() && this.world.player.attackCooldown === 0) {
      this.orderAttackAt(pointer);
    }
    if (this.heldKeys.has(ATTACK_KEY) && this.world.player.attackCooldown === 0) {
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
    const { world } = this.pointerInWorld(pointer);
    const { pos } = this.world.player;
    this.pending.push({ type: 'attack', dx: world.x - pos.x, dy: world.y - pos.y });
  }

  /** Without a cursor (keyboard) the hero strikes at the nearest monster, or straight ahead. */
  private orderAutoAttack(): void {
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
    this.pending.push({ type: 'attack', dx: dir.x, dy: dir.y });
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

    this.reportStats();
    if (checkpoint) this.events_.onCheckpoint(this.world);
  }

  private reportStats(): void {
    const stats = `${this.world.player.hp}/${this.world.monsters.length}/${this.world.player.revision}`;
    if (stats === this.lastStats) return;
    this.lastStats = stats;
    this.events_.onStats(this.world);
  }

  /** Plays the visual for one rule event. Returns true when the game should be saved. */
  private showEvent(event: GameEvent): boolean {
    switch (event.type) {
      case 'playerSwing':
        this.showSwing(event.dir);
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
        this.events_.onDeath(this.world);
        return true;
      case 'playerRespawned':
        this.setWorld(this.world);
        return true;
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

  private showSwing(dir: Point): void {
    const { pos } = this.world.player;
    const centre = tileToScreen(pos.x, pos.y);
    const angle = Math.atan2(dir.y, dir.x);
    const points: Point[] = [{ x: 0, y: 0 }];
    const segments = 10;
    for (let i = 0; i <= segments; i++) {
      const a = angle - PLAYER_ATTACK_ARC / 2 + (PLAYER_ATTACK_ARC * i) / segments;
      const edge = tileToScreen(pos.x + Math.cos(a) * PLAYER_ATTACK_RANGE, pos.y + Math.sin(a) * PLAYER_ATTACK_RANGE);
      points.push({ x: edge.x - centre.x, y: edge.y - centre.y });
    }
    const arc = this.add.graphics({ x: centre.x, y: centre.y }).setDepth(-400);
    arc.fillStyle(0xffffff, 0.35).fillPoints(points, true);
    this.tweens.add({ targets: arc, alpha: 0, duration: 180, onComplete: () => arc.destroy() });
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
    const { facing, attackCooldown } = this.world.player;
    const tip = tileToScreen(facing.x, facing.y);
    const length = Math.hypot(tip.x, tip.y) || 1;
    const reach = attackCooldown > 0 ? 30 : 22;
    this.weapon.clear();
    this.weapon.lineStyle(4, 0xd9dde6, 1);
    this.weapon.lineBetween(0, -20, (tip.x / length) * reach, -20 + (tip.y / length) * reach);
  }

  private createMonsterSprite(monster: Monster): MonsterSprite {
    const body = this.add.graphics();
    const bar = this.add.graphics();
    const container = this.add.container(0, 0, [body, bar]);
    return { container, body, bar, previous: { ...monster.pos }, lastHp: -1 };
  }

  private drawMonsterBody(sprite: MonsterSprite, windingUp: boolean): void {
    const g = sprite.body;
    g.clear();
    g.fillStyle(0x000000, 0.35).fillEllipse(0, 0, 30, 14);
    // The warning before a blow: the monster turns bright and a ring appears under it.
    if (windingUp) g.lineStyle(3, 0xffb347, 1).strokeEllipse(0, 0, 44, 22);
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
        this.drawMonsterBody(sprite, windingUp);
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

  private drawMap(): Phaser.GameObjects.GameObject[] {
    const { map } = this.world;
    const objects: Phaser.GameObjects.GameObject[] = [];
    const floor = this.add.graphics().setDepth(-1000);
    objects.push(floor);

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const c = tileToScreen(x, y);
        if (tileAt(map, x, y) !== TILE_WALL) {
          // Cosmetic variation only; it does not come from the game's RNG.
          const shade = ((x * 7 + y * 13) % 5) * 2;
          const diamond = [{ x: c.x, y: c.y - HALF_H }, { x: c.x + HALF_W, y: c.y }, { x: c.x, y: c.y + HALF_H }, { x: c.x - HALF_W, y: c.y }];
          floor.fillStyle(Phaser.Display.Color.GetColor(52 + shade, 56 + shade, 68 + shade));
          floor.fillPoints(diamond, true);
          floor.lineStyle(1, 0x2d313c, 1);
          floor.strokePoints(diamond, true, true);
          continue;
        }
        const wall = this.add.graphics().setDepth(x + y);
        const top = c.y - WALL_HEIGHT;
        wall.fillStyle(0x4a4038); // left face
        wall.fillPoints([{ x: c.x - HALF_W, y: top }, { x: c.x, y: top + HALF_H }, { x: c.x, y: c.y + HALF_H }, { x: c.x - HALF_W, y: c.y }], true);
        wall.fillStyle(0x362e28); // right face
        wall.fillPoints([{ x: c.x, y: top + HALF_H }, { x: c.x + HALF_W, y: top }, { x: c.x + HALF_W, y: c.y }, { x: c.x, y: c.y + HALF_H }], true);
        wall.fillStyle(0x6b5d50); // top
        wall.fillPoints([{ x: c.x, y: top - HALF_H }, { x: c.x + HALF_W, y: top }, { x: c.x, y: top + HALF_H }, { x: c.x - HALF_W, y: top }], true);
        objects.push(wall);
      }
    }
    return objects;
  }
}
