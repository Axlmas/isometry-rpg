import { type ItemId, type Quality, ITEMS } from '../sim';

// Item icons are drawn here as small vector pictures, so the game ships no
// image files. Every icon fits a 32x32 box. All the markup below is fixed
// text from this file, never player input.
//
// The pictures are shaded rather than flat: every surface is filled with a
// gradient lit from the top left, outlines are thin and dark, and a faint
// highlight marks the lit edge. The gradients are declared once, in a hidden
// <svg> at the end of the page, because the same icon is put into the page
// many times and gradient ids must stay unique in a document.

/** Mixes two `#rrggbb` colours; `amount` 0 gives the first one, 1 the second. */
function mix(from: string, to: string, amount: number): string {
  const channel = (hex: string, at: number): number => parseInt(hex.slice(at, at + 2), 16);
  let out = '#';
  for (const at of [1, 3, 5]) {
    const value = Math.round(channel(from, at) + (channel(to, at) - channel(from, at)) * amount);
    out += value.toString(16).padStart(2, '0');
  }
  return out;
}

/** Lightens a colour (positive amount) or darkens it (negative amount). */
export function shade(color: string, amount: number): string {
  return amount >= 0 ? mix(color, '#ffffff', amount) : mix(color, '#000000', -amount);
}

const paintIds = new Map<string, string>();
const paintDefs: string[] = [];
let mountedPaints = 0;
let paintHost: HTMLElement | null = null;

/** Evenly spaced gradient stops. A stop is `#rrggbb` or `#rrggbb@opacity`. */
function stopsMarkup(stops: readonly string[]): string {
  return stops.map((stop, index) => {
    const [color, opacity] = stop.split('@');
    const offset = stops.length > 1 ? index / (stops.length - 1) : 0;
    return `<stop offset="${offset.toFixed(3)}" stop-color="${color}"${opacity ? ` stop-opacity="${opacity}"` : ''}/>`;
  }).join('');
}

function paint(key: string, build: (id: string) => string): string {
  let id = paintIds.get(key);
  if (!id) {
    id = `icon-paint-${paintIds.size}`;
    paintIds.set(key, id);
    paintDefs.push(build(id));
  }
  return `url(#${id})`;
}

/**
 * A linear gradient to use as `fill` or `stroke`. By default it runs across the
 * shape's own box from the top left corner; with `user` set, the coordinates
 * are those of the 32x32 icon, which is what thin straight strokes need.
 */
export function lin(stops: readonly string[], x1 = 0, y1 = 0, x2 = 1, y2 = 1, user = false): string {
  const key = `l|${stops.join(',')}|${x1},${y1},${x2},${y2},${user}`;
  return paint(key, (id) => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${user ? ' gradientUnits="userSpaceOnUse"' : ''}>${stopsMarkup(stops)}</linearGradient>`);
}

/** A radial gradient across the shape's own box, brightest at (cx, cy). */
export function rad(stops: readonly string[], cx = 0.35, cy = 0.3, r = 0.75): string {
  const key = `r|${stops.join(',')}|${cx},${cy},${r}`;
  return paint(key, (id) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stopsMarkup(stops)}</radialGradient>`);
}

/** Puts the gradients used by the icons into the page. Safe to call often. */
export function mountIconPaints(): void {
  if (mountedPaints === paintDefs.length && paintHost?.isConnected) return;
  if (!paintHost) {
    paintHost = document.createElement('div');
    paintHost.setAttribute('aria-hidden', 'true');
    // Not `display: none`: gradients inside an undisplayed <svg> are not applied by every browser.
    paintHost.style.cssText = 'position:absolute;inline-size:0;block-size:0;overflow:hidden;pointer-events:none';
  }
  paintHost.innerHTML = `<svg width="0" height="0" focusable="false"><defs>${paintDefs.join('')}</defs></svg>`;
  if (!paintHost.isConnected) document.body.append(paintHost);
  mountedPaints = paintDefs.length;
}

