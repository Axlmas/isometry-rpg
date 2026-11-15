import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { fitToHeight, prepareModel } from './assets';
import { findBone } from './hero';

// A wolf. The AI service gives the model, a four-legged skeleton and one walk cycle.
// Everything else is procedural: tail, head turning toward prey, lunge, recoil, death.
// The same code works for any creature rigged on the same skeleton type.

const WANDER_SPEED = 1.0;
const CHASE_SPEED = 3.3;
const WALK_CLIP_SPEED = 1.25; // ground speed that matches the walk cycle at timeScale 1
const AGGRO_RANGE = 7;
const BITE_RANGE = 1.6;
const LUNGE_TIME = 0.5;
const LUNGE_COOLDOWN = 1.4;
const MAX_HP = 3;
const RESPAWN_TIME = 5;

type State = 'wander' | 'chase' | 'lunge' | 'stagger' | 'dead';

interface Driven {
  bone: THREE.Object3D;
  bind: THREE.Quaternion;
  /** The body's "up" expressed in the bone's parent space: turning about it swings sideways. */
  up: THREE.Vector3;
  /** The body's "right" in parent space: turning about it nods up and down. */
  side: THREE.Vector3;
}

export class Wolf {
  readonly object = new THREE.Group();
  /** Called when the bite lands. */
  onBite?: () => void;

  private readonly pose: THREE.Group;
  private readonly mixer: THREE.AnimationMixer;
  private readonly walk?: THREE.AnimationAction;
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly tail: Driven[] = [];
  private readonly head?: Driven;
  private readonly spine?: Driven;
  private readonly home: THREE.Vector3;
  private readonly rnd: () => number;
  private readonly velocity = new THREE.Vector3();
  private readonly knock = new THREE.Vector3();
  private heading = 0;
  private state: State = 'wander';
  private stateTime = 0;
  private wanderTarget: THREE.Vector3 | null = null;
  private wanderPause = 1;
  private cooldown = 0;
  private bitten = false;
  private flash = 0;
  private hp = MAX_HP;
  private time = 0;
  private lookYaw = 0;

