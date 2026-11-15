import { addItem } from './inventory';
import { ITEMS, droppableEquipment } from './items';
import { rollMods } from './mods';
import { createRng } from './rng';
import { grantXp, xpToNextLevel } from './progression';
import type { World } from './world';
import { isWalkable } from './grid';
import { REGION_SITES } from './zones';

/**
 * Shortcuts for testing the game while it is being made. They only work in a
 * world created with `dev: true`, which the client sets for development
 * builds; an ordinary game ignores them.
 */
export type DevAction =
  | { action: 'levelUp' }
  | { action: 'coins' }
  /** Materials, crystals, scrolls and potions: enough to try crafting and tempering. */
  | { action: 'kit' }
  /** A handful of random equipment with rolled quality and properties. */
  | { action: 'gear' }
  | { action: 'heal' }
  /** Kills every monster near the hero, with loot and experience as usual. */
  | { action: 'clear' }
  | { action: 'teleport'; to: 'village' | 'pasture' | 'moor' | 'hollow' | 'thicket' | 'mines' };

export function runDevAction(world: World, dev: DevAction): void {
  if (!world.dev) return;
  const { player } = world;
  switch (dev.action) {
    case 'levelUp':
      grantXp(world, xpToNextLevel(player.level) - player.xp);
      return;
    case 'coins':
      player.coins += 1000;
      player.revision += 1;
      return;
    case 'kit':
      for (const [itemId, count] of [
        ['ironOre', 30], ['coal', 30], ['leather', 30], ['bone', 15], ['thread', 30], ['crystalD', 60],
        ['scrollWeaponPlain', 10], ['scrollArmorPlain', 10], ['healthPotion', 20], ['manaPotion', 20], ['chargePlain', 500],
      ] as const) addItem(player, itemId, count);
      return;
    case 'gear': {
      const rng = createRng(world.rngState);
      const pool = [...droppableEquipment('none'), ...droppableEquipment('d')];
      for (let i = 0; i < 6; i++) {
        const itemId = pool[rng.int(0, pool.length - 1)] as (typeof pool)[number];
        const def = ITEMS[itemId];
        if (def.kind === 'equipment') addItem(player, itemId, 1, 0, rollMods(rng, def, true));
      }
      world.rngState = rng.state;
      return;
    }
    case 'heal':
      if (player.hp > 0) {
        player.hp = player.maxHp;
        player.mp = player.maxMp;
      }
      return;
    case 'clear':
      for (const monster of world.monsters) {
        if (Math.hypot(monster.pos.x - player.pos.x, monster.pos.y - player.pos.y) <= 8) monster.hp = 0;
      }
      // Handled by the ordinary rules on the next blow or tick; here they are simply removed.
      world.monsters = world.monsters.filter((monster) => monster.hp > 0);
      return;
    case 'teleport': {
      if (world.zone !== 'overworld' || player.hp <= 0) return;
      const door = world.exits[0]?.pos ?? world.spawn;
      let target = dev.to === 'village' ? world.spawn : dev.to === 'mines' ? { x: door.x - 1, y: door.y } : { x: REGION_SITES[dev.to].x, y: REGION_SITES[dev.to].y };
      // The heart of a region may be a tree or a pond: step out to the nearest open ground.
      for (let radius = 0; radius < 12 && !isWalkable(world.map, target.x, target.y); radius++) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (isWalkable(world.map, target.x + dx, target.y + dy)) target = { x: target.x + dx, y: target.y + dy };
          }
        }
      }
      player.pos = { ...target };
      player.path = [];
      player.moveDir = { x: 0, y: 0 };
      return;
    }
  }
}
