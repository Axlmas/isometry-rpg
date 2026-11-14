import {
  DEATH_XP_LOSS, MAX_LEVEL, MONSTER_DAMAGE_PER_LEVEL, MONSTER_HP_PER_LEVEL, MONSTER_MAX_HP, MONSTER_XP,
  MONSTER_XP_PER_LEVEL, PLAYER_DAMAGE_PER_LEVEL, PLAYER_HP_PER_LEVEL, PLAYER_MAX_HP, PLAYER_MAX_MP,
  PLAYER_MP_PER_LEVEL, XP_CURVE_BASE, XP_CURVE_POWER,
} from './balance';
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

/** Multiplier applied to the hero's weapon damage. */
export function damageBonusAtLevel(level: number): number {
  return 1 + PLAYER_DAMAGE_PER_LEVEL * (level - 1);
}

// Monsters grow with the dungeon level so that a stronger hero still has a fight.
export function monsterMaxHp(dungeonLevel: number): number {
  return Math.round(MONSTER_MAX_HP * (1 + MONSTER_HP_PER_LEVEL * (dungeonLevel - 1)));
}
export function monsterDamageBonus(dungeonLevel: number): number {
  return 1 + MONSTER_DAMAGE_PER_LEVEL * (dungeonLevel - 1);
}
export function monsterXp(dungeonLevel: number): number {
  return Math.round(MONSTER_XP * (1 + MONSTER_XP_PER_LEVEL * (dungeonLevel - 1)));
}

/** Skills that become available exactly at `level`. */
export function skillsUnlockedAt(level: number): SkillId[] {
  return SKILL_IDS.filter((id) => SKILLS[id].unlockLevel === level);
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
    player.maxHp = maxHpAtLevel(player.level);
    player.maxMp = maxMpAtLevel(player.level);
    // A new level is a moment of relief: the hero is fully restored.
    player.hp = player.maxHp;
    player.mp = player.maxMp;
    world.events.push({ type: 'levelUp', level: player.level, unlocked: skillsUnlockedAt(player.level) });
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
