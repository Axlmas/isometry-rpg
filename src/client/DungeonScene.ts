import Phaser from 'phaser';
import { type Command, type Point, type World, TICK_MS, TILE_WALL, isMoving, isWalkable, step, tileAt } from '../sim';
import { TILE_HEIGHT, TILE_WIDTH, screenToTile, tileToScreen } from './iso';

const WALL_HEIGHT = 30;
const HALF_W = TILE_WIDTH / 2;
const HALF_H = TILE_HEIGHT / 2;
/** A press that travels further than this is a drag, not a tap. */
const TAP_SLOP_PX = 12;

export interface SceneEvents {
  /** The hero entered a new tile. */
  onStep(world: World): void;
  /** The hero finished walking. */
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
  private lastWalked = 0;
  private wasMoving = false;
  private mapObjects: Phaser.GameObjects.GameObject[] = [];
  private hero!: Phaser.GameObjects.Container;
  private marker!: Phaser.GameObjects.Graphics;
  private hover!: Phaser.GameObjects.Graphics;

  constructor(world: World, events: SceneEvents) {
    super('dungeon');
    this.world = world;
    this.events_ = events;
  }

  create(): void {
    this.marker = this.add.graphics().setDepth(-500).setVisible(false);
    this.drawDiamond(this.marker, 0xe8c36a, 0.55, 0.7);
    this.hover = this.add.graphics().setDepth(-600).setVisible(false);
    this.drawDiamond(this.hover, 0xffffff, 0.12, 1);
    this.hero = this.createHero();
    this.cameras.main.startFollow(this.hero, false, 0.12, 0.12);

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.getDistance() > TAP_SLOP_PX) return;
      const tile = screenToTile(pointer.worldX, pointer.worldY);
      if (!isWalkable(this.world.map, tile.x, tile.y)) return;
      this.pending.push({ type: 'moveTo', x: tile.x, y: tile.y });
      const at = tileToScreen(tile.x, tile.y);
      this.marker.setPosition(at.x, at.y).setVisible(true);
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      // Hover feedback is for mouse only; a finger has no hover state.
      if (pointer.wasTouch) return;
      const tile = screenToTile(pointer.worldX, pointer.worldY);
      const walkable = isWalkable(this.world.map, tile.x, tile.y);
      const at = tileToScreen(tile.x, tile.y);
      this.hover.setPosition(at.x, at.y).setVisible(walkable);
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
    this.previous = { ...world.player.pos };
    this.lastWalked = world.player.tilesWalked;
    this.wasMoving = false;
    this.marker.setVisible(false);
    this.hover.setVisible(false);
    for (const object of this.mapObjects) object.destroy();
    this.mapObjects = this.drawMap();
    this.placeHero(world.player.pos);
    this.cameras.main.centerOn(this.hero.x, this.hero.y);
  }

  override update(_time: number, delta: number): void {
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

  private afterTick(): void {
    const walked = this.world.player.tilesWalked;
    if (walked !== this.lastWalked) {
      this.lastWalked = walked;
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
    // Objects further down the screen are drawn on top. Walls use x + y, so
    // +0.5 puts the hero in front of the walls behind them and behind the
    // walls in front of them.
    this.hero.setDepth(pos.x + pos.y + 0.5);
  }

  private createHero(): Phaser.GameObjects.Container {
    const body = this.add.graphics();
    body.fillStyle(0x000000, 0.35).fillEllipse(0, 0, 30, 14);
    body.fillStyle(0x3f6fb5).fillRoundedRect(-9, -34, 18, 30, 7);
    body.fillStyle(0x2c4f85).fillRoundedRect(-9, -18, 18, 14, { tl: 0, tr: 0, bl: 7, br: 7 });
    body.fillStyle(0xf0d2b0).fillCircle(0, -42, 8);
    return this.add.container(0, 0, [body]);
  }

  private drawDiamond(g: Phaser.GameObjects.Graphics, color: number, fillAlpha: number, scale: number): void {
    const w = HALF_W * scale;
    const h = HALF_H * scale;
    g.fillStyle(color, fillAlpha);
    g.fillPoints([{ x: 0, y: -h }, { x: w, y: 0 }, { x: 0, y: h }, { x: -w, y: 0 }], true);
    g.lineStyle(2, color, Math.min(1, fillAlpha + 0.4));
    g.strokePoints([{ x: 0, y: -h }, { x: w, y: 0 }, { x: 0, y: h }, { x: -w, y: 0 }], true, true);
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
          floor.fillStyle(Phaser.Display.Color.GetColor(52 + shade, 56 + shade, 68 + shade));
          floor.fillPoints(
            [{ x: c.x, y: c.y - HALF_H }, { x: c.x + HALF_W, y: c.y }, { x: c.x, y: c.y + HALF_H }, { x: c.x - HALF_W, y: c.y }],
            true,
          );
          floor.lineStyle(1, 0x23262f, 1);
          floor.strokePoints(
            [{ x: c.x, y: c.y - HALF_H }, { x: c.x + HALF_W, y: c.y }, { x: c.x, y: c.y + HALF_H }, { x: c.x - HALF_W, y: c.y }],
            true, true,
          );
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
