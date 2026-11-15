import type { SkillId } from '../sim';

// Skill icons, drawn as small vector pictures like the item icons. All the
// markup is fixed text from this file, never player input.
const O = 'stroke="#12141a" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"';

const ICONS: Record<SkillId, string> = {
  heavyBlow: `<rect width="32" height="32" fill="#4a2018"/><path d="M22 3 L28 9 L13 24 L8 19 Z" fill="#e8d9b0" ${O}/><path d="M6 17 L15 26" stroke="#d9a441" stroke-width="4" stroke-linecap="round"/><path d="M4 8 L10 10 M3 14 L9 14 M8 3 L11 8" stroke="#ffb347" stroke-width="2" stroke-linecap="round"/>`,
  sweep: `<rect width="32" height="32" fill="#183a4a"/><path d="M16 5 A11 11 0 1 1 5.5 12.5" fill="none" stroke="#9fe0ff" stroke-width="3.5" stroke-linecap="round"/><path d="M2 9 L6 14 L10 8 Z" fill="#9fe0ff" ${O}/><path d="M16 12 L20 16 L16 20 L12 16 Z" fill="#e8d9b0" ${O}/>`,
  secondWind: `<rect width="32" height="32" fill="#173d2a"/><path d="M16 27 C4 18 4 8 10.5 7 C13.5 6.6 15.3 8.4 16 10 C16.7 8.4 18.5 6.6 21.5 7 C28 8 28 18 16 27 Z" fill="#7fe0a0" ${O}/><path d="M16 12 V20 M12 16 H20" stroke="#12141a" stroke-width="2.5" stroke-linecap="round"/>`,
  powerShot: `<rect width="32" height="32" fill="#2c3f1c"/><path d="M5 27 L25 7" stroke="#e8d9b0" stroke-width="2.5" stroke-linecap="round"/><path d="M27 5 L27 13 L19 5 Z" fill="#e8d9b0" ${O}/><path d="M5 27 L3 21 M5 27 L11 29" stroke="#d94a3f" stroke-width="2.5" stroke-linecap="round"/><path d="M11 13 L7 9 M16 8 L13 4" stroke="#ffb347" stroke-width="2" stroke-linecap="round"/>`,
  volley: `<rect width="32" height="32" fill="#2c3f1c"/><g stroke="#e8d9b0" stroke-width="2" stroke-linecap="round"><path d="M16 28 L16 6"/><path d="M16 28 L6 9"/><path d="M16 28 L26 9"/></g><g fill="#e8d9b0" ${O}><path d="M16 3 L19 8 L13 8 Z"/><path d="M5 6 L9.5 9 L4.5 11.5 Z"/><path d="M27 6 L27.5 11.5 L22.5 9 Z"/></g>`,
  swiftness: `<rect width="32" height="32" fill="#1c3a3f"/><path d="M12 6 L22 6 L17 14 L23 14 L10 28 L14 17 L8 17 Z" fill="#9ff0d0" ${O}/><path d="M3 10 H8 M2 16 H6 M4 22 H9" stroke="#9ff0d0" stroke-width="2" stroke-linecap="round"/>`,
  fireBolt: `<rect width="32" height="32" fill="#4a1f12"/><path d="M19 4 C22 10 27 12 25 20 C24 26 19 29 15 28 C9 27 6 22 8 16 C9 13 11 12 12 9 C14 12 14 14 16 14 C18 12 19 8 19 4 Z" fill="#ff8a3d" ${O}/><path d="M17 15 C19 18 21 19 20 23 C19 26 14 26 13 23 C12 20 15 19 17 15 Z" fill="#ffe08a"/>`,
  frostNova: `<rect width="32" height="32" fill="#16304a"/><g stroke="#bfe8ff" stroke-width="2.5" stroke-linecap="round"><path d="M16 4 V28 M5.6 10 L26.4 22 M5.6 22 L26.4 10"/><path d="M16 4 L13 7 M16 4 L19 7 M16 28 L13 25 M16 28 L19 25"/></g><circle cx="16" cy="16" r="3" fill="#ffffff" ${O}/>`,
  mend: `<rect width="32" height="32" fill="#173d2a"/><circle cx="16" cy="16" r="10" fill="#7fe0a0" ${O}/><path d="M16 10 V22 M10 16 H22" stroke="#12141a" stroke-width="3.5" stroke-linecap="round"/><path d="M5 6 L7 9 M27 6 L25 9 M5 26 L7 23 M27 26 L25 23" stroke="#bff5d0" stroke-width="2" stroke-linecap="round"/>`,
};

/** An element showing the skill's picture. Purely decorative: the name is given in text elsewhere. */
export function skillIcon(id: SkillId): HTMLElement {
  const holder = document.createElement('span');
  holder.className = 'icon';
  holder.setAttribute('aria-hidden', 'true');
  holder.innerHTML = `<svg viewBox="0 0 32 32" width="100%" height="100%">${ICONS[id]}</svg>`;
  return holder;
}
