import type { MessageKey } from '../i18n';
import { type ClassId, type RaceId, type SkillId, classSkills } from '../sim';

// IDs to translation keys, written out in full so the translation check can
// find them. The Record types make a skill, class or race without texts a
// compile error.

export const SKILL_NAME: Record<SkillId, MessageKey> = {
  heavyBlow: 'skill.heavyBlow',
  sweep: 'skill.sweep',
  secondWind: 'skill.secondWind',
  powerShot: 'skill.powerShot',
  volley: 'skill.volley',
  swiftness: 'skill.swiftness',
  fireBolt: 'skill.fireBolt',
  frostNova: 'skill.frostNova',
  mend: 'skill.mend',
};

export const SKILL_INFO: Record<SkillId, MessageKey> = {
  heavyBlow: 'skillInfo.heavyBlow',
  sweep: 'skillInfo.sweep',
  secondWind: 'skillInfo.secondWind',
  powerShot: 'skillInfo.powerShot',
  volley: 'skillInfo.volley',
  swiftness: 'skillInfo.swiftness',
  fireBolt: 'skillInfo.fireBolt',
  frostNova: 'skillInfo.frostNova',
  mend: 'skillInfo.mend',
};

export const CLASS_NAME: Record<ClassId, MessageKey> = { warrior: 'class.warrior', archer: 'class.archer', mage: 'class.mage' };
export const CLASS_INFO: Record<ClassId, MessageKey> = { warrior: 'classInfo.warrior', archer: 'classInfo.archer', mage: 'classInfo.mage' };
export const RACE_NAME: Record<RaceId, MessageKey> = { human: 'race.human', elf: 'race.elf' };
export const RACE_INFO: Record<RaceId, MessageKey> = { human: 'raceInfo.human', elf: 'raceInfo.elf' };

/** The three skill keys, by position: a class's first skill is on Q, the second on E, the third on R. Physical keys (KeyboardEvent.code). */
export const SKILL_SLOTS: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'KeyQ', label: 'Q' },
  { code: 'KeyE', label: 'E' },
  { code: 'KeyR', label: 'R' },
];

/** The letter of the key that uses a skill. */
export function skillKeyLabel(id: SkillId, cls: ClassId): string {
  return SKILL_SLOTS[classSkills(cls).indexOf(id)]?.label ?? '';
}
