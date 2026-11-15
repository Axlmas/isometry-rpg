import { addItem } from './inventory';
import { grantXp, xpToNextLevel } from './progression';
import type { World } from './world';
import { ROAD_ROW, HOLLOW_BORDER } from './zones';

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
  | { action: 'heal' }
  /** Kills every monster near the hero, with loot and experience as usual. */
  | { action: 'clear' }
  | { action: 'teleport'; to: 'village' | 'moor' | 'hollow' | 'mines' };

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
      const places = {
        village: world.spawn,
        moor: { x: 40, y: ROAD_ROW },
        hollow: { x: HOLLOW_BORDER + 6, y: ROAD_ROW },
        mines: { x: door.x - 1, y: door.y },
      };
      player.pos = { ...places[dev.to] };
      player.path = [];
      player.moveDir = { x: 0, y: 0 };
      return;
    }
  }
}
