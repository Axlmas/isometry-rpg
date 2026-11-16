import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { type Library, type WeaponId, WEAPONS, fitToHeight, placeholder, prepareModel } from './assets';
import { IMPACT_AT, PoseBuilder, combatMoves } from './poses';

// Characters in the 3D world. They hold no game rules: the scene tells them where they
// are, how fast they move and what just happened, and they pick the animation.
//
// Locomotion never slides: each walk or run clip is measured once (how fast the feet
// travel backwards while touching the ground) and played exactly fast enough to match
// the speed the rules move the character at.

const FADE = 0.15;

export function findBone(root: THREE.Object3D, name: RegExp): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (!found && name.test(o.name)) found = o;
  });
  return found;
}

/** Ground speed (m/s, in the fitted model's scale) at which a clip's feet do not slide. */
const strideCache = new WeakMap<THREE.AnimationClip, number>();

function measureStride(holder: THREE.Object3D, model: THREE.Object3D, clip: THREE.AnimationClip, feet: THREE.Object3D[]): number {
  const cached = strideCache.get(clip);
  if (cached !== undefined) return cached;
  // Playing the clip moves the bones; put them back afterwards, so whoever looks at the
  // skeleton next (weapon sockets, the pose builder) still finds the rest pose.
  const rest: [THREE.Object3D, THREE.Vector3, THREE.Quaternion, THREE.Vector3][] = [];
  model.traverse((o) => rest.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(clip);
  action.play();
  const n = Math.max(48, Math.round(clip.duration * 60));
  const dt = clip.duration / n;
  const tracks: THREE.Vector3[][] = feet.map(() => []);
  for (let i = 0; i <= n; i++) {
    mixer.setTime(i * dt);
    holder.updateMatrixWorld(true);
    feet.forEach((foot, k) => tracks[k]!.push(holder.worldToLocal(foot.getWorldPosition(new THREE.Vector3()))));
  }
  action.stop();
  mixer.uncacheRoot(model);
  for (const [o, p, q, sc] of rest) {
    o.position.copy(p);
    o.quaternion.copy(q);
    o.scale.copy(sc);
  }
  holder.updateMatrixWorld(true);
  const speeds: number[] = [];
  for (const pts of tracks) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of pts) {
      lo = Math.min(lo, p.y);
      hi = Math.max(hi, p.y);
    }
    // A foot is planted while it is near the lowest point of its arc.
    const planted = lo + (hi - lo) * 0.15 + 0.004;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      if (a.y <= planted && b.y <= planted) speeds.push(Math.hypot(b.x - a.x, b.z - a.z) / dt);
    }
  }
  speeds.sort((a, b) => a - b);
  const speed = speeds.length > 3 ? speeds[Math.floor(speeds.length / 2)]! : 0;
  strideCache.set(clip, speed);
  return speed;
}

/** Clips with their hips put back over the spot where the character stands, per model. */
const centredClips = new WeakMap<THREE.AnimationClip[], THREE.AnimationClip[]>();

/**
 * The generated clips carry the hips off the spot where the character stands: the run
 * holds the whole body a metre ahead of it, the idle a quarter of a metre to the side.
 * Blending from one to the other then slides the body: a lurch forward when setting off,
 * a jump of two metres when turning round. Every clip is shifted so that it starts with
 * the hips straight above the rest pose; movement within a clip, such as a fall, is kept.
 */
