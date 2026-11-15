import * as THREE from 'three';
import { HERO, PROPS, WEAPONS, WOLF, fitToHeight, loadGltf, placeholder, prepareModel, type WeaponAsset } from './assets';
import { Hero } from './hero';
import { Stage, mulberry32 } from './stage';
import { Wolf } from './wolf';

const app = document.getElementById('app')!;
const stats = document.getElementById('stats')!;
const bar = document.getElementById('bar')!;
const loading = document.getElementById('loading')!;

const stage = new Stage(app);
const timer = new THREE.Timer();
const keys = new Set<string>();
const wolves: Wolf[] = [];
const weaponModels = new Map<string, THREE.Object3D>();
/** Tall things that turn see-through when they stand between the camera and the hero. */
const occluders: { object: THREE.Object3D; materials: THREE.Material[]; radius: number }[] = [];
let hero: Hero | null = null;
let fallback: THREE.Object3D | null = null;

async function main(): Promise<void> {
  const [heroGltf, wolfGltf, ...rest] = await Promise.allSettled([
    loadGltf(HERO.url),
    loadGltf(WOLF.url),
    ...WEAPONS.map((w) => loadGltf(w.url)),
    ...PROPS.map((p) => loadGltf(p.url)),
  ]);
  const weaponGltfs = rest.slice(0, WEAPONS.length);
  const propGltfs = rest.slice(WEAPONS.length);

  if (heroGltf.status === 'fulfilled') {
    hero = new Hero(heroGltf.value, HERO);
    stage.scene.add(hero.object);
    hero.onStrike = (position, facing) => {
      for (const wolf of wolves) {
        if (!wolf.alive) continue;
        const to = wolf.position.clone().sub(position).setY(0);
        const d = to.length();
        if (d < 2.4 && to.normalize().dot(facing) > 0.3) wolf.hit(position);
      }
    };
  } else {
    console.error('hero failed to load', heroGltf.reason);
    fallback = placeholder(HERO.height, '#8a6a4a');
    stage.scene.add(fallback);
  }

  WEAPONS.forEach((asset, i) => {
    const result = weaponGltfs[i];
    if (result?.status === 'fulfilled') weaponModels.set(asset.id, result.value.scene);
    else console.error(`weapon ${asset.id} failed to load`, result?.status === 'rejected' ? result.reason : '');
  });
  buildWeaponBar();
  equip(WEAPONS[0]!);

  if (wolfGltf.status === 'fulfilled') {
    const rnd = mulberry32(3);
    const homes = [new THREE.Vector3(7, 0, -5), new THREE.Vector3(-4, 0, -9), new THREE.Vector3(9, 0, 6)];
    for (const home of homes) {
      const wolf = new Wolf(wolfGltf.value, WOLF.height, home, rnd);
      wolf.onBite = () => hero?.hurt();
      wolves.push(wolf);
      stage.scene.add(wolf.object);
    }
  } else {
    console.error('wolf failed to load', wolfGltf.reason);
  }

  const props = new Map<string, THREE.Object3D>();
  PROPS.forEach((asset, i) => {
    const result = propGltfs[i];
    if (result?.status === 'fulfilled') {
      prepareModel(result.value.scene);
      props.set(asset.id, fitToHeight(result.value.scene, asset.height));
    } else {
      console.error(`prop ${asset.id} failed to load`, result?.status === 'rejected' ? result.reason : '');
    }
  });
  placeProps(props);

  loading.remove();
  stage.snapTo(heroPosition());
  bindInput();
  frame();
}

/** Hand-placed layout: a grove, scattered boulders and a ring of standing stones. */
function placeProps(props: Map<string, THREE.Object3D>): void {
  const rnd = mulberry32(21);
  const put = (id: string, x: number, z: number, scale: number, occludes = false) => {
    const proto = props.get(id);
    if (!proto) return;
    const obj = proto.clone();
    obj.position.set(x, 0, z);
    obj.rotation.y = rnd() * Math.PI * 2;
    obj.scale.setScalar(scale);
    stage.scene.add(obj);
    if (occludes) {
      const materials: THREE.Material[] = [];
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const own = (mesh.material as THREE.Material).clone();
        own.transparent = true;
        mesh.material = own;
        materials.push(own);
      });
      occluders.push({ object: obj, materials, radius: 2.2 * scale });
    }
  };

  const oaks: [number, number][] = [[-12, -4], [-15, 3], [-9, -14], [4, -16], [14, -12], [-20, -12], [18, 2], [-3, 17], [12, 15], [22, -6]];
  for (const [x, z] of oaks) put('oak', x + rnd() * 2, z + rnd() * 2, 0.8 + rnd() * 0.45, true);

  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 5 + rnd() * 26;
    put('boulder', Math.cos(a) * r, Math.sin(a) * r, 0.4 + rnd() * rnd() * 1.4);
  }

  const ring = new THREE.Vector3(-7, 0, 7);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rnd() * 0.2;
    put('menhir', ring.x + Math.cos(a) * 3.6, ring.z + Math.sin(a) * 3.6, 0.8 + rnd() * 0.35, true);
  }
}

