import { describe, expect, it } from 'vitest';
import { parseSave, serializeWorld } from '../src/client/save';
import {
  type ItemMods, type Monster, type World,
  AFFIX_RANGE, CRIT_BASE, CRIT_MULTIPLIER, ELDER, ITEMS, MONSTER_LINK_RANGE, PACK_RADIUS, PLAYER_ATTACK_COOLDOWN, QUALITIES, QUALITY, REGIONS,
  addItem, affixCount, attackCooldown, createRng, createWorld, critChance, droppableEquipment, gearStats, monsterMaxHp, monsterXp, newHero,
  playerDamage, playerDefense, refreshVitals, regionAt, rollMods, sellPrice, step, validMods, worthOf,
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

describe('packs and elders', () => {
  it('settles open-world monsters in packs of the region\'s size, close together', () => {
    const world = overworld();
    const packs = new Map<number, Monster[]>();
    for (const monster of world.monsters) packs.set(monster.pack, [...(packs.get(monster.pack) ?? []), monster]);
    let full = 0;
    for (const members of packs.values()) {
      const region = regionAt('overworld', members[0]!.home);
      expect(members.length).toBeLessThanOrEqual(region.pack);
      if (members.length === region.pack) full += 1;
      for (const member of members) {
        expect(regionAt('overworld', member.home)).toBe(region);
        expect(member.level).toBe(members[0]!.level);
        expect(Math.hypot(member.home.x - members[0]!.home.x, member.home.y - members[0]!.home.y)).toBeLessThanOrEqual(PACK_RADIUS);
      }
    }
    // Most packs are complete; a few at the edge of a wood are short.
    expect(full / packs.size).toBeGreaterThan(0.8);
    expect(REGIONS.moor.pack).toBeGreaterThan(REGIONS.hollow.pack);
  });

  it('brings the whole pack when one of them notices the hero, but not the whole field', () => {
    const world = overworld();
    const first = world.monsters.find((monster) => world.monsters.filter((other) => other.pack === monster.pack).length === REGIONS.moor.pack)!;
    world.player.pos = { x: first.home.x + 0.5, y: first.home.y + 0.5 };
    for (let i = 0; i < 3; i++) step(world);
    const pack = world.monsters.filter((monster) => monster.pack === first.pack);
    expect(pack.every((monster) => monster.aggro)).toBe(true);
    const hunting = world.monsters.filter((monster) => monster.aggro);
    expect(hunting.length).toBeLessThan(12);
    // Everyone hunting was either in sight of the hero or within call of someone who was.
    for (const monster of hunting) {
      const reach = Math.min(...pack.map((mate) => Math.hypot(mate.home.x - monster.home.x, mate.home.y - monster.home.y)));
      expect(reach).toBeLessThanOrEqual(MONSTER_LINK_RANGE * 3 + 5);
    }
  });

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
      expect(found).toBeLessThanOrEqual(ELDER.drops);
      items += found;
      expect(types(world)).not.toContain('playerDied');
    }
    // A boar's table comes up about 77 times in 100; an elder rolls it twice.
    expect(items / 200).toBeGreaterThan(1.2);
  });
});
