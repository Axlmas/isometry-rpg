import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Asset manifest. Game code refers to assets only through these entries, so any model
// can be regenerated or replaced without touching the code that uses it.
// Where every file came from is recorded in docs/ASSETS.md and tools/tripo/tasks.jsonl.

export interface CharacterAsset {
  url: string;
  /** Height in metres the model is scaled to. */
  height: number;
  /**
   * Generated clips often carry long lead-ins and pauses. Only this part, in seconds,
   * of the named clip is used.
   */
  clips?: Record<string, [start: number, end: number]>;
}

export interface PropAsset {
  id: string;
  url: string;
  height: number;
}

export interface WeaponAsset {
  id: string;
  name: string;
  url: string;
  /** Overall length in metres the model is scaled to. */
  length: number;
  /** Where the hand holds it: fraction of the length from the bottom end. */
  grip: number;
  /** Turn around the weapon's own long axis so the edge or face points the right way. */
  roll: number;
}

const base = import.meta.env.BASE_URL;

export const HERO: CharacterAsset = {
  url: `${base}models/hero.glb`,
  height: 1.82,
  clips: { slash: [0.6, 2.6], hurt: [0, 1.4] },
};

export const WOLF: CharacterAsset = { url: `${base}models/wolf.glb`, height: 0.95 };

export const WEAPONS: WeaponAsset[] = [
  { id: 'sword', name: 'Меч', url: `${base}models/sword.glb`, length: 1.05, grip: 0.1, roll: 0 },
  { id: 'axe', name: 'Топор', url: `${base}models/axe.glb`, length: 0.85, grip: 0.22, roll: 0 },
  { id: 'staff', name: 'Посох', url: `${base}models/staff.glb`, length: 1.75, grip: 0.42, roll: 0 },
];

export const PROPS: PropAsset[] = [
  { id: 'boulder', url: `${base}models/boulder.glb`, height: 1.1 },
  { id: 'oak', url: `${base}models/oak.glb`, height: 7.5 },
  { id: 'menhir', url: `${base}models/menhir.glb`, height: 2.6 },
];

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

export function loadGltf(url: string): Promise<GLTF> {
  return loader.loadAsync(url);
}

/** Turns on shadows and makes materials respond to scene lighting consistently. */
export function prepareModel(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Skinned meshes move away from their bind-pose bounds; never cull them by it.
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;
  });
}

/** Cuts each clip down to the window given in the manifest. */
export function trimClips(clips: THREE.AnimationClip[], windows: CharacterAsset['clips']): THREE.AnimationClip[] {
  const FPS = 60;
  return clips.map((clip) => {
    const w = windows?.[clip.name.toLowerCase()];
    if (!w) return clip;
    return THREE.AnimationUtils.subclip(clip, clip.name, Math.round(w[0] * FPS), Math.round(w[1] * FPS), FPS);
  });
}

/**
 * Wraps a loaded model so that it stands on y = 0, faces +Z and has the given height.
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

/** A simple stand-in shown when a model file is missing or fails to load. */
export function placeholder(height: number, color: string): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(height * 0.18, height * 0.6, 4, 12),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
  );
  body.position.y = height / 2;
  body.castShadow = true;
  g.add(body);
  return g;
}
