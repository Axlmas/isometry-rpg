import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { fitToHeight, prepareModel, trimClips, type CharacterAsset, type WeaponAsset } from './assets';

const RUN_SPEED = 4.2; // m/s
const RUN_CLIP_SPEED = 4.2; // speed at which the run clip's feet do not slide
const TURN_RATE = 14; // how fast the hero turns toward where he moves
const FADE = 0.15;
const SLASH_RATE = 1.5; // the swing plays this much faster than generated
const STRIKE_AT = 0.7; // fraction of the swing at which the blow lands
/** How far each finger joint bends to close the hand around a grip (radians). */
const GRIP_CURL = [1.1, 1.35, 0.9];

interface Curl {
  bone: THREE.Object3D;
  axis: THREE.Vector3;
  angle: number;
}

/**
 * The player's hero: one rigged model, shared animations, and a hand socket that any
 * weapon model can be put into. New weapons need no new animations or art for the hero.
 */
export class Hero {
  readonly object: THREE.Group;
  readonly velocity = new THREE.Vector3();
  heading = 0;
  /** Called at the moment the swing lands, with the hero's position and facing. */
  onStrike?: (position: THREE.Vector3, facing: THREE.Vector3) => void;

  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current?: THREE.AnimationAction;
  private readonly socket = new THREE.Group();
  private weapon?: THREE.Object3D;
  private target: THREE.Vector3 | null = null;
  private readonly wish = new THREE.Vector3();
  private attackLeft = 0;
  private attackLength = 0.8;
  private strikePending = false;
  private readonly grip: Curl[] = [];

