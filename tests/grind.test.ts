import { describe, expect, it } from 'vitest';
import { parseSave, serializeWorld } from '../src/client/save';
import {
  type ItemMods, type Monster, type World,
  AFFIX_RANGE, CRIT_BASE, CRIT_MULTIPLIER, DROP_TABLES, ELDER, ITEMS, MASTERY_TIERS, MONSTER_KINDS, MONSTER_KIND_IDS, MONSTER_SPACING, PLAYER_ATTACK_COOLDOWN, PLAYER_ATTACK_SLOW, STREAK_CAP, STREAK_WINDOW, STREAK_XP, QUALITIES, QUALITY,
  addItem, affixCount, attackCooldown, createRng, createWorld, critChance, droppableEquipment, gearStats, isUnique, masteryTier, monsterMaxHp, monsterXp, newHero,
  playerDamage, playerDefense, refreshVitals, rollMods, streakBonus, sellPrice, step, validMods, worthOf,
} from '../src/sim';

const equipment = (id: keyof typeof ITEMS) => ITEMS[id] as Extract<(typeof ITEMS)[keyof typeof ITEMS], { kind: 'equipment' }>;
const overworld = (seed = 1): World => createWorld(seed, newHero('human', 'warrior'), 1, 'overworld');
const types = (world: World) => world.events.map((event) => event.type);

