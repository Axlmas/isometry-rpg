import * as THREE from 'three';
import { findBone } from './actors';

// Animation written in code. A pose says where the arms point and how the torso turns,
// as directions in the character's own space (+Z forward, +X to its left, +Y up); the
// builder turns a sequence of poses into a clip for this particular skeleton. Only the
// upper body is written, so the legs keep walking, running or standing underneath.
//
// This is how the hero's attacks are made: short, snappy blows from a fighting stance
// in the manner of classic MMORPGs, instead of the generated "chop" clip.

export type Vec = readonly [number, number, number];

export interface ArmPose {
  /** Shoulder to elbow. */
  upper: Vec;
  /** Elbow to wrist. */
  fore: Vec;
  /** Where the held weapon's long axis points (the socket's +Y), if the hand holds one. */
  grip?: Vec;
}

export interface Pose {
  /** Turn of the torso, radians: positive turns the chest to the left. */
  yaw?: number;
  /** Lean forward, radians. */
  pitch?: number;
  /** Lean to the side, radians: positive to the right. */
  roll?: number;
  /** Extra turn of the head; by default it keeps looking ahead. */
  look?: number;
  right: ArmPose;
  left: ArmPose;
}

export interface Key {
  t: number;
  pose: Pose;
}

const UPPER = ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand'] as const;
type BoneName = (typeof UPPER)[number];

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

/** Everything about the skeleton's rest pose that posing needs, measured once. */
export class PoseBuilder {
  private readonly bones = new Map<BoneName, THREE.Object3D>();
  private readonly bindLocal = new Map<THREE.Object3D, THREE.Quaternion>();
  private readonly bindWorld = new Map<THREE.Object3D, THREE.Quaternion>();
  /** The direction each limb bone points, in its own space (towards its child). */
  private readonly along = new Map<THREE.Object3D, THREE.Vector3>();
  /** The held weapon's axis in each hand's own space. */
  private readonly gripAxis = new Map<THREE.Object3D, THREE.Vector3>();
  /** The model's own turn inside the character (the character faces +Z). */
  private readonly frame: THREE.Quaternion;
  readonly ok: boolean;

  /**
   * `model` must be in its rest (T) pose, inside a holder that faces +Z.
   * `sockets` are the weapon sockets already attached to the hands.
   */
  constructor(
    model: THREE.Object3D, holder: THREE.Object3D, sockets: Partial<Record<'right' | 'left', THREE.Object3D>>,
    /** The standing clip: the hips are taken from it, not from the T-pose (rigs differ in how the hips rest). */
    idle?: THREE.AnimationClip,
  ) {
    holder.updateMatrixWorld(true);
    this.frame = holder.getWorldQuaternion(new THREE.Quaternion()).invert();
    for (const name of UPPER) {
      // Mixamo names: `mixamorig:Spine` (loaded as `mixamorigSpine`). The prefix keeps `Arm` from matching `ForeArm`.
      const bone = findBone(model, new RegExp(`(^|[^A-Za-z]|mixamorig)${name}$`));
      if (bone) this.bones.set(name, bone);
    }
    this.ok = UPPER.every((n) => this.bones.has(n));
    if (!this.ok) return;
    const record = (bone: THREE.Object3D) => {
      this.bindLocal.set(bone, bone.quaternion.clone());
      this.bindWorld.set(bone, this.frame.clone().multiply(bone.getWorldQuaternion(new THREE.Quaternion())));
    };
    for (const bone of this.bones.values()) record(bone);
    const hips = this.bones.get('Spine')!.parent!;
    record(hips);
    // The upper body hangs from the hips as they are while standing. If the rig's rest
    // hips are turned differently (the legs make up for it), poses built on the rest
    // would come out tilted.
    const track = idle?.tracks.find((t) => t.name === `${hips.name}.quaternion`);
    if (track && hips.parent) {
      const v = track.values;
      const standing = new THREE.Quaternion(v[0], v[1], v[2], v[3]).normalize();
      const parentWorld = this.frame.clone().multiply(hips.parent.getWorldQuaternion(new THREE.Quaternion()));
      this.bindWorld.set(hips, parentWorld.multiply(standing));
    }
    const child = (bone: THREE.Object3D, name: RegExp) => bone.children.find((c) => name.test(c.name));
    for (const side of ['Right', 'Left'] as const) {
      const arm = this.bones.get(`${side}Arm`)!;
      const fore = this.bones.get(`${side}ForeArm`)!;
      const hand = this.bones.get(`${side}Hand`)!;
      const middle = child(hand, /HandMiddle1$/) ?? hand.children[0];
      this.along.set(arm, fore.position.clone().normalize());
      this.along.set(fore, hand.position.clone().normalize());
      if (middle) this.along.set(hand, middle.position.clone().normalize());
      const socket = sockets[side === 'Right' ? 'right' : 'left'];
      if (socket) this.gripAxis.set(hand, Y.clone().applyQuaternion(socket.quaternion).normalize());
    }
  }