  constructor(gltf: GLTF, asset: CharacterAsset) {
    const model = gltf.scene;
    prepareModel(model);
    model.updateMatrixWorld(true);
    this.object = fitToHeight(model, asset.height, -facingAngle(model));
    this.object.updateMatrixWorld(true);
    this.mountSocket(model);
    this.prepareGrip(model);

    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of trimClips(gltf.animations, asset.clips)) {
      this.actions.set(clip.name.toLowerCase(), this.mixer.clipAction(clip));
    }
    const slash = this.actions.get('slash');
    if (slash) {
      slash.setLoop(THREE.LoopOnce, 1);
      slash.clampWhenFinished = true;
      slash.timeScale = SLASH_RATE;
      this.attackLength = slash.getClip().duration / SLASH_RATE;
    }
    this.play('idle');
  }

  get position(): THREE.Vector3 {
    return this.object.position;
  }

  /** Puts a weapon model into the right hand, replacing the previous one. */
  equip(weaponModel: THREE.Object3D | null, asset?: WeaponAsset): void {
    if (this.weapon) this.socket.remove(this.weapon);
    this.weapon = undefined;
    if (!weaponModel || !asset) return;
    const holder = fitWeapon(weaponModel, asset);
    this.socket.add(holder);
    this.weapon = holder;
  }

  /** Walk to a point on the ground (click to move). */
  moveTo(point: THREE.Vector3): void {
    this.target = point.clone().setY(0);
  }

  /** Direction from keys, already in world space; zero vector means "no key held". */
  steer(direction: THREE.Vector3): void {
    this.wish.copy(direction);
    if (direction.lengthSq() > 0) this.target = null;
  }

  attack(): void {
    if (this.attackLeft > 0 || !this.actions.has('slash')) return;
    this.attackLeft = this.attackLength;
    this.strikePending = true;
    this.target = null;
    this.play('slash', 0.08);
  }

  hurt(): void {
    if (this.attackLeft > 0) return;
    this.actions.get('hurt')?.setLoop(THREE.LoopOnce, 1);
    this.play('hurt', 0.05);
  }

  update(dt: number): void {
    const desired = new THREE.Vector3();
    if (this.wish.lengthSq() > 0) {
      desired.copy(this.wish).normalize().multiplyScalar(RUN_SPEED);
    } else if (this.target) {
      const to = this.target.clone().sub(this.object.position);
      to.y = 0;
      const d = to.length();
      if (d < 0.08) this.target = null;
      else desired.copy(to).multiplyScalar(Math.min(RUN_SPEED, d * 6) / d);
    }

    const attacking = this.attackLeft > 0;
    if (attacking) {
      desired.set(0, 0, 0);
      this.attackLeft -= dt;
      if (this.strikePending && this.attackLeft < this.attackLength * (1 - STRIKE_AT)) {
        this.strikePending = false;
        const facing = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
        this.onStrike?.(this.object.position, facing);
      }
    }

    this.velocity.lerp(desired, 1 - Math.exp(-dt * 12));
    this.object.position.addScaledVector(this.velocity, dt);

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed > 0.2) {
      const want = Math.atan2(this.velocity.x, this.velocity.z);
      let diff = want - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * (1 - Math.exp(-dt * TURN_RATE));
    }
    this.object.rotation.y = this.heading;

    const hurtAction = this.actions.get('hurt');
    const hurting = !!hurtAction && this.current === hurtAction && hurtAction.isRunning();
    if (attacking && this.attackLeft > 0) {
      // let the swing finish
    } else if (speed > 0.6) {
      const run = this.play('run');
      if (run) run.timeScale = Math.max(0.6, speed / RUN_CLIP_SPEED);
    } else if (!hurting) {
      this.play('idle');
    }

    this.mixer.update(dt);

    // The generated animations hold the hand open; close it around the weapon.
    if (this.weapon) {
      for (const c of this.grip) {
        c.bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(c.axis, c.angle));
      }
    }
  }

  /**
   * Finds the right hand's finger joints and the axis each one bends around. In the bind
   * pose the arm points sideways with the palm down, so fingers curl around "forward".
   */
  private prepareGrip(model: THREE.Object3D): void {
    const forward = new THREE.Vector3(0, 0, 1); // holder space; the holder is unrotated here
    for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) {
      GRIP_CURL.forEach((angle, i) => {
        const bone = findBone(model, new RegExp(`RightHand${finger}${i + 1}$`));
        if (!bone?.parent) return;
        const parentQuat = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
        this.grip.push({ bone, axis: forward.clone().applyQuaternion(parentQuat).normalize(), angle });
      });
    }
  }

  private play(name: string, fade = FADE): THREE.AnimationAction | undefined {
    const next = this.actions.get(name);
    if (!next || next === this.current) return next;
    next.reset().setEffectiveWeight(1).play();
    if (this.current) next.crossFadeFrom(this.current, fade, false);
    this.current = next;
    return next;
  }

  /**
   * Creates the weapon socket in the bind (T) pose: centred in the right palm, with the
   * socket's +Y pointing where the character faces. Weapons are modelled upright, so
   * they end up held like a sword in a fist.
   */
  private mountSocket(model: THREE.Object3D): void {
    const hand = findBone(model, /RightHand$/);
    if (!hand) {
      // No skeleton: keep the weapon at the hip so it is at least visible.
      this.socket.position.set(0.3, 1.0, 0);
      this.object.add(this.socket);
      return;
    }
    const middle = findBone(model, /RightHandMiddle1$/);
    const wrist = hand.getWorldPosition(new THREE.Vector3());
    const palm = middle ? wrist.clone().lerp(middle.getWorldPosition(new THREE.Vector3()), 0.75) : wrist;
    this.object.add(this.socket);
    this.socket.position.copy(this.object.worldToLocal(palm.clone()));
    // Facing is +Z of the holder; turn the socket's +Y toward it.
    this.socket.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    this.socket.updateMatrixWorld(true);
    hand.attach(this.socket);
  }
}

/** Scales a weapon to its length and moves it so the grip sits at the origin, long axis up. */
function fitWeapon(model: THREE.Object3D, asset: WeaponAsset): THREE.Group {
  prepareModel(model);
  const holder = new THREE.Group();
  holder.add(model);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = asset.length / Math.max(1e-6, size.y);
  model.scale.multiplyScalar(scale);
  holder.updateMatrixWorld(true);
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y + asset.grip * asset.length;
  holder.rotation.y = asset.roll;
  return holder;
}

/** Angle of the character's facing in its own model, from the shoulders' line. */
function facingAngle(model: THREE.Object3D): number {
  const r = findBone(model, /RightHand$/);
  const l = findBone(model, /LeftHand$/);
  if (!r || !l) return 0;
  const right = r.getWorldPosition(new THREE.Vector3()).sub(l.getWorldPosition(new THREE.Vector3()));
  right.y = 0;
  const forward = new THREE.Vector3(0, 1, 0).cross(right.normalize());
  return Math.atan2(forward.x, forward.z);
}

export function findBone(root: THREE.Object3D, name: RegExp): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (!found && name.test(o.name)) found = o;
  });
  return found;
}
