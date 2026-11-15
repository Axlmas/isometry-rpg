import * as THREE from 'three';
import type { Stage } from './stage';

// Short-lived visuals: numbers that float up, rings, the arc of a blow, sparks, and
// the markers on the ground. Text is drawn as HTML over the canvas: crisp at any zoom
// and styled like the rest of the interface.

interface Floating {
  el: HTMLElement;
  at: THREE.Vector3;
  age: number;
  life: number;
  rise: number;
}

interface Fading {
  object: THREE.Object3D;
  material: THREE.Material & { opacity: number };
  age: number;
  life: number;
  grow: number;
  from: number;
}

interface Spark {
  points: THREE.Points;
  velocities: Float32Array;
  age: number;
  life: number;
}

export class Effects {
  private readonly layer: HTMLElement;
  private readonly floating: Floating[] = [];
  private readonly labels = new Map<object, { el: HTMLElement; target: THREE.Object3D; height: number }>();
  private readonly fading: Fading[] = [];
  private readonly sparks: Spark[] = [];
  private readonly group = new THREE.Group();
  readonly targetRing: THREE.Mesh;
  readonly hoverRing: THREE.Mesh;
  readonly marker: THREE.Mesh;
  private readonly screen = { x: 0, y: 0 };

  constructor(private readonly stage: Stage, host: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'world-text';
    this.layer.setAttribute('aria-hidden', 'true');
    host.appendChild(this.layer);
    stage.scene.add(this.group);

    this.targetRing = groundRing(0.55, 0.68, 0xe0503f, 0.95);
    this.hoverRing = groundRing(0.55, 0.62, 0xe8c36a, 0.6);
    this.marker = groundRing(0.22, 0.32, 0xe8c36a, 0.9);
    for (const ring of [this.targetRing, this.hoverRing, this.marker]) {
      ring.visible = false;
      stage.scene.add(ring);
    }
  }

  /** A number or word that rises from a point and fades. */
  float(text: string, at: THREE.Vector3, color: string, size = 18): void {
    const el = document.createElement('div');
    el.className = 'world-float';
    el.textContent = text;
    el.style.color = color;
    el.style.fontSize = `${size}px`;
    this.layer.appendChild(el);
    this.floating.push({ el, at: at.clone(), age: 0, life: 0.95, rise: 46 });
  }

  /** A name kept over an object's head until removed. */
  label(key: object, text: string, target: THREE.Object3D, height: number, className = 'world-label', color?: string): void {
    this.unlabel(key);
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    if (color) el.style.color = color;
    this.layer.appendChild(el);
    this.labels.set(key, { el, target, height });
  }

  unlabel(key: object): void {
    const l = this.labels.get(key);
    if (!l) return;
    l.el.remove();
    this.labels.delete(key);
  }

  clearLabels(): void {
    for (const key of [...this.labels.keys()]) this.unlabel(key);
  }

  /** A ring that grows out from a point on the ground: healing, a new level. */
  ring(at: THREE.Vector3, color: THREE.ColorRepresentation): void {
    const mesh = groundRing(0.4, 0.55, color, 0.9);
    mesh.position.copy(at).setY(0.06);
    this.group.add(mesh);
    this.fading.push({ object: mesh, material: mesh.material as THREE.MeshBasicMaterial, age: 0, life: 0.5, grow: 3, from: 0.9 });
  }

  /** The fan of a blow on the ground. `arc` is its full width in radians. */
  swing(at: THREE.Vector3, dir: THREE.Vector3, arc: number, range: number, color: THREE.ColorRepresentation): void {
    const full = arc >= Math.PI * 2 - 1e-3;
    const geometry = new THREE.CircleGeometry(range, full ? 40 : 14, 0, full ? Math.PI * 2 : arc);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(at).setY(0.07);
    // After the turn to the ground, the circle's angle θ points along (cos θ, 0, −sin θ);
    // turning the mesh by φ adds φ to it. Centre the fan on the blow's direction.
    mesh.rotation.y = Math.atan2(-dir.z, dir.x) - (full ? 0 : arc / 2);
    this.group.add(mesh);
    this.fading.push({ object: mesh, material, age: 0, life: 0.22, grow: 0, from: 0.35 });
  }

