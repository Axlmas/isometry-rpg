import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Asset manifest. Game code refers to models only through these entries, so any model
// can be regenerated or replaced without touching the code that uses it. Where every
// file came from is recorded in docs/ASSETS.md and tools/tripo/tasks.jsonl.

/** Metres per tile of the rules' grid. The rules count in tiles; the 3D world in metres. */
export const TILE = 1.25;

export type ClipWindows = Record<string, [start: number, end: number]>;

export interface ModelSpec {
  url: string;
  /** Height in metres the model is scaled to (for weapons: their length). */
  height: number;
  /** Generated clips often carry long lead-ins and pauses; only this part of the named clip is used. */
  clips?: ClipWindows;
  /** A second file with more clips for the same skeleton (bones are matched by name). */
  extraClips?: string;
}

export interface WeaponSpec extends ModelSpec {
  /** Where the hand holds it: fraction of the length from the bottom end. */
  grip: number;
  /** Which hand holds it. */
  hand: 'right' | 'left';
  /** Turn around the weapon's own long axis, radians. */
  roll: number;
  /** Tilt away from the forearm line, radians: a bow is held upright, a sword forward. */
  pitch: number;
}

const base = import.meta.env.BASE_URL;
const url = (file: string): string => `${base}models/${file}`;

export const CHARACTERS = {
  // The hero's three looks, by the armour on his body: none, ungraded, graded.
  'hero-t0': { url: url('hero-t0.glb'), height: 1.8, clips: { hurt: [0, 1.4] } },
  'hero-t1': { url: url('hero-t1.glb'), height: 1.8, clips: { hurt: [0, 1.4] } },
  hero: {
    url: url('hero.glb'), height: 1.82, extraClips: url('hero-extra.glb'),
    clips: { slash: [0.6, 2.6], hurt: [0, 1.4] },
  },
  ghoul: {
    url: url('ghoul.glb'), height: 1.85, extraClips: url('ghoul-extra.glb'),
    clips: { slash: [0.6, 2.6], hurt: [0, 1.4] },
  },
  wolf: { url: url('wolf.glb'), height: 0.95 },
  boar: { url: url('boar.glb'), height: 0.95 },
} satisfies Record<string, ModelSpec>;

export const WEAPONS = {
  sword: { url: url('sword.glb'), height: 1.05, grip: 0.1, hand: 'right', roll: 0, pitch: 0 },
  axe: { url: url('axe.glb'), height: 0.85, grip: 0.22, hand: 'right', roll: 0, pitch: 0 },
  staff: { url: url('staff.glb'), height: 1.75, grip: 0.42, hand: 'right', roll: 0, pitch: 0 },
  bow: { url: url('bow.glb'), height: 1.45, grip: 0.5, hand: 'left', roll: 0, pitch: -Math.PI / 2 },
} satisfies Record<string, WeaponSpec>;

export const PROPS = {
  oak: { url: url('oak.glb'), height: 5.4 },
  fir: { url: url('fir.glb'), height: 7.2 },
  boulder: { url: url('boulder.glb'), height: 0.95 },
  menhir: { url: url('menhir.glb'), height: 2.6 },
  ruin: { url: url('ruin.glb'), height: 2.4 },
  house: { url: url('house.glb'), height: 4.6 },
} satisfies Record<string, ModelSpec>;

export type CharacterId = keyof typeof CHARACTERS;
export type WeaponId = keyof typeof WEAPONS;
export type PropId = keyof typeof PROPS;

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/**
 * Everything the 3D scene draws from files. A file that is missing or fails to load is
 * simply absent: the scene then draws a plain stand-in, and the game still works.
 */
export class Library {
  private readonly characters = new Map<CharacterId, GLTF>();
  private readonly weapons = new Map<WeaponId, THREE.Group>();
  private readonly props = new Map<PropId, THREE.Group>();

  static async load(): Promise<Library> {
    const lib = new Library();
    const jobs: Promise<void>[] = [];
    for (const [id, spec] of Object.entries(CHARACTERS) as [CharacterId, ModelSpec][]) {
      jobs.push(loadCharacter(spec).then((gltf) => { lib.characters.set(id, gltf); }, warn(spec.url)));
    }
    for (const [id, spec] of Object.entries(WEAPONS) as [WeaponId, WeaponSpec][]) {
      jobs.push(loader.loadAsync(spec.url).then((gltf) => { lib.weapons.set(id, fitWeapon(gltf.scene, spec)); }, warn(spec.url)));
    }
    for (const [id, spec] of Object.entries(PROPS) as [PropId, ModelSpec][]) {
      jobs.push(loader.loadAsync(spec.url).then((gltf) => {
        prepareModel(gltf.scene);
        lib.props.set(id, fitToHeight(gltf.scene, spec.height));
      }, warn(spec.url)));
    }
    await Promise.all(jobs);
    return lib;
  }

  character(id: CharacterId): GLTF | undefined {
    return this.characters.get(id);
  }