export function centreHips(clips: THREE.AnimationClip[], model: THREE.Object3D): THREE.AnimationClip[] {
  const cached = centredClips.get(clips);
  if (cached) return cached;
  const hips = findBone(model, /Hips$/);
  if (!hips?.parent) return clips;
  const rest = hips.position.clone();
  // "Up" in the space the hips move in; only the horizontal part of the shift is removed.
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(hips.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
  const name = `${hips.name}.position`;
  const out = clips.map((clip) => {
    const track = clip.tracks.find((t) => t.name === name);
    if (!track || track.values.length < 3) return clip;
    const v = track.values;
    const shift = new THREE.Vector3(v[0]! - rest.x, v[1]! - rest.y, v[2]! - rest.z);
    shift.addScaledVector(up, -shift.dot(up));
    if (shift.lengthSq() < 1e-8) return clip;
    const copy = clip.clone();
    const values = copy.tracks.find((t) => t.name === name)!.values;
    for (let i = 0; i + 2 < values.length; i += 3) {
      values[i]! -= shift.x;
      values[i + 1]! -= shift.y;
      values[i + 2]! -= shift.z;
    }
    return copy;
  });
  centredClips.set(clips, out);
  return out;
}

/** Bones that belong to the legs: they follow walking and running while the arms are busy. */
const LOWER_BODY = /(Hips|UpLeg|Leg|Foot|Toe)/;

function boneOf(track: THREE.KeyframeTrack): string {
  return track.name.slice(0, track.name.lastIndexOf('.'));
}

/** Splits a full-body clip into `name@lower` (hips and legs) and `name@upper` (the rest). */
function splitClip(clip: THREE.AnimationClip): THREE.AnimationClip[] {
  const lower = clip.tracks.filter((t) => LOWER_BODY.test(boneOf(t)));
  const upper = clip.tracks.filter((t) => !LOWER_BODY.test(boneOf(t)));
  return [new THREE.AnimationClip(`${clip.name}@lower`, clip.duration, lower), new THREE.AnimationClip(`${clip.name}@upper`, clip.duration, upper)];
}

/** One half of the body playing one clip at a time, cross-fading between them. */
class Layer {
  current?: THREE.AnimationAction;
  name = '';

  constructor(private readonly actions: Map<string, THREE.AnimationAction>, private readonly half: '@lower' | '@upper') {}

  has(name: string): boolean {
    return this.actions.has(name + this.half);
  }

  play(name: string, options: { fade?: number; once?: boolean; restart?: boolean; at?: number } = {}): THREE.AnimationAction | undefined {
    const next = this.actions.get(name + this.half);
    if (!next) return undefined;
    if (next === this.current && !options.restart) return next;
    next.reset();
    next.setLoop(options.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = !!options.once;
    if (options.at !== undefined) next.time = options.at;
    next.setEffectiveWeight(1).play();
    if (this.current && this.current !== next) next.crossFadeFrom(this.current, Math.max(0.01, options.fade ?? FADE), false);
    this.current = next;
    this.name = name;
    return next;
  }

  /** True while a one-off clip is still playing. */
  busy(): boolean {
    return !!this.current && this.current.loop === THREE.LoopOnce && this.current.isRunning();
  }
}

interface Curl {
  bone: THREE.Object3D;
  /** The bend, ready to apply in the parent's space. */
  turn: THREE.Quaternion;
}

/** Scratch rotation reused every frame: making new ones per bone per frame makes the garbage collector stutter. */
const SCRATCH = new THREE.Quaternion();

/** How far each finger joint bends to close a hand around a grip (radians). */
const GRIP_CURL = [1.1, 1.35, 0.9];

/** Facing of a humanoid in its own model, from the line between its hands in the T-pose. */
function humanoidFacing(model: THREE.Object3D): number {
  const r = findBone(model, /RightHand$/);
  const l = findBone(model, /LeftHand$/);
  if (!r || !l) return 0;
  const right = r.getWorldPosition(new THREE.Vector3()).sub(l.getWorldPosition(new THREE.Vector3()));
  right.y = 0;
  const forward = new THREE.Vector3(0, 1, 0).cross(right.normalize());
  return Math.atan2(forward.x, forward.z);
}

/** Facing of a four-legged creature in its own model: from the tail toward the head. */
function creatureFacing(model: THREE.Object3D): number {
  const head = findBone(model, /Head_0$/);
  const tail = findBone(model, /Tail_0$/) ?? findBone(model, /Root$/);
  if (!head || !tail) return 0;
  const f = head.getWorldPosition(new THREE.Vector3()).sub(tail.getWorldPosition(new THREE.Vector3()));
  return Math.atan2(f.x, f.z);
}

function turnToward(current: number, target: number, rate: number, dt: number): number {
  const diff = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + diff * (1 - Math.exp(-dt * rate));
}

// ------------------------------------------------------------------ humanoid

export interface Motion {
  /** Where to stand, in metres. */
  position: THREE.Vector3;
  /** Ground speed in m/s; drives the walk or run cycle. */
  speed: number;
  /** Direction to face, or null to keep facing the way it moves. */
  face: THREE.Vector3 | null;
}

export type WeaponKind = 'sword' | 'bow' | 'staff' | 'none';

const WEAPON_KIND: Record<WeaponId, WeaponKind> = { sword: 'sword', axe: 'sword', bow: 'bow', staff: 'staff' };

/**
 * A humanoid on a Mixamo-named skeleton: the hero, a villager, a ghoul. Weapons go
 * into hand sockets made in the T-pose, so any weapon fits any humanoid.
 *
 * The body plays in two layers. The legs walk, run or stand; the arms and torso
 * either follow the legs or do something of their own: a blow, a shot, a spell, a
 * flinch, a fighting stance. So the hero can strike while still on the move.
 */
export class Humanoid {
  readonly object = new THREE.Group();
  private readonly pose: THREE.Group;
  private readonly mixer: THREE.AnimationMixer | null = null;
  private readonly lower: Layer | null = null;
  private readonly upper: Layer | null = null;
  private readonly sockets: Record<'right' | 'left', THREE.Group> = { right: new THREE.Group(), left: new THREE.Group() };
  private readonly grips: Record<'right' | 'left', Curl[]> = { right: [], left: [] };
  private readonly held: Record<'right' | 'left', THREE.Object3D | null> = { right: null, left: null };
  private readonly strides = new Map<string, number>();
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private weapon: WeaponKind = 'none';
  /** Where the character faces, radians around the vertical. */
  heading = 0;
  private moving = false;
  private combat = false;
  private dead = false;
  private flash = 0;
  /** Alternates the two blows of a sword, like the left-right rhythm of an auto-attack. */
  private combo = 0;

  constructor(gltf: GLTF | undefined, height: number, private readonly lib: Library, standIn = '#8a6a4a', tint?: THREE.ColorRepresentation) {
    if (!gltf) {
      this.pose = placeholder(height, standIn);
      this.object.add(this.pose);
      return;
    }
    const model = cloneSkinned(gltf.scene);
    prepareModel(model);
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.material instanceof THREE.MeshStandardMaterial) {
        const own = mesh.material.clone() as THREE.MeshStandardMaterial;
        if (tint !== undefined) own.color.multiply(new THREE.Color(tint));
        mesh.material = own;
        this.materials.push(own);
      }
    });
    model.updateMatrixWorld(true);
    this.pose = fitToHeight(model, height, -humanoidFacing(model));
    this.object.add(this.pose);
    this.object.updateMatrixWorld(true);
    this.mountSocket(model, 'right');
    this.mountSocket(model, 'left');

    const animations = centreHips(gltf.animations, model);
    // Strides are measured on the whole clips, before they are split into halves.
    const feet = ['Left', 'Right'].map((s) => findBone(model, new RegExp(`${s}ToeBase$`)) ?? findBone(model, new RegExp(`${s}Foot$`))).filter((b): b is THREE.Object3D => !!b);
    for (const name of ['walk', 'run']) {
      const clip = animations.find((c) => c.name === name);
      if (clip && feet.length === 2) this.strides.set(name, measureStride(this.pose, model, clip, feet));
    }

    const clips = animations.flatMap(splitClip);
    const builder = new PoseBuilder(model, this.object, this.sockets, animations.find((c) => c.name === 'idle'));
    if (builder.ok) clips.push(...combatMoves(builder));
    this.mixer = new THREE.AnimationMixer(model);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const clip of clips) actions.set(clip.name, this.mixer.clipAction(clip));
    this.lower = new Layer(actions, '@lower');
    this.upper = new Layer(actions, '@upper');
    this.lower.play('idle');
    this.upper.play('idle');
  }

  get position(): THREE.Vector3 {
    return this.object.position;
  }

  /** Measured ground speeds of the walk and run cycles, m/s; for tests. */
  get strideSpeeds(): Record<string, number> {
    return Object.fromEntries(this.strides);
  }

  /** Puts a weapon into its hand (a bow in the left, the rest in the right); null empties both. */
  setWeapon(id: WeaponId | null): void {
    for (const side of ['right', 'left'] as const) {
      const old = this.held[side];
      if (old) this.sockets[side].remove(old);
      this.held[side] = null;
    }
    this.weapon = id ? WEAPON_KIND[id] : 'none';
    if (!id) return;
    const weapon = this.lib.weapon(id);
    if (!weapon) return;
    const side = WEAPONS[id].hand;
    this.sockets[side].add(weapon);
    this.held[side] = weapon;
  }

  /** In a fight the character stands ready, weapon up, instead of idling. */
  setCombat(on: boolean): void {
    this.combat = on;
  }

  /**
   * A blow, a shot or a spell, depending on the weapon. `impactIn` is how many seconds
   * from now it lands: the clip is timed so the weapon meets the target then.
   */
  attack(impactIn = IMPACT_AT): void {
    const upper = this.upper;
    if (this.dead || !upper) return;
    let name = this.weapon === 'sword' || this.weapon === 'none' ? `atk-${this.weapon}-${this.combo % 2 === 0 ? 'a' : 'b'}` : `atk-${this.weapon}`;
    if (!upper.has(name)) name = 'slash';
    this.combo += 1;
    const action = upper.play(name, { once: true, restart: true, fade: 0.05 });
    if (action) action.timeScale = name === 'slash' ? 1.5 : IMPACT_AT / Math.max(0.05, impactIn);
  }

  /** Holds the upper body still at one moment of a clip; for checking poses in tests. */
  freeze(name: string, time: number): void {
    const action = this.upper?.play(name, { once: true, restart: true, fade: 0.01 });
    if (!action) return;
    action.time = time;
    action.timeScale = 0;
    this.frozen = true;
  }

  /** True while `freeze` holds the pose; normal play resumes after `revive`. */
  private frozen = false;

  /** A flinch of the upper body. It does not cut a blow short; then it shows as a flash only. */
  hurt(): void {
    this.flash = 1;
    const upper = this.upper;
    if (this.dead || !upper || upper.busy()) return;
    const action = upper.play('hurt', { once: true, restart: true, fade: 0.06 });
    if (action) action.timeScale = 1.4;
  }

  /** Lies down for good (until `revive`). */
  die(): void {
    if (this.dead) return;
    this.dead = true;
    if (this.lower?.has('fall')) {
      this.lower.play('fall', { once: true, fade: 0.1 });
      this.upper!.play('fall', { once: true, fade: 0.1 });
    } else {
      this.pose.rotation.z = Math.PI / 2;
    }
  }

  revive(): void {
    this.dead = false;
    this.frozen = false;
    this.pose.rotation.z = 0;
    this.lower?.play('idle', { fade: 0.05 });
    this.upper?.play('idle', { fade: 0.05 });
  }

  /** Off screen: only keep its place and facing, skip the animation work. */
  place(motion: Motion): void {
    this.object.position.copy(motion.position);
  }

  /** Places the character for this frame and picks the animation from its motion. */
  update(dt: number, motion: Motion): void {
    this.object.position.copy(motion.position);
    const moving = motion.speed > 0.25;
    if (!this.dead) {
      if (motion.face && motion.face.lengthSq() > 1e-6) {
        const want = Math.atan2(motion.face.x, motion.face.z);
        // A quick turn, but a turn: snapping round reads as a jolt.
        this.heading = turnToward(this.heading, want, 16, dt);
      }
      this.object.rotation.y = this.heading;
    }
    const started = moving && !this.moving;
    this.moving = moving;

    const { mixer, lower, upper } = this;
    if (mixer && lower && upper) {
      if (!this.dead) {
        let legs = 'idle';
        let rate = 1;
        if (moving) {
          // Walk when slow, run when fast; play exactly fast enough that the feet stay put.
          const walk = this.strides.get('walk') ?? 0;
          const run = this.strides.get('run') ?? 0;
          legs = run > 0 && (walk === 0 || motion.speed > walk * 1.35) ? 'run' : 'walk';
          const stride = this.strides.get(legs) ?? 0;
          rate = stride > 0.1 ? THREE.MathUtils.clamp(motion.speed / stride, 0.4, 2.6) : 1;
        }
        // The body gathers speed smoothly, so the legs blend from standing to walking to running.
        const lowerAction = lower.play(legs, { fade: started ? 0.18 : 0.2 });
        if (lowerAction) lowerAction.timeScale = rate;
        if (!upper.busy() && !this.frozen) {
          const stance = `stance-${this.weapon}`;
          if (!moving && this.combat && upper.has(stance)) {
            upper.play(stance, { fade: 0.2 });
          } else {
            // The arms follow the legs, in step with them.
            const upperAction = upper.play(legs, { fade: 0.2, at: lowerAction?.time });
            if (upperAction) upperAction.timeScale = rate;
          }
        }
      }
      mixer.update(dt);
      // The generated clips hold the hands open; close them around what they hold.
      for (const side of ['right', 'left'] as const) {
        if (!this.held[side]) continue;
        for (const c of this.grips[side]) c.bone.quaternion.premultiply(c.turn);
      }
    } else if (moving) {
      this.pose.position.y = Math.abs(Math.sin(performance.now() / 90)) * 0.06;
    }

    this.flash = Math.max(0, this.flash - dt * 5);
    for (const m of this.materials) m.emissive.setRGB(this.flash * 0.55, this.flash * 0.05, 0);
  }

  /** Socket at the palm, made in the T-pose: its +Y points where the character faces. */
  private mountSocket(model: THREE.Object3D, side: 'right' | 'left'): void {
    const Side = side === 'right' ? 'Right' : 'Left';
    const hand = findBone(model, new RegExp(`${Side}Hand$`));
    const socket = this.sockets[side];
    if (!hand) {
      socket.position.set(side === 'right' ? -0.3 : 0.3, 1.0, 0);
      this.object.add(socket);
      return;
    }
    const middle = findBone(model, new RegExp(`${Side}HandMiddle1$`));
    const wrist = hand.getWorldPosition(new THREE.Vector3());
    const palm = middle ? wrist.clone().lerp(middle.getWorldPosition(new THREE.Vector3()), 0.75) : wrist;
    this.object.add(socket);
    socket.position.copy(this.object.worldToLocal(palm));
    socket.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    socket.updateMatrixWorld(true);
    hand.attach(socket);

    // Fingers curl around "forward". The sign flips for the left hand, which points the other way.
    const forward = new THREE.Vector3(0, 0, side === 'right' ? 1 : -1);
    for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) {
      GRIP_CURL.forEach((angle, i) => {
        const bone = findBone(model, new RegExp(`${Side}Hand${finger}${i + 1}$`));
        if (!bone?.parent) return;
        const inv = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
        this.grips[side].push({ bone, turn: new THREE.Quaternion().setFromAxisAngle(forward.clone().applyQuaternion(inv).normalize(), angle) });
      });
    }
  }
}

