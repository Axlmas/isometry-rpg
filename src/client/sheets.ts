import type Phaser from 'phaser';
import type { ClassId, MonsterKind, NpcKind } from '../sim';

// Characters are drawn from sprite sheets rendered out of 3D models by
// tools/sprites (see docs/ASSETS.md). Each sheet has a small JSON file next
// to it that says which frames make up which animation in which direction.

/** Width and height of one frame in the sheets, in pixels. Must match tools/sprites/page.html. */
const FRAME = 160;

export type AnimationName = 'idle' | 'run' | 'attack' | 'hit' | 'death';

interface SheetMeta {
  /** Frames are drawn larger than shown; this is the factor to show them at. */
  scale: number;
  /** Where the character's feet are inside a frame, as shares of its width and height. */
  anchor: { x: number; y: number };
  directions: number[];
  animations: Partial<Record<AnimationName, Record<string, number[]>>>;
}

export const HERO_SHEET: Record<ClassId, string> = { warrior: 'warrior', archer: 'archer', mage: 'mage' };
/** Monsters that have a sheet; the others are still drawn from shapes. */
export const MONSTER_SHEET: Partial<Record<MonsterKind, string>> = { grunt: 'skeleton' };
export const NPC_SHEET: Record<NpcKind, string> = {
  alchemist: 'npc-alchemist',
  outfitter: 'npc-outfitter',
  blacksmith: 'npc-blacksmith',
  trainer: 'npc-trainer',
  hunter: 'npc-hunter',
  guard: 'npc-guard',
};
const SHEETS = [...new Set([...Object.values(HERO_SHEET), ...Object.values(MONSTER_SHEET), ...Object.values(NPC_SHEET)])];

/** Frames per second and whether the animation loops. Attack, hit and death play once. */
const TIMING: Record<AnimationName, { rate: number; repeat: number }> = {
  idle: { rate: 4, repeat: -1 },
  run: { rate: 14, repeat: -1 },
  attack: { rate: 15, repeat: 0 },
  hit: { rate: 12, repeat: 0 },
  death: { rate: 9, repeat: 0 },
};

/** Queues every sheet for loading. Call from the scene's preload(). */
export function preloadSheets(scene: Phaser.Scene): void {
  for (const name of SHEETS) {
    scene.load.spritesheet(name, `sprites/${name}.webp`, { frameWidth: FRAME, frameHeight: FRAME });
    scene.load.json(`${name}.meta`, `sprites/${name}.json`);
  }
}

const metaOf = (scene: Phaser.Scene, sheet: string): SheetMeta | null =>
  scene.textures.exists(sheet) ? ((scene.cache.json.get(`${sheet}.meta`) as SheetMeta | undefined) ?? null) : null;

const animationKey = (sheet: string, animation: AnimationName, direction: number): string => `${sheet}:${animation}:${direction}`;

/** Registers the animations of every sheet that loaded. Call once, from the scene's create(). */
export function createAnimations(scene: Phaser.Scene): void {
  for (const sheet of SHEETS) {
    const meta = metaOf(scene, sheet);
    if (!meta) continue;
    for (const [animation, byDirection] of Object.entries(meta.animations) as Array<[AnimationName, Record<string, number[]>]>) {
      for (const [direction, frames] of Object.entries(byDirection)) {
        const key = animationKey(sheet, animation, Number(direction));
        if (scene.anims.exists(key)) continue;
        scene.anims.create({ key, frames: scene.anims.generateFrameNumbers(sheet, { frames }), frameRate: TIMING[animation].rate, repeat: TIMING[animation].repeat });
      }
    }
  }
}

/** True when the sheet and its description arrived; otherwise the caller falls back to shapes. */
export function hasSheet(scene: Phaser.Scene, sheet: string | undefined): sheet is string {
  return sheet !== undefined && metaOf(scene, sheet) !== null;
}

/** A sprite of the given sheet, standing on its feet at (0, 0). */
export function createCharacter(scene: Phaser.Scene, sheet: string): Phaser.GameObjects.Sprite {
  const meta = metaOf(scene, sheet) as SheetMeta;
  return scene.add.sprite(0, 0, sheet, 0).setOrigin(meta.anchor.x, meta.anchor.y).setScale(meta.scale);
}

/**
 * Which of the eight directions a character faces, from where it looks in
 * the game's tile coordinates. Direction 0 looks along +x and they go round
 * through +y, matching how the sheets were rendered.
 */
export function directionOf(x: number, y: number): number {
  return ((Math.round(Math.atan2(y, x) / (Math.PI / 4)) % 8) + 8) % 8;
}

/**
 * Makes the sprite show an animation in a direction. If it is already
 * showing that animation in another direction (the character turned), the
 * animation carries on from the same frame instead of starting over.
 */
export function playCharacter(scene: Phaser.Scene, sprite: Phaser.GameObjects.Sprite, sheet: string, animation: AnimationName, direction: number): void {
  const meta = metaOf(scene, sheet);
  if (!meta) return;
  // A sheet rendered in fewer directions (a villager) uses the one it has.
  const facing = meta.directions.includes(direction) ? direction : (meta.directions[0] as number);
  const key = animationKey(sheet, meta.animations[animation] ? animation : 'idle', facing);
  const current = sprite.anims.currentAnim?.key;
  if (current === key) return;
  const sameAnimation = current !== undefined && current.split(':')[1] === animation && current.split(':')[0] === sheet;
  const startFrame = sameAnimation ? Math.max(0, (sprite.anims.currentFrame?.index ?? 1) - 1) : 0;
  sprite.anims.play({ key, startFrame }, false);
}