function heroPosition(): THREE.Vector3 {
  return hero?.position ?? fallback?.position ?? new THREE.Vector3();
}

function equip(asset: WeaponAsset): void {
  const model = weaponModels.get(asset.id);
  hero?.equip(model ? model.clone() : null, asset);
  for (const b of bar.querySelectorAll('button')) b.classList.toggle('on', b.dataset.id === asset.id);
}

function buildWeaponBar(): void {
  WEAPONS.forEach((asset, i) => {
    const b = document.createElement('button');
    b.textContent = `${i + 1} ${asset.name}`;
    b.dataset.id = asset.id;
    b.disabled = !weaponModels.has(asset.id);
    b.addEventListener('click', () => equip(asset));
    bar.appendChild(b);
  });
  const strike = document.createElement('button');
  strike.textContent = 'Удар';
  strike.addEventListener('click', () => hero?.attack());
  bar.appendChild(strike);
}

function bindInput(): void {
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    keys.add(k);
    if (k === ' ') { e.preventDefault(); hero?.attack(); }
    const asset = WEAPONS[Number(k) - 1];
    if (asset && weaponModels.has(asset.id)) equip(asset);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  stage.renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, stage.camera);
    const hit = ray.intersectObject(stage.ground)[0];
    if (hit) hero?.moveTo(hit.point);
  });
  stage.renderer.domElement.addEventListener('wheel', (e) => {
    e.preventDefault();
    stage.distance = THREE.MathUtils.clamp(stage.distance * Math.exp(e.deltaY * 0.001), 5, 30);
  }, { passive: false });
}

/** WASD in screen directions: the camera looks diagonally across the world. */
function keyDirection(): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(45);
  const forward = new THREE.Vector3(-Math.sin(az), 0, -Math.cos(az));
  const right = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
  const d = new THREE.Vector3();
  if (keys.has('w') || keys.has('arrowup')) d.add(forward);
  if (keys.has('s') || keys.has('arrowdown')) d.sub(forward);
  if (keys.has('d') || keys.has('arrowright')) d.add(right);
  if (keys.has('a') || keys.has('arrowleft')) d.sub(right);
  return d;
}

/** Fades trees and stones that hide the hero from the camera. */
function updateOccluders(dt: number): void {
  const eye = stage.camera.position;
  const target = heroPosition().clone().setY(1);
  const line = new THREE.Line3(eye, target);
  const closest = new THREE.Vector3();
  for (const o of occluders) {
    const p = o.object.position.clone().setY(1.5);
    line.closestPointToPoint(p, true, closest);
    const hides = closest.distanceTo(p) < o.radius && eye.distanceTo(p) < eye.distanceTo(target);
    for (const m of o.materials) {
      m.opacity += ((hides ? 0.3 : 1) - m.opacity) * (1 - Math.exp(-dt * 8));
      m.depthWrite = m.opacity > 0.95;
    }
  }
}

let fps = 60;
function frame(time?: number): void {
  requestAnimationFrame(frame);
  timer.update(time);
  const dt = Math.min(timer.getDelta(), 0.05);
  if (hero) {
    hero.steer(keyDirection());
    hero.update(dt);
  }
  const prey = heroPosition();
  for (const wolf of wolves) wolf.update(dt, prey);
  stage.follow(prey, dt);
  updateOccluders(dt);
  stage.render();

  if (dt > 0) fps += (1 / dt - fps) * 0.05;
  const info = stage.renderer.info.render;
  stats.textContent = `${fps.toFixed(0)} FPS · ${(info.triangles / 1000).toFixed(0)}k треуг. · ${info.calls} вызовов`;
}

main().catch((err) => {
  console.error(err);
  loading.textContent = 'Не удалось загрузить сцену. Подробности в консоли.';
});
