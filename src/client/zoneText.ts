import type { MessageKey } from '../i18n';
import type { RegionId } from '../sim';

/** Region IDs to translation keys, written out in full so the translation check can find them. */
export const REGION_NAME: Record<RegionId, MessageKey> = {
  village: 'zone.village',
  pasture: 'zone.pasture',
  moor: 'zone.moor',
  thicket: 'zone.thicket',
  hollow: 'zone.hollow',
  mines: 'zone.mines',
};

/** How each region is painted. Colours are [red, green, blue]; the floor gets a slight per-tile variation. */
export interface RegionLook {
  floor: readonly [number, number, number];
  grid: number;
  /** How obstacles look: stone blocks, trees, or wooden walls with houses inside. */
  walls: 'stone' | 'trees' | 'wood';
}

export const REGION_LOOK: Record<RegionId, RegionLook> = {
  village: { floor: [98, 86, 66], grid: 0x8a7656, walls: 'wood' },
  // Muted, earthy greens: a meadow, a heath, a damp hollow and a dark wood.
  pasture: { floor: [74, 94, 56], grid: 0x4b7046, walls: 'trees' },
  moor: { floor: [84, 84, 66], grid: 0x4b7046, walls: 'trees' },
  hollow: { floor: [70, 78, 48], grid: 0x6b6d40, walls: 'trees' },
  thicket: { floor: [48, 64, 46], grid: 0x3b5a3c, walls: 'trees' },
  mines: { floor: [52, 56, 68], grid: 0x2d313c, walls: 'stone' },
};
export const ROAD_COLOR: readonly [number, number, number] = [112, 96, 70];
export const WATER_COLOR: readonly [number, number, number] = [44, 78, 96];
/** Colour of the glow that marks an exit, by the region it leads to. */
export const EXIT_COLOR: Record<RegionId, number> = {
  village: 0xf2c94c,
  pasture: 0x7fd18a,
  moor: 0x7fd18a,
  thicket: 0x7fd18a,
  hollow: 0x7fd18a,
  mines: 0xb48cff,
};
