import { type ItemId, type Quality, ITEMS } from '../sim';

// Item icons are drawn here as small vector pictures, so the game ships no
// image files. Every icon fits a 32x32 box. All the markup below is fixed
// text from this file, never player input.

const OUTLINE = 'stroke="#12141a" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"';

const sword = (blade: string, guard: string, wide = false): string => `
  <path d="M${wide ? 23 : 24} 4 L28 ${wide ? 9 : 8} L13 ${wide ? 24 : 23} L${wide ? 8 : 9} 19 Z" fill="${blade}" ${OUTLINE}/>
  <path d="M7 17 L15 25" stroke="${guard}" stroke-width="4" stroke-linecap="round"/>
  <path d="M9 23 L5 27" stroke="#5a3f26" stroke-width="4" stroke-linecap="round"/>`;

const helmet = (color: string, shade: string, guard: boolean): string => `
  <path d="M6 22 Q6 7 16 7 Q26 7 26 22 Z" fill="${color}" ${OUTLINE}/>
  <path d="M5 22 H27 V25 H5 Z" fill="${shade}" ${OUTLINE}/>
  ${guard ? `<path d="M15 14 H17 V27 H15 Z" fill="${shade}" ${OUTLINE}/>` : ''}`;

const vest = (color: string, shade: string, rings: boolean): string => `
  <path d="M9 6 L13 6 Q16 10 19 6 L23 6 L28 11 L24 15 L24 27 L8 27 L8 15 L4 11 Z" fill="${color}" ${OUTLINE}/>
  <path d="M8 21 H24" stroke="${shade}" stroke-width="2"/>
  ${rings ? `<g fill="${shade}"><circle cx="12" cy="13" r="1.2"/><circle cx="16" cy="15" r="1.2"/><circle cx="20" cy="13" r="1.2"/><circle cx="12" cy="18" r="1.2"/><circle cx="20" cy="18" r="1.2"/><circle cx="16" cy="24" r="1.2"/></g>` : ''}`;

const boot = (color: string, shade: string): string => `
  <path d="M11 5 H19 V18 Q27 19 27 24 V27 H8 V18 Z" fill="${color}" ${OUTLINE}/>
  <path d="M8 24 H27" stroke="${shade}" stroke-width="2"/>`;

const flask = (liquid: string): string => `
  <path d="M13 5 H19 V11 L25 21 Q27 27 21 27 H11 Q5 27 7 21 L13 11 Z" fill="#dfe6ee" fill-opacity="0.35" ${OUTLINE}/>
  <path d="M10 17 H22 L24.5 21.5 Q26 26 21 26 H11 Q6 26 7.5 21.5 Z" fill="${liquid}"/>
  <path d="M12 4 H20" stroke="#8a6a45" stroke-width="3" stroke-linecap="round"/>`;

const crystal = (color: string, light: string): string => `
  <path d="M16 3 L24 12 L18 29 L14 29 L8 12 Z" fill="${color}" ${OUTLINE}/>
  <path d="M16 3 L16 29 M8 12 L24 12" stroke="${light}" stroke-width="1" opacity="0.8"/>`;

const scroll = (seal: string, mark: string): string => `
  <path d="M8 6 H24 V26 H8 Z" fill="#e8dcc0" ${OUTLINE}/>
  <path d="M6 5 H26 V8 H6 Z M6 24 H26 V27 H6 Z" fill="#b89f73" ${OUTLINE}/>
  <path d="${mark}" stroke="#6e5a3a" stroke-width="2" fill="none" stroke-linecap="round"/>
  <circle cx="21" cy="21" r="3.2" fill="${seal}" stroke="#12141a" stroke-width="1"/>`;
/** The drawing on a scroll: a blade for weapons, a shield for armour. */
const BLADE_MARK = 'M12 20 L19 11 M11 17 L14 20';
const SHIELD_MARK = 'M12 11 H19 V15 Q19 19 15.5 20 Q12 19 12 15 Z';

/** A recipe: a page with a corner folded and a drawing of what it makes. */
const recipePage = (mark: string): string => `
  <path d="M8 4 H20 L25 9 V28 H8 Z" fill="#efe6cf" ${OUTLINE}/>
  <path d="M20 4 V9 H25" fill="#cdbf9c" ${OUTLINE}/>
  <path d="${mark}" stroke="#3f6fb0" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M11 23 H22 M11 25.5 H18" stroke="#8a7c5c" stroke-width="1"/>`;

const bow = (wood: string, string: string): string => `
  <path d="M9 4 Q27 16 9 28" fill="none" stroke="#12141a" stroke-width="5.5" stroke-linecap="round"/>
  <path d="M9 4 Q27 16 9 28" fill="none" stroke="${wood}" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M9 4 L9 28" stroke="${string}" stroke-width="1.2"/>
  <path d="M6 16 H24" stroke="#e8d9b0" stroke-width="1.5"/><path d="M26 16 L21 13.5 L21 18.5 Z" fill="#cfd3dc" ${OUTLINE}/>`;

