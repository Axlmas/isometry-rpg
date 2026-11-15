import {
  DEATH_XP_LOSS, MAX_LEVEL, type MonsterKind, MONSTER_KINDS, MONSTER_DAMAGE_PER_LEVEL, MONSTER_HP_PER_LEVEL, MONSTER_MAX_HP, MONSTER_XP,
  MONSTER_XP_PER_LEVEL, PLAYER_DAMAGE_PER_LEVEL, PLAYER_HP_PER_LEVEL, PLAYER_MAX_HP, PLAYER_MAX_MP,
  PLAYER_MP_PER_LEVEL, XP_CURVE_BASE, XP_CURVE_POWER,
} from './balance';
import { type ClassId, type RaceId, CLASSES, RACES } from './classes';
import { type SkillId, SKILLS, SKILL_IDS } from './skills';
import type { World } from './world';

/** Experience needed to go from `level` to the next one. */
export function xpToNextLevel(level: number): number {
  return Math.round(XP_CURVE_BASE * level ** XP_CURVE_POWER);
}

export function maxHpAtLevel(level: number): number {
  return PLAYER_MAX_HP + PLAYER_HP_PER_LEVEL * (level - 1);
}

export function maxMpAtLevel(level: number): number {
  return PLAYER_MAX_MP + PLAYER_MP_PER_LEVEL * (level - 1);
}

/** The hero's maximum health and mana: the level table adjusted for race and class. */
export function heroMaxHp(level: number, race: RaceId, cls: ClassId): number {
  return Math.round(maxHpAtLevel(level) * RACES[race].hp * CLASSES[cls].hp);
}
export function heroMaxMp(level: number, race: RaceId, cls: ClassId): number {
  return Math.round(maxMpAtLevel(level) * RACES[race].mp * CLASSES[cls].mp);
}

/** Multiplier applied to the hero's weapon damage. */
export function damageBonusAtLevel(level: number): number {
  return 1 + PLAYER_DAMAGE_PER_LEVEL * (level - 1);
}

// Monsters grow with the zone's level so that a stronger hero still has a fight.
export function monsterMaxHp(zoneLevel: number, kind: MonsterKind = 'grunt'): number {
  return Math.round(MONSTER_MAX_HP * (1 + MONSTER_HP_PER_LEVEL * (zoneLevel - 1)) * MONSTER_KINDS[kind].hp);
}
export function monsterDamageBonus(zoneLevel: number, kind: MonsterKind = 'grunt'): number {
  return (1 + MONSTER_DAMAGE_PER_LEVEL * (zoneLevel - 1)) * MONSTER_KINDS[kind].damage;
}
export function monsterXp(zoneLevel: number, kind: MonsterKind = 'grunt'): number {
  return Math.round(MONSTER_XP * (1 + MONSTER_XP_PER_LEVEL * (zoneLevel - 1)) * MONSTER_KINDS[kind].xp);
}

/** Skills that become available exactly at `level`: of one class, or of all when none is given. */
export function skillsUnlockedAt(level: number, cls?: ClassId): SkillId[] {
  return SKILL_IDS.filter((id) => SKILLS[id].unlockLevel === level && (cls === undefined || SKILLS[id].cls === cls));
}

/** Gives experience and applies any level-ups it causes. */
export function grantXp(world: World, amount: number): void {
  const { player } = world;
  if (amount <= 0 || player.level >= MAX_LEVEL) return;
  player.xp += amount;
  world.events.push({ type: 'xpGained', amount });
  while (player.level < MAX_LEVEL && player.xp >= xpToNextLevel(player.level)) {
    player.xp -= xpToNextLevel(player.level);
    player.level += 1;
    player.maxHp = heroMaxHp(player.level, player.race, player.cls);
    player.maxMp = heroMaxMp(player.level, player.race, player.cls);
    // A new level is a moment of relief: the hero is fully restored.
    player.hp = player.maxHp;
    player.mp = player.maxMp;
    world.events.push({ type: 'levelUp', level: player.level, unlocked: skillsUnlockedAt(player.level, player.cls) });
  }
  if (player.level >= MAX_LEVEL) player.xp = 0;
  player.revision += 1;
}

/** Takes away part of the current level's progress. Never lowers the level. Returns the amount lost. */
export function applyDeathPenalty(world: World): number {
  const { player } = world;
  const lost = Math.min(player.xp, Math.round(xpToNextLevel(player.level) * DEATH_XP_LOSS));
  player.xp -= lost;
  if (lost > 0) player.revision += 1;
  return lost;
}