describe('item quality and properties', () => {
  it('rolls as many properties as the quality allows, each once and within its range', () => {
    const rng = createRng(7);
    for (const itemId of [...droppableEquipment('none'), ...droppableEquipment('d')]) {
      const def = equipment(itemId);
      for (let i = 0; i < 200; i++) {
        const mods = rollMods(rng, def);
        if (!mods) continue;
        expect(mods.affixes).toHaveLength(affixCount(def, mods.quality));
        expect(new Set(mods.affixes.map((affix) => affix.stat)).size).toBe(mods.affixes.length);
        for (const affix of mods.affixes) {
          const [min, max] = AFFIX_RANGE[def.grade][affix.stat];
          expect(affix.value).toBeGreaterThanOrEqual(min);
          expect(affix.value).toBeLessThanOrEqual(max);
        }
        expect(validMods(def, mods)).toBe(true);
      }
    }
  });

  it('makes better quality rarer, and an elder luckier', () => {
    const count = (elder: boolean) => {
      const rng = createRng(11);
      const seen: Record<string, number> = { common: 0, fine: 0, rare: 0, epic: 0 };
      for (let i = 0; i < 4000; i++) seen[rollMods(rng, equipment('ironSword'), elder)?.quality ?? 'common']! += 1;
      return seen;
    };
    const plain = count(false);
    expect(plain.common!).toBeGreaterThan(plain.fine!);
    expect(plain.fine!).toBeGreaterThan(plain.rare!);
    expect(plain.rare!).toBeGreaterThan(plain.epic!);
    expect(plain.epic!).toBeGreaterThan(0);
    expect(count(true).epic!).toBeGreaterThan(plain.epic! * 2);
    for (const quality of QUALITIES) expect(QUALITY[quality].worth).toBeGreaterThanOrEqual(1);
    expect(QUALITIES.reduce((sum, quality) => sum + QUALITY[quality].weight, 0)).toBe(100);
    expect(QUALITIES.reduce((sum, quality) => sum + QUALITY[quality].elderWeight, 0)).toBe(100);
  });

  it('gives jewellery at least one property, since it has nothing else', () => {
    const rng = createRng(3);
    for (let i = 0; i < 200; i++) expect(rollMods(rng, equipment('copperRing'))?.affixes.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects properties an item could not have rolled', () => {
    const def = equipment('ironSword');
    expect(validMods(def, { quality: 'fine', affixes: [{ stat: 'crit', value: 2 }] })).toBe(true);
    expect(validMods(def, { quality: 'fine', affixes: [{ stat: 'crit', value: 99 }] })).toBe(false);
    expect(validMods(def, { quality: 'fine', affixes: [] })).toBe(false);
    expect(validMods(def, { quality: 'rare', affixes: [{ stat: 'crit', value: 2 }, { stat: 'crit', value: 2 }] })).toBe(false);
    expect(validMods(def, { quality: 'legendary', affixes: [] })).toBe(false);
    expect(validMods(def, { quality: 'common', affixes: [] })).toBe(false);
    expect(validMods(def, null)).toBe(false);
  });

  it('changes what the hero can do when worn, and changes it back when taken off', () => {
    const world = overworld();
    const { player } = world;
    const before = { hp: player.maxHp, mp: player.maxMp, defense: playerDefense(player), crit: critChance(player), cooldown: attackCooldown(player) };
    const ring: ItemMods = { quality: 'epic', affixes: [{ stat: 'hp', value: 14 }, { stat: 'mp', value: 10 }, { stat: 'crit', value: 3 }, { stat: 'haste', value: 5 }] };
    const cap: ItemMods = { quality: 'rare', affixes: [{ stat: 'defense', value: 1 }, { stat: 'speed', value: 4 }] };
    addItem(player, 'copperRing', 1, 0, ring);
    addItem(player, 'leatherCap', 1, 0, cap);
    step(world, [{ type: 'equip', index: 0 }]);
    step(world, [{ type: 'equip', index: 0 }]);
    expect(player.inventory).toEqual([]);
    expect(player.maxHp).toBe(before.hp + 14);
    expect(player.maxMp).toBe(before.mp + 10);
    expect(critChance(player)).toBe(before.crit + 3);
    expect(attackCooldown(player)).toBeLessThanOrEqual(before.cooldown);
    // The cap: 1 of its own, 1 for being rare, 1 from its property.
    expect(playerDefense(player)).toBe(before.defense + 3);
    expect(gearStats(player).speed).toBe(4);

    player.hp = player.maxHp;
    step(world, [{ type: 'unequip', slot: 'ring' }, { type: 'unequip', slot: 'helmet' }]);
    expect(player.maxHp).toBe(before.hp);
    expect(player.hp).toBe(before.hp);
    expect(playerDefense(player)).toBe(before.defense);
    // The items keep what makes them special.
    expect(player.inventory.map((stack) => stack.mods)).toEqual([ring, cap]);
  });

  it('walks and strikes faster with the right properties', () => {
    const walk = (speed: number) => {
      const world = overworld();
      for (let i = 0; i < world.map.tiles.length; i++) world.map.tiles[i] = 0;
      world.monsters = [];
      if (speed > 0) {
        world.player.equipment.boots = 'leatherBoots';
        world.player.equipmentMods.boots = { quality: 'fine', affixes: [{ stat: 'speed', value: speed }] };
      }
      const from = world.player.pos.x;
      step(world, [{ type: 'moveDir', dx: 1, dy: 0 }]);
      for (let i = 0; i < 19; i++) step(world);
      return world.player.pos.x - from;
    };
    expect(walk(4) / walk(0)).toBeCloseTo(1.04, 2);

    const world = overworld();
    world.player.equipment.gloves = 'leatherGloves';
    world.player.equipmentMods.gloves = { quality: 'fine', affixes: [{ stat: 'haste', value: 5 }] };
    world.player.equipment.ring = 'silverRing';
    world.player.equipmentMods.ring = { quality: 'common', affixes: [{ stat: 'haste', value: 8 }] };
    expect(attackCooldown(world.player)).toBeLessThan(PLAYER_ATTACK_COOLDOWN);
  });

  it('raises a weapon\'s damage and the price a merchant pays', () => {
    const world = overworld();
    const plain = playerDamage(world.player);
    world.player.equipmentMods.weapon = { quality: 'epic', affixes: [{ stat: 'hp', value: 6 }, { stat: 'mp', value: 4 }, { stat: 'crit', value: 1 }] };
    expect(playerDamage(world.player)[1]).toBeGreaterThan(plain[1]);
    expect(sellPrice('ironSword', worthOf({ quality: 'epic', affixes: [] }))).toBeGreaterThan(sellPrice('ironSword'));
    expect(sellPrice('ironSword', worthOf(undefined))).toBe(sellPrice('ironSword'));
  });

  it('survives saving and loading, and a tampered one is refused', () => {
    const world = overworld(5);
    const mods: ItemMods = { quality: 'rare', affixes: [{ stat: 'power', value: 4 }, { stat: 'crit', value: 2 }] };
    addItem(world.player, 'ironSword', 1, 2, mods);
    world.player.equipment.ring = 'copperRing';
    world.player.equipmentMods.ring = { quality: 'common', affixes: [{ stat: 'hp', value: 9 }] };
    refreshVitals(world.player);
    const raw = serializeWorld(world);
    const loaded = parseSave(raw);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.world.player.inventory).toEqual([{ itemId: 'ironSword', count: 1, enchant: 2, mods }]);
    expect(loaded.world.player.equipmentMods.ring).toEqual({ quality: 'common', affixes: [{ stat: 'hp', value: 9 }] });
    expect(loaded.world.player.maxHp).toBe(world.player.maxHp);

    expect(parseSave(raw.replace('"value":4', '"value":400')).status).toBe('damaged');
    expect(parseSave(raw.replace('"quality":"rare"', '"quality":"epic"')).status).toBe('damaged');
  });
});

