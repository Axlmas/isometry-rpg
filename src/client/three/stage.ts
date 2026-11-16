import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Renderer, camera, light, fog and post-processing. Pure code, tuned independently of
// the models. The camera looks down the same diagonal as the old isometric view, so
// "up" on the screen is still towards smaller x and y in the rules' coordinates.

export const CAMERA_AZIMUTH = THREE.MathUtils.degToRad(45);
const CAMERA_ELEVATION = THREE.MathUtils.degToRad(42);

export type Mood = 'overworld' | 'dungeon';

const MOODS: Record<Mood, { fog: string; near: number; far: number; sun: number; sky: string; ground: string; hemi: number; env: number; torch: number }> = {
  overworld: { fog: '#9aa3a6', near: 28, far: 70, sun: 2.2, sky: '#c3cfdd', ground: '#3e3628', hemi: 0.9, env: 0.45, torch: 0 },
  dungeon: { fog: '#0d0f12', near: 10, far: 32, sun: 0.3, sky: '#6a7080', ground: '#1c1814', hemi: 0.5, env: 0.2, torch: 110 },
};

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.5, 260);
  readonly canvas: HTMLCanvasElement;
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  /** Warm light that travels with the hero underground. */
  private readonly torch: THREE.PointLight;
  private readonly fog: THREE.Fog;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly focus = new THREE.Vector3();
  private shakeLeft = 0;
  private shakeStrength = 0;
  /**
   * Render resolution as a share of the screen's pixels. It adapts to the machine: down
   * a step when frames take too long, up a step when there is time to spare.
   */
  private pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  private readonly maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  private frameTimes: number[] = [];
  /** The first seconds compile shaders and upload textures: they say nothing about the machine. */
  private warmUp = 3;
  /** Highest resolution allowed: once a level proved too slow, the screen never goes back to it. */
  private ceiling = this.maxPixelRatio;
  /** Seconds-long stretches in a row with time to spare; a step up needs several. */
  private calm = 0;
  distance = 22;

  constructor(private readonly container: HTMLElement) {
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(this.pixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    // Several passes render per frame; count them all, reset once per frame in render().
    renderer.info.autoReset = false;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.canvas = renderer.domElement;
    this.canvas.style.display = 'block';
    this.canvas.style.touchAction = 'none';

    const scene = this.scene;
    this.fog = new THREE.Fog(MOODS.overworld.fog, 28, 70);
    scene.fog = this.fog;
    scene.background = new THREE.Color(MOODS.overworld.fog);

    // Soft image-based light so metal armour has something to reflect.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.hemi = new THREE.HemisphereLight(MOODS.overworld.sky, MOODS.overworld.ground, 0.9);
    scene.add(this.hemi);

    const sun = new THREE.DirectionalLight('#fff0dc', 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -18; sc.right = 18; sc.top = 18; sc.bottom = -18; sc.near = 1; sc.far = 80;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    this.sun = sun;

    this.torch = new THREE.PointLight('#ffb36b', 0, 22, 1.3);
    this.torch.castShadow = false;
    scene.add(this.torch);

    const target = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.5, 0.9);
    composer.addPass(this.bloom);
    composer.addPass(new ShaderPass(GradeShader));
    composer.addPass(new OutputPass());
    this.composer = composer;

    this.setMood('overworld');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setMood(mood: Mood): void {
    const m = MOODS[mood];
    this.fog.color.set(m.fog);
    this.fog.near = m.near;
    this.fog.far = m.far;
    (this.scene.background as THREE.Color).set(m.fog);
    this.sun.intensity = m.sun;
    this.hemi.color.set(m.sky);
    this.hemi.groundColor.set(m.ground);
    this.hemi.intensity = m.hemi;
    this.scene.environmentIntensity = m.env;
    this.torch.intensity = m.torch;
  }

  /** Keeps the camera, the sun's shadow box and the torch on a point (the hero). */
  follow(point: THREE.Vector3, dt: number): void {
    // Locked on the hero, as in classic MMORPGs: a trailing camera makes every start look
    // like a lurch forward. Positions are already smoothed between rule ticks.
    this.focus.copy(point);
    const d = this.distance;
    const f = this.focus;
    this.camera.position.set(
      f.x + Math.sin(CAMERA_AZIMUTH) * Math.cos(CAMERA_ELEVATION) * d,
      f.y + Math.sin(CAMERA_ELEVATION) * d,
      f.z + Math.cos(CAMERA_AZIMUTH) * Math.cos(CAMERA_ELEVATION) * d,
    );
    if (this.shakeLeft > 0) {
      this.shakeLeft = Math.max(0, this.shakeLeft - dt);
      const s = this.shakeStrength * (this.shakeLeft > 0 ? 1 : 0);
      this.camera.position.x += (Math.random() - 0.5) * s; // cosmetic only
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(f.x, f.y + 0.9, f.z);
    this.sun.position.set(f.x - 12, f.y + 22, f.z + 9);
    this.sun.target.position.copy(f);
    this.torch.position.set(point.x, point.y + 2.4, point.z);
  }

  snapTo(point: THREE.Vector3): void {
    this.focus.copy(point);
    this.follow(point, 0);
  }

  shake(seconds: number, strength: number): void {
    this.shakeLeft = Math.max(this.shakeLeft, seconds);
    this.shakeStrength = strength;
  }

  render(dt = 0): void {
    // A new resolution is applied before drawing. Resizing the canvas clears it: done after
    // drawing, the player would see one empty, dark frame.
    this.adapt(dt);
    this.renderer.info.reset();
    this.composer.render();
  }

  /**
   * Steps the resolution down when frames run below ~45 a second, and up again only after
   * several calm stretches and never back to a level that was too slow, so it settles
   * instead of seesawing.
   */
  private adapt(dt: number): void {
    if (dt <= 0 || document.hidden) return;
    if (this.warmUp > 0) {
      this.warmUp -= dt;
      return;
    }
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const typical = sorted[Math.floor(sorted.length * 0.6)]!;
    this.frameTimes = [];
    let next = this.pixelRatio;
    if (typical > 1 / 45) {
      this.calm = 0;
      this.ceiling = Math.min(this.ceiling, this.pixelRatio - 0.05);
      next = Math.max(0.75, this.pixelRatio - 0.15);
    } else if (typical < 1 / 58 && ++this.calm >= 3) {
      this.calm = 0;
      next = Math.min(this.ceiling, this.pixelRatio + 0.1);
    }
    if (Math.abs(next - this.pixelRatio) < 0.01) return;
    this.setResolution(next);
  }

  /**
   * Render resolution as a share of the screen's pixels. The post-processing chain keeps its
   * own copy of it: both are changed together, or the scene would still be drawn at the old
   * size and anything placed in screen pixels (the see-through circle) would drift.
   */
  setResolution(ratio: number): void {
    this.pixelRatio = ratio;
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    this.resize();
  }

  /** Current render resolution share, for the stats readout. */
  get resolution(): number {
    return this.pixelRatio;
  }

  /** Size in pixels of the image the scene is drawn into: the space of `gl_FragCoord`. */
  sceneSize(out: THREE.Vector2): THREE.Vector2 {
    return out.set(this.composer.renderTarget1.width, this.composer.renderTarget1.height);
  }

  /** Screen pixel position of a point in the world, or null when it is behind the camera. */
  project(point: THREE.Vector3, out: { x: number; y: number }): boolean {
    const v = point.clone().project(this.camera);
    if (v.z > 1) return false;
    const rect = this.canvas.getBoundingClientRect();
    out.x = rect.left + (v.x * 0.5 + 0.5) * rect.width;
    out.y = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
    return true;
  }

  /** The ray from the camera through a screen pixel. */
  rayAt(clientX: number, clientY: number, ray = new THREE.Raycaster()): THREE.Raycaster {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, this.camera);
    return ray;
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}

/** A slight warm grade and muted colours — the old-MMO mood. The vignette is a HUD layer. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, 0.9);
      col *= vec3(1.02, 1.0, 0.97);
      gl_FragColor = vec4(col, c.a);
    }`,
};
