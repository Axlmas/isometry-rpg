import Phaser from 'phaser';
import { type Command, type Point, type World, TICK_MS, TILE_WALL, isMoving, isWalkable, step, tileAt } from '../sim';
import { TILE_HEIGHT, TILE_WIDTH, screenToWorld, tileToScreen } from './iso';

const WALL_HEIGHT = 30;
const HALF_W = TILE_WIDTH / 2;
const HALF_H = TILE_HEIGHT / 2;
/** While the pointer is held down, the destination follows it at this interval. */
const HOLD_REPEAT_MS = 120;

// Physical key positions (KeyboardEvent.code), so movement works on any
// keyboard layout, including Cyrillic. Values are directions on the screen.
const KEY_DIRECTIONS: Record<string, readonly [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

export interface SceneEvents {
  /** The whole number of steps walked has changed. */
  onStep(world: World): void;
  /** The hero stopped walking. */
  onArrive(world: World): void;
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
  private previous: Point = { x: 0, y: 0 };
  private lastSteps = 0;
  private wasMoving = false;
  private readonly heldKeys = new Set<string>();
  private holdTimer = 0;
  private lastFrameAt = performance.now();
  private mapObjects: Phaser.GameObjects.GameObject[] = [];
  private hero!: Phaser.GameObjects.Container;
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

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.holdTimer = 0;
      this.orderMoveTo(pointer);
    });

    // Listening on the window keeps movement working even when a HUD button has focus.
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.code in KEY_DIRECTIONS) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (document.querySelector('dialog[open]')) return; // Keys belong to the dialog.
      event.preventDefault(); // Arrow keys must not scroll the page.
      if (this.heldKeys.has(event.code)) return;
      this.heldKeys.add(event.code);
      this.sendKeyDirection();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (this.heldKeys.delete(event.code)) this.sendKeyDirection();
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
    this.lastSteps = Math.floor(world.player.distance);
    this.wasMoving = false;
    this.heldKeys.clear();
    this.marker.setVisible(false);
    for (const object of this.mapObjects) object.destroy();
    this.mapObjects = this.drawMap();
    this.placeHero(world.player.pos);
    this.cameras.main.centerOn(this.hero.x, this.hero.y);
  }

  override update(): void {
    // Phaser smooths and clamps its own frame delta, which makes the game run
    // slow on devices with an uneven frame rate. The real clock does not.
    const now = performance.now();
    const delta = now - this.lastFrameAt;
    this.lastFrameAt = now;

    // Holding the mouse button or a finger keeps the hero walking towards it.
    const pointer = this.input.activePointer;
    if (pointer.isDown && this.heldKeys.size === 0) {
      this.holdTimer += delta;
      if (this.holdTimer >= HOLD_REPEAT_MS) {
        this.holdTimer = 0;
        this.orderMoveTo(pointer);
      }
    }

    // Rules run in fixed ticks; a long pause (hidden tab) must not turn into
    // a burst of hundreds of ticks.
    this.accumulator = Math.min(this.accumulator + delta, TICK_MS * 5);
    while (this.accumulator >= TICK_MS) {
      this.previous = { ...this.world.player.pos };
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
  }

  private orderMoveTo(pointer: Phaser.Input.Pointer): void {
    // The pointer's stored world position goes stale while the camera moves.
    const at = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const target = screenToWorld(at.x, at.y);
    if (!isWalkable(this.world.map, Math.round(target.x), Math.round(target.y))) return;
    this.pending.push({ type: 'moveTo', x: target.x, y: target.y });
    this.marker.setPosition(at.x, at.y).setVisible(true);
  }

  private sendKeyDirection(): void {
    let sx = 0;
    let sy = 0;
    for (const code of this.heldKeys) {
      const [dx, dy] = KEY_DIRECTIONS[code] as readonly [number, number];
      sx += dx;
      sy += dy;
    }
    // "Up" means up on the screen, which is a diagonal on the isometric grid.
    const dir = screenToWorld(Math.sign(sx) * HALF_W, Math.sign(sy) * HALF_H);
    this.pending.push({ type: 'moveDir', dx: dir.x, dy: dir.y });
    if (sx !== 0 || sy !== 0) this.marker.setVisible(false);
  }

  private afterTick(): void {
    const steps = Math.floor(this.world.player.distance);
    if (steps !== this.lastSteps) {
      this.lastSteps = steps;
      this.events_.onStep(this.world);
    }
    const moving = isMoving(this.world);
    if (this.wasMoving && !moving) {
      this.marker.setVisible(false);
      this.events_.onArrive(this.world);
    }
    this.wasMoving = moving;
  }

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
    return this.add.container(0, 0, [body]);
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