const staff = (wood: string, orb: string): string => `
  <path d="M8 28 L22 9" stroke="#12141a" stroke-width="5.5" stroke-linecap="round"/>
  <path d="M8 28 L22 9" stroke="${wood}" stroke-width="3.5" stroke-linecap="round"/>
  <circle cx="23" cy="8" r="5" fill="${orb}" ${OUTLINE}/><circle cx="21.5" cy="6.5" r="1.6" fill="#ffffff" opacity="0.8"/>`;

const glove = (color: string, shade: string): string => `
  <path d="M9 27 V15 L7 9 Q8 6 10.5 8 L12 12 V6 Q13.5 3.5 15 6 V11 V5 Q16.5 2.5 18 5 V11 V6 Q19.5 3.5 21 6 V13 L23 11 Q25.5 10 25 13 L22 19 V27 Z" fill="${color}" ${OUTLINE}/>
  <path d="M9 22 H22" stroke="${shade}" stroke-width="2.5"/>`;

const ring = (metal: string, gem: string): string => `
  <circle cx="16" cy="19" r="8" fill="none" stroke="#12141a" stroke-width="5.5"/>
  <circle cx="16" cy="19" r="8" fill="none" stroke="${metal}" stroke-width="3"/>
  <path d="M16 4 L20 9 L16 13 L12 9 Z" fill="${gem}" ${OUTLINE}/>`;

const amulet = (cord: string, stone: string): string => `
  <path d="M7 4 Q16 18 25 4" fill="none" stroke="${cord}" stroke-width="2" stroke-linecap="round"/>
  <path d="M16 13 L22 20 L16 28 L10 20 Z" fill="${stone}" ${OUTLINE}/>
  <path d="M16 13 V28 M10 20 H22" stroke="#ffffff" stroke-width="1" opacity="0.5"/>`;

const IRON = '#b8bcc6';
const IRON_DARK = '#7f8591';
const LEATHER = '#a8743e';
const LEATHER_DARK = '#6e4a24';
const D_STEEL = '#8fbaf2';
const D_STEEL_DARK = '#4f7fbf';

