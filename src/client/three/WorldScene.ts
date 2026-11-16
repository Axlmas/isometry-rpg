import * as THREE from 'three';
import {
  type Command, type GameEvent, type GroundLoot, type ItemId, type Monster, type NpcKind, type Point, type Quality, type SkillId, type World, type ZoneKind,
  ITEMS, LOOT_PICKUP_RADIUS, MONSTER_ATTACK_WINDUP, PLAYER_ATTACK_RANGE, PLAYER_ATTACK_WINDUP, SKILLS, TICK_MS,
  type Player, classSkills, isAlive, isMoving, isStriking, isUnique, isWalkable, step, weaponInHand,
} from '../../sim';
import { QUICK_KEYS } from '../hotbar';
import { QUALITY_COLOR } from '../itemText';
import { NPC_LOOK } from '../npcText';
import { SKILL_SLOTS } from '../skillText';
import { sound, unlockSound } from '../sound';
import { type CharacterId, type WeaponId, CHARACTERS, Library, TILE } from './assets';
import { Beast, Humanoid, type Motion, setOpacity } from './actors';
import { Effects, disposeTree } from './effects';
import { Stage } from './stage';
import { SEE_THROUGH, type Terrain, buildTerrain } from './terrain';

// The 3D view of the game. Like the old 2D scene it holds no game rules: it runs
// `step` from src/sim at a fixed rate, turns input into commands and shows what the
// rules report. The interface around it (HUD, bag, shops) talks to it the same way.

const TARGET_MEMORY_MS = 5000;
const HOLD_REPEAT_MS = 120;
const AUTO_AIM_RANGE = PLAYER_ATTACK_RANGE + 1;
/** A monster counts as under the cursor within this many pixels of its body. */
const PICK_RADIUS_PX = 46;
const CHARGE_COLOR = 0x7fe9ff;
/** Beyond this many metres from the hero, monsters are hidden and not animated. */
const FAR_AWAY = 55;
const ELDER_SCALE = 1.35;
const KIND_SCALE: Partial<Record<Monster['kind'], number>> = { wolfPup: 0.72, tusker: 1.22 };
/** Which model draws each kind of monster. */
const MONSTER_MODEL: Record<Monster['kind'], CharacterId> = { wolfPup: 'wolf', wolf: 'wolf', boar: 'boar', tusker: 'boar', grunt: 'ghoul' };
/** Which of the hero's looks each villager wears. */
const NPC_MODEL: Record<NpcKind, CharacterId> = {
  guard: 'hero', trainer: 'hero', blacksmith: 'hero-t1', hunter: 'hero-t1', alchemist: 'hero-t0', outfitter: 'hero-t1',
};

/**
 * The hero's look follows the armour on his body, as in classic MMORPGs: a ragged
 * recruit without it, leather when it has no grade, plate from grade D up.
 */
function heroModel(player: Player): CharacterId {
  const id = player.equipment.armor;
  const def = id ? ITEMS[id] : null;
  if (!def || def.kind !== 'equipment') return 'hero-t0';
  return def.grade === 'none' ? 'hero-t1' : 'hero';
}

const NPC_WEAPON: Record<NpcKind, WeaponId | null> = {
  guard: 'sword', trainer: 'sword', blacksmith: 'axe', hunter: 'bow', alchemist: 'staff', outfitter: null,
};

// Physical key positions (KeyboardEvent.code), so controls work on any layout.
// Values are directions on the screen: x to the right, y down.
const KEY_DIRECTIONS: Record<string, readonly [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};
const ATTACK_KEY = 'Space';
const CANCEL_KEY = 'Escape';
const INVENTORY_KEY = 'KeyI';
const INTERACT_KEY = 'KeyT';
/** Picks up the nearest thing on the ground. */
const PICKUP_KEY = 'KeyZ';
/** How far around the hero Z looks for something to pick up, in tiles. */
const PICKUP_SEARCH = 8;
/** A thing on the ground counts as under the cursor within this many pixels. */
const LOOT_PICK_PX = 30;
const COMMAND_KEYS: Record<string, Command> = {
  [QUICK_KEYS.healthPotion]: { type: 'use', itemId: 'healthPotion' },
  [QUICK_KEYS.manaPotion]: { type: 'use', itemId: 'manaPotion' },
  [QUICK_KEYS.charges]: { type: 'toggleCharges' },
};
const SKILL_SLOT_BY_KEY = new Map<string, number>(SKILL_SLOTS.map((slot, index) => [slot.code, index]));

export interface SceneEvents {
  onStats(world: World): void;
  onCheckpoint(world: World): void;
  onDeath(world: World, xpLost: number): void;
  onTick(world: World): void;
  onLevelUp(level: number, unlocked: SkillId[]): void;
  onSkillDenied(id: SkillId, reason: 'locked' | 'unlearned' | 'cooldown' | 'mana'): void;
  onPickup(itemId: ItemId, count: number, quality: Quality | null): void;
  onXp(amount: number): void;
  streakText(streak: number): string;
  onInventoryFull(): void;
  onToggleInventory(): void;
  onInteract(): void;
  onTarget(monster: Monster | null): void;
  /** What a thing on the ground is called, shown over it: "Leather ×2", "7 coins". */
  lootName(loot: GroundLoot): string;
  onReady(): void;
  onTravel(to: ZoneKind): void;
  onRespawn(): void;
  onNotice(event: GameEvent): void;
  formatNumber(value: number): string;
  /** A villager's name in the player's language, shown over their head. */
  npcName(kind: NpcKind): string;
}

interface MonsterView {
  id: number;
  actor: Humanoid | Beast;
  previous: Point;
  /** Last windup seen, to notice when a blow starts. */
  windup: number;
  /** Seconds since it fell; negative while alive. */
  deadFor: number;
  /** Reused every frame. */
  motion: Motion;
  face: THREE.Vector3;
  sphere: THREE.Sphere;
}

/** Rules' tile position to metres on the ground. */
function at(p: Point, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(p.x * TILE, 0, p.y * TILE);
}

export class WorldScene {
  private world: World;
  private readonly events: SceneEvents;
  private readonly stage: Stage;
  private readonly effects: Effects;
  private lib: Library | null = null;
  private terrain: Terrain | null = null;
  private hero: Humanoid | null = null;
  private heroWeapon: WeaponId | null | undefined = undefined;
  private heroLook: CharacterId | null = null;
  private readonly monsters = new Map<number, MonsterView>();
  private readonly corpses: MonsterView[] = [];
  private npcViews: { kind: NpcKind; pos: Point; actor: Humanoid }[] = [];
  private readonly lootViews = new Map<number, THREE.Object3D>();
  private readonly missileViews = new Map<number, THREE.Object3D>();

