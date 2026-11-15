import { CHARGE_DAMAGE_MULTIPLIER, PLAYER_ATTACK_RANGE, PLAYER_ATTACK_WINDUP, TICK_MS } from './balance';
import type { ClassId } from './classes';
import { hitMonstersAround } from './combat';
import { attackCooldown } from './inventory';
import type { Point } from './grid';
import { spendCharge } from './inventory';
import type { World } from './world';

/** Skill IDs are stable: saves and the client refer to them. */
export type SkillId =
  | 'heavyBlow' | 'sweep' | 'secondWind'
  | 'powerShot' | 'volley' | 'swiftness'
  | 'fireBolt' | 'frostNova' | 'mend';

export type SkillEffect =
  /** A melee blow with its own shape and strength. `arc` is the full width in radians. */
  | { kind: 'strike'; arc: number; range: number; multiplier: number }
  /** One or more missiles from a ranged weapon. `spread` is the full width of the fan in radians. */
  | { kind: 'shot'; count: number; spread: number; multiplier: number; pierce: boolean; splash: number }
  /** Hits everything around the hero at once and slows it for `slow` ticks. */
  | { kind: 'nova'; radius: number; multiplier: number; slow: number }
  /** Restores this share of maximum health. */
  | { kind: 'heal'; fraction: number }
  /** Walk `factor` times faster for `duration` ticks. */
  | { kind: 'haste'; factor: number; duration: number };

export interface SkillDef {
  id: SkillId;
  /** Only heroes of this class can learn it. */
  cls: ClassId;
  unlockLevel: number;
  manaCost: number;
  /** In ticks. */
  cooldown: number;
  effect: SkillEffect;
}

const seconds = (value: number): number => Math.round((value * 1000) / TICK_MS);
const degrees = (value: number): number => (value * Math.PI) / 180;
const skill = (id: SkillId, cls: ClassId, unlockLevel: number, manaCost: number, cooldown: number, effect: SkillEffect): SkillDef => ({
  id, cls, unlockLevel, manaCost, cooldown: seconds(cooldown), effect,
});

/** Three skills per class, opening at levels 2, 4 and 6: a strong hit, an area hit, and something to survive with. */
export const SKILLS: Readonly<Record<SkillId, SkillDef>> = {
  heavyBlow: skill('heavyBlow', 'warrior', 2, 8, 4, { kind: 'strike', arc: degrees(60), range: PLAYER_ATTACK_RANGE + 0.25, multiplier: 2.2 }),
  sweep: skill('sweep', 'warrior', 4, 14, 8, { kind: 'strike', arc: degrees(360), range: PLAYER_ATTACK_RANGE, multiplier: 1.3 }),
  secondWind: skill('secondWind', 'warrior', 6, 20, 20, { kind: 'heal', fraction: 0.35 }),

  powerShot: skill('powerShot', 'archer', 2, 8, 4, { kind: 'shot', count: 1, spread: 0, multiplier: 2.2, pierce: true, splash: 0 }),
  volley: skill('volley', 'archer', 4, 14, 8, { kind: 'shot', count: 5, spread: degrees(50), multiplier: 0.9, pierce: false, splash: 0 }),
  swiftness: skill('swiftness', 'archer', 6, 18, 20, { kind: 'haste', factor: 1.5, duration: seconds(5) }),

  fireBolt: skill('fireBolt', 'mage', 2, 10, 3, { kind: 'shot', count: 1, spread: 0, multiplier: 1.9, pierce: false, splash: 1.4 }),
  frostNova: skill('frostNova', 'mage', 4, 18, 9, { kind: 'nova', radius: 2.6, multiplier: 1.2, slow: seconds(3) }),
  mend: skill('mend', 'mage', 6, 22, 15, { kind: 'heal', fraction: 0.35 }),
};
export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];

/** The skills of a class, in the order of the keys that use them. */
export function classSkills(cls: ClassId): SkillId[] {
  return SKILL_IDS.filter((id) => SKILLS[id].cls === cls).sort((a, b) => SKILLS[a].unlockLevel - SKILLS[b].unlockLevel);
}

export function isSkillId(value: unknown): value is SkillId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SKILLS, value);
}

/**
 * Tries to use a skill. A refusal the player should hear about (locked, not
 * learned, no mana, still cooling down) is reported as an event; nothing
 * else changes.
 */
export function useSkill(world: World, id: SkillId, dir: Point | null): void {
  const { player } = world;
  if (!isSkillId(id)) return;
  const def = SKILLS[id];
  const deny = (reason: 'locked' | 'unlearned' | 'cooldown' | 'mana') => void world.events.push({ type: 'skillDenied', id, reason });
  if (player.level < def.unlockLevel) return deny('locked');
  // Reaching the level is not enough: the trainer has to teach the skill.
  if (!player.skills.includes(id)) return deny('unlearned');
  if (player.skillCooldowns[id] > 0) return deny('cooldown');
  if (player.mp < def.manaCost) return deny('mana');

  const { effect } = def;
  let charged = false;
  if (effect.kind === 'strike' || effect.kind === 'shot') {
    // A blow already in the air has to land first; the key press is simply ignored.
    if (player.pendingAttack !== null) return;
    const aim = dir ?? player.facing;
    player.facing = aim;
    player.attackCooldown = attackCooldown(player);
    charged = spendCharge(world);
    const multiplier = effect.multiplier * (charged ? CHARGE_DAMAGE_MULTIPLIER : 1);
    player.pendingAttack =
      effect.kind === 'strike'
        ? { dir: aim, ticks: PLAYER_ATTACK_WINDUP, arc: effect.arc, range: effect.range, multiplier, charged, cleave: effect.arc > Math.PI, shot: null }
        : { dir: aim, ticks: PLAYER_ATTACK_WINDUP, arc: 0, range: 0, multiplier, charged, cleave: false, shot: { count: effect.count, spread: effect.spread, pierce: effect.pierce, splash: effect.splash } };
  } else if (effect.kind === 'nova') {
    hitMonstersAround(world, player.pos, effect.radius, effect.multiplier, effect.slow);
  } else if (effect.kind === 'heal') {
    const healed = Math.min(player.maxHp - player.hp, Math.round(player.maxHp * effect.fraction));
    player.hp += healed;
    world.events.push({ type: 'playerHealed', amount: healed });
  } else {
    player.hasteTicks = effect.duration;
    player.hasteFactor = effect.factor;
  }
  player.mp -= def.manaCost;
  player.skillCooldowns[id] = def.cooldown;
  world.events.push({ type: 'skillUsed', id, dir: { ...player.facing }, charged });
}