  constructor(gltf: GLTF, height: number, home: THREE.Vector3, rnd: () => number) {
    const model = cloneSkinned(gltf.scene);
    prepareModel(model);
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.material instanceof THREE.MeshStandardMaterial) {
        const own = mesh.material.clone() as THREE.MeshStandardMaterial;
        mesh.material = own;
        this.materials.push(own);
      }
    });
    model.updateMatrixWorld(true);
    this.pose = fitToHeight(model, height, -creatureFacing(model));
    this.object.add(this.pose);
    this.object.updateMatrixWorld(true);

    const tailRoot = findBone(model, /Tail_0$/);
    for (let b: THREE.Object3D | undefined = tailRoot; b; b = b.children.find((c) => (c as THREE.Bone).isBone)) {
      this.tail.push(drive(b));
    }
    const head = findBone(model, /Head_0$/);
    if (head) this.head = drive(head);
    const spine = findBone(model, /Spine_1$/);
    if (spine) this.spine = drive(spine);

    this.mixer = new THREE.AnimationMixer(model);
    const clip = gltf.animations[0];
    if (clip) {
      this.walk = this.mixer.clipAction(clip);
      this.walk.play();
    }

    this.home = home.clone();
    this.rnd = rnd;
    this.heading = rnd() * Math.PI * 2;
    this.object.position.copy(home);
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  get position(): THREE.Vector3 {
    return this.object.position;
  }

  hit(from: THREE.Vector3): void {
    if (this.state === 'dead') return;
    this.hp -= 1;
    this.flash = 1;
    this.knock.copy(this.object.position).sub(from).setY(0).normalize().multiplyScalar(4.5);
    this.setState(this.hp <= 0 ? 'dead' : 'stagger');
  }

  update(dt: number, prey: THREE.Vector3): void {
    this.time += dt;
    this.stateTime += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const toPrey = prey.clone().sub(this.object.position).setY(0);
    const dist = toPrey.length();
    const desired = new THREE.Vector3();
    let face: number | null = null;

    switch (this.state) {
      case 'wander': {
        if (dist < AGGRO_RANGE) { this.setState('chase'); break; }
        if (this.wanderTarget) {
          const to = this.wanderTarget.clone().sub(this.object.position).setY(0);
          if (to.length() < 0.2) { this.wanderTarget = null; this.wanderPause = 1 + this.rnd() * 3; }
          else desired.copy(to.normalize().multiplyScalar(WANDER_SPEED));
        } else if ((this.wanderPause -= dt) <= 0) {
          const a = this.rnd() * Math.PI * 2;
          const r = 1 + this.rnd() * 4;
          this.wanderTarget = this.home.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
        }
        break;
      }
      case 'chase': {
        if (dist > AGGRO_RANGE * 1.6) { this.setState('wander'); break; }
        face = Math.atan2(toPrey.x, toPrey.z);
        if (dist > BITE_RANGE) desired.copy(toPrey).multiplyScalar(CHASE_SPEED / dist);
        else if (this.cooldown === 0) this.setState('lunge');
        break;
      }
      case 'lunge': {
        face = Math.atan2(toPrey.x, toPrey.z);
        if (!this.bitten && this.stateTime > LUNGE_TIME * 0.45) {
          this.bitten = true;
          if (dist < BITE_RANGE + 0.6) this.onBite?.();
        }
        if (this.stateTime >= LUNGE_TIME) { this.cooldown = LUNGE_COOLDOWN; this.setState('chase'); }
        break;
      }
      case 'stagger': {
        if (this.stateTime > 0.35) this.setState('chase');
        break;
      }
      case 'dead': {
        if (this.stateTime > RESPAWN_TIME) this.respawn();
        break;
      }
    }

    // Movement and turning.
    this.velocity.lerp(desired, 1 - Math.exp(-dt * 8));
    this.knock.multiplyScalar(Math.exp(-dt * 7));
    this.object.position.addScaledVector(this.velocity, dt).addScaledVector(this.knock, dt);
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (face === null && speed > 0.15) face = Math.atan2(this.velocity.x, this.velocity.z);
    if (face !== null && this.state !== 'dead') {
      const diff = Math.atan2(Math.sin(face - this.heading), Math.cos(face - this.heading));
      this.heading += diff * (1 - Math.exp(-dt * 9));
    }
    this.object.rotation.y = this.heading;

    // The walk cycle: weight follows speed, playback rate follows speed.
    if (this.walk) {
      const moving = this.state === 'dead' ? 0 : THREE.MathUtils.clamp(speed / 0.35, 0, 1);
      this.walk.setEffectiveWeight(moving);
      this.walk.timeScale = Math.max(0.4, speed / WALK_CLIP_SPEED);
    }
    this.mixer.update(dt);
    this.animateProcedural(dt, speed, prey);
  }

  private animateProcedural(dt: number, speed: number, prey: THREE.Vector3): void {
    const t = this.time;
    const s = this.stateTime;
    const pose = this.pose;
    pose.position.set(0, 0, 0);
    pose.rotation.set(0, 0, 0);
    pose.scale.setScalar(1);

    if (this.state === 'lunge') {
      const k = Math.sin(Math.PI * Math.min(1, s / LUNGE_TIME));
      pose.position.z = k * 0.6;
      pose.rotation.x = k * 0.12;
    } else if (this.state === 'stagger') {
      const k = Math.sin(Math.PI * Math.min(1, s / 0.35));
      pose.rotation.x = -k * 0.2;
    } else if (this.state === 'dead') {
      const fall = THREE.MathUtils.smoothstep(s, 0, 0.45);
      pose.rotation.z = fall * Math.PI * 0.5;
      pose.position.y = -THREE.MathUtils.smoothstep(s, 2.5, RESPAWN_TIME) * 0.6;
    } else if (s < 0.6 && this.hp === MAX_HP) {
      pose.scale.setScalar(THREE.MathUtils.smoothstep(s, 0, 0.6)); // fresh spawn grows in
    }

    // Tail: lazy sway when calm, fast wag when hunting, still when dead.
    const hunting = this.state === 'chase' || this.state === 'lunge';
    const freq = hunting ? 9 : 2.2;
    const amp = this.state === 'dead' ? 0 : hunting ? 0.35 : 0.18 + Math.min(speed, 1) * 0.1;
    this.tail.forEach((d, i) => {
      const a = Math.sin(t * freq - i * 0.7) * amp;
      d.bone.quaternion.copy(d.bind).premultiply(new THREE.Quaternion().setFromAxisAngle(d.up, a));
    });

    // Head turns toward the hero when hunting, and dips during the lunge.
    if (this.head) {
      let want = 0;
      if (hunting) {
        const to = prey.clone().sub(this.object.position);
        const angle = Math.atan2(to.x, to.z) - this.heading;
        want = THREE.MathUtils.clamp(Math.atan2(Math.sin(angle), Math.cos(angle)), -0.7, 0.7);
      }
      this.lookYaw += (want - this.lookYaw) * (1 - Math.exp(-dt * 8));
      const nod = this.state === 'lunge' ? Math.sin(Math.PI * Math.min(1, s / LUNGE_TIME)) * 0.35 : 0;
      this.head.bone.quaternion.copy(this.head.bind)
        .premultiply(new THREE.Quaternion().setFromAxisAngle(this.head.up, this.lookYaw))
        .premultiply(new THREE.Quaternion().setFromAxisAngle(this.head.side, nod));
    }

    // Breathing when standing still.
    if (this.spine && speed < 0.2 && this.state !== 'dead') {
      const b = Math.sin(t * 2.4) * 0.025;
      this.spine.bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(this.spine.side, b));
    }

    // Red flash when hit.
    this.flash = Math.max(0, this.flash - dt * 4);
    for (const m of this.materials) m.emissive.setRGB(this.flash * 0.6, 0, 0);
  }

  private setState(state: State): void {
    this.state = state;
    this.stateTime = 0;
    this.bitten = false;
  }

  private respawn(): void {
    this.hp = MAX_HP;
    this.object.position.copy(this.home);
    this.velocity.set(0, 0, 0);
    this.knock.set(0, 0, 0);
    this.wanderTarget = null;
    this.setState('wander');
  }
}