describe('critical blows', () => {
  it('land about as often as the chance says and hit harder', () => {
    let crits = 0;
    let blows = 0;
    for (let seed = 0; seed < 300; seed++) {
      const world = overworld(seed);
      const { map } = world;
      for (let y = 1; y < map.height - 1; y++) for (let x = 1; x < map.width - 1; x++) map.tiles[y * map.width + x] = 0;
      const template = world.monsters[0] as Monster;
      world.monsters = [{ ...template, elder: false, hp: 100000, maxHp: 100000, pos: { x: world.spawn.x + 1, y: world.spawn.y }, home: { ...world.spawn } }];
      step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
      for (let i = 0; i < 5; i++) {
        for (const event of world.events) {
          if (event.type !== 'monsterHit') continue;
          blows += 1;
          const [min, max] = playerDamage(world.player);
          if (event.crit) {
            crits += 1;
            expect(event.damage).toBeGreaterThanOrEqual(min * CRIT_MULTIPLIER);
          } else {
            expect(event.damage).toBeLessThanOrEqual(max);
          }
        }
        step(world);
      }
    }
    expect(blows).toBe(300);
    expect(crits / blows).toBeGreaterThan(CRIT_BASE / 100 - 0.04);
    expect(crits / blows).toBeLessThan(CRIT_BASE / 100 + 0.05);
  });
});

describe('who comes when one is attacked', () => {
  /** Open ground on the moor with the given monsters around the hero. */
  function field(kind: Monster['kind'], offsets: Array<[number, number]>): World {
    const world = overworld();
    const { map } = world;
    const at = { x: 60, y: 24 };
    for (let y = at.y - 15; y <= at.y + 15; y++) for (let x = at.x - 15; x <= at.x + 15; x++) map.tiles[y * map.width + x] = 0;
    world.player.pos = { ...at };
    const template = world.monsters[0] as Monster;
    world.monsters = offsets.map(([dx, dy], id) => ({ ...template, id, kind, elder: false, rest: 100000, hp: 100000, maxHp: 100000, home: { x: at.x + dx, y: at.y + dy }, pos: { x: at.x + dx, y: at.y + dy } }));
    return world;
  }

  it('spreads monsters out singly, at uneven distances, never on top of each other', () => {
    const world = overworld();
    const nearest = world.monsters.map((monster) =>
      Math.min(...world.monsters.filter((other) => other !== monster).map((other) => Math.hypot(other.home.x - monster.home.x, other.home.y - monster.home.y))));
    for (const gap of nearest) expect(gap).toBeGreaterThanOrEqual(MONSTER_SPACING);
    // Some stand in a crowd, some alone: how many a fight draws depends on where it starts.
    expect(nearest.filter((gap) => gap < 3.2).length).toBeGreaterThan(10);
    expect(nearest.filter((gap) => gap > 4).length).toBeGreaterThan(10);
  });

  it('leaves the hero alone if the kind is peaceful, until one is struck', () => {
    const world = field('boar', [[1, 0], [3, 0], [9, 0]]);
    for (let i = 0; i < 60; i++) step(world);
    expect(world.monsters.some((monster) => monster.aggro)).toBe(false);
    step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
    for (let i = 0; i < 4; i++) step(world);
    // The struck boar and the one within earshot turn on the hero; the far one grazes on.
    expect(world.monsters.map((monster) => monster.aggro)).toEqual([true, true, false]);
  });

  it('is attacked on sight by an aggressive kind, which calls only kin within earshot', () => {
    const sight = MONSTER_KINDS.wolf.aggro;
    const earshot = MONSTER_KINDS.wolf.social;
    const world = field('wolf', [[sight - 0.5, 0], [sight - 0.5 + earshot - 0.3, 0], [sight - 0.5 + earshot * 2 + 1, 0]]);
    step(world);
    expect(world.monsters.map((monster) => monster.aggro)).toEqual([true, true, false]);
    // The one who answered the call does not pass it on.
    for (let i = 0; i < 5; i++) step(world);
    expect(world.monsters[2]!.aggro).toBe(false);
  });

  it('a sweeping skill still hits everything around, unlike an ordinary blow', () => {
    const world = field('boar', [[1, 0], [-1, 0], [0, 1]]);
    world.player.level = 4;
    world.player.skills.push('sweep');
    world.player.mp = 100;
    step(world, [{ type: 'skill', id: 'sweep', dx: 1, dy: 0 }]);
    for (let i = 0; i < 4; i++) step(world);
    expect(world.monsters.every((monster) => monster.hp < monster.maxHp)).toBe(true);
  });

  it('slows the hero while striking: fight or run, not both', () => {
    const walked = (attacking: boolean) => {
      const world = field('boar', []);
      const from = world.player.pos.x;
      for (let i = 0; i < 40; i++) step(world, [{ type: 'moveDir', dx: 1, dy: 0 }, ...(attacking ? [{ type: 'attack', dx: 1, dy: 0 } as const] : [])]);
      return world.player.pos.x - from;
    };
    expect(walked(true)).toBeLessThan(walked(false) * (PLAYER_ATTACK_SLOW + 0.1));
  });
});