// Materials. Each returns a paint lit from the top left.
/** Polished metal: bright edge, dark belly, a faint reflected light below. */
export const metal = (color: string): string => lin([shade(color, 0.5), color, shade(color, -0.5), shade(color, -0.2)]);
/** Leather, wood, cloth, paper: a soft falloff without a reflection. */
export const matte = (color: string): string => lin([shade(color, 0.22), color, shade(color, -0.45)]);
/** Glass, gems and liquids: a bright spot and a deep edge. */
export const glass = (color: string): string => rad([shade(color, 0.6), color, shade(color, -0.6)]);

export const INK = '#120e0a';
/** A thin dark outline. */
export const OUTLINE = `stroke="${INK}" stroke-width="0.8" stroke-linejoin="round" stroke-linecap="round"`;

/** A round bar drawn along a path: dark edge, body, and a lit side. */
export function rod(d: string, color: string, width: number): string {
  return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${width + 1.4}" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="${d}" fill="none" stroke="${shade(color, -0.2)}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="${d}" fill="none" stroke="${shade(color, 0.3)}" stroke-width="${(width * 0.4).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" transform="translate(-0.35 -0.35)"/>`;
}

/** A faint light line along a lit edge. */
export const glint = (d: string, opacity = 0.4, width = 0.8): string =>
  `<path d="${d}" fill="none" stroke="#fff6e0" stroke-opacity="${opacity}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;

const IRON = '#8b8f95';
const D_STEEL = '#6d87a8';
const LEATHER = '#7d5632';
const TANNED = '#5f3d20';
const WOOD = '#735031';
const DARK_WOOD = '#4d3521';
const PAPER = '#c4b48c';
const GOLD = '#b08a3a';
const BONE = '#cdc5ad';

const sword = (blade: string, guard: string, wide = false): string => {
  const upper = wide ? 'M8.3 19.3 L22.8 4.8 L27.5 4.5 L10.5 21.5 Z' : 'M9 20 L23.5 5.5 L27.5 4.5 L10.5 21.5 Z';
  const lower = wide ? 'M12.7 23.7 L27.2 9.2 L27.5 4.5 L10.5 21.5 Z' : 'M12 23 L26.5 8.5 L27.5 4.5 L10.5 21.5 Z';
  const whole = wide ? 'M8.3 19.3 L22.8 4.8 L27.5 4.5 L27.2 9.2 L12.7 23.7 Z' : 'M9 20 L23.5 5.5 L27.5 4.5 L26.5 8.5 L12 23 Z';
  return `<path d="${upper}" fill="${lin([shade(blade, 0.55), shade(blade, 0.1)], 1, 0, 0, 1)}"/>`
    + `<path d="${lower}" fill="${lin([shade(blade, -0.15), shade(blade, -0.55)], 1, 0, 0, 1)}"/>`
    + `<path d="${whole}" fill="none" ${OUTLINE}/>`
    + glint('M11.5 19 L24 6.5', 0.35, 0.6)
    + rod('M9.6 22.4 L6 26', TANNED, 1.8)
    + rod('M6.3 17.3 L14.7 25.7', guard, 2)
    + `<circle cx="5.3" cy="26.7" r="1.9" fill="${glass(guard)}" ${OUTLINE}/>`;
};

const helmet = (color: string, plate: boolean): string => {
  const fill = plate ? metal(color) : matte(color);
  return `<path d="M6 22 Q6 7 16 7 Q26 7 26 22 Z" fill="${fill}" ${OUTLINE}/>`
    + `<path d="M5 22 H27 V25.5 H5 Z" fill="${plate ? metal(shade(color, -0.2)) : matte(shade(color, -0.25))}" ${OUTLINE}/>`
    + (plate
      ? `<path d="M14.8 13 H17.2 V28 H14.8 Z" fill="${metal(shade(color, -0.1))}" ${OUTLINE}/>`
        + `<path d="M16 7 V13" stroke="${INK}" stroke-opacity="0.45" stroke-width="0.7"/>`
        + `<g fill="${shade(color, 0.45)}"><circle cx="8.5" cy="23.7" r="0.6"/><circle cx="12" cy="23.7" r="0.6"/><circle cx="20" cy="23.7" r="0.6"/><circle cx="23.5" cy="23.7" r="0.6"/></g>`
      : `<path d="M16 7 Q13.5 14 13 22 M16 7 Q18.5 14 19 22" fill="none" stroke="${INK}" stroke-opacity="0.4" stroke-width="0.7"/>`
        + `<path d="M6.5 23.7 H25.5" stroke="${shade(color, 0.3)}" stroke-opacity="0.6" stroke-width="0.6" stroke-dasharray="1.2 1.2"/>`)
    + glint('M8.6 17.5 Q9.2 10.8 14 9.2', plate ? 0.5 : 0.25, 1);
};

const vest = (color: string, mail: boolean): string => {
  const body = 'M9 6 L13 6 Q16 10 19 6 L23 6 L28 11 L24 15 L24 27 L8 27 L8 15 L4 11 Z';
  return `<path d="${body}" fill="${mail ? metal(color) : matte(color)}" ${OUTLINE}/>`
    + (mail
      ? `<g stroke="${INK}" stroke-opacity="0.5" stroke-width="0.9" stroke-dasharray="1.1 1.1" fill="none"><path d="M9 12.5 H23"/><path d="M8.6 14.5 H23.4" stroke-dashoffset="1.1"/><path d="M8.6 16.5 H23.4"/><path d="M8.6 18.5 H23.4" stroke-dashoffset="1.1"/><path d="M8.6 20.5 H23.4"/><path d="M8.6 22.5 H23.4" stroke-dashoffset="1.1"/><path d="M8.6 24.5 H23.4"/></g>`
        + `<path d="M13 6 Q16 10 19 6" fill="none" stroke="${shade(color, 0.4)}" stroke-width="1"/>`
      : `<path d="M16 9 V27" stroke="${INK}" stroke-opacity="0.45" stroke-width="0.7"/>`
        + `<path d="M14.6 12 L17.4 14 M14.6 15 L17.4 17 M14.6 18 L17.4 20" stroke="${shade(color, 0.35)}" stroke-opacity="0.7" stroke-width="0.6"/>`
        + `<path d="M8 21.5 H24 V24 H8 Z" fill="${matte(shade(color, -0.3))}" stroke="${INK}" stroke-width="0.6"/>`
        + `<rect x="14.6" y="21.3" width="2.8" height="2.9" fill="${metal(GOLD)}" stroke="${INK}" stroke-width="0.5"/>`)
    + glint('M9.3 7 L5.3 11 M9 15.5 V20', 0.3, 0.7);
};

const boot = (color: string, plate: boolean): string =>
  `<path d="M11 5 H19 V18 Q27 19 27 24 V25 H8 V18 Z" fill="${plate ? metal(color) : matte(color)}" ${OUTLINE}/>`
  + `<path d="M7.5 25 H27.5 V27.5 H7.5 Z" fill="${matte(shade(color, -0.55))}" ${OUTLINE}/>`
  + `<path d="M10.5 5 H19.5 V8 H10.5 Z" fill="${plate ? metal(shade(color, 0.1)) : matte(shade(color, -0.2))}" ${OUTLINE}/>`
  + (plate
    ? `<path d="M11 12 H19 M10 16 H19 M19 18 Q20 22 19.5 25" fill="none" stroke="${INK}" stroke-opacity="0.45" stroke-width="0.7"/>`
    : `<path d="M14 10 L17.5 11.5 M14 13 L17.5 14.5 M14 16 L17.5 17.5" stroke="${shade(color, 0.4)}" stroke-opacity="0.7" stroke-width="0.6"/>`)
  + glint('M12 9 V17 L9.2 18.6', plate ? 0.45 : 0.25, 0.8);

const glove = (color: string, plate: boolean): string =>
  `<path d="M9 27 V15 L7 9 Q8 6 10.5 8 L12 12 V6 Q13.5 3.5 15 6 V11 V5 Q16.5 2.5 18 5 V11 V6 Q19.5 3.5 21 6 V13 L23 11 Q25.5 10 25 13 L22 19 V27 Z" fill="${plate ? metal(color) : matte(color)}" ${OUTLINE}/>`
  + `<path d="M8.5 22 H22.5 V27.5 H8.5 Z" fill="${plate ? metal(shade(color, -0.15)) : matte(shade(color, -0.3))}" ${OUTLINE}/>`
  + `<path d="M12 12 V16 M15 11 V16 M18 11 V16" stroke="${INK}" stroke-opacity="0.45" stroke-width="0.7"/>`
  + (plate ? `<path d="M9.5 17.5 H21.5 M9.5 19.7 H21.5" stroke="${INK}" stroke-opacity="0.4" stroke-width="0.6"/>` : '')
  + glint('M9.8 26 V23 M13 6.4 V10', plate ? 0.45 : 0.25, 0.7);

const flask = (liquid: string): string =>
  `<path d="M13 6 H19 V11 L25 21 Q27 27 21 27 H11 Q5 27 7 21 L13 11 Z" fill="${lin(['#aab4b8@0.35', '#4a5458@0.25', '#1c2226@0.5'])}" ${OUTLINE}/>`
  + `<path d="M10.4 16.5 H21.6 L24.4 21.4 Q25.8 26 21 26 H11 Q6.2 26 7.6 21.4 Z" fill="${glass(liquid)}"/>`
  + `<path d="M10.4 16.5 H21.6" stroke="${shade(liquid, 0.45)}" stroke-opacity="0.8" stroke-width="0.7"/>`
  + `<path d="M12.2 3.6 H19.8 V6.4 H12.2 Z" fill="${matte('#7a5c3a')}" ${OUTLINE}/>`
  + glint('M13.8 8 V11.4 L9.4 19', 0.45, 0.8)
  + `<ellipse cx="11.2" cy="21.6" rx="1" ry="1.8" fill="#ffffff" fill-opacity="0.3" transform="rotate(28 11.2 21.6)"/>`;

const crystal = (color: string): string =>
  `<path d="M16 3 L8 12 L14 29 L16 29 Z" fill="${lin([shade(color, 0.5), shade(color, -0.05)], 0, 0, 0, 1)}"/>`
  + `<path d="M16 3 L24 12 L18 29 L16 29 Z" fill="${lin([shade(color, -0.1), shade(color, -0.6)], 0, 0, 0, 1)}"/>`
  + `<path d="M16 3 L20 12 L16 14.5 L12 12 Z" fill="#ffffff" fill-opacity="0.22"/>`
  + `<path d="M8 12 L12 12 L16 14.5 L20 12 L24 12 M16 14.5 V29" fill="none" stroke="${shade(color, 0.6)}" stroke-opacity="0.45" stroke-width="0.6"/>`
  + `<path d="M16 3 L24 12 L18 29 L14 29 L8 12 Z" fill="none" ${OUTLINE}/>`
  + glint('M15.2 5 L9.6 11.6', 0.5, 0.7);

const ROLL = lin([shade(PAPER, -0.5), shade(PAPER, 0.1), shade(PAPER, -0.25), shade(PAPER, -0.6)], 0, 0, 0, 1);
const scroll = (seal: string, mark: string): string =>
  `<path d="M8 6.5 H24 V25.5 H8 Z" fill="${lin([shade(PAPER, -0.3), shade(PAPER, 0.12), PAPER, shade(PAPER, -0.35)], 0, 0, 0, 1)}" ${OUTLINE}/>`
  + `<path d="M6 4.5 H26 V8 H6 Z M6 24 H26 V27.5 H6 Z" fill="${ROLL}" ${OUTLINE}/>`
  + `<path d="${mark}" stroke="#4a3a24" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
  + `<circle cx="21" cy="21" r="3" fill="${glass(seal)}" stroke="${INK}" stroke-width="0.7"/>`;
/** The drawing on a scroll: a blade for weapons, a shield for armour. */
const BLADE_MARK = 'M12 20 L19 11 M11 17 L14 20';
const SHIELD_MARK = 'M12 11 H19 V15 Q19 19 15.5 20 Q12 19 12 15 Z';

/** A recipe: a page with a corner folded and a drawing of what it makes. */
const recipePage = (mark: string): string =>
  `<path d="M8 4 H20 L25 9 V28 H8 Z" fill="${matte(shade(PAPER, 0.08))}" ${OUTLINE}/>`
  + `<path d="M20 4 V9 H25 Z" fill="${matte(shade(PAPER, -0.3))}" ${OUTLINE}/>`
  + `<path d="${mark}" stroke="#2f3f58" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
  + `<path d="M11 23.5 H22 M11 25.5 H18" stroke="#5c5038" stroke-opacity="0.8" stroke-width="0.7"/>`;

const bow = (wood: string, string: string): string =>
  `<path d="M9 4 L9 28" stroke="${string}" stroke-opacity="0.85" stroke-width="0.7"/>`
  + rod('M9 4 Q27 16 9 28', wood, 2.4)
  + `<path d="M16.6 13.4 Q18 16 16.6 18.6" fill="none" stroke="${shade(wood, -0.55)}" stroke-width="3" stroke-linecap="round"/>`
  + `<path d="M6 16 H24" stroke="${INK}" stroke-width="1.6"/><path d="M6 16 H24" stroke="#a89878" stroke-width="0.8"/>`
  + `<path d="M27 16 L22 13.8 L22 18.2 Z" fill="${metal(IRON)}" ${OUTLINE}/>`;

const staff = (wood: string, orb: string): string =>
  rod('M8 28 L21 10.5', wood, 2.4)
  + `<path d="M19.2 12.9 L21.6 9.7" stroke="${INK}" stroke-width="4.4" stroke-linecap="round"/><path d="M19.2 12.9 L21.6 9.7" stroke="${shade(GOLD, -0.1)}" stroke-width="3" stroke-linecap="round"/>`
  + `<circle cx="23" cy="8" r="4.6" fill="${glass(orb)}" ${OUTLINE}/>`
  + `<ellipse cx="21.6" cy="6.4" rx="1.5" ry="1" fill="#ffffff" fill-opacity="0.55" transform="rotate(-35 21.6 6.4)"/>`;

const gem = (color: string, cx: number, cy: number, size: number): string => {
  const [l, r, t, b] = [cx - size, cx + size, cy - size * 1.15, cy + size * 1.15];
  return `<path d="M${cx} ${t} L${l} ${cy} L${cx} ${b} Z" fill="${shade(color, 0.3)}"/>`
    + `<path d="M${cx} ${t} L${r} ${cy} L${cx} ${b} Z" fill="${shade(color, -0.4)}"/>`
    + `<path d="M${cx} ${t} L${cx + size * 0.45} ${cy} L${cx} ${cy + size * 0.3} L${cx - size * 0.45} ${cy} Z" fill="#ffffff" fill-opacity="0.3"/>`
    + `<path d="M${cx} ${t} L${r} ${cy} L${cx} ${b} L${l} ${cy} Z" fill="none" ${OUTLINE}/>`;
};

const ring = (band: string, stone: string): string =>
  `<circle cx="16" cy="19" r="8" fill="none" stroke="${INK}" stroke-width="4.4"/>`
  + `<circle cx="16" cy="19" r="8" fill="none" stroke="${lin([shade(band, 0.5), band, shade(band, -0.55), shade(band, -0.15)], 6, 9, 26, 29, true)}" stroke-width="3"/>`
  + `<path d="M9.4 16 A7.4 7.4 0 0 1 13 12.4" fill="none" stroke="#ffffff" stroke-opacity="0.45" stroke-width="0.8" stroke-linecap="round"/>`
  + gem(stone, 16, 9, 3.6);

const amulet = (cord: string, stone: string): string =>
  `<path d="M7 4 Q16 18 25 4" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`
  + `<path d="M7 4 Q16 18 25 4" fill="none" stroke="${cord}" stroke-width="1.1" stroke-linecap="round" stroke-dasharray="1.6 0.8"/>`
  + `<circle cx="16" cy="12.6" r="1.6" fill="${metal(cord)}" ${OUTLINE}/>`
  + gem(stone, 16, 21, 6);

const ICONS: Record<ItemId, string> = {
  coins:
    `<ellipse cx="13" cy="21.5" rx="9" ry="4.6" fill="${shade(GOLD, -0.55)}" ${OUTLINE}/>`
    + `<ellipse cx="13" cy="19.5" rx="9" ry="4.6" fill="${metal(GOLD)}" ${OUTLINE}/>`
    + `<ellipse cx="13" cy="19.5" rx="6" ry="2.8" fill="none" stroke="${shade(GOLD, -0.45)}" stroke-opacity="0.7" stroke-width="0.6"/>`
    + `<ellipse cx="20" cy="14.5" rx="8" ry="4.2" fill="${shade(GOLD, -0.55)}" ${OUTLINE}/>`
    + `<ellipse cx="20" cy="12.5" rx="8" ry="4.2" fill="${metal(shade(GOLD, 0.1))}" ${OUTLINE}/>`
    + `<ellipse cx="20" cy="12.5" rx="5.2" ry="2.5" fill="none" stroke="${shade(GOLD, -0.45)}" stroke-opacity="0.7" stroke-width="0.6"/>`
    + glint('M14 11 Q17 9 21 9.2', 0.5, 0.7),

  leather:
    `<path d="M8 6 Q16 9 24 6 L27 12 Q24 16 27 21 L23 27 Q16 24 9 27 L5 21 Q8 16 5 12 Z" fill="${matte('#96704a')}" ${OUTLINE}/>`
    + `<path d="M9.5 9 Q16 11.5 22.5 9 L24.4 12.4 Q22 16 24.4 20.4 L22 24 Q16 21.8 10 24 L7.6 20.4 Q10 16 7.6 12.4 Z" fill="none" stroke="${INK}" stroke-opacity="0.25" stroke-width="0.7"/>`
    + glint('M9 7.6 Q13 8.8 16 8.6', 0.3, 0.7),
  ironOre:
    `<path d="M6 22 L10 10 L19 6 L27 14 L24 26 L11 27 Z" fill="${matte('#666a70')}" ${OUTLINE}/>`
    + `<path d="M10 10 L15 16 L19 6 M15 16 L11 27 M15 16 L24 26 M15 16 L27 14" fill="none" stroke="${INK}" stroke-opacity="0.35" stroke-width="0.6"/>`
    + `<path d="M10 10 L19 6 L15 16 Z" fill="#ffffff" fill-opacity="0.12"/>`
    + `<g fill="${glass('#a8643a')}" stroke="${INK}" stroke-width="0.4"><path d="M11.5 18 L13.5 16.4 L15 18.6 L13 20.4 Z"/><path d="M18.6 19 L21.6 17.6 L22.6 21 L19.6 22.4 Z"/><path d="M18.4 9.6 L20.6 10.4 L20 12.6 L17.8 11.8 Z"/></g>`,
  coal:
    `<path d="M5 22 L9 13 L16 11 L20 17 L17 26 L8 27 Z" fill="${lin(['#4a4c52', '#222326', '#0e0e10'])}" ${OUTLINE}/>`
    + `<path d="M15 16 L20 8 L27 11 L28 21 L21 25 Z" fill="${lin(['#55585f', '#2a2b2f', '#121214'])}" ${OUTLINE}/>`
    + `<path d="M9 13 L12 18 L16 11 M12 18 L8 27 M20 8 L22 15 L28 21 M22 15 L15 16" fill="none" stroke="#8a8f9a" stroke-opacity="0.35" stroke-width="0.6"/>`
    + glint('M9.8 13.6 L15 12 M20.6 9 L25.6 11.2', 0.3, 0.7),
  bone:
    `<g fill="${INK}"><circle cx="7" cy="22" r="3.6"/><circle cx="10" cy="25" r="3.6"/><circle cx="22" cy="7" r="3.6"/><circle cx="25" cy="10" r="3.6"/></g>`
    + `<path d="M9 23 L23 9" stroke="${INK}" stroke-width="5.2" stroke-linecap="round"/>`
    + `<path d="M9 23 L23 9" stroke="${lin([shade(BONE, 0.3), BONE, shade(BONE, -0.45)], 12, 12, 20, 20, true)}" stroke-width="3.8" stroke-linecap="round"/>`
    + `<g fill="${matte(BONE)}"><circle cx="7" cy="22" r="2.9"/><circle cx="10" cy="25" r="2.9"/><circle cx="22" cy="7" r="2.9"/><circle cx="25" cy="10" r="2.9"/></g>`
    + glint('M10.5 19.8 L20.2 10.1', 0.45, 0.7),
  thread:
    `<path d="M9 8 H23 V24 H9 Z" fill="${lin([shade('#b4aa96', -0.5), '#c2b8a4', '#b4aa96', shade('#b4aa96', -0.6)], 0, 0, 1, 0)}" ${OUTLINE}/>`
    + `<path d="M9 10.4 H23 M9 12.8 H23 M9 15.2 H23 M9 17.6 H23 M9 20 H23 M9 22.4 H23" stroke="${INK}" stroke-opacity="0.35" stroke-width="0.6"/>`
    + `<path d="M7 5 H25 V8 H7 Z M7 24 H25 V27 H7 Z" fill="${lin([shade(WOOD, -0.4), shade(WOOD, 0.2), WOOD, shade(WOOD, -0.5)], 0, 0, 1, 0)}" ${OUTLINE}/>`,

  trainingSword: sword('#8f6d45', DARK_WOOD),
  ironSword: sword(IRON, shade(IRON, -0.25)),
  soldierBlade: sword(D_STEEL, GOLD, true),

  trainingBow: bow('#8f6d45', '#c9bfa8'),
  huntingBow: bow(DARK_WOOD, '#c9bfa8'),
  longbow: bow('#4a6485', '#b9cce0'),
  apprenticeStaff: staff('#8f6d45', '#8d9299'),
  oakStaff: staff(DARK_WOOD, '#4f9a6c'),
  runedStaff: staff('#3d3157', '#5d86c4'),

  leatherCap: helmet(LEATHER, false),
  ironHelm: helmet(D_STEEL, true),

  leatherJerkin: vest(LEATHER, false),
  chainShirt: vest(D_STEEL, true),

  leatherBoots: boot(LEATHER, false),
  ironGreaves: boot(D_STEEL, true),

  leatherGloves: glove(LEATHER, false),
  ironGauntlets: glove(D_STEEL, true),
  copperRing: ring('#a0633a', '#4f9a6c'),
  silverRing: ring('#a9afb8', '#4a7cc0'),
  boneAmulet: amulet('#7a5c3a', BONE),
  silverAmulet: amulet('#a9afb8', '#8a5cc0'),

  firstHuntCharm: amulet('#6e5436', '#c9a44a'),
  packFang:
    `<path d="M7 4 Q16 16 25 4" fill="none" stroke="#6e5436" stroke-width="1.6" stroke-linecap="round"/>`
    + `<path d="M12 12 Q22 12 19 29 Q13 22 12 12 Z" fill="${lin([shade('#d8d0bc', 0.3), '#d8d0bc', shade('#d8d0bc', -0.45)], 0, 0, 1, 1)}" ${OUTLINE}/>`,
  bristleGrips: glove('#4a382c', false),
  tuskRing: ring('#d8d0bc', '#c9861f'),
  overseerSignet: ring('#7b828f', '#c9861f'),

  healthPotion: flask('#a0302a'),
  manaPotion: flask('#2f5fa8'),
  chargePlain: crystal('#9aa0a8'),
  chargeD: crystal('#4a7cc0'),
  crystalD:
    `<path d="M8 14 L13 6 L16 14 Z M13 6 L21 6 L16 14 Z" fill="${shade('#6c4fa8', 0.25)}"/>`
    + `<path d="M21 6 L26 14 L16 14 Z" fill="${shade('#6c4fa8', -0.15)}"/>`
    + `<path d="M8 14 L16 14 L16 28 Z" fill="${lin([shade('#6c4fa8', 0.1), shade('#6c4fa8', -0.3)], 0, 0, 0, 1)}"/>`
    + `<path d="M26 14 L16 14 L16 28 Z" fill="${lin([shade('#6c4fa8', -0.3), shade('#6c4fa8', -0.65)], 0, 0, 0, 1)}"/>`
    + `<path d="M13 6 L21 6 L16 14 Z" fill="#ffffff" fill-opacity="0.2"/>`
    + `<path d="M8 14 H26 M13 6 L16 14 L21 6 M16 14 V28" fill="none" stroke="#d9c8ff" stroke-opacity="0.4" stroke-width="0.6"/>`
    + `<path d="M8 14 L13 6 L21 6 L26 14 L16 28 Z" fill="none" ${OUTLINE}/>`
    + glint('M9.6 13 L13.4 7', 0.5, 0.7),
  scrollWeaponPlain: scroll('#8d9299', BLADE_MARK),
  scrollArmorPlain: scroll('#8d9299', SHIELD_MARK),
  scrollWeaponD: scroll('#4a7cc0', BLADE_MARK),
  scrollArmorD: scroll('#4a7cc0', SHIELD_MARK),
  steelIngot:
    `<path d="M6 20 L10 12 L24 12 L28 20 L24 24 L10 24 Z" fill="${shade('#8a94a4', -0.5)}" ${OUTLINE}/>`
    + `<path d="M10 12 L24 12 L26 16 L12 16 Z" fill="${lin([shade('#8a94a4', 0.5), '#8a94a4'], 0, 0, 1, 0)}"/>`
    + `<path d="M12 16 L26 16 L24 24 L10 24 Z" fill="${lin([shade('#8a94a4', -0.1), shade('#8a94a4', -0.5)], 0, 0, 0, 1)}"/>`
    + `<path d="M10 12 L12 16 L10 24 L6 20 Z" fill="${shade('#8a94a4', 0.1)}"/>`
    + `<path d="M6 20 L10 12 L24 12 L28 20 L24 24 L10 24 Z M10 12 L12 16 L26 16 M12 16 L10 24" fill="none" ${OUTLINE}/>`
    + glint('M11.6 13.2 H22.6', 0.55, 0.7),
  tannedLeather:
    `<path d="M7 9 Q7 6 10 6 H22 Q25 6 25 9 V23 Q25 26 22 26 H10 Q7 26 7 23 Z" fill="${lin([shade(TANNED, 0.3), TANNED, shade(TANNED, -0.45), shade(TANNED, -0.1), shade(TANNED, -0.55)], 0, 0, 0, 1)}" ${OUTLINE}/>`
    + `<path d="M7 11.5 H25 V13.5 H7 Z M7 18.5 H25 V20.5 H7 Z" fill="${shade(TANNED, -0.6)}" fill-opacity="0.85"/>`
    + `<circle cx="16" cy="16" r="2.3" fill="${glass(GOLD)}" stroke="${INK}" stroke-width="0.6"/>`
    + glint('M9.4 7.6 H21', 0.3, 0.7),
  cord:
    `<ellipse cx="16" cy="15.5" rx="9.5" ry="8.5" fill="none" stroke="${INK}" stroke-width="5.2"/>`
    + `<ellipse cx="16" cy="15.5" rx="9.5" ry="8.5" fill="none" stroke="${lin([shade('#a8946c', 0.3), '#a8946c', shade('#a8946c', -0.55)], 5, 6, 27, 26, true)}" stroke-width="3.8"/>`
    + `<ellipse cx="16" cy="15.5" rx="9.5" ry="8.5" fill="none" stroke="${INK}" stroke-opacity="0.45" stroke-width="3.8" stroke-dasharray="0.7 2.2"/>`
    + rod('M23.5 20.5 L27.5 27', '#a8946c', 2),
  recipeSoldierBlade: recipePage(BLADE_MARK),
  recipeIronHelm: recipePage('M11 19 Q11 10 16 10 Q21 10 21 19 Z'),
  recipeChainShirt: recipePage(SHIELD_MARK),
  recipeIronGreaves: recipePage('M13 10 H18 V16 Q22 17 22 20 H12 Z'),
  recipeLongbow: recipePage('M13 10 Q21 15 13 21 M13 10 V21'),
  recipeRunedStaff: recipePage('M12 21 L19 12 M19 12 m-2 0 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0'),
};

/** An element showing the item's picture. Purely decorative: the name is given in text elsewhere. */
export function itemIcon(itemId: ItemId, quality?: Quality): HTMLElement {
  mountIconPaints();
  const holder = document.createElement('span');
  holder.className = 'icon';
  holder.setAttribute('aria-hidden', 'true');
  holder.innerHTML = `<svg viewBox="0 0 32 32" width="100%" height="100%">${ICONS[itemId]}</svg>`;
  const def = ITEMS[itemId];
  if (def.kind === 'equipment' || def.kind === 'scroll') holder.dataset.grade = def.grade;
  if (def.kind === 'equipment') holder.dataset.quality = quality ?? 'common';
  return holder;
}
