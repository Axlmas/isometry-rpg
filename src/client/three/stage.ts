import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Everything that is not a model: renderer, camera, light, fog, ground, post-processing.
// These layers are pure code and can be tuned independently of the assets.

const FOG_COLOR = new THREE.Color('#9aa3a6');
const CAMERA_ELEVATION = THREE.MathUtils.degToRad(40);
const CAMERA_AZIMUTH = THREE.MathUtils.degToRad(45);

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.5, 200);
  readonly sun: THREE.DirectionalLight;
  readonly ground: THREE.Mesh;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly focus = new THREE.Vector3();
  distance = 15;

  constructor(container: HTMLElement) {
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // Several passes render per frame; count them all, reset once per frame in render().
    renderer.info.autoReset = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = this.scene;
    scene.background = FOG_COLOR;
    scene.fog = new THREE.Fog(FOG_COLOR, 22, 55);

    // Soft image-based light so metal armour has something to reflect.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.45;

    scene.add(new THREE.HemisphereLight('#c3cfdd', '#3e3628', 0.9));

    const sun = new THREE.DirectionalLight('#fff0dc', 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 60;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    this.sun = sun;

    this.ground = makeGround();
    scene.add(this.ground);
    scene.add(makeRocks(), makeGrass());

    const target = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.5, 0.9);
    composer.addPass(this.bloom);
    composer.addPass(new ShaderPass(GradeShader));
    composer.addPass(new OutputPass());
    this.composer = composer;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Keeps the camera and the shadow box centred on a point (the hero). */
  follow(point: THREE.Vector3, dt: number): void {
    const k = 1 - Math.exp(-dt * 6);
    this.focus.lerp(point, k);
    const d = this.distance;
    this.camera.position.set(
      this.focus.x + Math.sin(CAMERA_AZIMUTH) * Math.cos(CAMERA_ELEVATION) * d,
      this.focus.y + Math.sin(CAMERA_ELEVATION) * d,
      this.focus.z + Math.cos(CAMERA_AZIMUTH) * Math.cos(CAMERA_ELEVATION) * d,
    );
    this.camera.lookAt(this.focus.x, this.focus.y + 0.9, this.focus.z);
    this.sun.position.set(this.focus.x - 9, this.focus.y + 16, this.focus.z + 7);
    this.sun.target.position.copy(this.focus);
  }

  snapTo(point: THREE.Vector3): void {
    this.focus.copy(point);
    this.follow(point, 0);
  }

  render(): void {
    this.renderer.info.reset();
    this.composer.render();
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}

/** Slight warm grade, a touch of contrast and a vignette — the "old MMO" mood. */
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
      col = mix(vec3(l), col, 0.9);               // slightly muted colours
      col *= vec3(1.02, 1.0, 0.97);               // slightly warm
      vec2 d = vUv - 0.5;
      col *= 1.0 - smoothstep(0.35, 0.85, length(d * vec2(1.3, 1.0))) * 0.55; // vignette
      gl_FragColor = vec4(col, c.a);
    }`,
};

function makeGround(): THREE.Mesh {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#4f5a32';
  ctx.fillRect(0, 0, size, size);
  const rnd = mulberry32(7);
  // Layers of soft blotches: dry grass, darker grass, bare earth.
  const blotch = (count: number, rMin: number, rMax: number, colors: string[], alpha: number) => {
    for (let i = 0; i < count; i++) {
      const x = rnd() * size, y = rnd() * size, r = rMin + rnd() * (rMax - rMin);
      const color = colors[Math.floor(rnd() * colors.length)]!;
      for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]] as const) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = alpha;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };
  blotch(70, 50, 140, ['#58653a', '#4a552e', '#626339'], 0.3);
  blotch(14, 25, 60, ['#6b5a3e', '#5e4f37'], 0.35);
  blotch(4000, 1, 2.5, ['#6f7a48', '#3d4624', '#5f5a3e'], 0.25);
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  tex.anisotropy = 8;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 160),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

/** Small smooth pebbles scattered on the ground; the large rocks are generated models. */
function makeRocks(): THREE.InstancedMesh {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const rnd = mulberry32(11);
  for (let v = 0; v < pos.count; v++) {
    const s = 0.85 + rnd() * 0.3;
    pos.setXYZ(v, pos.getX(v) * s, pos.getY(v) * s * 0.55, pos.getZ(v) * s);
  }
  geo.computeVertexNormals();
  const count = 160;
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#6c675d', roughness: 0.9 }), count);
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const angle = rnd() * Math.PI * 2;
    const dist = 2 + rnd() * 38;
    const s = 0.05 + rnd() * rnd() * 0.22;
    m.compose(
      new THREE.Vector3(Math.cos(angle) * dist, s * 0.15, Math.sin(angle) * dist),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * Math.PI, 0)),
      new THREE.Vector3(s, s, s * (0.7 + rnd() * 0.6)),
    );
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, color.setHSL(0.09, 0.08, 0.3 + rnd() * 0.15));
  }
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/** Tens of thousands of grass tufts in one draw call. */
function makeGrass(): THREE.InstancedMesh {
  // One tuft: five thin blades fanned out, leaning slightly.
  const verts: number[] = [];
  for (let b = 0; b < 5; b++) {
    const a = (b / 5) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    const w = 0.012;
    const h = 0.16 + (b % 3) * 0.05;
    const lean = 0.05 + (b % 2) * 0.04;
    verts.push(-dz * w, 0, dx * w, dz * w, 0, -dx * w, dx * lean, h, dz * lean);
  }
  const tuft = new THREE.BufferGeometry();
  tuft.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  tuft.computeVertexNormals();
  // Normals pointing up light the blades like the ground below them, so they blend in.
  const normals = tuft.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < normals.count; i++) normals.setXYZ(i, 0, 1, 0);
  // Base colour on the material; per-tuft colours only vary its brightness and hue a little.
  const material = new THREE.MeshStandardMaterial({ color: '#56632f', roughness: 1, side: THREE.DoubleSide });
  const count = 26000;
  const mesh = new THREE.InstancedMesh(tuft, material, count);
  const rnd = mulberry32(5);
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(rnd()) * 38;
    const a = rnd() * Math.PI * 2;
    const s = 0.6 + rnd() * 0.9;
    m.compose(
      new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r),
      new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.3, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.3)),
      new THREE.Vector3(s, s * (0.7 + rnd() * 0.6), s),
    );
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, color.setHSL(0.13 + rnd() * 0.1, 0.25, 0.65 + rnd() * 0.35));
  }
  mesh.receiveShadow = true;
  return mesh;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