  /** Builds a clip from timed poses. Times are in seconds. */
  clip(name: string, keys: Key[], loop = false): THREE.AnimationClip {
    const tracks: THREE.KeyframeTrack[] = [];
    const solved = keys.map((k) => this.solve(k.pose));
    for (const name of UPPER) {
      const bone = this.bones.get(name)!;
      const values: number[] = [];
      let prev: THREE.Quaternion | null = null;
      for (const pose of solved) {
        const q = pose.get(bone)!.clone();
        // Keep neighbouring keys on the same side of the sphere, so they blend the short way.
        if (prev && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        values.push(q.x, q.y, q.z, q.w);
        prev = q;
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, keys.map((k) => k.t), values));
    }
    const clip = new THREE.AnimationClip(`${name}@upper`, keys[keys.length - 1]!.t, tracks);
    if (loop) clip.duration = keys[keys.length - 1]!.t;
    return clip;
  }

  /** Local rotations of every upper-body bone for one pose. */
  private solve(pose: Pose): Map<THREE.Object3D, THREE.Quaternion> {
    const world = new Map<THREE.Object3D, THREE.Quaternion>();
    const local = new Map<THREE.Object3D, THREE.Quaternion>();
    const hips = this.bones.get('Spine')!.parent!;
    world.set(hips, this.bindWorld.get(hips)!.clone());
    const follow = (bone: THREE.Object3D) => world.get(bone.parent!)!.clone().multiply(this.bindLocal.get(bone)!);
    const set = (bone: THREE.Object3D, w: THREE.Quaternion) => {
      world.set(bone, w);
      local.set(bone, world.get(bone.parent!)!.clone().invert().multiply(w));
    };
    const turn = (axis: THREE.Vector3, angle: number) => new THREE.Quaternion().setFromAxisAngle(axis, angle);

    // The torso turns over three spine bones; the head turns back to keep looking ahead.
    const yaw = pose.yaw ?? 0;
    for (const name of ['Spine', 'Spine1', 'Spine2'] as const) {
      const bone = this.bones.get(name)!;
      const q = turn(Y, yaw / 3).multiply(turn(X, (pose.pitch ?? 0) / 3)).multiply(turn(Z, -(pose.roll ?? 0) / 3));
      set(bone, q.multiply(follow(bone)));
    }
    const neck = this.bones.get('Neck')!;
    set(neck, turn(Y, -yaw * 0.4).multiply(follow(neck)));
    const head = this.bones.get('Head')!;
    set(head, turn(Y, -yaw * 0.35 + (pose.look ?? 0)).multiply(turn(X, -(pose.pitch ?? 0) * 0.5)).multiply(follow(head)));

    for (const side of ['Right', 'Left'] as const) {
      const arm = side === 'Right' ? pose.right : pose.left;
      const shoulder = this.bones.get(`${side}Shoulder`)!;
      set(shoulder, follow(shoulder));
      const upper = this.bones.get(`${side}Arm`)!;
      set(upper, this.aim(upper, follow(upper), dir(arm.upper)));
      const fore = this.bones.get(`${side}ForeArm`)!;
      set(fore, this.aim(fore, follow(fore), dir(arm.fore)));
      const hand = this.bones.get(`${side}Hand`)!;
      const grip = arm.grip ? dir(arm.grip) : null;
      const foreDir = dir(arm.fore);
      const axis = this.gripAxis.get(hand);
      let w: THREE.Quaternion;
      if (grip && axis) {
        // The weapon must point exactly where asked; the hand then turns about the weapon's
        // axis to stay as close as it can to the line of the forearm. (In the model's
        // T-pose the weapon axis is not square to the hand, so the order matters.)
        const start = follow(hand);
        const now = axis.clone().applyQuaternion(start).normalize();
        w = new THREE.Quaternion().setFromUnitVectors(now, grip).multiply(start);
        const along = this.along.get(hand);
        if (along) {
          const a = along.clone().applyQuaternion(w);
          a.addScaledVector(grip, -a.dot(grip));
          const b = foreDir.clone().addScaledVector(grip, -foreDir.dot(grip));
          if (a.lengthSq() > 1e-4 && b.lengthSq() > 1e-4) {
            a.normalize();
            b.normalize();
            w = turn(grip, Math.atan2(grip.dot(a.clone().cross(b)), a.dot(b))).multiply(w);
          }
        }
      } else {
        w = this.aim(hand, follow(hand), foreDir);
      }
      set(hand, w);
    }
    return local;
  }