/** Records a bone's bind pose and the body's up/right axes in its parent's space. */
function drive(bone: THREE.Object3D): Driven {
  const parentQuat = new THREE.Quaternion();
  bone.parent?.getWorldQuaternion(parentQuat);
  const inv = parentQuat.invert();
  // Body axes in the holder's space: up is +Y, right is -X when facing +Z.
  const holderQuat = new THREE.Quaternion();
  let holder: THREE.Object3D = bone;
  while (holder.parent) holder = holder.parent;
  holder.getWorldQuaternion(holderQuat);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(holderQuat).applyQuaternion(inv).normalize();
  const side = new THREE.Vector3(1, 0, 0).applyQuaternion(holderQuat).applyQuaternion(inv).normalize();
  return { bone, bind: bone.quaternion.clone(), up, side };
}

/** Facing of a four-legged creature in its own model: from the tail toward the head. */
function creatureFacing(model: THREE.Object3D): number {
  const head = findBone(model, /Head_0$/);
  const tail = findBone(model, /Tail_0$/) ?? findBone(model, /Root$/);
  if (!head || !tail) return 0;
  const f = head.getWorldPosition(new THREE.Vector3()).sub(tail.getWorldPosition(new THREE.Vector3()));
  return Math.atan2(f.x, f.z);
}
