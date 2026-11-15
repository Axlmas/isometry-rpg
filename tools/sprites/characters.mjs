// What to render. Each entry becomes public/sprites/<name>.webp and <name>.json.
//
// `model` is a path inside the folder given to the tool (see README.md).
// `show` lists the optional parts of the model to keep (weapons, shields,
// hats); every other optional part is hidden. `animations` maps the game's
// own animation names to a clip in the model and the number of frames to
// sample from it.

const ADVENTURERS = 'KayKit-Character-Pack-Adventures-1.0/addons/kaykit_character_pack_adventures/Characters/gltf';
const SKELETONS = 'KayKit-Character-Pack-Skeletons-1.0/addons/kaykit_character_pack_skeletons/Characters/gltf';

/** The parts of the KayKit models that are props: all hidden unless listed in `show`. */
export const OPTIONAL_PARTS = [
  '1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '1H_Sword', '2H_Sword',
  'Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable',
  'Spellbook', 'Spellbook_open', '1H_Wand', '2H_Staff',
  '1H_Axe_Offhand', 'Barbarian_Round_Shield', '1H_Axe', '2H_Axe', 'Mug',
];

/** A hero or a monster: stands, runs, attacks, flinches, dies. */
const fighter = (attack) => ({
  idle: { clip: 'Idle', frames: 4 },
  run: { clip: 'Running_A', frames: 8 },
  attack: { clip: attack, frames: 6 },
  hit: { clip: 'Hit_A', frames: 3 },
  death: { clip: 'Death_A', frames: 6 },
});
/** A villager only stands, facing the camera (direction 1 is straight down the screen). */
const villager = { idle: { clip: 'Idle', frames: 4 } };

export const CHARACTERS = [
  { name: 'warrior', model: `${ADVENTURERS}/Knight.glb`, show: ['1H_Sword', 'Round_Shield'], animations: fighter('1H_Melee_Attack_Slice_Diagonal') },
  { name: 'archer', model: `${ADVENTURERS}/Rogue_Hooded.glb`, show: ['2H_Crossbow'], animations: fighter('2H_Ranged_Shoot') },
  { name: 'mage', model: `${ADVENTURERS}/Mage.glb`, show: ['2H_Staff'], animations: fighter('Spellcast_Shoot') },
  { name: 'skeleton', model: `${SKELETONS}/Skeleton_Minion.glb`, show: [], animations: fighter('Unarmed_Melee_Attack_Punch_A') },

  { name: 'npc-guard', model: `${ADVENTURERS}/Knight.glb`, show: ['2H_Sword', 'Badge_Shield'], directions: [1], animations: villager },
  { name: 'npc-blacksmith', model: `${ADVENTURERS}/Barbarian.glb`, show: ['1H_Axe'], directions: [1], animations: villager },
  { name: 'npc-trainer', model: `${ADVENTURERS}/Barbarian.glb`, show: ['2H_Axe', 'Barbarian_Round_Shield'], directions: [1], animations: villager },
  { name: 'npc-alchemist', model: `${ADVENTURERS}/Mage.glb`, show: ['Spellbook_open'], directions: [1], animations: villager },
  { name: 'npc-outfitter', model: `${ADVENTURERS}/Rogue.glb`, show: [], directions: [1], animations: villager },
  { name: 'npc-hunter', model: `${ADVENTURERS}/Rogue_Hooded.glb`, show: ['1H_Crossbow'], directions: [1], animations: villager },
];