// ------------------------------------------------------------------ quadruped

interface Driven {
  bone: THREE.Object3D;
  bind: THREE.Quaternion;
  /** The body's "up" in the bone's parent space: turning about it swings sideways. */
  up: THREE.Vector3;
  /** The body's "right" in parent space: turning about it nods. */
  side: THREE.Vector3;
}

function drive(bone: THREE.Object3D): Driven {
  const inv = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert() : new THREE.Quaternion();
  return {
    bone,
    bind: bone.quaternion.clone(),
    up: new THREE.Vector3(0, 1, 0).applyQuaternion(inv).normalize(),
    side: new THREE.Vector3(1, 0, 0).applyQuaternion(inv).normalize(),
  };
}

/**
 * A four-legged beast. The model brings a skeleton and one walk cycle; tail, head,
 * the lunge of a bite, the recoil of a hit and the fall are done here in code, so any
 * beast on the same skeleton type gets them for free.
 */
export class Beast {
  readonly object = new THREE.Group();
  private readonly pose: THREE.Group;
  private readonly mixer: THREE.AnimationMixer | null = null;
  /** The walk cycle split in two: the right legs play apart so they can change phase. */
  private readonly gait: { body: THREE.AnimationAction; right: THREE.AnimationAction; duration: number } | null = null;
  private readonly walkStride: number;
  /** 0 for a walk; 1 for a bound, where both front legs (and both hind legs) move together. */
  private bound = 0;
  private readonly tail: Driven[] = [];
  private readonly head?: Driven;
  private readonly spine?: Driven;
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private heading = 0;
  private time = Math.random() * 10; // cosmetic phase
  private lookYaw = 0;
  private lunge = 0;
  private stagger = 0;
  private flash = 0;
  private dying = -1;

