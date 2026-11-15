import type Phaser from 'phaser';
import { type ClassId, type ItemId, type MonsterKind, type NpcKind, ITEMS } from '../sim';

// Characters are drawn from sprite sheets (see docs/ASSETS.md and
// tools/ai-sprites). Each sheet has a small JSON file next to it that says
// which frames make up which animation in which direction.

/** Width and height of one frame in the sheets, in pixels. Must match tools/ai-sprites/build.py. */
const FRAME = 192;

export type AnimationName = 'idle' | 'run' | 'attack' | 'hit' | 'death';

interface SheetMeta {
  /** Frames are drawn larger than shown; this is the factor to show them at. */
  scale: number;
  /** Where the character's feet are inside a frame, as shares of its width and height. */
  anchor: { x: number; y: number };
  directions: number[];
  animations: Partial<Record<AnimationName, Record<string, number[]>>>;
}

/**
 * How a hero looks depends on the body armour worn: a peasant's clothes
 * without any, leather in ungraded armour, steel (or a battle robe) in graded.
 */
export const HERO_LOOKS = 3;
export function heroSheet(cls: ClassId, look: number): string {
  return `${cls}-t${look}`;
}
export function heroLook(armor: ItemId | null): number {
  const def = armor ? ITEMS[armor] : null;
  if (!def || def.kind !== 'equipment') return 0;
  return def.grade === 'none' ? 1 : 2;
}

/** Monsters that have a sheet; the others are still drawn from shapes. The young wolf is a small wolf. */
export const MONSTER_SHEET: Partial<Record<MonsterKind, string>> = { wolfPup: 'wolf', wolf: 'wolf', boar: 'boar', tusker: 'tusker', grunt: 'ghoul' };
/** How large each sheet is shown, in screen pixels per frame pixel. */
const SHEET_SCALE: Record<string, number> = { wolf: 0.42, boar: 0.5, tusker: 0.6, ghoul: 0.56 };
const DEFAULT_SCALE = 0.56;
export const NPC_SHEET: Record<NpcKind, string> = {
  alchemist: 'npc-alchemist',
  outfitter: 'npc-outfitter',
  blacksmith: 'npc-blacksmith',
  trainer: 'npc-trainer',
  hunter: 'npc-hunter',
  guard: 'npc-guard',
};
const HERO_SHEETS = (['warrior', 'archer', 'mage'] as const).flatMap((cls) => [0, 1, 2].map((look) => heroSheet(cls, look)));
const SHEETS = [...new Set([...HERO_SHEETS, ...Object.values(MONSTER_SHEET), ...Object.values(NPC_SHEET)])];

/** Frames per second and whether the animation loops. Attack, hit and death play once. */
const TIMING: Record<AnimationName, { rate: number; repeat: number }> = {
  idle: { rate: 4, repeat: -1 },
  run: { rate: 14, repeat: -1 },
  attack: { rate: 20, repeat: 0 },
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

/** Whether a sheet has its own picture of this animation (some have no death, for one). */
export function hasAnimation(scene: Phaser.Scene, sheet: string, animation: AnimationName): boolean {
  return metaOf(scene, sheet)?.animations[animation] !== undefined;
}

/** True when the sheet and its description arrived; otherwise the caller falls back to shapes. */
export function hasSheet(scene: Phaser.Scene, sheet: string | undefined): sheet is string {
  return sheet !== undefined && metaOf(scene, sheet) !== null;
}

/** A sprite of the given sheet, standing on its feet at (0, 0). */
export function createCharacter(scene: Phaser.Scene, sheet: string): Phaser.GameObjects.Sprite {
  const meta = metaOf(scene, sheet) as SheetMeta;
  return scene.add.sprite(0, 0, sheet, 0).setOrigin(meta.anchor.x, meta.anchor.y).setScale(SHEET_SCALE[sheet] ?? DEFAULT_SCALE);
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
  // Not every animation exists in every direction: the nearest one that does is used.
  const known = meta.animations[animation] ? animation : 'idle';
  const available = Object.keys(meta.animations[known] ?? {}).map(Number);
  if (available.length === 0) return;
  const turn = (a: number, b: number): number => Math.min((a - b + 8) % 8, (b - a + 8) % 8);
  // Of two equally near, the one facing the viewer reads better.
  const facing = available.reduce((best, candidate) =>
    turn(candidate, direction) < turn(best, direction) || (turn(candidate, direction) === turn(best, direction) && turn(candidate, 1) < turn(best, 1)) ? candidate : best);
  const key = animationKey(sheet, known, facing);
  const current = sprite.anims.currentAnim?.key;
  if (current === key) return;
  const sameAnimation = current !== undefined && current.split(':')[1] === animation && current.split(':')[0] === sheet;
  const startFrame = sameAnimation ? Math.max(0, (sprite.anims.currentFrame?.index ?? 1) - 1) : 0;
  sprite.anims.play({ key, startFrame }, false);
}
