import type { SkillId } from '../sim';
import { INK, OUTLINE, glass, glint, lin, metal, mountIconPaints, rad, rod, shade } from './itemIcon';

// Skill icons, drawn as small vector pictures like the item icons: a dark
// tile tinted by the kind of skill, a shaded picture on it, and darkened
// edges. All the markup is fixed text from this file, never player input.

/** The tile behind the picture: a dim glow in the middle, falling off to near black. */
const tile = (color: string): string =>
  `<rect width="32" height="32" fill="${rad([shade(color, 0.15), shade(color, -0.35), shade(color, -0.8)], 0.5, 0.45, 0.8)}"/>`;
/** Darkened edges and a lit top line, drawn over the picture. */
const EDGE = `<rect width="32" height="32" fill="${rad(['#000000@0', '#000000@0', '#000000@0.55'], 0.5, 0.5, 0.75)}"/>`
  + `<path d="M0.5 31.5 V0.5 H31.5" fill="none" stroke="#ffffff" stroke-opacity="0.14"/>`
  + `<path d="M31.5 0.5 V31.5 H0.5" fill="none" stroke="#000000" stroke-opacity="0.5"/>`;

const STEEL = '#a9aeb6';
const BRASS = '#a8843c';
const EMBER = '#c8782c';
const ICE = '#8fb8d8';
const LEAF = '#5f9f74';
const SHAFT = '#a89878';

const arrowHead = (d: string): string => `<path d="${d}" fill="${metal(STEEL)}" ${OUTLINE}/>`;