  /** A few bright specks flying out from a blow. */
  burst(at: THREE.Vector3, color: THREE.ColorRepresentation, count = 10, speed = 3): void {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions.set([at.x, at.y, at.z], i * 3);
      const a = Math.random() * Math.PI * 2; // cosmetic only
      const up = 0.3 + Math.random();
      velocities.set([Math.cos(a) * speed, up * speed * 0.8, Math.sin(a) * speed], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color, size: 0.09, transparent: true, opacity: 1, depthWrite: false });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.group.add(points);
    this.sparks.push({ points, velocities, age: 0, life: 0.45 });
  }

  update(dt: number): void {
    for (let i = this.floating.length - 1; i >= 0; i--) {
      const f = this.floating[i]!;
      f.age += dt;
      const k = f.age / f.life;
      if (k >= 1 || !this.stage.project(f.at, this.screen)) {
        f.el.remove();
        this.floating.splice(i, 1);
        continue;
      }
      f.el.style.transform = `translate(${this.screen.x}px, ${this.screen.y - k * f.rise}px) translate(-50%, -100%)`;
      f.el.style.opacity = String(k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
    }
    for (const l of this.labels.values()) {
      const p = l.target.getWorldPosition(new THREE.Vector3());
      p.y += l.height;
      const visible = l.target.visible && this.stage.project(p, this.screen);
      l.el.style.display = visible ? '' : 'none';
      if (visible) l.el.style.transform = `translate(${this.screen.x}px, ${this.screen.y}px) translate(-50%, -100%)`;
    }
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const f = this.fading[i]!;
      f.age += dt;
      const k = f.age / f.life;
      if (k >= 1) {
        this.group.remove(f.object);
        disposeTree(f.object);
        this.fading.splice(i, 1);
        continue;
      }
      if (f.grow) f.object.scale.setScalar(1 + k * f.grow);
      f.material.opacity = f.from * (1 - k);
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]!;
      s.age += dt;
      if (s.age >= s.life) {
        this.group.remove(s.points);
        disposeTree(s.points);
        this.sparks.splice(i, 1);
        continue;
      }
      const pos = s.points.geometry.attributes.position as THREE.BufferAttribute;
      for (let j = 0; j < pos.count; j++) {
        s.velocities[j * 3 + 1]! -= 9.8 * dt;
        pos.setXYZ(j, pos.getX(j) + s.velocities[j * 3]! * dt, Math.max(0.02, pos.getY(j) + s.velocities[j * 3 + 1]! * dt), pos.getZ(j) + s.velocities[j * 3 + 2]! * dt);
      }
      pos.needsUpdate = true;
      (s.points.material as THREE.PointsMaterial).opacity = 1 - s.age / s.life;
    }
    // The rings on the ground pulse gently.
    const pulse = 1 + Math.sin(performance.now() / 180) * 0.05;
    this.targetRing.scale.setScalar(pulse);
  }

  clear(): void {
    for (const f of this.floating) f.el.remove();
    this.floating.length = 0;
    for (const f of this.fading) {
      this.group.remove(f.object);
      disposeTree(f.object);
    }
    this.fading.length = 0;
    for (const s of this.sparks) {
      this.group.remove(s.points);
      disposeTree(s.points);
    }
    this.sparks.length = 0;
    this.targetRing.visible = false;
    this.hoverRing.visible = false;
    this.marker.visible = false;
  }
}

function groundRing(inner: number, outer: number, color: THREE.ColorRepresentation, opacity: number): THREE.Mesh {
  const geometry = new THREE.RingGeometry(inner, outer, 40);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  mesh.position.y = 0.05;
  mesh.renderOrder = 2;
  return mesh;
}

export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const m of mats) m.dispose();
  });
}
