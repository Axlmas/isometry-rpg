import { describe, expect, it } from 'vitest';
import {
  type ClassId, type EquipSlot, type ItemId, type MonsterKind, type World,
  TICK_MS, createWorld, isAlive, isWalkable, monsterMaxHp, newHero, step,
} from '../src/sim';

// How hard the hunt is, measured on the real rules: a hero of a given level, in the gear
// that level usually has, fights one monster of a region alone. Each scenario is a
// target for the game's difficulty. `npm run balance` prints the table.

interface Duel {
  /** Blows that landed until the monster fell. */
  hits: number;
  /** Seconds of fighting. */
  seconds: number;
  /** Share of the hero's health lost, 0..1. */
  lost: number;
  won: boolean;
}

/** Gear a hero of each stage usually wears. */
const GEAR: Record<'start' | 'plain' | 'd', (cls: ClassId) => Partial<Record<EquipSlot, ItemId>>> = {
  start: () => ({}),
  plain: (cls) => ({
    weapon: cls === 'archer' ? 'huntingBow' : cls === 'mage' ? 'oakStaff' : 'ironSword',
    helmet: 'leatherCap', armor: 'leatherJerkin', gloves: 'leatherGloves', boots: 'leatherBoots',
  }),
  d: (cls) => ({
    weapon: cls === 'archer' ? 'longbow' : cls === 'mage' ? 'runedStaff' : 'soldierBlade',
    helmet: 'ironHelm', armor: 'chainShirt', gloves: 'ironGauntlets', boots: 'ironGreaves',
  }),
};

function duel(cls: ClassId, level: number, gear: keyof typeof GEAR, kind: MonsterKind, monsterLevel: number, elder = false, seed = 7): Duel {
  const base = newHero('human', cls);
  const world: World = createWorld(seed, { ...base, level, equipment: { ...base.equipment, ...GEAR[gear](cls) } }, monsterLevel, 'dungeon');
  const { player } = world;
  // One monster of the wanted kind, a step away, already hunting the hero.
  const monster = world.monsters[0]!;
  world.monsters = [monster];
  const spot = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
    .map(([dx, dy]) => ({ x: Math.round(player.pos.x) + dx!, y: Math.round(player.pos.y) + dy! }))
    .find((p) => isWalkable(world.map, p.x, p.y))!;
  Object.assign(monster, {
    kind, level: monsterLevel, elder, pos: spot, home: { ...spot }, aggro: true, returning: false,
    maxHp: monsterMaxHp(monsterLevel, kind, elder), hp: monsterMaxHp(monsterLevel, kind, elder),
  });
  const startHp = player.hp;
  let hits = 0;
  let ticks = 0;
  while (ticks < (60 * 1000) / TICK_MS && isAlive(world) && world.monsters.includes(monster) && monster.hp > 0) {
    const ready = player.attackCooldown === 0 && player.pendingAttack === null;
    step(world, ready ? [{ type: 'attack', dx: monster.pos.x - player.pos.x, dy: monster.pos.y - player.pos.y }] : []);
    hits += world.events.filter((e) => e.type === 'monsterHit' && e.id === monster.id).length;
    ticks += 1;
  }
  const won = isAlive(world) && (monster.hp <= 0 || !world.monsters.includes(monster));
  return { hits, seconds: (ticks * TICK_MS) / 1000, lost: (startHp - Math.max(0, player.hp)) / player.maxHp, won };
}

/** Average over a few seeds, so one lucky roll does not decide. */
function average(run: (seed: number) => Duel): Duel {
  const runs = [7, 11, 23, 41, 59].map(run);
  const mean = (f: (d: Duel) => number) => runs.reduce((s, d) => s + f(d), 0) / runs.length;
  return { hits: mean((d) => d.hits), seconds: mean((d) => d.seconds), lost: mean((d) => d.lost), won: runs.every((d) => d.won) };
}

/** Each region's monster against a hero of its level in the gear usual for that level. */
const SCENARIOS: { name: string; cls: ClassId; level: number; gear: keyof typeof GEAR; kind: MonsterKind; monster: number; elder?: boolean }[] = [
  { name: 'meadow: young wolf', cls: 'warrior', level: 1, gear: 'start', kind: 'wolfPup', monster: 1 },
  { name: 'moor: wolf', cls: 'warrior', level: 3, gear: 'plain', kind: 'wolf', monster: 3 },
  { name: 'hollow: boar', cls: 'warrior', level: 4, gear: 'plain', kind: 'boar', monster: 4 },
  { name: 'thicket: tusker', cls: 'warrior', level: 6, gear: 'plain', kind: 'tusker', monster: 6 },
  { name: 'mines: ghoul', cls: 'warrior', level: 9, gear: 'd', kind: 'grunt', monster: 9 },
  { name: 'moor: wolf (archer)', cls: 'archer', level: 3, gear: 'plain', kind: 'wolf', monster: 3 },
  { name: 'hollow: boar (mage)', cls: 'mage', level: 4, gear: 'plain', kind: 'boar', monster: 4 },
];

describe('difficulty of the hunt', () => {
  const results = SCENARIOS.map((s) => ({ ...s, duel: average((seed) => duel(s.cls, s.level, s.gear, s.kind, s.monster, s.elder, seed)) }));

  // npm names the script it runs; the table is printed only for `npm run balance`.
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
  if (env.npm_lifecycle_event === 'balance' || env.BALANCE) {
    console.table(results.map((r) => ({
      scenario: r.name, hits: r.duel.hits.toFixed(1), seconds: r.duel.seconds.toFixed(1), 'health lost %': Math.round(r.duel.lost * 100), won: r.duel.won,
    })));
    const elder = average((seed) => duel('warrior', 3, 'plain', 'wolf', 3, true, seed));
    console.log(`elder wolf vs level 3 warrior: ${elder.hits.toFixed(1)} hits, ${elder.seconds.toFixed(1)} s, ${Math.round(elder.lost * 100)}% health lost, won: ${elder.won}`);
  }

  it('makes every monster a fight of several blows, not one or two', () => {
    for (const r of results) {
      expect(r.duel.hits, r.name).toBeGreaterThanOrEqual(4);
      expect(r.duel.hits, r.name).toBeLessThanOrEqual(14);
    }
  });

  it('takes the time of a classic MMORPG fight: seconds of trading blows, not a flurry or a slog', () => {
    for (const r of results) {
      expect(r.duel.seconds, r.name).toBeGreaterThanOrEqual(4);
      expect(r.duel.seconds, r.name).toBeLessThanOrEqual(18);
    }
  });

  it('makes the hero pay in health for every same-level fight, yet win it alone', () => {
    for (const r of results) {
      expect(r.duel.won, r.name).toBe(true);
      expect(r.duel.lost, r.name).toBeGreaterThanOrEqual(0.08);
      expect(r.duel.lost, r.name).toBeLessThanOrEqual(0.7);
    }
  });

  it('makes an elder a real danger for a hero of its level', () => {
    const elder = average((seed) => duel('warrior', 3, 'plain', 'wolf', 3, true, seed));
    expect(elder.lost > 0.5 || !elder.won).toBe(true);
  });
});
