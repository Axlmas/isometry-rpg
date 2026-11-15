import type Phaser from 'phaser';
import type { MonsterKind, NpcKind } from '../sim';
import { NPC_LOOK } from './npcText';

// Everything that walks is drawn here from simple shapes: a dark outline, a
// base colour and a darker shade for volume. Each figure stands on (0, 0),
// which is the point where its feet touch the ground.

type G = Phaser.GameObjects.Graphics;
const OUTLINE = 0x14110d;

/** Mixes a colour towards black (factor below 1) or white (above 1). */
export function tint(color: number, factor: number): number {
  const channel = (shift: number): number => {
    const value = (color >> shift) & 0xff;
    const mixed = factor <= 1 ? value * factor : value + (255 - value) * (factor - 1);
    return Math.max(0, Math.min(255, Math.round(mixed)));
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** A soft shadow on the ground under a figure. */
export function drawShadow(g: G, width: number): void {
  g.fillStyle(0x000000, 0.28).fillEllipse(0, 1, width, width * 0.42);
}

export interface PersonLook {
  clothes: number;
  skin?: number;
  hair?: number;
  /** A helmet instead of hair. */
  helmet?: number;
}

/** A person about 44 pixels tall: legs, belted tunic, arms, head. */
export function drawPerson(g: G, look: PersonLook): void {
  const { clothes } = look;
  const dark = tint(clothes, 0.68);
  const skin = look.skin ?? 0xe8c39e;
  g.lineStyle(1.5, OUTLINE, 1);
  // legs
  g.fillStyle(0x2f2a26).fillRect(-6, -13, 5, 13).fillRect(1, -13, 5, 13);
  g.strokeRect(-6, -13, 5, 13).strokeRect(1, -13, 5, 13);
  // boots
  g.fillStyle(0x4a3524).fillRect(-7, -3, 6, 3).fillRect(1, -3, 6, 3);
  // arms behind the body
  g.fillStyle(dark).fillRoundedRect(-11, -29, 5, 14, 2).fillRoundedRect(6, -29, 5, 14, 2);
  g.strokeRoundedRect(-11, -29, 5, 14, 2).strokeRoundedRect(6, -29, 5, 14, 2);
  g.fillStyle(skin).fillCircle(-8.5, -15, 2.4).fillCircle(8.5, -15, 2.4);
  // tunic: lit on the left, shaded on the right
  g.fillStyle(clothes).fillRoundedRect(-8, -31, 16, 20, 4);
  g.fillStyle(dark).fillRoundedRect(1, -31, 7, 20, { tl: 0, tr: 4, bl: 0, br: 4 });
  g.strokeRoundedRect(-8, -31, 16, 20, 4);
  g.fillStyle(0x3a2a1a).fillRect(-8, -18, 16, 2.5);
  g.fillStyle(0xd9b24a).fillRect(-1.5, -18.5, 3, 3.5);
  // head
  g.fillStyle(skin).fillCircle(0, -37, 6.5);
  g.strokeCircle(0, -37, 6.5);
  if (look.helmet !== undefined) {
    g.fillStyle(look.helmet).slice(0, -38, 7.2, Math.PI, 0, false).fillPath();
    g.fillStyle(tint(look.helmet, 0.7)).fillRect(-7.5, -39, 15, 2.2);
    g.lineStyle(1.5, OUTLINE, 1).beginPath().arc(0, -38, 7.2, Math.PI, 0, false).strokePath();
  } else {
    g.fillStyle(look.hair ?? 0x5a3a22).slice(0, -38.5, 6.8, Math.PI * 0.95, Math.PI * 0.05, false).fillPath();
  }
  g.fillStyle(OUTLINE).fillCircle(-2.3, -36.5, 0.9).fillCircle(2.3, -36.5, 0.9);
}

/** A villager: clothes in the colour of their trade. Guards wear a helmet and hold a spear. */
export function drawNpcFigure(g: G, kind: NpcKind): void {
  const look = NPC_LOOK[kind];
  drawShadow(g, 30);
  if (kind === 'guard') {
    // The spear stands behind the guard.
    g.lineStyle(2.5, 0x5a3f26, 1).lineBetween(12, 0, 12, -58);
    g.fillStyle(0xd7dbe2).fillTriangle(9, -56, 15, -56, 12, -68);
    g.lineStyle(1, OUTLINE, 1).strokeTriangle(9, -56, 15, -56, 12, -68);
    drawPerson(g, { clothes: look.clothes, helmet: 0xaab0bb });
    // A small round shield on the arm.
    g.fillStyle(0x7b2f2a).fillCircle(-9, -22, 6.5);
    g.lineStyle(1.5, OUTLINE, 1).strokeCircle(-9, -22, 6.5);
    g.fillStyle(0xd9b24a).fillCircle(-9, -22, 2);
    return;
  }
  const hair: Record<Exclude<NpcKind, 'guard'>, number> = { alchemist: 0xb7b0a0, outfitter: 0x3a2a1c, blacksmith: 0x241a14, trainer: 0x8a8f99, hunter: 0x7a4a22 };
  drawPerson(g, { clothes: look.clothes, hair: hair[kind] });
  if (kind === 'blacksmith') {
    // A leather apron.
    g.fillStyle(0x7a5230).fillRect(-5, -27, 10, 16);
    g.lineStyle(1, OUTLINE, 0.8).strokeRect(-5, -27, 10, 16);
  }
  // A sign over the head marks someone worth talking to.
  g.fillStyle(OUTLINE).fillCircle(0, -54, 5.5);
  g.fillStyle(look.sign).fillCircle(0, -54, 4.2);
  g.fillStyle(0xffffff, 0.6).fillCircle(-1.3, -55.3, 1.3);
}

/** A monster, facing right. `alert` paints it in the warning colour used just before it strikes. */
export function drawMonsterFigure(g: G, kind: MonsterKind, alert: boolean): void {
  g.lineStyle(1.5, OUTLINE, 1);
  if (kind === 'wolf') {
    const fur = alert ? 0xd8663a : 0x8b909a;
    const dark = tint(fur, 0.7);
    drawShadow(g, 34);
    g.fillStyle(dark).fillRect(-11, -8, 3.5, 8).fillRect(7, -8, 3.5, 8);
    g.lineStyle(3, fur, 1).lineBetween(-13, -14, -19, -20); // tail
    g.lineStyle(1.5, OUTLINE, 1);
    g.fillStyle(fur).fillEllipse(0, -13, 30, 13);
    g.strokeEllipse(0, -13, 30, 13);
    g.fillStyle(tint(fur, 1.25)).fillEllipse(-2, -15, 18, 5);
    g.fillStyle(fur).fillRect(-7, -8, 3.5, 8).fillRect(3, -8, 3.5, 8);
    g.fillStyle(fur).fillCircle(13, -18, 6.5);
    g.strokeCircle(13, -18, 6.5);
    g.fillStyle(tint(fur, 1.2)).fillTriangle(15, -18, 22, -16, 15, -13); // muzzle
    g.fillStyle(dark).fillTriangle(9, -23, 11, -30, 13.5, -23).fillTriangle(13.5, -23, 16, -30, 18, -22);
    g.fillStyle(0xfff2a8).fillCircle(14.5, -19.5, 1.4);
    g.fillStyle(OUTLINE).fillCircle(21.5, -16, 1.2);
    return;
  }
  if (kind === 'boar') {
    const hide = alert ? 0xd8663a : 0x5d4737;
    const dark = tint(hide, 0.65);
    drawShadow(g, 40);
    g.fillStyle(dark).fillRect(-12, -7, 4.5, 7).fillRect(8, -7, 4.5, 7);
    g.fillStyle(hide).fillEllipse(-1, -15, 36, 21);
    g.strokeEllipse(-1, -15, 36, 21);
    // bristles along the back
    g.fillStyle(dark);
    for (let i = -12; i <= 8; i += 5) g.fillTriangle(i, -24, i + 2.5, -30, i + 5, -24);
    g.fillStyle(hide).fillRect(-7, -7, 4.5, 7).fillRect(3, -7, 4.5, 7);
    g.fillStyle(tint(hide, 1.15)).fillEllipse(15, -13, 15, 13);
    g.strokeEllipse(15, -13, 15, 13);
    g.fillStyle(0xc98f86).fillEllipse(21.5, -11.5, 5, 6);
    g.fillStyle(0xf4e9c8).fillTriangle(16, -8, 20, -8, 19, -15); // tusk
    g.fillStyle(0xfff2a8).fillCircle(14, -16.5, 1.4);
    return;
  }
  // The ghoul of the mines: hunched, grey-green, long arms and pale eyes.
  const flesh = alert ? 0xd8663a : 0x6f7d68;
  const dark = tint(flesh, 0.65);
  drawShadow(g, 30);
  g.fillStyle(dark).fillRect(-6, -11, 5, 11).fillRect(1, -11, 5, 11);
  g.fillStyle(dark).fillRoundedRect(-13, -27, 5, 20, 2).fillRoundedRect(8, -27, 5, 20, 2);
  g.strokeRoundedRect(-13, -27, 5, 20, 2).strokeRoundedRect(8, -27, 5, 20, 2);
  g.fillStyle(flesh).fillRoundedRect(-9, -30, 18, 21, 7);
  g.fillStyle(dark).fillRoundedRect(1, -30, 8, 21, { tl: 0, tr: 7, bl: 0, br: 7 });
  g.strokeRoundedRect(-9, -30, 18, 21, 7);
  g.fillStyle(flesh).fillEllipse(2, -34, 15, 12);
  g.strokeEllipse(2, -34, 15, 12);
  g.fillStyle(0xe6ffd0).fillCircle(0, -35, 2).fillCircle(6, -35, 2);
  g.fillStyle(OUTLINE).fillCircle(0.5, -35, 0.8).fillCircle(6.5, -35, 0.8).fillRect(0, -30.5, 6, 1.2);
  g.fillStyle(0xd9d2c0).fillTriangle(-13, -7, -10.5, -1, -8, -7).fillTriangle(8, -7, 10.5, -1, 13, -7); // claws
}

/** The hero's blade, lying along +x from the hand at (0, 0); it is rotated to point where the hero faces. */
export function drawBlade(g: G, charged: boolean): void {
  g.clear();
  const steel = charged ? 0x9ff0ff : 0xd9dde6;
  g.lineStyle(1.5, OUTLINE, 1);
  g.fillStyle(steel).fillPoints([{ x: 4, y: -2.2 }, { x: 22, y: -1.6 }, { x: 26, y: 0 }, { x: 22, y: 1.6 }, { x: 4, y: 2.2 }], true);
  g.strokePoints([{ x: 4, y: -2.2 }, { x: 22, y: -1.6 }, { x: 26, y: 0 }, { x: 22, y: 1.6 }, { x: 4, y: 2.2 }], true, true);
  g.fillStyle(0xd9b24a).fillRect(2, -4.5, 2.5, 9);
  g.fillStyle(0x5a3f26).fillRect(-3, -1.5, 5, 3);
  if (charged) g.lineStyle(1, 0xffffff, 0.8).lineBetween(6, 0, 22, 0);
}

/** What the hero looks like: race, class and what they wear. */
export interface HeroLook {
  race: 'human' | 'elf';
  cls: 'warrior' | 'archer' | 'mage';
  /** Colour of the body armour, or null when none is worn. */
  armor: number | null;
  helmet: number | null;
  boots: number | null;
}

const CLASS_CLOTHES: Record<HeroLook['cls'], number> = { warrior: 0x3f6fb5, archer: 0x3f7d4a, mage: 0x6a4a9c };

/** The hero: clothes in the colour of the class, the ears of the race, and the armour actually worn. */
export function drawHeroFigure(g: G, look: HeroLook): void {
  g.clear();
  const clothes = look.armor ?? CLASS_CLOTHES[look.cls];
  drawPerson(g, { clothes, hair: look.race === 'elf' ? 0xd9c27a : 0x6b4a2a, ...(look.helmet !== null ? { helmet: look.helmet } : {}) });
  g.lineStyle(1.5, OUTLINE, 1);
  if (look.armor !== null) {
    // Worn armour keeps a stripe of the class colour, so the class still reads at a glance.
    g.fillStyle(CLASS_CLOTHES[look.cls]).fillRect(-8, -31, 16, 3);
  }
  if (look.cls === 'mage' && look.armor === null) {
    // A robe reaches down over the legs.
    g.fillStyle(clothes).fillPoints([{ x: -8, y: -14 }, { x: 8, y: -14 }, { x: 10, y: -2 }, { x: -10, y: -2 }], true);
    g.fillStyle(tint(clothes, 0.68)).fillPoints([{ x: 1, y: -14 }, { x: 8, y: -14 }, { x: 10, y: -2 }, { x: 1, y: -2 }], true);
    g.strokePoints([{ x: -8, y: -14 }, { x: -10, y: -2 }, { x: 10, y: -2 }, { x: 8, y: -14 }], false);
  }
  if (look.boots !== null) {
    g.fillStyle(look.boots).fillRect(-7, -5, 6, 5).fillRect(1, -5, 6, 5);
    g.strokeRect(-7, -5, 6, 5).strokeRect(1, -5, 6, 5);
  }
  if (look.race === 'elf' && look.helmet === null) {
    // Pointed ears.
    g.fillStyle(0xe8c39e).fillTriangle(-6, -38, -11, -43, -5.5, -34).fillTriangle(6, -38, 11, -43, 5.5, -34);
    g.strokeTriangle(-6, -38, -11, -43, -5.5, -34).strokeTriangle(6, -38, 11, -43, 5.5, -34);
  }
}

/**
 * The weapon in the hero's hand, lying along +x from the hand at (0, 0); it
 * is rotated to point where the hero faces. `kind` is null for bare hands.
 */
export function drawWeapon(g: G, kind: 'sword' | 'bow' | 'staff' | null, color: number, charged: boolean): void {
  g.clear();
  if (kind === null) return;
  if (kind === 'sword') {
    drawBlade(g, charged);
    if (!charged) {
      // The blade takes the colour of the item (wood, iron, graded steel).
      g.fillStyle(color).fillPoints([{ x: 4, y: -2.2 }, { x: 22, y: -1.6 }, { x: 26, y: 0 }, { x: 22, y: 1.6 }, { x: 4, y: 2.2 }], true);
      g.lineStyle(1.5, OUTLINE, 1).strokePoints([{ x: 4, y: -2.2 }, { x: 22, y: -1.6 }, { x: 26, y: 0 }, { x: 22, y: 1.6 }, { x: 4, y: 2.2 }], true, true);
    }
    return;
  }
  if (kind === 'bow') {
    // Held upright in front of the hand: an arc with a string, and an arrow on it.
    g.lineStyle(4.5, OUTLINE, 1).beginPath().arc(2, 0, 13, -Math.PI / 2.4, Math.PI / 2.4, false).strokePath();
    g.lineStyle(2.5, color, 1).beginPath().arc(2, 0, 13, -Math.PI / 2.4, Math.PI / 2.4, false).strokePath();
    g.lineStyle(1, 0xe8dcc0, 1).lineBetween(5.4, -12.5, 5.4, 12.5);
    g.lineStyle(1.5, charged ? 0x9ff0ff : 0xe8d9b0, 1).lineBetween(5, 0, 22, 0);
    g.fillStyle(charged ? 0x9ff0ff : 0xcfd3dc).fillTriangle(22, -2.5, 22, 2.5, 27, 0);
    return;
  }
  // A staff with an orb at the far end.
  g.lineStyle(4.5, OUTLINE, 1).lineBetween(-10, 0, 20, 0);
  g.lineStyle(2.5, 0x6e4a24, 1).lineBetween(-10, 0, 20, 0);
  g.fillStyle(OUTLINE).fillCircle(23, 0, 6);
  g.fillStyle(charged ? 0x9ff0ff : color).fillCircle(23, 0, 4.6);
  g.fillStyle(0xffffff, 0.75).fillCircle(21.5, -1.5, 1.5);
}
