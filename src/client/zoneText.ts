import type { MessageKey } from '../i18n';
import type { ZoneKind } from '../sim';

/** Zone IDs to translation keys, written out in full so the translation check can find them. */
export const ZONE_NAME: Record<ZoneKind, MessageKey> = {
  village: 'zone.village',
  field: 'zone.field',
  dungeon: 'zone.dungeon',
};

/** How each zone is painted. Colours are 0xRRGGBB; floor colours are a base that gets a slight per-tile variation. */
export interface ZoneLook {
  background: number;
  floor: readonly [number, number, number];
  grid: number;
  /** A marked path across the zone, where it has one. */
  road: readonly [number, number, number] | null;
  /** How obstacles look: stone blocks, trees, or wooden walls with houses inside. */
  walls: 'stone' | 'trees' | 'wood';
}

export const ZONE_LOOK: Record<ZoneKind, ZoneLook> = {
  dungeon: { background: 0x12141a, floor: [52, 56, 68], grid: 0x2d313c, road: null, walls: 'stone' },
  field: { background: 0x16201a, floor: [62, 92, 58], grid: 0x4b7046, road: [124, 104, 72], walls: 'trees' },
  village: { background: 0x1a1712, floor: [112, 96, 70], grid: 0x8a7656, road: null, walls: 'wood' },
};

/** Colour of the glow that marks an exit, by where it leads. */
export const EXIT_COLOR: Record<ZoneKind, number> = {
  village: 0xf2c94c,
  field: 0x7fd18a,
  dungeon: 0xb48cff,
};