const ICONS: Record<SkillId, string> = {
  heavyBlow: tile('#5a2418')
    + `<path d="M4 8 L10 10.5 M3 14.5 L9 14.5 M8.5 3 L11 8.5" stroke="${EMBER}" stroke-opacity="0.9" stroke-width="1.4" stroke-linecap="round"/>`
    + `<path d="M8.5 19.5 L22.5 5 L27.5 4.5 L10.8 21.8 Z" fill="${lin([shade(STEEL, 0.6), shade(STEEL, 0.1)], 1, 0, 0, 1)}"/>`
    + `<path d="M13 24 L27 9.5 L27.5 4.5 L10.8 21.8 Z" fill="${lin([shade(STEEL, -0.15), shade(STEEL, -0.6)], 1, 0, 0, 1)}"/>`
    + `<path d="M8.5 19.5 L22.5 5 L27.5 4.5 L27 9.5 L13 24 Z" fill="none" ${OUTLINE}/>`
    + rod('M6 17 L15 26', BRASS, 2.2)
    + rod('M9.4 22.6 L5.5 26.5', '#5f3d20', 1.8),
  sweep: tile('#1c3d4c')
    + `<path d="M16 5 A11 11 0 1 1 5.5 12.5" fill="none" stroke="${INK}" stroke-width="4.2" stroke-linecap="round"/>`
    + `<path d="M16 5 A11 11 0 1 1 5.5 12.5" fill="none" stroke="${lin([shade(ICE, 0.45), ICE, shade(ICE, -0.6)], 5, 5, 27, 27, true)}" stroke-width="2.8" stroke-linecap="round"/>`
    + `<path d="M2 8.5 L6 14.5 L10.5 8 Z" fill="${metal(ICE)}" ${OUTLINE}/>`
    + `<path d="M16 11.5 L20.5 16 L16 20.5 L11.5 16 Z" fill="${metal(STEEL)}" ${OUTLINE}/>`
    + `<path d="M16 11.5 V20.5" stroke="${INK}" stroke-opacity="0.4" stroke-width="0.6"/>`,
  secondWind: tile('#1c4430')
    + `<path d="M16 27 C4 18 4 8 10.5 7 C13.5 6.6 15.3 8.4 16 10 C16.7 8.4 18.5 6.6 21.5 7 C28 8 28 18 16 27 Z" fill="${glass(LEAF)}" ${OUTLINE}/>`
    + `<path d="M16 12.5 V20.5 M12 16.5 H20" stroke="${INK}" stroke-opacity="0.8" stroke-width="3.2" stroke-linecap="round"/>`
    + `<path d="M16 12.5 V20.5 M12 16.5 H20" stroke="#dcefd8" stroke-width="1.6" stroke-linecap="round"/>`
    + glint('M8.2 13 Q8.4 9.4 11.4 8.8', 0.5, 0.9),
  powerShot: tile('#33441f')
    + `<path d="M11 13 L7 9 M16 8 L13 4" stroke="${EMBER}" stroke-opacity="0.9" stroke-width="1.4" stroke-linecap="round"/>`
    + `<path d="M5 27 L3 21 M5 27 L11 29 M7.5 24.5 L5.5 19 M7.5 24.5 L13 26.5" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`
    + `<path d="M5 27 L3 21 M5 27 L11 29 M7.5 24.5 L5.5 19 M7.5 24.5 L13 26.5" stroke="#8f3a30" stroke-width="1.2" stroke-linecap="round"/>`
    + rod('M5 27 L24 8', SHAFT, 1.3)
    + arrowHead('M28 4 L27.5 13 L19 4.5 Z'),
  volley: tile('#33441f')
    + rod('M16 28 L16 7', SHAFT, 1.1) + rod('M16 28 L6.5 10', SHAFT, 1.1) + rod('M16 28 L25.5 10', SHAFT, 1.1)
    + arrowHead('M16 2.5 L19.2 8.5 L12.8 8.5 Z') + arrowHead('M4.5 5.5 L10 9 L4.6 12 Z') + arrowHead('M27.5 5.5 L27.4 12 L22 9 Z'),
  swiftness: tile('#1f4046')
    + `<path d="M3 10 H8 M2 16 H6 M4 22 H9" stroke="${shade(ICE, -0.1)}" stroke-opacity="0.75" stroke-width="1.3" stroke-linecap="round"/>`
    + `<path d="M12 6 L22 6 L17 14 L23 14 L10 28 L14 17 L8 17 Z" fill="${lin([shade('#b9dccc', 0.5), '#8fc8b0', shade('#8fc8b0', -0.6)], 0, 0, 0, 1)}" ${OUTLINE}/>`
    + glint('M12.6 7 L9.4 16', 0.5, 0.7),
  fireBolt: tile('#5a2412')
    + `<path d="M19 4 C22 10 27 12 25 20 C24 26 19 29 15 28 C9 27 6 22 8 16 C9 13 11 12 12 9 C14 12 14 14 16 14 C18 12 19 8 19 4 Z" fill="${lin(['#e0a040', EMBER, '#8a2c14'], 0, 0, 0, 1)}" ${OUTLINE}/>`
    + `<path d="M17 14.5 C19 17.5 21 19 20 23 C19 26.2 14 26.2 13 23 C12 20 15 19 17 14.5 Z" fill="${rad(['#fff0c0', '#f0c868', '#d08a30'], 0.5, 0.7, 0.7)}"/>`,
  frostNova: tile('#1a3552')
    + `<g stroke="${INK}" stroke-width="3" stroke-linecap="round"><path d="M16 4 V28 M5.6 10 L26.4 22 M5.6 22 L26.4 10"/></g>`
    + `<g stroke="${lin([shade(ICE, 0.6), ICE, shade(ICE, -0.4)], 5, 4, 27, 28, true)}" stroke-width="1.7" stroke-linecap="round" fill="none"><path d="M16 4 V28 M5.6 10 L26.4 22 M5.6 22 L26.4 10"/><path d="M16 4 L13 7 M16 4 L19 7 M16 28 L13 25 M16 28 L19 25 M5.6 10 L9.6 9 M5.6 10 L6.8 14 M26.4 22 L22.4 23 M26.4 22 L25.2 18 M5.6 22 L6.8 18 M5.6 22 L9.6 23 M26.4 10 L25.2 14 M26.4 10 L22.4 9"/></g>`
    + `<circle cx="16" cy="16" r="2.8" fill="${glass('#cfe4f2')}" ${OUTLINE}/>`,
  mend: tile('#1c4430')
    + `<path d="M5 6 L7 9 M27 6 L25 9 M5 26 L7 23 M27 26 L25 23" stroke="${shade(LEAF, 0.35)}" stroke-opacity="0.75" stroke-width="1.3" stroke-linecap="round"/>`
    + `<circle cx="16" cy="16" r="9.5" fill="${glass(LEAF)}" ${OUTLINE}/>`
    + `<path d="M16 10.5 V21.5 M10.5 16 H21.5" stroke="${INK}" stroke-opacity="0.8" stroke-width="3.8" stroke-linecap="round"/>`
    + `<path d="M16 10.5 V21.5 M10.5 16 H21.5" stroke="#dcefd8" stroke-width="2" stroke-linecap="round"/>`
    + glint('M9.6 12.4 Q11.4 8.8 15 8', 0.5, 0.9),
};

/** An element showing the skill's picture. Purely decorative: the name is given in text elsewhere. */
export function skillIcon(id: SkillId): HTMLElement {
  mountIconPaints();
  const holder = document.createElement('span');
  holder.className = 'icon';
  holder.setAttribute('aria-hidden', 'true');
  holder.innerHTML = `<svg viewBox="0 0 32 32" width="100%" height="100%">${ICONS[id]}${EDGE}</svg>`;
  return holder;
}