  constructor(gltf: GLTF | undefined, height: number, private readonly glow: THREE.Color | null, standIn: string) {
    if (!gltf) {
      this.pose = placeholder(height, standIn, height * 0.3);
      this.pose.rotation.x = Math.PI / 2;
      this.pose.position.y = height * 0.3;
      const holder = new THREE.Group();
      holder.add(this.pose);
      this.object.add(holder);
      this.walkStride = 0;
      return;
    }
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
    for (let b: THREE.Object3D | undefined = tailRoot; b; b = b.children.find((c) => (c as THREE.Bone).isBone)) this.tail.push(drive(b));
    const head = findBone(model, /Head_0$/);
    if (head) this.head = drive(head);
    const spine = findBone(model, /Spine_1$/);
    if (spine) this.spine = drive(spine);

    const feet = ['0_Left', '0_Right', '1_Left', '1_Right']
      .map((s) => findBone(model, new RegExp(`${s}_Limb_4$`)) ?? findBone(model, new RegExp(`${s}_Limb_3$`)))
      .filter((b): b is THREE.Object3D => !!b);
    const walk = gltf.animations.find((c) => c.name === 'walk');
    this.walkStride = walk && feet.length >= 2 ? measureStride(this.pose, model, walk, feet) : 0;
    this.mixer = new THREE.AnimationMixer(model);
    if (walk) {
      const isRight = (t: THREE.KeyframeTrack) => /Right_Limb/.test(t.name);
      const body = new THREE.AnimationClip('walk-body', walk.duration, walk.tracks.filter((t) => !isRight(t)));
      const right = new THREE.AnimationClip('walk-right', walk.duration, walk.tracks.filter(isRight));
      this.gait = { body: this.mixer.clipAction(body), right: this.mixer.clipAction(right), duration: walk.duration };
      this.gait.body.play();
      this.gait.right.play();
    }
  }

