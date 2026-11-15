import type { MessageKey } from '../i18n';
import type { MonsterKind, NpcKind } from '../sim';

/** NPC kinds to translation keys, written out in full so the translation check can find them. */
export const NPC_NAME: Record<NpcKind, MessageKey> = {
  alchemist: 'npc.alchemist',
  outfitter: 'npc.outfitter',
  blacksmith: 'npc.blacksmith',
  trainer: 'npc.trainer',
  hunter: 'npc.hunter',
  guard: 'npc.guard',
};

/** How each NPC is painted: the colour of their clothes and of the sign floating above their head. */
export const NPC_LOOK: Record<NpcKind, { clothes: number; shade: number; sign: number }> = {
  alchemist: { clothes: 0x3e7d5a, shade: 0x2c5c42, sign: 0xd9534f },
  outfitter: { clothes: 0x8a5a2c, shade: 0x66421f, sign: 0xf2c94c },
  blacksmith: { clothes: 0x4a4d57, shade: 0x34363d, sign: 0xff9a3d },
  trainer: { clothes: 0x6a4a9c, shade: 0x4c3472, sign: 0x9fd0ff },
  hunter: { clothes: 0x5a6b3a, shade: 0x3f4c28, sign: 0xb7e07a },
  guard: { clothes: 0x9aa0ab, shade: 0x6e747f, sign: 0xcfd3dc },
};

/** Monster kinds to the names shown in the target frame. */
export const MONSTER_NAME: Record<MonsterKind, MessageKey> = {
  wolfPup: 'monster.wolfPup',
  wolf: 'monster.wolf',
  tusker: 'monster.tusker',
  boar: 'monster.boar',
  grunt: 'monster.grunt',
};
