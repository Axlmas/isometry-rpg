import type { MessageKey } from '../i18n';
import type { RegionId } from '../sim';

/** Region IDs to translation keys, written out in full so the translation check can find them. */
export const REGION_NAME: Record<RegionId, MessageKey> = {
  village: 'zone.village',
  moor: 'zone.moor',
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
  village: { floor: [112, 96, 70], grid: 0x8a7656, walls: 'wood' },
  moor: { floor: [62, 92, 58], grid: 0x4b7046, walls: 'trees' },
  hollow: { floor: [86, 88, 52], grid: 0x6b6d40, walls: 'trees' },
  mines: { floor: [52, 56, 68], grid: 0x2d313c, walls: 'stone' },
};

export const ROAD_COLOR: readonly [number, number, number] = [124, 104, 72];

/** Colour of the glow that marks an exit, by the region it leads to. */
export const EXIT_COLOR: Record<RegionId, number> = {
  village: 0xf2c94c,
  moor: 0x7fd18a,
  hollow: 0x7fd18a,
  mines: 0xb48cff,
};