  /** A fresh copy of a weapon, already scaled, with its grip at the origin and its length along +Y. */
  weapon(id: WeaponId): THREE.Object3D | undefined {
    return this.weapons.get(id)?.clone();
  }

  /** The shared original of a prop: standing on y = 0, centred, scaled to its height. */
  prop(id: PropId): THREE.Object3D | undefined {
    return this.props.get(id);
  }
}

function warn(file: string): (error: unknown) => void {
  return (error) => console.warn(`[3d] ${file} is not available; a stand-in is drawn instead.`, error);
}

async function loadCharacter(spec: ModelSpec): Promise<GLTF> {
  const [gltf, extra] = await Promise.all([
    loader.loadAsync(spec.url),
    spec.extraClips ? loader.loadAsync(spec.extraClips).catch(() => null) : Promise.resolve(null),
  ]);
  const clips = [...gltf.animations, ...(extra?.animations ?? [])];
  gltf.animations = trimClips(clips, spec.clips);
  return gltf;
}

/** Clip names lose their "preset:" prefixes so code can ask for "walk" or "fall". */
function cleanName(name: string): string {
  return (name.split(':').pop() ?? name).toLowerCase();
}

/** Cuts each clip down to the window given in the manifest. */
export function trimClips(clips: THREE.AnimationClip[], windows: ClipWindows | undefined): THREE.AnimationClip[] {
  const FPS = 60;
  return clips.map((clip) => {
    const name = cleanName(clip.name);
    const w = windows?.[name];
    const out = w ? THREE.AnimationUtils.subclip(clip, name, Math.round(w[0] * FPS), Math.round(w[1] * FPS), FPS) : clip;
    out.name = name;
    return out;
  });
}

/**
 * Turns on shadows. Skinned meshes get a padded bounding sphere: animations move the
 * body away from its bind pose, and without the padding a swinging arm could be cut off
 * at the screen's edge. Culling them matters: the world holds dozens of monsters.
 */
export function prepareModel(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const skinned = mesh as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      skinned.computeBoundingSphere();
      if (skinned.boundingSphere) skinned.boundingSphere.radius *= 1.6;
    }
  });
}

/**
 * Wraps a model so that it stands on y = 0, is centred and has the given height.
 * `yaw` is the turn that makes the model face +Z. Returns the outer group.
 */
export function fitToHeight(model: THREE.Object3D, height: number, yaw = 0): THREE.Group {
  const holder = new THREE.Group();
  model.rotation.y += yaw;
  holder.add(model);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const scale = height / Math.max(1e-6, box.max.y - box.min.y);
  model.scale.multiplyScalar(scale);
  holder.updateMatrixWorld(true);
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;
  return holder;
}

/** Scales a weapon to its length and moves it so the grip sits at the origin, long axis up. */
function fitWeapon(model: THREE.Object3D, spec: WeaponSpec): THREE.Group {
  prepareModel(model);
  const holder = new THREE.Group();
  holder.add(model);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  model.scale.multiplyScalar(spec.height / Math.max(1e-6, size.y));
  holder.updateMatrixWorld(true);
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y + spec.grip * spec.height;
  holder.rotation.set(spec.pitch, spec.roll, 0, 'YXZ');
  return holder;
}

/**
 * The single mesh of a static prop with its placement baked in, for drawing many
 * copies at once (InstancedMesh). Null when the prop has not loaded.
 */
export function bakeProp(prop: THREE.Object3D | undefined): { geometry: THREE.BufferGeometry; material: THREE.Material }[] {
  if (!prop) return [];
  prop.updateMatrixWorld(true);
  const parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
  prop.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = toFloat(mesh.geometry.clone()).applyMatrix4(mesh.matrixWorld);
    parts.push({ geometry, material: mesh.material as THREE.Material });
  });
  return parts;
}

/**
 * Compressed models store positions and normals as small integers scaled into −1…1,
 * with the real size kept on the node. Baking a placement into such numbers would clip
 * every model to a 2 m cube, so they are turned back into plain floats first.
 */
function toFloat(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of ['position', 'normal']) {
    const a = geometry.getAttribute(name);
    if (!a || (a.array instanceof Float32Array && !a.normalized && !(a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute)) continue;
    const n = a.itemSize;
    const out = new Float32Array(a.count * n);
    for (let i = 0; i < a.count; i++) {
      out[i * n] = a.getX(i);
      if (n > 1) out[i * n + 1] = a.getY(i);
      if (n > 2) out[i * n + 2] = a.getZ(i);
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(out, n));
  }
  return geometry;
}

/** A simple stand-in shown when a model file is missing. */
export function placeholder(height: number, color: string, radius = height * 0.18): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, Math.max(0.01, height - radius * 2), 4, 12),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
  );
  body.position.y = height / 2;
  body.castShadow = true;
  g.add(body);
  return g;
}

/** Simple vector maths shared by the 3D code: the rules' tile position to metres. */
export function toWorld(x: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(x * TILE, 0, y * TILE);
}
