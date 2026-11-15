import { type World, TILE_WALL, isRoad, regionAt, tileAt } from '../sim';
import { REGION_LOOK, ROAD_COLOR } from './zoneText';

/** Pixels per tile before the map is turned and squashed to match the game view. */
const SCALE = 5;

const css = ([r, g, b]: readonly [number, number, number], factor = 1): string =>
  `rgb(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)})`;

/**
 * A small round map of the hero's surroundings, turned the same way as the
 * game view so that "up" on the map is "up" on the screen. Dots: yellow for
 * villagers, red for monsters, violet for doorways, white for the hero.
 */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private world: World | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  }

  /** Paints the terrain once per map; only the dots are redrawn afterwards. */
  private prepare(world: World): void {
    const { map, zone } = world;
    const base = document.createElement('canvas');
    base.width = map.width * SCALE;
    base.height = map.height * SCALE;
    const ctx = base.getContext('2d') as CanvasRenderingContext2D;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const look = REGION_LOOK[regionAt(zone, { x, y }).id];
        const wall = tileAt(map, x, y) === TILE_WALL;
        ctx.fillStyle = wall ? css(look.floor, look.walls === 'trees' ? 0.55 : 0.3) : css(isRoad(zone, x, y) ? ROAD_COLOR : look.floor);
        ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
      }
    }
    this.base = base;
    this.world = world;
  }

  draw(world: World): void {
    if (world !== this.world || !this.base) this.prepare(world);
    const { ctx, canvas } = this;
    const half = canvas.width / 2;
    const { pos } = world.player;
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#07080b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // The same turn and squash as the isometric view of the game.
    ctx.translate(half, half);
    ctx.scale(1, 0.5);
    ctx.rotate(Math.PI / 4);
    // Tile (x, y) is centred on (x, y), so its square starts half a tile earlier.
    ctx.translate(-(pos.x + 0.5) * SCALE, -(pos.y + 0.5) * SCALE);
    ctx.drawImage(this.base as HTMLCanvasElement, 0, 0);
    const dot = (x: number, y: number, color: string, size: number) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc((x + 0.5) * SCALE, (y + 0.5) * SCALE, size, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const exit of world.exits) dot(exit.pos.x, exit.pos.y, '#c9a6ff', 5);
    for (const npc of world.npcs) dot(npc.pos.x, npc.pos.y, '#f2c94c', 4);
    for (const monster of world.monsters) dot(monster.pos.x, monster.pos.y, '#e0503f', 3.2);
    ctx.restore();
    // The hero is always in the middle.
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(half, half, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(half, half, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