describe('hunting mastery and trophies', () => {
  it('counts kills by kind and makes the hero better against that kind, tier by tier', () => {
    const world = overworld();
    const { map } = world;
    for (let y = 1; y < map.height - 1; y++) for (let x = 1; x < map.width - 1; x++) map.tiles[y * map.width + x] = 0;
    const template = world.monsters[0] as Monster;
    const tiers: number[] = [];
    for (let i = 0; i < MASTERY_TIERS[0]!; i++) {
      world.monsters = [{ ...template, id: i, kind: 'wolf', elder: false, hp: 1, pos: { x: world.player.pos.x + 1, y: world.player.pos.y }, home: { ...world.player.pos } }];
      step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
      for (let t = 0; t < 12 && world.monsters.length > 0; t++) step(world);
      for (let t = 0; t < 12; t++) {
        step(world);
        for (const event of world.events) if (event.type === 'masteryUp') tiers.push(event.tier);
      }
      world.player.hp = world.player.maxHp;
    }
    expect(world.player.kills.wolf).toBe(MASTERY_TIERS[0]);
    expect(world.player.kills.boar).toBe(0);
    expect(masteryTier(world.player.kills.wolf)).toBe(1);
    expect(masteryTier(MASTERY_TIERS[MASTERY_TIERS.length - 1]!)).toBe(MASTERY_TIERS.length);
    expect(masteryTier(0)).toBe(0);
  });

  it('rewards killing without long pauses: a streak adds experience and lapses after a rest', () => {
    const world = overworld();
    const { map } = world;
    for (let y = 1; y < map.height - 1; y++) for (let x = 1; x < map.width - 1; x++) map.tiles[y * map.width + x] = 0;
    const template = world.monsters[0] as Monster;
    const kill = (id: number): number => {
      world.monsters = [{ ...template, id, kind: 'tusker', level: 6, elder: false, hp: 1, pos: { x: world.player.pos.x + 1, y: world.player.pos.y }, home: { ...world.player.pos } }];
      let gained = 0;
      step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
      for (let t = 0; t < 30; t++) {
        for (const event of world.events) if (event.type === 'xpGained') gained += event.amount;
        step(world);
      }
      return gained;
    };
    const first = kill(1);
    const second = kill(2);
    const third = kill(3);
    expect(world.player.streak).toBe(3);
    expect(second).toBeGreaterThanOrEqual(first);
    expect(third).toBeGreaterThan(first);
    expect(streakBonus(1)).toBe(1);
    expect(streakBonus(1000)).toBeCloseTo(1 + STREAK_CAP * STREAK_XP);
    for (let t = 0; t < STREAK_WINDOW + 1; t++) step(world);
    expect(world.player.streak).toBe(0);
  });

  it('keeps the kill count through saving and loading', () => {
    const world = overworld(5);
    world.player.kills.wolf = 73;
    const loaded = parseSave(serializeWorld(world));
    expect(loaded.status).toBe('ok');
    if (loaded.status === 'ok') expect(loaded.world.player.kills).toEqual({ ...world.player.kills, wolf: 73 });
    expect(parseSave(serializeWorld(world).replace('"wolf":73', '"wolf":-1')).status).toBe('damaged');
  });

  it('gives every kind of monster a trophy of its own that nothing else drops', () => {
    const trophies = MONSTER_KIND_IDS.map((kind) => DROP_TABLES[kind].rare.itemId);
    expect(new Set(trophies).size).toBe(MONSTER_KIND_IDS.length);
    for (const itemId of trophies) {
      expect(isUnique(itemId)).toBe(true);
      for (const kind of MONSTER_KIND_IDS) expect(DROP_TABLES[kind].drops.some((entry) => entry.items.includes(itemId))).toBe(false);
      expect(droppableEquipment('none')).not.toContain(itemId);
      expect(droppableEquipment('d')).not.toContain(itemId);
    }
    // Rare from an ordinary monster, a real hope from an elder.
    for (const kind of MONSTER_KIND_IDS) {
      expect(DROP_TABLES[kind].rare.chance).toBeLessThanOrEqual(10);
      expect(DROP_TABLES[kind].rare.elderChance).toBeGreaterThanOrEqual(10);
    }
  });

  it('a worn trophy gives what it promises', () => {
    const world = overworld();
    const before = { crit: critChance(world.player), cooldown: attackCooldown(world.player) };
    addItem(world.player, 'packFang', 1);
    step(world, [{ type: 'equip', index: 0 }]);
    expect(critChance(world.player)).toBe(before.crit + 6);
    expect(attackCooldown(world.player)).toBeLessThan(before.cooldown);
  });
});