  private pending: Command[] = [];
  private accumulator = 0;
  private lastFrameAt = performance.now();
  /** Debug only (`?stats`): frames are driven by `__three.advance(ms)` instead of the screen. */
  private manualClock: number | null = null;
  private previous: Point = { x: 0, y: 0 };
  private wasMoving = false;
  private lastStats = '';
  private readonly heldKeys = new Set<string>();
  private holdTimer = 0;
  private pointerHeld = false;
  private readonly pointer = { x: -1, y: -1, over: false };
  private peaceful = false;
  private paused = false;
  private ready = false;
  private savedRevision = 0;
  private targetId: number | null = null;
  private targetUntil = 0;
  private lockedId: number | null = null;
  private lockTimer = 0;
  /** The thing on the ground the hero was told to pick up: he walks to it, then takes it. */
  private pickId: number | null = null;
  private pickTimer = 0;
  private shownTarget = '';
  private readonly screen = { x: 0, y: 0 };
  private time = 0;
  /** What the camera sees this frame, for skipping work on things off screen. */
  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();
  /** When the hero last struck or was struck: he stays in a fighting stance for a while. */
  private lastFight = -1e9;
  /** The hero's drawn body, which gathers speed instead of jumping to it. */
  private readonly heroTarget = new THREE.Vector3();
  private readonly heroRuleVel = new THREE.Vector3();
  private readonly heroFace = new THREE.Vector3();

  constructor(container: HTMLElement, world: World, events: SceneEvents) {
    this.world = world;
    this.events = events;
    this.stage = new Stage(container);
    this.effects = new Effects(this.stage, container);
    this.bindInput();
    Library.load().then((lib) => {
      this.lib = lib;
      this.ready = true;
      this.setWorld(this.world);
      this.events.onReady();
    }, (error) => {
      throw error;
    });
    const frame = (now: number) => {
      requestAnimationFrame(frame);
      if (this.manualClock === null) this.frame(now);
    };
    requestAnimationFrame(frame);
  }

  /** Replaces the world being shown, for example when the hero walks into the mines. */
  setWorld(world: World): void {
    this.world = world;
    if (!this.ready || !this.lib) return;
    this.pending = [];
    this.accumulator = 0;
    this.lastFrameAt = performance.now();
    this.previous = { ...world.player.pos };
    this.wasMoving = false;
    this.savedRevision = world.player.revision;
    this.lastStats = '';
    this.heldKeys.clear();
    this.lockedId = null;
    this.targetId = null;
    this.pickId = null;
    this.effects.clear();
    this.effects.clearLabels();

    const scene = this.stage.scene;
    if (this.terrain) {
      scene.remove(this.terrain.group);
      this.terrain.dispose();
    }
    this.terrain = buildTerrain(world, this.lib);
    scene.add(this.terrain.group);
    this.stage.setMood(world.zone === 'dungeon' ? 'dungeon' : 'overworld');

    for (const view of [...this.monsters.values(), ...this.corpses]) scene.remove(view.actor.object);
    this.monsters.clear();
    this.corpses.length = 0;
    for (const npc of this.npcViews) scene.remove(npc.actor.object);
    this.npcViews = world.npcs.map((npc) => {
      const actor = new Humanoid(this.lib!.character(NPC_MODEL[npc.kind]) ?? this.lib!.character('hero'), 1.78, this.lib!, '#8a7a6a', blend(NPC_LOOK[npc.kind].clothes));
      actor.setWeapon(NPC_WEAPON[npc.kind]);
      actor.update(0, { position: at(npc.pos), speed: 0, face: new THREE.Vector3(1, 0, 1) });
      scene.add(actor.object);
      this.effects.label(actor, this.events.npcName(npc.kind), actor.object, 2.15, npc.kind === 'guard' ? 'world-label' : 'world-label npc');
      return { kind: npc.kind, pos: npc.pos, actor };
    });
    for (const view of this.lootViews.values()) scene.remove(view);
    this.lootViews.clear();
    for (const view of this.missileViews.values()) scene.remove(view);
    this.missileViews.clear();

    this.heroWeapon = undefined;
    this.heroLook = null;
    this.syncHeroLook();
    const hero = this.hero!;
    if (isAlive(world)) hero.revive();
    else hero.die();
    const start = at(world.player.pos);
    hero.update(0, { position: start, speed: 0, face: null });
    this.syncMonsters(1, 0);
    this.syncLoot(0);
    this.stage.snapTo(start);
    this.reportStats();
  }

  setPeaceful(peaceful: boolean): void {
    this.peaceful = peaceful;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.heldKeys.clear();
    this.pending = [];
    this.lastFrameAt = performance.now();
  }

  send(command: Command): void {
    this.pending.push(command);
  }

  /** Uses the skill on the given key (0 for Q, 1 for E, 2 for R); the class decides which skill it is. */
  useSkillSlot(slot: number, aimAtCursor: boolean): void {
    const id = classSkills(this.world.player.cls)[slot];
    if (id) this.useSkill(id, aimAtCursor);
  }

  /** Skills go at the current target, as in classic MMORPGs; without one, at the cursor or the nearest monster. */
  useSkill(id: SkillId, aimAtCursor: boolean): void {
    const { kind } = SKILLS[id].effect;
    if (this.peaceful && (kind === 'strike' || kind === 'shot' || kind === 'nova')) return;
    const { pos } = this.world.player;
    const target = this.lockedMonster() ?? this.rememberedTarget();
    let dir: Point;
    if (target) dir = { x: target.pos.x - pos.x, y: target.pos.y - pos.y };
    else if (aimAtCursor && this.pointer.over) {
      const ground = this.groundUnder(this.pointer.x, this.pointer.y);
      dir = ground ? { x: ground.x - pos.x, y: ground.y - pos.y } : this.autoAim();
    } else dir = this.autoAim();
    this.pending.push({ type: 'skill', id, dx: dir.x, dy: dir.y });
  }

  // ---------------------------------------------------------------- frame

