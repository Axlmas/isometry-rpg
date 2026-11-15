import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { centreHips } from '../src/client/three/actors';

// Generated clips may hold the whole body off the spot where the character stands (the run
// a metre ahead, the idle to the side); blending between them then throws the body about.

function rig(): THREE.Object3D {
  const root = new THREE.Group();
  // Like the generated rigs: the armature is turned, so "up" for the hips is not +Y.
  const armature = new THREE.Group();
  armature.rotation.x = -Math.PI / 2;
  const hips = new THREE.Bone();
  hips.name = 'mixamorigHips';
  hips.position.set(0, 0, 0.57);
  armature.add(hips);
  root.add(armature);
  root.updateMatrixWorld(true);
  return root;
}

function clip(name: string, keys: number[][]): THREE.AnimationClip {
  const times = keys.map((_, i) => i * 0.5);
  return new THREE.AnimationClip(name, times[times.length - 1], [new THREE.VectorKeyframeTrack('mixamorigHips.position', times, keys.flat())]);
}

describe('hips put back over the spot where the character stands', () => {
  it('removes a constant offset to the side or forward but keeps the height', () => {
    const run = clip('run', [[0.58, 0.1, 0.48], [0.58, 0.1, 0.52], [0.58, 0.1, 0.48]]);
    const [centred] = centreHips([run], rig());
    const v = Array.from(centred!.tracks[0]!.values);
    // In this rig x and y are horizontal, z is up.
    expect(v[0]).toBeCloseTo(0, 6);
    expect(v[1]).toBeCloseTo(0, 6);
    expect(v[2]).toBeCloseTo(0.48, 6);
    expect(v[5]).toBeCloseTo(0.52, 6);
  });

  it('keeps movement within a clip, such as a fall', () => {
    const fall = clip('fall', [[0, 0.1, 0.5], [0, 0.4, 0.15]]);
    const [centred] = centreHips([fall], rig());
    const v = Array.from(centred!.tracks[0]!.values);
    expect(v[4]! - v[1]!).toBeCloseTo(0.3, 6);
    expect(v[1]).toBeCloseTo(0, 6);
  });

  it('leaves the loaded clips untouched and does the work once per model', () => {
    const clips = [clip('idle', [[0, -0.14, 0.57], [0, -0.14, 0.56]])];
    const model = rig();
    const first = centreHips(clips, model);
    expect(clips[0]!.tracks[0]!.values[1]).toBeCloseTo(-0.14, 6);
    expect(centreHips(clips, model)).toBe(first);
  });
});