  /** Turns a bone (given its world rotation if it just followed its parent) to point along `target`. */
  private aim(bone: THREE.Object3D, followed: THREE.Quaternion, target: THREE.Vector3): THREE.Quaternion {
    const along = this.along.get(bone);
    if (!along) return followed;
    const now = along.clone().applyQuaternion(followed).normalize();
    return new THREE.Quaternion().setFromUnitVectors(now, target).multiply(followed);
  }
}

function dir(v: Vec): THREE.Vector3 {
  return new THREE.Vector3(v[0], v[1], v[2]).normalize();
}

// ------------------------------------------------------------------ the moves

/**
 * Seconds from the start of an attack clip to the moment the blow lands. It matches the
 * rules' wind-up (PLAYER_ATTACK_WINDUP), so the clips play at their own pace.
 */
export const IMPACT_AT = 0.35;
/** The blade is cocked back by then: a readable wind-up, then a quick strike. */
const COCKED_AT = 0.22;
/** End of the follow-through, and of the whole move, back in the ready stance. */
const FOLLOW_AT = 0.46;
const SETTLED_AT = 0.9;

const RELAXED: Record<'right' | 'left', ArmPose> = {
  right: { upper: [-0.2, -1, 0.1], fore: [-0.08, -0.85, 0.5] },
  left: { upper: [0.2, -1, 0.1], fore: [0.08, -0.85, 0.5] },
};

/** One-handed sword, ready: knees from the legs' layer, chest turned so the sword side leads. */
const SWORD_READY: Pose = {
  yaw: 0.3, pitch: 0.15,
  right: { upper: [-0.35, -0.8, 0.45], fore: [0.05, 0.15, 1], grip: [0.25, 0.75, 0.6] },
  left: { upper: [0.45, -0.85, 0.25], fore: [0.35, -0.35, 0.85] },
};

/** Bow raised and half drawn, the left shoulder towards the target. */
const BOW_READY: Pose = {
  yaw: -1.0, pitch: 0.02,
  right: { upper: [-0.55, -0.05, -0.8], fore: [0.6, 0.12, 0.78] },
  left: { upper: [0.05, 0.04, 1], fore: [0.02, 0.05, 1], grip: [-1, 0, 0] },
};

/** Staff upright before the body, the free hand open towards the enemy. */
const STAFF_READY: Pose = {
  yaw: 0.15, pitch: 0.05,
  right: { upper: [-0.35, -0.85, 0.3], fore: [-0.05, -0.2, 0.98], grip: [0.05, 0.97, 0.2] },
  left: { upper: [0.35, -0.85, 0.3], fore: [0.2, -0.3, 0.93] },
};

function breathe(pose: Pose, amount: number): Pose {
  return { ...pose, pitch: (pose.pitch ?? 0) + amount };
}

function noGrip(pose: Pose): Pose {
  return { ...pose, right: { upper: pose.right.upper, fore: pose.right.fore }, left: { upper: pose.left.upper, fore: pose.left.fore } };
}

/**
 * The fighting moves. Every attack winds up, lands at IMPACT_AT seconds and settles back
 * into the ready stance, with the torso turning into the blow and a short follow-through.
 */