  private frame(now: number): void {
    const delta = Math.min(now - this.lastFrameAt, 250);
    this.lastFrameAt = now;
    const dt = delta / 1000;
    this.time += dt;
    if (this.ready && this.hero) {
      if (!this.paused) {
        this.readHeldInput(delta);
        this.accumulator = Math.min(this.accumulator + delta, TICK_MS * 5);
        while (this.accumulator >= TICK_MS) {
          this.previous = { ...this.world.player.pos };
          for (const monster of this.world.monsters) {
            const view = this.monsters.get(monster.id);
            if (view) view.previous = { ...monster.pos };
          }
          step(this.world, this.pending);
          this.pending = [];
          this.accumulator -= TICK_MS;
          this.afterTick();
        }
      }
      const alpha = this.paused ? 1 : this.accumulator / TICK_MS;
      const camera = this.stage.camera;
      camera.updateMatrixWorld();
      this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.viewProjection);
      this.syncHero(alpha, dt);
      this.syncMonsters(alpha, dt);
      this.syncNpcs(dt);
      this.syncLoot(dt);
      this.syncMissiles(alpha);
      this.updateTarget();
      this.stage.follow(this.hero.position, dt);
      this.updateSeeThrough();
      this.terrain?.update(this.time);
    }
    this.effects.update(dt);
    this.stage.render(dt);
    this.showStats(dt);
  }

  private statsEl: HTMLElement | null | undefined;
  private fps = 60;

  /** With `?stats` in the address: frames per second and what the GPU draws, for testing. */
  private showStats(dt: number): void {
    if (this.statsEl === undefined) {
      this.statsEl = new URLSearchParams(window.location.search).has('stats') ? document.createElement('div') : null;
      if (this.statsEl) {
        this.statsEl.id = 'render-stats';
        this.statsEl.style.cssText = 'position:fixed;left:50%;top:6px;transform:translateX(-50%);z-index:20;font:11px monospace;color:#cfc;background:rgba(0,0,0,.6);padding:2px 6px;pointer-events:none';
        document.body.appendChild(this.statsEl);
        // For tests and debugging in the console.
        (window as unknown as { __three: unknown }).__three = {
          THREE, scene: this.stage.scene, renderer: this.stage.renderer, camera: this.stage.camera,
          monsters: () => [...this.monsters.values()].filter((v) => v.actor.object.visible).map((v) => {
            const p = v.actor.object.position.clone().setY(0.55);
            const ok = this.stage.project(p, this.screen);
            return ok ? { id: v.id, x: this.screen.x, y: this.screen.y, d: v.actor.object.position.distanceTo(this.hero!.position) } : null;
          }).filter(Boolean),
          hero: () => this.hero,
          send: (command: Command) => this.pending.push(command),
          // Frame-by-frame stepping for measurements: freeze() stops the screen-driven loop,
          // advance(ms) draws one frame that long after the previous one.
          freeze: () => { this.manualClock = this.lastFrameAt; },
          advance: (ms: number) => { this.manualClock = (this.manualClock ?? this.lastFrameAt) + ms; this.frame(this.manualClock); },
          world: () => this.world,
          stage: this.stage,
          bag: () => this.world.player.inventory.map((stack) => stack?.itemId ?? null),
          loot: () => this.world.loot.map((l) => {
            const ok = this.stage.project(at(l.pos).setY(0.15), this.screen);
            return { id: l.id, itemId: l.itemId, x: ok ? this.screen.x : null, y: ok ? this.screen.y : null };
          }),
          state: () => ({
            look: this.heroLook, armor: this.world.player.equipment.armor,
            locked: this.lockedId, target: this.targetId, hero: this.world.player.pos, hp: this.world.player.hp,
            xp: this.world.player.xp, level: this.world.player.level, kills: this.world.player.kills,
            lockedHp: this.lockedMonster()?.hp ?? null, cooldown: this.world.player.attackCooldown,
          }),
          strides: () => ({ hero: this.hero?.strideSpeeds, monsters: [...this.monsters.values()].slice(0, 6).map((v) => (v.actor instanceof Beast ? v.actor.strideSpeed : v.actor.strideSpeeds)) }),
        };
      }
    }
    if (!this.statsEl || dt <= 0) return;
    this.fps += (1 / dt - this.fps) * 0.05;
    const info = this.stage.renderer.info.render;
    this.statsEl.textContent = `${this.fps.toFixed(0)} fps · ${(info.triangles / 1000).toFixed(0)}k tris · ${info.calls} calls · res ${this.stage.resolution.toFixed(2)}`;
  }

  /**
   * The hero is drawn exactly where the rules put him, between the last two ticks. He sets
   * off and stops at once, as in classic MMORPGs; the legs blend from standing into running.
   */
  private syncHero(alpha: number, dt: number): void {
    const hero = this.hero!;
    const { player } = this.world;
    const target = this.heroTarget.set(
      (this.previous.x + (player.pos.x - this.previous.x) * alpha) * TILE, 0,
      (this.previous.y + (player.pos.y - this.previous.y) * alpha) * TILE,
    );
    const ruleVel = this.heroRuleVel.set(player.pos.x - this.previous.x, 0, player.pos.y - this.previous.y).multiplyScalar((TILE * 1000) / TICK_MS);
    const speed = Math.hypot(ruleVel.x, ruleVel.z);
    let face: THREE.Vector3 | null = null;
    if (isStriking(player)) face = this.heroFace.set(player.facing.x, 0, player.facing.y);
    else if (speed > 0.3) face = this.heroFace.copy(ruleVel);
    hero.setCombat(this.lockedId !== null || performance.now() - this.lastFight < 4000);
    hero.update(dt, { position: target, speed, face });
  }

  private readonly seeSize = new THREE.Vector2();

  /** Where the hero is on screen, for the circle in which trees and houses dissolve. */
  private updateSeeThrough(): void {
    const chest = this.hero!.position.clone().setY(1.1);
    const camera = this.stage.camera;
    const view = chest.clone().applyMatrix4(camera.matrixWorldInverse);
    const ndc = chest.clone().project(camera);
    const size = this.stage.sceneSize(this.seeSize);
    SEE_THROUGH.uSeeCenter.value.set((ndc.x * 0.5 + 0.5) * size.x, (ndc.y * 0.5 + 0.5) * size.y);
    SEE_THROUGH.uSeeRadius.value = size.y * 0.16;
    SEE_THROUGH.uSeeDepth.value = -view.z;
  }

  /** Swaps the hero's model when the armour on his body changes his look. */
  private syncHeroLook(): void {
    const lib = this.lib;
    if (!lib) return;
    const look = heroModel(this.world.player);
    if (look !== this.heroLook || !this.hero) {
      this.heroLook = look;
      const old = this.hero;
      const hero = new Humanoid(lib.character(look) ?? lib.character('hero'), CHARACTERS.hero.height, lib);
      if (old) {
        hero.object.position.copy(old.position);
        hero.heading = old.heading;
        this.stage.scene.remove(old.object);
      }
      this.stage.scene.add(hero.object);
      this.hero = hero;
      this.heroWeapon = undefined;
    }
    this.syncHeroWeapon();
  }

  private syncHeroWeapon(): void {
    const held = weaponInHand(this.world.player);
    const id: WeaponId | null = held === 'bow' ? 'bow' : held === 'staff' ? 'staff' : held === 'sword' ? 'sword' : null;
    if (id === this.heroWeapon) return;
    this.heroWeapon = id;
    this.hero?.setWeapon(id);
  }

  private syncMonsters(alpha: number, dt: number): void {
    if (!this.lib) return;
    const scene = this.stage.scene;
    const present = new Set<number>();
    const prey = this.hero ? this.hero.position : null;
    for (const monster of this.world.monsters) {
      present.add(monster.id);
      let view = this.monsters.get(monster.id);
      if (!view) {
        view = this.createMonster(monster);
        this.monsters.set(monster.id, view);
        scene.add(view.actor.object);
      }
      const x = view.previous.x + (monster.pos.x - view.previous.x) * alpha;
      const y = view.previous.y + (monster.pos.y - view.previous.y) * alpha;
      // Far beyond the fog nothing is seen: skip the animation work.
      const far = Math.hypot(x - this.world.player.pos.x, y - this.world.player.pos.y) * TILE > FAR_AWAY;
      view.actor.object.visible = !far;
      if (far) {
        view.actor.object.position.set(x * TILE, 0, y * TILE);
        view.windup = monster.windup;
        continue;
      }
      const stepLen = Math.hypot(monster.pos.x - view.previous.x, monster.pos.y - view.previous.y);
      // One motion object per monster, reused every frame: no garbage, no collector stutter.
      const motion = view.motion;
      motion.position.set(x * TILE, 0, y * TILE);
      motion.speed = (stepLen * TILE * 1000) / TICK_MS;
      if (monster.aggro) motion.face = view.face.set(this.world.player.pos.x - x, 0, this.world.player.pos.y - y);
      else if (stepLen > 1e-4) motion.face = view.face.set(monster.pos.x - view.previous.x, 0, monster.pos.y - view.previous.y);
      else motion.face = null;
      // Off screen it only keeps its place; its animation would not be seen.
      view.sphere.center.copy(motion.position);
      view.sphere.radius = 2.5 * view.actor.object.scale.x;
      if (!this.frustum.intersectsSphere(view.sphere)) {
        view.actor.place(motion);
        view.windup = monster.windup;
        continue;
      }
      if (view.actor instanceof Beast) {
        view.actor.windup(monster.windup > 0 ? 1 - monster.windup / MONSTER_ATTACK_WINDUP : 0);
        view.actor.update(dt, motion, monster.aggro, prey);
      } else {
        if (monster.windup > 0 && view.windup === 0) view.actor.attack((monster.windup * TICK_MS) / 1000);
        view.actor.update(dt, motion);
      }
      view.windup = monster.windup;
    }
    for (const [id, view] of this.monsters) {
      if (present.has(id)) continue;
      this.monsters.delete(id);
      // It fell: keep the body for a moment, then let it sink away.
      view.actor.die();
      view.deadFor = 0;
      this.corpses.push(view);
    }
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const view = this.corpses[i]!;
      const actor = view.actor;
      const motion: Motion = { position: actor.object.position.clone(), speed: 0, face: null };
      if (actor instanceof Beast) actor.update(dt, motion, false, null);
      else actor.update(dt, motion);
      view.deadFor += dt;
      if (view.deadFor > 2.4) setOpacity(actor.object, Math.max(0, 1 - (view.deadFor - 2.4) / 0.9));
      if (view.deadFor > 3.3) {
        scene.remove(actor.object);
        this.corpses.splice(i, 1);
      }
    }
  }

  private createMonster(monster: Monster): MonsterView {
    const lib = this.lib!;
    const model = MONSTER_MODEL[monster.kind];
    const scale = (KIND_SCALE[monster.kind] ?? 1) * (monster.elder ? ELDER_SCALE : 1);
    let actor: Humanoid | Beast;
    if (model === 'ghoul') {
      actor = new Humanoid(lib.character('ghoul'), CHARACTERS.ghoul.height, lib, '#6b7a5a', monster.elder ? '#ffd98a' : undefined);
    } else {
      const glow = monster.elder ? new THREE.Color(0.07, 0.045, 0.0) : null;
      const tint = monster.kind === 'tusker' ? '#5a4a3a' : '#5d5a55';
      actor = new Beast(lib.character(model), CHARACTERS[model].height, glow, tint);
    }
    actor.object.scale.setScalar(scale);
    actor.object.position.copy(at(monster.pos));
    return {
      id: monster.id, actor, previous: { ...monster.pos }, windup: 0, deadFor: -1,
      motion: { position: new THREE.Vector3(), speed: 0, face: null }, face: new THREE.Vector3(), sphere: new THREE.Sphere(),
    };
  }

  private syncNpcs(dt: number): void {
    const hero = this.world.player.pos;
    for (const npc of this.npcViews) {
      const near = Math.hypot(hero.x - npc.pos.x, hero.y - npc.pos.y) < 4;
      const face = near ? new THREE.Vector3(hero.x - npc.pos.x, 0, hero.y - npc.pos.y) : new THREE.Vector3(1, 0, 1);
      npc.actor.update(dt, { position: at(npc.pos), speed: 0, face });
    }
  }

  private syncLoot(dt: number): void {
    const scene = this.stage.scene;
    const present = new Set<number>();
    for (const loot of this.world.loot) {
      present.add(loot.id);
      let view = this.lootViews.get(loot.id);
      if (!view) {
        view = lootModel(loot);
        view.position.copy(at(loot.pos));
        view.userData.age = 0;
        this.lootViews.set(loot.id, view);
        scene.add(view);
        // Its name floats over it, coloured by quality, as in classic MMORPGs.
        const color = loot.mods ? `#${QUALITY_COLOR[loot.mods.quality].toString(16).padStart(6, '0')}` : loot.itemId === 'coins' ? '#e8c36a' : undefined;
        this.effects.label(view, this.events.lootName(loot), view, 0.55, 'world-label loot', color);
        view.userData.count = loot.count;
      } else if (view.userData.count !== loot.count) {
        // Part of a stack was taken (the bag was full): the label shows what is left.
        view.userData.count = loot.count;
        this.effects.label(view, this.events.lootName(loot), view, 0.55, 'world-label loot');
      }
      view.userData.age += dt;
      const age = view.userData.age as number;
      // A short hop makes a fresh drop noticeable; then it turns slowly.
      const hop = age < 0.35 ? Math.sin((age / 0.35) * Math.PI) * 0.45 : 0;
      const inner = view.children[0];
      if (inner) {
        inner.position.y = hop + (view.userData.float ? 0.25 + Math.sin(this.time * 2 + loot.id) * 0.05 : 0);
        inner.rotation.y += dt * (view.userData.float ? 1.2 : 0);
      }
    }
    for (const [id, view] of this.lootViews) {
      if (present.has(id)) continue;
      this.effects.unlabel(view);
      scene.remove(view);
      disposeTree(view);
      this.lootViews.delete(id);
    }
  }

  /** Arrows and bolts, drawn a little ahead of their last known place so they move smoothly. */
  private syncMissiles(alpha: number): void {
    const scene = this.stage.scene;
    const flying = new Set<number>();
    for (const missile of this.world.projectiles) {
      flying.add(missile.id);
      let view = this.missileViews.get(missile.id);
      if (!view) {
        view = missileModel(missile.kind, missile.splash > 0, missile.charged);
        view.rotation.y = Math.atan2(missile.dir.x, missile.dir.y);
        this.missileViews.set(missile.id, view);
        scene.add(view);
      }
      const ahead = (missile.speed * TICK_MS * alpha) / 1000;
      view.position.set((missile.pos.x + missile.dir.x * ahead) * TILE, 1.25, (missile.pos.y + missile.dir.y * ahead) * TILE);
    }
    for (const [id, view] of this.missileViews) {
      if (flying.has(id)) continue;
      scene.remove(view);
      disposeTree(view);
      this.missileViews.delete(id);
    }
  }

  // ---------------------------------------------------------------- input

  private bindInput(): void {
    const canvas = this.stage.canvas;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointermove', (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.pointer.over = true;
    });
    canvas.addEventListener('pointerleave', () => {
      this.pointer.over = false;
    });
    canvas.addEventListener('pointerdown', (e) => {
      unlockSound();
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      if (this.paused || !this.ready) return;
      canvas.setPointerCapture(e.pointerId);
      this.pointerHeld = true;
      this.holdTimer = 0;
      // A click on a thing on the ground: walk to it and pick it up.
      const loot = e.button === 0 ? this.lootAt(e.clientX, e.clientY) : null;
      if (loot) {
        this.pickId = loot.id;
        this.lockedId = null;
        this.pickTimer = 1e9;
        this.pointerHeld = false;
        return;
      }
      // A click on a monster picks it as the target: the hero goes after it and keeps striking.
      const picked = e.button === 0 ? this.monsterAt(e.clientX, e.clientY) : null;
      this.pickId = null;
      if (picked) {
        if (!this.peaceful) this.lockedId = picked.id;
        this.targetId = picked.id;
        this.targetUntil = performance.now() + TARGET_MEMORY_MS;
        this.pointerHeld = false;
        return;
      }
      this.lockedId = null;
      this.orderMoveTo(e.clientX, e.clientY);
    });
    const release = () => {
      this.pointerHeld = false;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.stage.distance = THREE.MathUtils.clamp(this.stage.distance * Math.exp(e.deltaY * 0.001), 7, 38);
    }, { passive: false });

    // Listening on the window keeps controls working even when a HUD button has focus.
    window.addEventListener('keydown', (event) => {
      unlockSound();
      const skill = SKILL_SLOT_BY_KEY.get(event.code);
      const command = COMMAND_KEYS[event.code];
      const known =
        event.code in KEY_DIRECTIONS || event.code === ATTACK_KEY || event.code === INVENTORY_KEY || event.code === CANCEL_KEY ||
        event.code === INTERACT_KEY || event.code === PICKUP_KEY || skill !== undefined || command !== undefined;
      if (!known || this.paused || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === INVENTORY_KEY) {
        if (!event.repeat) this.events.onToggleInventory();
        return;
      }
      if (event.code === CANCEL_KEY) {
        this.lockedId = null;
        this.targetId = null;
        return;
      }
      if (skill !== undefined) {
        if (!event.repeat) this.useSkillSlot(skill, true);
        return;
      }
      if (event.code === INTERACT_KEY) {
        if (!event.repeat) this.events.onInteract();
        return;
      }
      if (event.code === PICKUP_KEY) {
        if (!event.repeat) this.pickNearest();
        return;
      }
      if (command !== undefined) {
        if (!event.repeat) this.pending.push(command);
        return;
      }
      if (event.code === ATTACK_KEY && event.target instanceof HTMLButtonElement) return;
      event.preventDefault();
      if (this.heldKeys.has(event.code)) return;
      this.heldKeys.add(event.code);
      if (event.code === ATTACK_KEY) this.targetNext();
      else this.sendKeyDirection();
    });
    window.addEventListener('keyup', (event) => {
      if (this.heldKeys.delete(event.code) && event.code !== ATTACK_KEY) this.sendKeyDirection();
    });
    window.addEventListener('blur', () => {
      if (this.heldKeys.size === 0) return;
      this.heldKeys.clear();
      this.sendKeyDirection();
    });
  }

  /** Space: fight the current target, or pick the nearest monster and fight it. */
  private targetNext(): void {
    if (this.peaceful) return;
    const current = this.lockedMonster() ?? this.rememberedTarget();
    const next = current ?? this.nearestMonster(AUTO_AIM_RANGE + 7);
    if (next) {
      this.lockedId = next.id;
      this.targetId = next.id;
      this.targetUntil = performance.now() + TARGET_MEMORY_MS;
    } else if (this.world.player.attackCooldown === 0) {
      const dir = this.autoAim();
      this.pending.push({ type: 'attack', dx: dir.x, dy: dir.y });
    }
  }

  private readHeldInput(delta: number): void {
    if (this.pointerHeld && !this.hasDirectionKeys()) {
      // Holding the button keeps the hero walking towards the pointer.
      this.holdTimer += delta;
      if (this.holdTimer >= HOLD_REPEAT_MS) {
        this.holdTimer = 0;
        this.orderMoveTo(this.pointer.x, this.pointer.y);
      }
    }
    if (this.hasDirectionKeys()) {
      this.lockedId = null;
      this.pickId = null;
    }
    this.fightLocked(delta);
    this.collect(delta);
  }

  /** Z: the nearest thing on the ground within reach of a short walk. */
  private pickNearest(): void {
    const { pos } = this.world.player;
    let best: GroundLoot | null = null;
    let bestDistance = PICKUP_SEARCH;
    for (const loot of this.world.loot) {
      const d = Math.hypot(loot.pos.x - pos.x, loot.pos.y - pos.y);
      if (d < bestDistance) {
        best = loot;
        bestDistance = d;
      }
    }
    if (!best) return;
    this.pickId = best.id;
    this.lockedId = null;
    this.pickTimer = 1e9;
  }

  /**
   * Walks to the thing the hero was told to pick up and picks it up once within reach,
   * as a player would: the rules only take it when he stands next to it.
   */
  private collect(delta: number): void {
    if (this.pickId === null) return;
    const loot = this.world.loot.find((l) => l.id === this.pickId);
    if (!loot || !isAlive(this.world) || this.lockedId !== null) {
      this.pickId = null;
      return;
    }
    const { pos } = this.world.player;
    if (Math.hypot(loot.pos.x - pos.x, loot.pos.y - pos.y) <= LOOT_PICKUP_RADIUS - 0.1) {
      this.pending.push({ type: 'pickUp', id: loot.id });
      this.pickId = null;
      return;
    }
    this.pickTimer += delta;
    if (this.pickTimer >= 200) {
      this.pickTimer = 0;
      this.pending.push({ type: 'moveTo', x: loot.pos.x, y: loot.pos.y });
    }
  }

  /** The thing on the ground drawn under a screen point, if any. */
  private lootAt(clientX: number, clientY: number): GroundLoot | null {
    let best: GroundLoot | null = null;
    let bestDistance = LOOT_PICK_PX;
    for (const loot of this.world.loot) {
      const p = at(loot.pos).setY(0.15);
      if (!this.stage.project(p, this.screen)) continue;
      const d = Math.hypot(this.screen.x - clientX, this.screen.y - clientY);
      if (d < bestDistance) {
        best = loot;
        bestDistance = d;
      }
    }
    return best;
  }

  private lockedMonster(): Monster | null {
    if (this.lockedId === null) return null;
    return this.world.monsters.find((m) => m.id === this.lockedId) ?? null;
  }

  private rememberedTarget(): Monster | null {
    if (this.targetId === null || performance.now() > this.targetUntil) return null;
    return this.world.monsters.find((m) => m.id === this.targetId) ?? null;
  }

  private nearestMonster(within: number, hostileOnly = false): Monster | null {
    const { pos } = this.world.player;
    let best: Monster | null = null;
    let bestDistance = within;
    for (const monster of this.world.monsters) {
      if (hostileOnly && !monster.aggro) continue;
      const d = Math.hypot(monster.pos.x - pos.x, monster.pos.y - pos.y);
      if (d < bestDistance) {
        best = monster;
        bestDistance = d;
      }
    }
    return best;
  }

  /** The monster drawn under a screen point: whichever body's middle is closest, within reach of the cursor. */
  private monsterAt(clientX: number, clientY: number): Monster | null {
    let best: Monster | null = null;
    let bestDistance = PICK_RADIUS_PX;
    for (const monster of this.world.monsters) {
      const view = this.monsters.get(monster.id);
      const p = view ? view.actor.object.position.clone() : at(monster.pos);
      p.y += 0.55 * (view?.actor.object.scale.y ?? 1);
      if (!this.stage.project(p, this.screen)) continue;
      const d = Math.hypot(this.screen.x - clientX, this.screen.y - clientY);
      if (d < bestDistance) {
        best = monster;
        bestDistance = d;
      }
    }
    return best;
  }

  /** The point on the ground under a screen point, in tile units. */
  private groundUnder(clientX: number, clientY: number): Point | null {
    if (!this.terrain) return null;
    const hit = this.stage.rayAt(clientX, clientY).intersectObject(this.terrain.ground)[0];
    return hit ? { x: hit.point.x / TILE, y: hit.point.z / TILE } : null;
  }

  /**
   * Keeps fighting the picked monster: walks into reach, strikes whenever the weapon is
   * ready, and when it falls turns to whoever else is attacking. Only a hand on the same
   * controls a player has.
   */
  private fightLocked(delta: number): void {
    const { player } = this.world;
    if (this.lockedId === null) return;
    if (!isAlive(this.world) || this.peaceful) {
      this.lockedId = null;
      return;
    }
    let target = this.lockedMonster();
    if (!target) {
      target = this.nearestMonster(8, true);
      this.lockedId = target?.id ?? null;
      if (!target) return;
      this.targetId = target.id;
      this.targetUntil = performance.now() + TARGET_MEMORY_MS;
    }
    const dx = target.pos.x - player.pos.x;
    const dy = target.pos.y - player.pos.y;
    const distance = Math.hypot(dx, dy);
    const held = weaponInHand(player);
    const reach = held === 'bow' ? 6.5 : held === 'staff' ? 5.5 : PLAYER_ATTACK_RANGE + 0.15;
    this.lockTimer += delta;
    if (distance <= reach) {
      if (isMoving(this.world)) this.pending.push({ type: 'moveTo', x: player.pos.x, y: player.pos.y });
      if (player.attackCooldown === 0 && player.pendingAttack === null) this.pending.push({ type: 'attack', dx, dy });
    } else if (this.lockTimer >= 200) {
      this.lockTimer = 0;
      this.pending.push({ type: 'moveTo', x: target.pos.x, y: target.pos.y });
    }
  }

  private hasDirectionKeys(): boolean {
    for (const code of this.heldKeys) if (code in KEY_DIRECTIONS) return true;
    return false;
  }

  private orderMoveTo(clientX: number, clientY: number): void {
    const ground = this.groundUnder(clientX, clientY);
    if (!ground || !isAlive(this.world) || !isWalkable(this.world.map, Math.round(ground.x), Math.round(ground.y))) return;
    this.pending.push({ type: 'moveTo', x: ground.x, y: ground.y });
    this.effects.marker.position.set(ground.x * TILE, 0.05, ground.y * TILE);
    this.effects.marker.visible = true;
  }

  private autoAim(): Point {
    const { pos, facing } = this.world.player;
    let dir = facing;
    let best = AUTO_AIM_RANGE;
    for (const monster of this.world.monsters) {
      const d = Math.hypot(monster.pos.x - pos.x, monster.pos.y - pos.y);
      if (d < best && d > 0) {
        best = d;
        dir = { x: monster.pos.x - pos.x, y: monster.pos.y - pos.y };
      }
    }
    return dir;
  }

  /** WASD in screen directions. The camera looks along the old isometric diagonal. */
  private sendKeyDirection(): void {
    let sx = 0;
    let sy = 0;
    for (const code of this.heldKeys) {
      const d = KEY_DIRECTIONS[code];
      if (!d) continue;
      sx += d[0];
      sy += d[1];
    }
    sx = Math.sign(sx);
    sy = Math.sign(sy);
    this.pending.push({ type: 'moveDir', dx: (sx + sy) / 2, dy: (sy - sx) / 2 });
    if (sx !== 0 || sy !== 0) this.effects.marker.visible = false;
  }

  // ---------------------------------------------------------------- after each tick

  private afterTick(): void {
    let checkpoint = false;
    for (const event of this.world.events) checkpoint = this.showEvent(event) || checkpoint;
    const moving = isMoving(this.world);
    if (this.wasMoving && !moving) {
      this.effects.marker.visible = false;
      checkpoint = true;
    }
    this.wasMoving = moving;
    if (this.world.player.revision !== this.savedRevision) {
      this.savedRevision = this.world.player.revision;
      this.syncHeroLook();
      checkpoint = true;
    }
    this.reportStats();
    this.events.onTick(this.world);
    if (checkpoint) this.events.onCheckpoint(this.world);
  }

  private reportStats(): void {
    const { hp, mp, revision } = this.world.player;
    const stats = `${hp}/${mp}/${this.world.monsters.length}/${revision}`;
    if (stats === this.lastStats) return;
    this.lastStats = stats;
    this.events.onStats(this.world);
  }

  private heroChest(): THREE.Vector3 {
    return (this.hero?.position.clone() ?? at(this.world.player.pos)).setY(1.3);
  }

  /** Plays the visual for one rule event. Returns true when the game should be saved. */
  private showEvent(event: GameEvent): boolean {
    const hero = this.hero!;
    const heroAt = at(this.world.player.pos);
    const dir = (p: Point) => new THREE.Vector3(p.x, 0, p.y);
    switch (event.type) {
      case 'playerSwing':
        this.lastFight = performance.now();
        hero.attack(PLAYER_ATTACK_WINDUP * TICK_MS / 1000);
        sound.swing();
        if (event.charged) this.effects.burst(this.heroChest(), CHARGE_COLOR, 14, 2.5);
        return false;
      case 'playerShot':
        hero.attack(PLAYER_ATTACK_WINDUP * TICK_MS / 1000);
        sound.shot(this.world.player.cls === 'mage');
        if (event.charged) this.effects.burst(this.heroChest(), CHARGE_COLOR, 14, 2.5);
        return false;
      case 'projectileEnded':
        this.effects.burst(at(event.pos).setY(1.2), event.kind === 'bolt' ? 0xb9a0ff : 0xe8d9b0, 8, 2);
        return false;
      case 'equipDenied':
        this.events.onNotice(event);
        return false;
      case 'skillUsed': {
        const { effect } = SKILLS[event.id];
        if (effect.kind === 'nova') {
          this.effects.swing(heroAt, dir(event.dir), Math.PI * 2, effect.radius * TILE, 0x9fe0ff);
          hero.attack(PLAYER_ATTACK_WINDUP * TICK_MS / 1000);
        }
        if (effect.kind === 'haste') this.effects.ring(heroAt, 0x9ff0d0);
        if (effect.kind === 'shot') hero.attack(PLAYER_ATTACK_WINDUP * TICK_MS / 1000);
        if (effect.kind === 'strike') {
          this.effects.swing(heroAt, dir(event.dir), effect.arc, effect.range * TILE, event.charged ? CHARGE_COLOR : 0xffb347);
          hero.attack(PLAYER_ATTACK_WINDUP * TICK_MS / 1000);
        }
        return false;
      }
      case 'playerHealed':
        this.effects.float(this.events.formatNumber(event.amount), this.heroChest().setY(2.1), '#7fe0a0');
        this.effects.ring(heroAt, 0x7fe0a0);
        return false;
      case 'xpGained':
        this.events.onXp(event.amount);
        if (this.world.player.streak >= 2) this.effects.float(this.events.streakText(this.world.player.streak), this.heroChest().setY(2.5), '#e8c36a', 13);
        return false;
      case 'levelUp':
        sound.levelUp();
        this.effects.ring(heroAt, 0xe8c36a);
        this.effects.burst(this.heroChest(), 0xe8c36a, 24, 3);
        this.events.onLevelUp(event.level, event.unlocked);
        return true;
      case 'skillDenied':
        this.events.onSkillDenied(event.id, event.reason);
        return false;
      case 'itemUsed':
        sound.potion();
        return true;
      case 'bought':
      case 'sold':
      case 'masteryUp':
      case 'skillLearned':
      case 'recipeLearned':
      case 'crafted':
      case 'craftFailed':
      case 'enchanted':
      case 'enchantFailed':
      case 'crystallized':
        this.events.onNotice(event);
        return true;
      case 'useDenied':
      case 'chargesEmpty':
      case 'tradeDenied':
      case 'learnDenied':
      case 'recipeDenied':
      case 'craftDenied':
      case 'enchantDenied':
      case 'crystallizeDenied':
        this.events.onNotice(event);
        return false;
      case 'guardStrike': {
        const p = at(event.pos).setY(1);
        this.effects.float(this.events.formatNumber(event.damage), p.clone().setY(1.6), '#cfd3dc');
        this.effects.burst(p, 0xffffff, 10, 3);
        return false;
      }
      case 'monsterHit': {
        const view = this.monsters.get(event.id);
        const p = (view ? view.actor.object.position.clone() : at(event.pos)).setY(0.8);
        this.effects.float(this.events.formatNumber(event.damage), p.clone().setY(event.crit ? 1.7 : 1.4), event.crit ? '#ff9a3c' : '#ffe9a8', event.crit ? 26 : 18);
        if (event.crit) this.stage.shake(0.08, 0.12);
        const grunt = this.world.monsters.find((m) => m.id === event.id)?.kind === 'grunt';
        this.effects.burst(p, grunt ? 0x5a6b3a : 0x9c1f1a, event.crit || event.died ? 16 : 9, 2.6);
        this.effects.burst(p.clone().setY(1), 0xfff0c0, 6, 3.5);
        sound.hit(event.crit);
        if (event.died) sound.kill();
        if (view) {
          if (view.actor instanceof Beast) view.actor.hit();
          else view.actor.hurt();
        }
        this.targetId = event.id;
        this.targetUntil = performance.now() + TARGET_MEMORY_MS;
        return event.died;
      }
      case 'monsterWindup':
        return false;
      case 'playerHit':
        sound.hurt();
        this.effects.burst(this.heroChest(), 0x9c1f1a, 9, 2.4);
        this.effects.float(this.events.formatNumber(event.damage), this.heroChest().setY(2.1), '#ff7a6b');
        hero.hurt();
        this.lastFight = performance.now();
        this.stage.shake(0.12, 0.18);
        return false;
      case 'playerDied':
        sound.death();
        this.lockedId = null;
        this.effects.marker.visible = false;
        hero.die();
        this.events.onDeath(this.world, event.xpLost);
        return true;
      case 'playerRespawned':
        this.events.onRespawn();
        return false;
      case 'travel':
        this.events.onTravel(event.to);
        return false;
      case 'lootDropped':
        return false;
      case 'itemPicked':
        if (event.itemId === 'coins') sound.coins();
        else if (event.quality === 'rare' || event.quality === 'epic' || isUnique(event.itemId)) sound.treasure();
        else sound.pickup();
        this.events.onPickup(event.itemId, event.count, event.quality ?? null);
        return true;
      case 'inventoryFull':
        this.events.onInventoryFull();
        return false;
    }
  }

  /**
   * The target is the locked monster, else the one under the cursor, else the one hit
   * last. It gets a red ring on the ground; the one under the cursor a gold one.
   */
  private updateTarget(): void {
    const hover = this.pointer.over && !this.pointerHeld ? this.monsterAt(this.pointer.x, this.pointer.y) : null;
    const target = this.lockedMonster() ?? hover ?? this.rememberedTarget();
    const ringFor = (m: Monster | null, ring: THREE.Mesh) => {
      const view = m ? this.monsters.get(m.id) : undefined;
      ring.visible = !!view;
      if (view) {
        ring.position.set(view.actor.object.position.x, 0.05, view.actor.object.position.z);
        ring.scale.setScalar(view.actor.object.scale.x * (m!.kind === 'grunt' ? 1 : 1.25));
      }
    };
    ringFor(target, this.effects.targetRing);
    ringFor(hover && hover !== target ? hover : null, this.effects.hoverRing);
    const overLoot = !hover && this.pointer.over && !this.pointerHeld && this.lootAt(this.pointer.x, this.pointer.y) !== null;
    this.stage.canvas.style.cursor = hover ? 'crosshair' : overLoot ? 'pointer' : 'default';

    const shown = target ? `${target.id}/${target.hp}` : '';
    if (shown === this.shownTarget) return;
    this.shownTarget = shown;
    this.events.onTarget(target);
  }
}