  /** Measured ground speed of the walk cycle, m/s; for tests. */
  get strideSpeed(): number {
    return this.walkStride;
  }

  /** The warning before a bite: the body leans back, then lunges forward. */
  windup(progress: number): void {
    this.lunge = progress;
  }

  hit(): void {
    this.flash = 1;
    this.stagger = 1;
  }

  die(): void {
    if (this.dying < 0) this.dying = 0;
  }

  get dead(): boolean {
    return this.dying >= 0;
  }

  /** Seconds since it fell; the scene removes the body after a while. */
  get deadFor(): number {
    return this.dying;
  }

  /** Off screen: only keep its place, skip the animation work. */
  place(motion: Motion): void {
    this.object.position.copy(motion.position);
  }

  update(dt: number, motion: Motion, hunting: boolean, prey: THREE.Vector3 | null): void {
    this.time += dt;
    this.object.position.copy(motion.position);
    if (this.dying < 0) {
      if (motion.face && motion.face.lengthSq() > 1e-6) this.heading = turnToward(this.heading, Math.atan2(motion.face.x, motion.face.z), 10, dt);
      this.object.rotation.y = this.heading;
    } else {
      this.dying += dt;
    }

    if (this.mixer && this.gait) {
      const { body, right, duration } = this.gait;
      const moving = this.dying >= 0 ? 0 : THREE.MathUtils.clamp(motion.speed / 0.3, 0, 1);
      // Past about twice its walking pace the beast bounds: right legs join the left ones.
      const wantBound = motion.speed > this.walkStride * 2.2 ? 1 : 0;
      this.bound += (wantBound - this.bound) * (1 - Math.exp(-dt * 6));
      // A bound covers more ground per cycle than a walk, so it is played less fast.
      const reach = 1 + this.bound * 0.7;
      const scale = this.walkStride > 0.05 ? THREE.MathUtils.clamp(motion.speed / (this.walkStride * reach), 0.3, 4.5) : 1;
      for (const a of [body, right]) {
        a.setEffectiveWeight(moving);
        a.timeScale = scale;
      }
      right.time = (body.time + this.bound * duration * 0.5) % duration;
      this.mixer.update(dt);
    }
    this.animate(dt, motion.speed, hunting, prey);
  }