const ICONS: Record<ItemId, string> = {
  coins: '<ellipse cx="13" cy="20" rx="9" ry="5" fill="#b8862b" stroke="#12141a" stroke-width="1.5"/><ellipse cx="13" cy="17" rx="9" ry="5" fill="#f2c94c" stroke="#12141a" stroke-width="1.5"/><ellipse cx="20" cy="13" rx="8" ry="4.5" fill="#f2c94c" stroke="#12141a" stroke-width="1.5"/>',

  leather: `<path d="M8 6 Q16 9 24 6 L27 12 Q24 16 27 21 L23 27 Q16 24 9 27 L5 21 Q8 16 5 12 Z" fill="#c89a62" ${OUTLINE}/>`,
  ironOre: `<path d="M6 22 L10 10 L19 6 L27 14 L24 26 L11 27 Z" fill="#7c8088" ${OUTLINE}/><circle cx="13" cy="15" r="2.2" fill="#d98a4a"/><circle cx="20" cy="19" r="2.6" fill="#d98a4a"/><circle cx="18" cy="11" r="1.5" fill="#d98a4a"/>`,
  coal: `<path d="M5 22 L9 13 L16 11 L20 17 L17 26 L8 27 Z" fill="#2b2d33" ${OUTLINE}/><path d="M15 16 L20 8 L27 11 L28 21 L21 25 Z" fill="#3a3d45" ${OUTLINE}/><path d="M9 16 L13 14 M21 13 L24 13" stroke="#6b7080" stroke-width="1.5"/>`,
  bone: `<path d="M9 23 L23 9" stroke="#ece6d6" stroke-width="5" stroke-linecap="round"/><g fill="#ece6d6" stroke="#12141a" stroke-width="1.2"><circle cx="7" cy="22" r="3.2"/><circle cx="10" cy="25" r="3.2"/><circle cx="22" cy="7" r="3.2"/><circle cx="25" cy="10" r="3.2"/></g>`,
  thread: `<path d="M9 8 H23 V24 H9 Z" fill="#d8cfc0" ${OUTLINE}/><path d="M9 11 H23 M9 14 H23 M9 17 H23 M9 20 H23" stroke="#a89c86" stroke-width="1.2"/><path d="M7 5 H25 V8 H7 Z M7 24 H25 V27 H7 Z" fill="#8a6a45" ${OUTLINE}/>`,

  trainingSword: sword('#b98d57', '#7a5a33'),
  ironSword: sword(IRON, IRON_DARK),
  soldierBlade: sword(D_STEEL, '#d9b24a', true),

  trainingBow: bow('#b98d57', '#e8dcc0'),
  huntingBow: bow('#8a5a2c', '#e8dcc0'),
  longbow: bow(D_STEEL_DARK, '#d6eaff'),
  apprenticeStaff: staff('#b98d57', '#cfd3dc'),
  oakStaff: staff('#6e4a24', '#7fe0a0'),
  runedStaff: staff('#4a3a6a', '#8fbaf2'),

  leatherCap: helmet(LEATHER, LEATHER_DARK, false),
  ironHelm: helmet(D_STEEL, D_STEEL_DARK, true),

  leatherJerkin: vest(LEATHER, LEATHER_DARK, false),
  chainShirt: vest(D_STEEL, D_STEEL_DARK, true),

  leatherBoots: boot(LEATHER, LEATHER_DARK),
  ironGreaves: boot(D_STEEL, D_STEEL_DARK),

  leatherGloves: glove(LEATHER, LEATHER_DARK),
  ironGauntlets: glove(D_STEEL, D_STEEL_DARK),
  copperRing: ring('#c9814a', '#7fe0a0'),
  silverRing: ring('#d5dbe6', '#5fa8ff'),
  boneAmulet: amulet('#8a6a45', '#ece6d6'),
  silverAmulet: amulet('#d5dbe6', '#c58bff'),

  firstHuntCharm: amulet('#8a6a45', '#e8c36a'),
  packFang: `<path d="M7 4 Q16 16 25 4" fill="none" stroke="#8a6a45" stroke-width="2" stroke-linecap="round"/><path d="M12 12 Q22 12 19 29 Q13 22 12 12 Z" fill="#f1ead8" ${OUTLINE}/>`,
  bristleGrips: glove('#5d4737', '#e8a23a'),
  tuskRing: ring('#f1ead8', '#e8a23a'),
  overseerSignet: ring('#8f97a6', '#e8a23a'),

  healthPotion: flask('#d9534f'),
  manaPotion: flask('#4f8fe0'),
  chargePlain: crystal('#cfd3dc', '#ffffff'),
  chargeD: crystal('#5fa8ff', '#d6eaff'),
  crystalD: `<path d="M8 14 L13 6 L21 6 L26 14 L16 28 Z" fill="#8f6bd6" ${OUTLINE}/><path d="M8 14 H26 M13 6 L16 14 L21 6 M16 14 V28" stroke="#d9c8ff" stroke-width="1" opacity="0.8"/>`,
  scrollWeaponPlain: scroll('#cfd3dc', BLADE_MARK),
  scrollArmorPlain: scroll('#cfd3dc', SHIELD_MARK),
  scrollWeaponD: scroll('#5fa8ff', BLADE_MARK),
  scrollArmorD: scroll('#5fa8ff', SHIELD_MARK),
  steelIngot: `<path d="M6 20 L10 12 L24 12 L28 20 L24 24 L10 24 Z" fill="#aeb6c4" ${OUTLINE}/><path d="M10 12 L12 16 L26 16 L24 12 M12 16 L10 24" stroke="#12141a" stroke-width="1" fill="none"/><path d="M12 14 H22" stroke="#ffffff" stroke-width="1.2" opacity="0.7"/>`,
  tannedLeather: `<path d="M7 9 Q7 6 10 6 H22 Q25 6 25 9 V23 Q25 26 22 26 H10 Q7 26 7 23 Z" fill="#8a5a2c" ${OUTLINE}/><path d="M7 12 H25 M7 20 H25" stroke="#5f3c1a" stroke-width="1.5"/><circle cx="16" cy="16" r="2.5" fill="#d9b24a" stroke="#12141a" stroke-width="1"/>`,
  cord: `<ellipse cx="16" cy="16" rx="10" ry="9" fill="none" stroke="#c9b48a" stroke-width="4"/><ellipse cx="16" cy="16" rx="10" ry="9" fill="none" stroke="#12141a" stroke-width="1" stroke-dasharray="3 3"/><path d="M24 20 L28 27" stroke="#c9b48a" stroke-width="3" stroke-linecap="round"/>`,
  recipeSoldierBlade: recipePage(BLADE_MARK),
  recipeIronHelm: recipePage('M11 19 Q11 10 16 10 Q21 10 21 19 Z'),
  recipeChainShirt: recipePage(SHIELD_MARK),
  recipeIronGreaves: recipePage('M13 10 H18 V16 Q22 17 22 20 H12 Z'),
  recipeLongbow: recipePage('M13 10 Q21 15 13 21 M13 10 V21'),
  recipeRunedStaff: recipePage('M12 21 L19 12 M19 12 m-2 0 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0'),
};

/** An element showing the item's picture. Purely decorative: the name is given in text elsewhere. */
export function itemIcon(itemId: ItemId, quality?: Quality): HTMLElement {
  const holder = document.createElement('span');
  holder.className = 'icon';
  holder.setAttribute('aria-hidden', 'true');
  holder.innerHTML = `<svg viewBox="0 0 32 32" width="100%" height="100%">${ICONS[itemId]}</svg>`;
  const def = ITEMS[itemId];
  if (def.kind === 'equipment' || def.kind === 'scroll') holder.dataset.grade = def.grade;
  if (def.kind === 'equipment') holder.dataset.quality = quality ?? 'common';
  return holder;
}
