import type { MessageKey } from '../i18n';
import type { SkillId } from '../sim';

// Skill IDs to translation keys, written out in full so the translation check
// can find them. The Record types make a skill without texts a compile error.

export const SKILL_NAME: Record<SkillId, MessageKey> = {
  heavyBlow: 'skill.heavyBlow',
  sweep: 'skill.sweep',
  secondWind: 'skill.secondWind',
};

export const SKILL_INFO: Record<SkillId, MessageKey> = {
  heavyBlow: 'skillInfo.heavyBlow',
  sweep: 'skillInfo.sweep',
  secondWind: 'skillInfo.secondWind',
};

/** Physical keys (KeyboardEvent.code) and the letter shown on the button. */
export const SKILL_KEYS: Record<SkillId, { code: string; label: string }> = {
  heavyBlow: { code: 'KeyQ', label: 'Q' },
  sweep: { code: 'KeyE', label: 'E' },
  secondWind: { code: 'KeyR', label: 'R' },
};
