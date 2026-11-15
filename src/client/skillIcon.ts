import type { SkillId } from '../sim';

// Skill icons, drawn as small vector pictures like the item icons. All the
// markup is fixed text from this file, never player input.
const O = 'stroke="#12141a" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"';

const ICONS: Record<SkillId, string> = {
  heavyBlow: `<rect width="32" height="32" fill="#4a2018"/><path d="M22 3 L28 9 L13 24 L8 19 Z" fill="#e8d9b0" ${O}/><path d="M6 17 L15 26" stroke="#d9a441" stroke-width="4" stroke-linecap="round"/><path d="M4 8 L10 10 M3 14 L9 14 M8 3 L11 8" stroke="#ffb347" stroke-width="2" stroke-linecap="round"/>`,
  sweep: `<rect width="32" height="32" fill="#183a4a"/><path d="M16 5 A11 11 0 1 1 5.5 12.5" fill="none" stroke="#9fe0ff" stroke-width="3.5" stroke-linecap="round"/><path d="M2 9 L6 14 L10 8 Z" fill="#9fe0ff" ${O}/><path d="M16 12 L20 16 L16 20 L12 16 Z" fill="#e8d9b0" ${O}/>`,
  secondWind: `<rect width="32" height="32" fill="#173d2a"/><path d="M16 27 C4 18 4 8 10.5 7 C13.5 6.6 15.3 8.4 16 10 C16.7 8.4 18.5 6.6 21.5 7 C28 8 28 18 16 27 Z" fill="#7fe0a0" ${O}/><path d="M16 12 V20 M12 16 H20" stroke="#12141a" stroke-width="2.5" stroke-linecap="round"/>`,
};

/** An element showing the skill's picture. Purely decorative: the name is given in text elsewhere. */
export function skillIcon(id: SkillId): HTMLElement {
  const holder = document.createElement('span');
  holder.className = 'icon';
  holder.setAttribute('aria-hidden', 'true');
  holder.innerHTML = `<svg viewBox="0 0 32 32" width="100%" height="100%">${ICONS[id]}</svg>`;
  return holder;
}