  private animate(dt: number, speed: number, hunting: boolean, prey: THREE.Vector3 | null): void {
    const pose = this.pose;
    pose.position.set(0, 0, 0);
    pose.rotation.set(0, 0, 0);
    this.stagger = Math.max(0, this.stagger - dt * 3);
    if (this.dying >= 0) {
      const fall = THREE.MathUtils.smoothstep(this.dying, 0, 0.45);
      pose.rotation.z = fall * Math.PI * 0.5;
      pose.position.y = -THREE.MathUtils.smoothstep(this.dying, 1.8, 3.0) * 0.7;
    } else if (this.lunge > 0) {
      // First a crouch back, then the bite forward.
      const k = this.lunge < 0.6 ? -Math.sin((this.lunge / 0.6) * Math.PI * 0.5) * 0.2 : Math.sin(((this.lunge - 0.6) / 0.4) * Math.PI) * 0.7;
      pose.position.z = k * 0.6;
      pose.rotation.x = Math.max(0, k) * 0.15;
    } else if (this.stagger > 0) {
      pose.rotation.x = -Math.sin(this.stagger * Math.PI) * 0.18;
      pose.position.z = -this.stagger * 0.15;
    }

    if (this.gait && this.bound > 0.05 && this.dying < 0) {
      // The spring of a bound: the body rises and pitches once per stride.
      const phase = (this.gait.body.time / this.gait.duration) * Math.PI * 2;
      pose.position.y += Math.abs(Math.sin(phase)) * 0.12 * this.bound;
      pose.rotation.x += Math.sin(phase) * 0.07 * this.bound;
    }

    const t = this.time;
    const freq = hunting ? 9 : 2.2;
    const amp = this.dying >= 0 ? 0 : hunting ? 0.35 : 0.18 + Math.min(speed, 1) * 0.1;
    this.tail.forEach((d, i) => {
      d.bone.quaternion.copy(d.bind).premultiply(SCRATCH.setFromAxisAngle(d.up, Math.sin(t * freq - i * 0.7) * amp));
    });
    if (this.head) {
      let want = 0;
      if (hunting && prey && this.dying < 0) {
        const to = prey.clone().sub(this.object.position);
        const angle = Math.atan2(to.x, to.z) - this.heading;
        want = THREE.MathUtils.clamp(Math.atan2(Math.sin(angle), Math.cos(angle)), -0.7, 0.7);
      }
      this.lookYaw += (want - this.lookYaw) * (1 - Math.exp(-dt * 8));
      const nod = this.lunge > 0.6 ? Math.sin(((this.lunge - 0.6) / 0.4) * Math.PI) * 0.35 : 0;
      this.head.bone.quaternion.copy(this.head.bind)
        .premultiply(SCRATCH.setFromAxisAngle(this.head.up, this.lookYaw))
        .premultiply(SCRATCH.setFromAxisAngle(this.head.side, nod));
    }
    if (this.spine && speed < 0.2 && this.dying < 0) {
      this.spine.bone.quaternion.premultiply(SCRATCH.setFromAxisAngle(this.spine.side, Math.sin(t * 2.4) * 0.025));
    }
    this.flash = Math.max(0, this.flash - dt * 4);
    for (const m of this.materials) {
      m.emissive.setRGB(this.flash * 0.6, 0, 0);
      if (this.glow && this.flash === 0) m.emissive.copy(this.glow);
    }
  }
}

/** Fades every material of an object, for bodies that sink away. */
export function setOpacity(root: THREE.Object3D, opacity: number): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      m.transparent = opacity < 1;
      m.opacity = opacity;
    }
  });
}
