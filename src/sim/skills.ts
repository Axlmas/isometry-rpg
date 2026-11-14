import { PLAYER_ATTACK_COOLDOWN, PLAYER_ATTACK_RANGE, PLAYER_ATTACK_WINDUP, TICK_MS } from './balance';
import type { Point } from './grid';
import type { World } from './world';

/** Skill IDs are stable: saves and the client refer to them. */
export type SkillId = 'heavyBlow' | 'sweep' | 'secondWind';
export const SKILL_IDS: readonly SkillId[] = ['heavyBlow', 'sweep', 'secondWind'];

export type SkillEffect =
  /** A weapon blow with its own shape and strength. `arc` is the full width in radians. */
  | { kind: 'strike'; arc: number; range: number; multiplier: number }
  /** Restores this share of maximum health. */
  | { kind: 'heal'; fraction: number };

export interface SkillDef {
  id: SkillId;
  unlockLevel: number;
  manaCost: number;
  /** In ticks. */
  cooldown: number;
  effect: SkillEffect;
}

const seconds = (value: number): number => Math.round((value * 1000) / TICK_MS);
const degrees = (value: number): number => (value * Math.PI) / 180;

export const SKILLS: Readonly<Record<SkillId, SkillDef>> = {
  heavyBlow: {
    id: 'heavyBlow',
    unlockLevel: 2,
    manaCost: 8,
    cooldown: seconds(4),
    effect: { kind: 'strike', arc: degrees(60), range: PLAYER_ATTACK_RANGE + 0.25, multiplier: 2.2 },
  },
  sweep: {
    id: 'sweep',
    unlockLevel: 4,
    manaCost: 14,
    cooldown: seconds(8),
    effect: { kind: 'strike', arc: degrees(360), range: PLAYER_ATTACK_RANGE, multiplier: 1.3 },
  },
  secondWind: {
    id: 'secondWind',
    unlockLevel: 6,
    manaCost: 20,
    cooldown: seconds(20),
    effect: { kind: 'heal', fraction: 0.35 },
  },
};

export function isSkillId(value: unknown): value is SkillId {
  return typeof value === 'string' && (SKILL_IDS as readonly string[]).includes(value);
}

/**
 * Tries to use a skill. A refusal the player should hear about (locked, no
 * mana, still cooling down) is reported as an event; nothing else changes.
 */
export function useSkill(world: World, id: SkillId, dir: Point | null): void {
  const { player } = world;
  if (!isSkillId(id)) return;
  const def = SKILLS[id];
  if (player.level < def.unlockLevel) {
    world.events.push({ type: 'skillDenied', id, reason: 'locked' });
    return;
  }
  if (player.skillCooldowns[id] > 0) {
    world.events.push({ type: 'skillDenied', id, reason: 'cooldown' });
    return;
  }
  if (player.mp < def.manaCost) {
    world.events.push({ type: 'skillDenied', id, reason: 'mana' });
    return;
  }

  const { effect } = def;
  if (effect.kind === 'strike') {
    // A blow already in the air has to land first; the key press is simply ignored.
    if (player.pendingAttack !== null) return;
    const aim = dir ?? player.facing;
    player.facing = aim;
    player.attackCooldown = PLAYER_ATTACK_COOLDOWN;
    player.pendingAttack = { dir: aim, ticks: PLAYER_ATTACK_WINDUP, arc: effect.arc, range: effect.range, multiplier: effect.multiplier };
  } else {
    const healed = Math.min(player.maxHp - player.hp, Math.round(player.maxHp * effect.fraction));
    player.hp += healed;
    world.events.push({ type: 'playerHealed', amount: healed });
  }
  player.mp -= def.manaCost;
  player.skillCooldowns[id] = def.cooldown;
  world.events.push({ type: 'skillUsed', id, dir: { ...player.facing } });
}