describe('elders', () => {
  it('has a few elders: much tougher, and worth much more', () => {
    const world = overworld();
    const elders = world.monsters.filter((monster) => monster.elder);
    expect(elders.length).toBeGreaterThan(0);
    expect(elders.length).toBeLessThan(world.monsters.length / 5);
    for (const elder of elders) expect(elder.maxHp).toBe(monsterMaxHp(elder.level, elder.kind, true));
    expect(monsterMaxHp(3, 'wolf', true)).toBeGreaterThanOrEqual(monsterMaxHp(3, 'wolf') * ELDER.hp - 1);
    expect(monsterXp(3, 'wolf', true)).toBeGreaterThanOrEqual(monsterXp(3, 'wolf') * ELDER.xp - 2);
  });

  it('an elder leaves more coins and rolls the drop table more than once', () => {
    let items = 0;
    for (let seed = 0; seed < 200; seed++) {
      const world = overworld(seed);
      const { map } = world;
      for (let y = 1; y < map.height - 1; y++) for (let x = 1; x < map.width - 1; x++) map.tiles[y * map.width + x] = 0;
      const template = world.monsters[0] as Monster;
      world.monsters = [{ ...template, kind: 'boar', elder: true, hp: 1, pos: { x: world.spawn.x + 1, y: world.spawn.y }, home: { ...world.spawn } }];
      step(world, [{ type: 'attack', dx: 1, dy: 0 }]);
      for (let i = 0; i < 5 && world.monsters.length > 0; i++) step(world);
      expect(world.monsters).toEqual([]);
      // Whatever fell at the hero's feet is already in the bag.
      const found = world.loot.filter((loot) => loot.itemId !== 'coins').length + world.player.inventory.length;
      expect(found).toBeLessThanOrEqual(ELDER.drops + 1); // and, with luck, the trophy
      items += found;
      expect(types(world)).not.toContain('playerDied');
    }
    // A boar's table comes up about 77 times in 100; an elder rolls it twice.
    expect(items / 200).toBeGreaterThan(1.2);
  });
});