export function combatMoves(b: PoseBuilder): THREE.AnimationClip[] {
  const stance = (name: string, pose: Pose) => b.clip(name, [
    { t: 0, pose }, { t: 1.1, pose: breathe(pose, 0.035) }, { t: 2.2, pose },
  ]);

  // Diagonal cut: the blade cocked back over the right shoulder, then down across to the left.
  // The wind-up stays at shoulder height: a raised-overhead blade reads as chopping wood.
  const swordA: Key[] = [
    { t: 0, pose: SWORD_READY },
    { t: COCKED_AT, pose: {
      yaw: -0.5, pitch: 0.08,
      right: { upper: [-0.8, 0.05, -0.55], fore: [-0.3, 0.3, -0.9], grip: [-0.45, 0.45, -0.75] },
      left: { upper: [0.5, -0.7, 0.4], fore: [0.3, -0.2, 0.95] },
    } },
    { t: IMPACT_AT, pose: {
      yaw: 0.5, pitch: 0.22,
      right: { upper: [0.05, -0.2, 0.98], fore: [0.65, -0.15, 0.75], grip: [0.85, -0.25, 0.45] },
      left: { upper: [0.55, -0.8, -0.1], fore: [0.4, -0.6, -0.6] },
    } },
    { t: FOLLOW_AT, pose: {
      yaw: 0.6, pitch: 0.25,
      right: { upper: [0.4, -0.45, 0.8], fore: [0.85, -0.35, 0.25], grip: [0.5, -0.55, -0.65] },
      left: { upper: [0.55, -0.8, -0.1], fore: [0.4, -0.6, -0.6] },
    } },
    { t: SETTLED_AT, pose: SWORD_READY },
  ];
  // Flat backhand from the left back across to the right.
  const swordB: Key[] = [
    { t: 0, pose: SWORD_READY },
    { t: COCKED_AT, pose: {
      yaw: 0.6, pitch: 0.1,
      right: { upper: [0.35, -0.25, 0.9], fore: [0.95, 0, 0.25], grip: [0.55, 0.1, -0.8] },
      left: { upper: [0.6, -0.75, -0.1], fore: [0.5, -0.5, -0.6] },
    } },
    { t: IMPACT_AT, pose: {
      yaw: -0.25, pitch: 0.18,
      right: { upper: [-0.35, -0.15, 0.92], fore: [-0.6, 0, 0.8], grip: [-0.8, 0.05, 0.6] },
      left: { upper: [0.35, -0.85, 0.35], fore: [0.3, -0.4, 0.85] },
    } },
    { t: FOLLOW_AT, pose: {
      yaw: -0.5, pitch: 0.15,
      right: { upper: [-0.8, -0.15, 0.55], fore: [-0.95, -0.05, 0], grip: [-0.5, 0, -0.85] },
      left: { upper: [0.35, -0.85, 0.35], fore: [0.3, -0.4, 0.85] },
    } },
    { t: SETTLED_AT, pose: SWORD_READY },
  ];
  // Pull the string to the cheek, loose, the hand flies back past the ear.
  const bow: Key[] = [
    { t: 0, pose: BOW_READY },
    { t: 0.28, pose: { ...BOW_READY, right: { upper: [-0.6, 0.05, -0.8], fore: [0.65, 0.18, 0.74] } } },
    { t: IMPACT_AT, pose: { ...BOW_READY, right: { upper: [-0.6, 0.15, -0.78], fore: [-0.35, 0.25, -0.9] } } },
    { t: 0.52, pose: { ...BOW_READY, right: { upper: [-0.6, 0.1, -0.78], fore: [-0.2, 0.15, -0.95] } } },
    { t: SETTLED_AT, pose: BOW_READY },
  ];
  // Gather, then thrust staff and open hand at the enemy.
  const staff: Key[] = [
    { t: 0, pose: STAFF_READY },
    { t: COCKED_AT, pose: {
      yaw: 0.3, pitch: -0.05,
      right: { upper: [-0.55, 0.1, 0.8], fore: [-0.1, 0.55, 0.83], grip: [0, 0.85, 0.5] },
      left: { upper: [0.45, -0.3, 0.85], fore: [0.1, 0.2, 0.98] },
    } },
    { t: IMPACT_AT, pose: {
      yaw: 0.05, pitch: 0.15,
      right: { upper: [-0.25, 0, 0.97], fore: [0.05, 0.25, 0.97], grip: [0.05, 0.6, 0.8] },
      left: { upper: [0.25, -0.05, 0.97], fore: [0, 0.05, 1] },
    } },
    { t: 0.55, pose: {
      yaw: 0.05, pitch: 0.15,
      right: { upper: [-0.25, 0, 0.97], fore: [0.05, 0.25, 0.97], grip: [0.05, 0.6, 0.8] },
      left: { upper: [0.25, -0.05, 0.97], fore: [0, 0.05, 1] },
    } },
    { t: SETTLED_AT, pose: STAFF_READY },
  ];
  const bare = (keys: Key[]) => keys.map((k) => ({ t: k.t, pose: noGrip(k.pose) }));

  return [
    stance('stance-sword', SWORD_READY),
    stance('stance-bow', BOW_READY),
    stance('stance-staff', STAFF_READY),
    b.clip('atk-sword-a', swordA),
    b.clip('atk-sword-b', swordB),
    b.clip('atk-bow', bow),
    b.clip('atk-staff', staff),
    // Claws and fists: the same swings without a weapon to point.
    b.clip('atk-none-a', bare(swordA)),
    b.clip('atk-none-b', bare(swordB)),
    stance('stance-none', noGrip({ ...SWORD_READY, right: RELAXED.right, left: RELAXED.left })),
  ];
}