/** A villager's clothes colour as a gentle tint over the shared model. */
function blend(color: number): THREE.Color {
  return new THREE.Color(color).lerp(new THREE.Color(1, 1, 1), 0.55);
}

/** Small things lying on the ground; equipment glows in the colour of its quality. */
function lootModel(loot: GroundLoot): THREE.Group {
  const holder = new THREE.Group();
  const inner = new THREE.Group();
  holder.add(inner);
  const def = ITEMS[loot.itemId];
  const mesh = (geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, emissive = 0) =>
    new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2, emissive: new THREE.Color(color), emissiveIntensity: emissive }));
  if (def.kind === 'currency') {
    for (let i = 0; i < 4; i++) {
      const coin = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.025, 12), 0xf2c94c, 0.25);
      coin.position.set((i % 2) * 0.08 - 0.04, 0.02 + i * 0.026, Math.floor(i / 2) * 0.06 - 0.03);
      inner.add(coin);
    }
    inner.rotation.y = loot.id;
  } else if (def.kind === 'material') {
    const sack = mesh(new THREE.SphereGeometry(0.16, 10, 8), 0x8a6a45);
    sack.scale.set(1, 0.8, 1);
    sack.position.y = 0.12;
    inner.add(sack);
  } else if (def.kind === 'recipe' || def.kind === 'scroll') {
    const roll = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 10), 0xe8dcc0, 0.15);
    roll.rotation.z = Math.PI / 2;
    roll.position.y = 0.06;
    inner.add(roll);
    holder.userData.float = true;
  } else if (def.kind === 'consumable') {
    const color = def.effect.kind === 'heal' ? 0xd9534f : def.effect.kind === 'mana' ? 0x4f8fe0 : CHARGE_COLOR;
    const flask = mesh(new THREE.SphereGeometry(0.1, 12, 10), color, 0.6);
    flask.position.y = 0.1;
    const neck = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8), 0xcfd3dc);
    neck.position.y = 0.22;
    inner.add(flask, neck);
  } else {
    const quality = loot.mods?.quality ?? 'common';
    const color = QUALITY_COLOR[quality];
    const gem = mesh(new THREE.OctahedronGeometry(0.16, 0), color, quality === 'common' ? 0.4 : 1.4);
    gem.scale.set(1, 1.4, 1);
    inner.add(gem);
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(quality === 'epic' ? 0.7 : quality === 'rare' ? 0.55 : 0.4, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.04;
    holder.add(glow);
    holder.userData.float = true;
  }
  inner.traverse((o) => {
    o.castShadow = true;
  });
  return holder;
}

function missileModel(kind: 'arrow' | 'bolt', splash: boolean, charged: boolean): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'arrow') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.75, 6), new THREE.MeshStandardMaterial({ color: charged ? CHARGE_COLOR : 0xd8c9a0, emissive: charged ? CHARGE_COLOR : 0x000000 }));
    shaft.rotation.x = Math.PI / 2;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 6), new THREE.MeshStandardMaterial({ color: 0xcfd3dc, metalness: 0.8, roughness: 0.3 }));
    tip.rotation.x = Math.PI / 2;
    tip.position.z = 0.42;
    g.add(shaft, tip);
  } else {
    const color = splash ? 0xff8a3d : charged ? CHARGE_COLOR : 0xb9a0ff;
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 3 }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }));
    const light = new THREE.PointLight(color, 3, 5, 1.6);
    g.add(core, halo, light);
  }
  return g;
}
