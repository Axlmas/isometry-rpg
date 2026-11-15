import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  type Point, type RegionId, type World, TILE_FLOOR, TILE_ROCK, TILE_RUIN, TILE_WATER, isRoad, regionAt, tileAt,
} from '../../sim';
import { EXIT_COLOR, REGION_LOOK, ROAD_COLOR, WATER_COLOR } from '../zoneText';
import { type Library, type PropId, TILE, bakeProp } from './assets';

// Builds the 3D world from the rules' grid. Every obstacle tile of the rules becomes
// something solid to look at (a tree, a boulder, a house, a wall), so what blocks the
// hero on screen is exactly what blocks him in the rules.

const SHORE: readonly [number, number, number] = [116, 108, 82];
const STONE_FLOOR: readonly [number, number, number] = [58, 60, 70];
/** Tiles per instancing chunk: each chunk is culled on its own when off screen. */
const CHUNK = 20;
/** Decorative forest drawn beyond the map's edge, in tiles, so the world has no visible end. */
const OUTSKIRTS = 10;

/**
 * Trees and houses between the camera and the hero dissolve in a circle around him, so
 * he is never lost behind them. The scene updates these each frame.
 */
export const SEE_THROUGH = {
  uSeeCenter: { value: new THREE.Vector2(-1e4, -1e4) },
  uSeeRadius: { value: 0 },
  uSeeDepth: { value: 0 },
};

const seeThroughDone = new WeakSet<THREE.Material>();

function seeThrough(material: THREE.Material): void {
  if (seeThroughDone.has(material)) return;
  seeThroughDone.add(material);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, SEE_THROUGH);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vSeeDepth;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSeeDepth = -mvPosition.z;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uSeeCenter;\nuniform float uSeeRadius;\nuniform float uSeeDepth;\nvarying float vSeeDepth;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (vSeeDepth < uSeeDepth - 1.2) {
          float k = 1.0 - smoothstep(uSeeRadius * 0.55, uSeeRadius, distance(gl_FragCoord.xy, uSeeCenter));
          float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (k * 0.8 > noise) discard;
        }`);
  };
  material.needsUpdate = true;
}

export interface Terrain {
  readonly group: THREE.Group;
  /** The flat ground, for turning clicks into positions. */
  readonly ground: THREE.Mesh;
  update(time: number): void;
  dispose(): void;
}

/** Stable pseudo-random numbers from tile coordinates: decoration only, never a game rule. */
function hash(x: number, y: number, n: number): number {
  const v = Math.sin(x * 127.1 + y * 311.7 + n * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

export function buildTerrain(world: World, lib: Library): Terrain {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(thing: T): T => {
    disposables.push(thing);
    return thing;
  };
  const { map, zone } = world;
  const dungeon = zone === 'dungeon';
  const regionOf = (x: number, y: number): RegionId => regionAt(zone, { x, y }).id;

  // ------------------------------------------------------------------ ground
  // One colour per tile in a small texture; bilinear filtering blends neighbours into
  // soft edges. A tiling detail texture adds grain on top, in world space.
  const margin = dungeon ? 2 : OUTSKIRTS;
  const cols = map.width + margin * 2;
  const rows = map.height + margin * 2;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = cols;
  colorCanvas.height = rows;
  const ctx = colorCanvas.getContext('2d')!;
  const image = ctx.createImageData(cols, rows);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const x = tx - margin;
      const y = ty - margin;
      const tile = tileAt(map, x, y);
      let c: readonly [number, number, number];
      if (dungeon) c = tile === TILE_FLOOR ? STONE_FLOOR : [40, 42, 50];
      else if (tile === TILE_WATER) c = [WATER_COLOR[0] * 0.6, WATER_COLOR[1] * 0.6, WATER_COLOR[2] * 0.6];
      else if (tile === TILE_FLOOR && isRoad(zone, x, y)) c = ROAD_COLOR;
      else if (tile === TILE_FLOOR && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => tileAt(map, x + dx!, y + dy!) === TILE_WATER)) c = SHORE;
      else {
        const inside = x >= 0 && y >= 0 && x < map.width && y < map.height;
        const look = REGION_LOOK[inside ? regionOf(x, y) : 'thicket'];
        // Under trees the ground is darker: fallen needles and shade.
        const dim = tile === TILE_FLOOR ? 1 : 0.78;
        c = [look.floor[0] * dim, look.floor[1] * dim, look.floor[2] * dim];
      }
      const patch = (hash(x * 0.3, y * 0.3, 3) - 0.5) * 10;
      const i = (ty * cols + tx) * 4;
      image.data[i] = clamp(c[0] + patch * 0.8);
      image.data[i + 1] = clamp(c[1] + patch);
      image.data[i + 2] = clamp(c[2] + patch * 0.6);
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const colorTex = keep(new THREE.CanvasTexture(colorCanvas));
  colorTex.colorSpace = THREE.SRGBColorSpace;
  colorTex.magFilter = THREE.LinearFilter;
  colorTex.minFilter = THREE.LinearFilter;
  colorTex.generateMipmaps = false;

  const detail = keep(detailTexture(dungeon));
  const groundMat = keep(new THREE.MeshStandardMaterial({ map: colorTex, roughness: 1, metalness: 0 }));
  groundMat.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: detail };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vDetailUv;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvDetailUv = (modelMatrix * vec4(transformed, 1.0)).xz / 3.0;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nvarying vec2 vDetailUv;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= texture2D(detailMap, vDetailUv).rgb * 2.0;');
  };
  const groundGeo = keep(new THREE.PlaneGeometry(cols * TILE, rows * TILE));
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  // Tile (x, y) is centred on (x, y) * TILE, so the map's corner is half a tile out.
  ground.position.set((map.width / 2 - 0.5) * TILE, 0, (map.height / 2 - 0.5) * TILE);
  ground.receiveShadow = true;
  group.add(ground);

  // A wide dark apron beyond the texture, lost in the fog.
  const apron = new THREE.Mesh(keep(new THREE.PlaneGeometry(1000, 1000)), keep(new THREE.MeshStandardMaterial({ color: dungeon ? '#0c0d10' : '#2f3a26', roughness: 1 })));
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(ground.position.x, -0.02, ground.position.z);
  group.add(apron);

  // ------------------------------------------------------------------ water
  let water: THREE.Mesh | null = null;
  const waterTiles: Point[] = [];
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (tileAt(map, x, y) === TILE_WATER) waterTiles.push({ x, y });
  if (waterTiles.length > 0) {
    const quads = waterTiles.map(({ x, y }) => {
      const q = new THREE.PlaneGeometry(TILE * 1.02, TILE * 1.02);
      q.rotateX(-Math.PI / 2);
      q.translate(x * TILE, 0.06, y * TILE);
      return q;
    });
    const geo = keep(mergeGeometries(quads)!);
    for (const q of quads) q.dispose();
    const ripples = keep(rippleTexture());
    const mat = keep(new THREE.MeshStandardMaterial({
      color: '#2c4c5a', roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.86,
      normalMap: ripples, normalScale: new THREE.Vector2(0.35, 0.35),
    }));
    water = new THREE.Mesh(geo, mat);
    water.receiveShadow = true;
    group.add(water);
  }

  // ------------------------------------------------------------------ obstacles
  // How far each obstacle tile is from open ground: full trees stand at the forest's
  // edge, where they are seen; deeper in, a cheap canopy of crowns fills the gaps.
  const depth = distanceToOpen(world, margin, 5);
  const scatter = new Scatter(lib);
  const village: Point[] = [];
  const stone: Point[] = [];
  const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < map.width && y < map.height;
  for (let y = -margin; y < map.height + margin; y++) {
    for (let x = -margin; x < map.width + margin; x++) {
      const tile = tileAt(map, x, y);
      if (tile === TILE_FLOOR || tile === TILE_WATER) continue;
      const d = depth(x, y);
      if (dungeon) {
        if (d <= 2) stone.push({ x, y });
        continue;
      }
      const region = inMap(x, y) ? regionOf(x, y) : 'thicket';
      const at = new THREE.Vector3(x * TILE, 0, y * TILE);
      if (tile === TILE_ROCK) {
        scatter.add('boulder', at, hash(x, y, 1) * Math.PI * 2, 0.75 + hash(x, y, 2) * 0.55, 0.15);
      } else if (tile === TILE_RUIN) {
        scatter.add(hash(x, y, 4) < 0.6 ? 'ruin' : 'menhir', at, Math.round(hash(x, y, 5) * 4) * (Math.PI / 2) + (hash(x, y, 6) - 0.5) * 0.3, 0.55 + hash(x, y, 7) * 0.35, 0.05);
      } else if (REGION_LOOK[region].walls === 'wood') {
        village.push({ x, y });
      } else {
        const fir = region === 'thicket' || (region === 'moor' && hash(x, y, 8) < 0.4) || (!inMap(x, y) && hash(x, y, 8) < 0.5);
        // A crown is about four tiles wide, so a tree every few tiles closes the canopy.
        const chance = d <= 1 ? (fir ? 0.34 : 0.3) : fir ? 0.14 : 0.12;
        if (hash(x, y, 3) < chance) {
          scatter.add(fir ? 'fir' : 'oak', at, hash(x, y, 1) * Math.PI * 2, 0.75 + hash(x, y, 2) * 0.5, 0.6);
        } else if (d <= 2) {
          scatter.shrub(at, hash(x, y, 11), hash(x, y, 12));
        }
      }
    }
  }
  if (village.length > 0) buildVillage(village, world, scatter, lib, keep, group);
  if (stone.length > 0) group.add(buildStoneWalls(stone, keep));
  for (const mesh of scatter.build(keep)) group.add(mesh);

  // ------------------------------------------------------------------ grass
  if (!dungeon) for (const mesh of buildGrass(world, keep)) group.add(mesh);

  // ------------------------------------------------------------------ exits
  for (const exit of world.exits) group.add(buildExit(exit.pos, EXIT_COLOR[exit.leadsTo], keep));

  return {
    group,
    ground,
    update(time: number) {
      if (water) {
        const map = (water.material as THREE.MeshStandardMaterial).normalMap;
        if (map) map.offset.set(time * 0.012, time * 0.007);
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

// ------------------------------------------------------------------ instancing

interface Placement {
  matrix: THREE.Matrix4;
  chunk: string;
}

/** Collects copies of props and builds one InstancedMesh per prop part and chunk. */
class Scatter {
  private readonly placements = new Map<PropId, Placement[]>();
  private readonly shrubs: Placement[] = [];
  private readonly crowns: Placement[] = [];

  constructor(private readonly lib: Library) {}

  add(id: PropId, at: THREE.Vector3, rotation: number, scale: number, jitter: number, stretch?: THREE.Vector3): void {
    const x = at.x + (hash(at.x, at.z, 21) - 0.5) * jitter * TILE;
    const z = at.z + (hash(at.x, at.z, 22) - 0.5) * jitter * TILE;
    const s = stretch ? stretch.clone().multiplyScalar(scale) : new THREE.Vector3(scale, scale, scale);
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation), s);
    const list = this.placements.get(id) ?? [];
    list.push({ matrix, chunk: chunkKey(at) });
    this.placements.set(id, list);
  }

  shrub(at: THREE.Vector3, a: number, b: number): void {
    const s = 0.7 + a * 0.6;
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(at.x + (a - 0.5) * 0.5, 0, at.z + (b - 0.5) * 0.5),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b * 6.28),
      new THREE.Vector3(s, s * (0.7 + b * 0.5), s),
    );
    this.shrubs.push({ matrix, chunk: chunkKey(at) });
  }

  /** A plain crown high up: from above, deep forest reads as a roof of leaves. */
  canopy(at: THREE.Vector3, a: number, b: number, fir: boolean): void {
    const s = 1.4 + a * 0.9;
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(at.x + (a - 0.5) * 0.8, 3.2 + b * 1.6, at.z + (b - 0.5) * 0.8),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a * 6.28),
      new THREE.Vector3(s, s * (fir ? 1.5 : 0.8), s),
    );
    this.crowns.push({ matrix, chunk: chunkKey(at) });
  }

  build(keep: <T extends { dispose(): void }>(t: T) => T): THREE.InstancedMesh[] {
    const meshes: THREE.InstancedMesh[] = [];
    for (const [id, list] of this.placements) {
      let parts = bakeProp(this.lib.prop(id));
      if (parts.length === 0) parts = [standIn(id, keep)];
      for (const part of parts) {
        keep(part.geometry);
        if (id !== 'boulder') seeThrough(part.material);
      }
      for (const [, group] of byChunk(list)) {
        for (const part of parts) {
          const mesh = new THREE.InstancedMesh(part.geometry, part.material, group.length);
          group.forEach((p, i) => mesh.setMatrixAt(i, p.matrix));
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.computeBoundingSphere();
          meshes.push(mesh);
        }
      }
    }
    if (this.shrubs.length > 0) {
      const geo = keep(crownGeometry());
      geo.scale(0.38, 0.32, 0.38);
      geo.translate(0, 0.32, 0);
      const mat = keep(new THREE.MeshStandardMaterial({ color: '#34452a', roughness: 1 }));
      for (const [, group] of byChunk(this.shrubs)) {
        const mesh = new THREE.InstancedMesh(geo, mat, group.length);
        group.forEach((p, i) => mesh.setMatrixAt(i, p.matrix));
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        meshes.push(mesh);
      }
    }
    if (this.crowns.length > 0) {
      const geo = keep(crownGeometry());
      const mats = ['#2b3a22', '#33432a', '#26331f'].map((c) => keep(new THREE.MeshStandardMaterial({ color: c, roughness: 1 })));
      for (const [key, group] of byChunk(this.crowns)) {
        const mat = mats[Math.abs(key.length + group.length) % mats.length]!;
        const mesh = new THREE.InstancedMesh(geo, mat, group.length);
        group.forEach((p, i) => mesh.setMatrixAt(i, p.matrix));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        meshes.push(mesh);
      }
    }
    return meshes;
  }
}

/** A clump of foliage: several lumpy balls, darker underneath. Cheap stand-in for a tree crown deep in a forest. */
function crownGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const blobs: [number, number, number, number][] = [[0, 0, 0, 1], [0.8, -0.2, 0.3, 0.7], [-0.7, -0.1, -0.4, 0.75], [0.2, 0.5, -0.6, 0.6], [-0.3, 0.4, 0.7, 0.65]];
  blobs.forEach(([bx, by, bz, r], k) => {
    const g = new THREE.IcosahedronGeometry(r * 1.3, 1);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      v.multiplyScalar(0.8 + hash(v.x * 3 + k, v.y * 3, v.z * 3) * 0.4);
      pos.setXYZ(i, v.x + bx, v.y + by, v.z + bz);
    }
    parts.push(g);
  });
  const geo = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  geo.computeVertexNormals();
  return geo;
}

/** Steps from each tile to the nearest walkable one (capped), over the map and its outskirts. */
function distanceToOpen(world: World, margin: number, cap: number): (x: number, y: number) => number {
  const { map } = world;
  const w = map.width + margin * 2;
  const h = map.height + margin * 2;
  const dist = new Uint8Array(w * h).fill(cap);
  const queue: number[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (tileAt(map, x, y) === TILE_FLOOR) {
        const i = (y + margin) * w + (x + margin);
        dist[i] = 0;
        queue.push(i);
      }
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    const d = dist[i]!;
    if (d + 1 >= cap) continue;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (dist[j]! > d + 1) {
        dist[j] = d + 1;
        queue.push(j);
      }
    }
  }
  return (x, y) => {
    const tx = x + margin;
    const ty = y + margin;
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return cap;
    return dist[ty * w + tx]!;
  };
}

function chunkKey(at: THREE.Vector3): string {
  return `${Math.floor(at.x / TILE / CHUNK)},${Math.floor(at.z / TILE / CHUNK)}`;
}

function byChunk(list: Placement[]): Map<string, Placement[]> {
  const out = new Map<string, Placement[]>();
  for (const p of list) {
    const g = out.get(p.chunk) ?? [];
    g.push(p);
    out.set(p.chunk, g);
  }
  return out;
}

/** Plain shapes for props whose model has not loaded. */
function standIn(id: PropId, keep: <T extends { dispose(): void }>(t: T) => T): { geometry: THREE.BufferGeometry; material: THREE.Material } {
  if (id === 'oak' || id === 'fir') {
    const crown = id === 'fir' ? new THREE.ConeGeometry(1.6, 6, 8) : new THREE.IcosahedronGeometry(2.4, 1);
    crown.translate(0, id === 'fir' ? 4 : 4.2, 0);
    const trunk = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6);
    trunk.translate(0, 1.2, 0);
    const geometry = mergeGeometries([crown.toNonIndexed(), trunk.toNonIndexed()])!;
    return { geometry, material: keep(new THREE.MeshStandardMaterial({ color: id === 'fir' ? '#26382a' : '#3d5228', roughness: 1 })) };
  }
  const geometry = new THREE.DodecahedronGeometry(0.7, 0);
  geometry.translate(0, 0.45, 0);
  return { geometry, material: keep(new THREE.MeshStandardMaterial({ color: '#77736a', roughness: 0.95 })) };
}

// ------------------------------------------------------------------ village

/**
 * The village's wall tiles: the outer ring is a palisade of sharpened logs; the blocks
 * inside are houses, one model stretched to each block's footprint.
 */
function buildVillage(
  tiles: Point[], world: World, scatter: Scatter, lib: Library, keep: <T extends { dispose(): void }>(t: T) => T, group: THREE.Group,
): void {
  const proto = lib.prop('house');
  const houseSize = proto ? new THREE.Box3().setFromObject(proto).getSize(new THREE.Vector3()) : new THREE.Vector3(6.3, 4.6, 4.2);
  const { zone } = world;
  const set = new Set(tiles.map((t) => `${t.x},${t.y}`));
  const has = (x: number, y: number) => set.has(`${x},${y}`);
  const here = (x: number, y: number) => regionAt(zone, { x, y });
  const isPalisade = (x: number, y: number) => {
    const r = here(x, y);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (here(x + dx, y + dy) !== r) return true;
    return false;
  };

  // Palisade logs.
  const logs: THREE.Matrix4[] = [];
  const houses: Point[] = [];
  for (const t of tiles) {
    if (!isPalisade(t.x, t.y)) {
      houses.push(t);
      continue;
    }
    const alongX = has(t.x - 1, t.y) || has(t.x + 1, t.y);
    const alongY = has(t.x, t.y - 1) || has(t.x, t.y + 1);
    const offsets: [number, number][] = [];
    for (const o of [-0.34, 0, 0.34]) {
      if (alongX || !alongY) offsets.push([o, 0]);
      if (alongY) offsets.push([0, o]);
    }
    for (const [ox, oy] of offsets) {
      const h = 0.9 + hash(t.x + ox, t.y + oy, 31) * 0.2;
      logs.push(new THREE.Matrix4().compose(
        new THREE.Vector3((t.x + ox) * TILE, 0, (t.y + oy) * TILE),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(t.x, t.y, ox + oy) * 6),
        new THREE.Vector3(1, h, 1),
      ));
    }
  }
  if (logs.length > 0) {
    const shaft = new THREE.CylinderGeometry(0.17, 0.19, 2.7, 7);
    shaft.translate(0, 1.35, 0);
    const tip = new THREE.ConeGeometry(0.17, 0.45, 7);
    tip.translate(0, 2.92, 0);
    const geo = keep(mergeGeometries([shaft.toNonIndexed(), tip.toNonIndexed()])!);
    shaft.dispose();
    tip.dispose();
    const mat = keep(new THREE.MeshStandardMaterial({ color: '#6a5038', roughness: 0.95 }));
    seeThrough(mat);
    const mesh = new THREE.InstancedMesh(geo, mat, logs.length);
    logs.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  // Houses: connected blocks of inner wall tiles.
  const seen = new Set<string>();
  for (const start of houses) {
    const key = `${start.x},${start.y}`;
    if (seen.has(key)) continue;
    const block: Point[] = [];
    const queue = [start];
    seen.add(key);
    while (queue.length > 0) {
      const p = queue.pop()!;
      block.push(p);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = { x: p.x + dx, y: p.y + dy };
        const k = `${n.x},${n.y}`;
        if (!seen.has(k) && has(n.x, n.y) && !isPalisade(n.x, n.y)) {
          seen.add(k);
          queue.push(n);
        }
      }
    }
    const minX = Math.min(...block.map((p) => p.x));
    const maxX = Math.max(...block.map((p) => p.x));
    const minY = Math.min(...block.map((p) => p.y));
    const maxY = Math.max(...block.map((p) => p.y));
    const w = (maxX - minX + 1) * TILE + 0.5;
    const d = (maxY - minY + 1) * TILE + 0.5;
    const centre = new THREE.Vector3(((minX + maxX) / 2) * TILE, 0, ((minY + maxY) / 2) * TILE);
    placeHouse(scatter, centre, w, d, block.length, houseSize);
  }
}

/** Stretches the house model to a footprint of w × d metres (x × z). */
function placeHouse(scatter: Scatter, centre: THREE.Vector3, w: number, d: number, seed: number, size: THREE.Vector3): void {
  const modelAlongX = size.x >= size.z;
  const blockAlongX = w >= d;
  const long = Math.max(w, d);
  const short = Math.min(w, d);
  const modelLong = Math.max(size.x, size.z);
  const modelShort = Math.min(size.x, size.z);
  const stretch = modelAlongX
    ? new THREE.Vector3(long / modelLong, 1, short / modelShort)
    : new THREE.Vector3(short / modelShort, 1, long / modelLong);
  const turn = modelAlongX === blockAlongX ? 0 : Math.PI / 2;
  const flip = hash(centre.x, centre.z, seed) < 0.5 ? Math.PI : 0;
  scatter.add('house', centre, turn + flip, 1, 0, stretch);
}

// ------------------------------------------------------------------ dungeon

function buildStoneWalls(tiles: Point[], keep: <T extends { dispose(): void }>(t: T) => T): THREE.InstancedMesh {
  const geo = keep(new THREE.BoxGeometry(TILE, 2.6, TILE));
  geo.translate(0, 1.3, 0);
  const tex = keep(stoneTexture());
  const mat = keep(new THREE.MeshStandardMaterial({ map: tex, color: '#8a8478', roughness: 0.95 }));
  seeThrough(mat);
  const mesh = new THREE.InstancedMesh(geo, mat, tiles.length);
  tiles.forEach((t, i) => {
    const h = 0.85 + hash(t.x, t.y, 41) * 0.35;
    mesh.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(t.x * TILE, 0, t.y * TILE), new THREE.Quaternion(), new THREE.Vector3(1, h, 1)));
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// ------------------------------------------------------------------ grass

function buildGrass(world: World, keep: <T extends { dispose(): void }>(t: T) => T): THREE.InstancedMesh[] {
  const { map, zone } = world;
  const verts: number[] = [];
  for (let b = 0; b < 5; b++) {
    const a = (b / 5) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    const w = 0.014;
    const h = 0.2 + (b % 3) * 0.06;
    const lean = 0.06 + (b % 2) * 0.05;
    verts.push(-dz * w, 0, dx * w, dz * w, 0, -dx * w, dx * lean, h, dz * lean);
  }
  const tuft = keep(new THREE.BufferGeometry());
  tuft.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  // Normals pointing up light the blades like the ground below them, so they blend in.
  tuft.setAttribute('normal', new THREE.Float32BufferAttribute(verts.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));

  const byRegion = new Map<RegionId, THREE.Matrix4[]>();
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (tileAt(map, x, y) !== TILE_FLOOR || isRoad(zone, x, y)) continue;
      const region = regionAt(zone, { x, y }).id;
      if (REGION_LOOK[region].walls !== 'trees') continue;
      const list = byRegion.get(region) ?? [];
      const count = 3 + Math.floor(hash(x, y, 51) * 3);
      for (let i = 0; i < count; i++) {
        const s = 0.6 + hash(x, y, 60 + i) * 0.9;
        list.push(new THREE.Matrix4().compose(
          new THREE.Vector3((x + hash(x, y, 70 + i) - 0.5) * TILE, 0, (y + hash(x, y, 80 + i) - 0.5) * TILE),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(x, y, 90 + i) * 6.28),
          new THREE.Vector3(s, s * (0.7 + hash(x, y, 100 + i) * 0.6), s),
        ));
      }
      byRegion.set(region, list);
    }
  }
  const meshes: THREE.InstancedMesh[] = [];
  for (const [region, list] of byRegion) {
    const f = REGION_LOOK[region].floor;
    const color = new THREE.Color(`rgb(${clamp(f[0] * 1.05)}, ${clamp(f[1] * 1.15)}, ${clamp(f[2] * 0.8)})`);
    const mat = keep(new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide }));
    const mesh = new THREE.InstancedMesh(tuft, mat, list.length);
    list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    meshes.push(mesh);
  }
  return meshes;
}

// ------------------------------------------------------------------ exits

/** A glowing patch between two posts: a way into the mines or back out. */
function buildExit(pos: Point, color: number, keep: <T extends { dispose(): void }>(t: T) => T): THREE.Group {
  const g = new THREE.Group();
  g.position.set(pos.x * TILE, 0, pos.y * TILE);
  const glow = new THREE.Mesh(
    keep(new THREE.CircleGeometry(1.1, 32)),
    keep(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false })),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.04;
  const ring = new THREE.Mesh(
    keep(new THREE.RingGeometry(1.0, 1.15, 40)),
    keep(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false })),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  g.add(glow, ring);
  const postGeo = keep(new THREE.CylinderGeometry(0.12, 0.15, 2.2, 8));
  const postMat = keep(new THREE.MeshStandardMaterial({ color: '#3a3530', roughness: 0.9 }));
  const orbGeo = keep(new THREE.SphereGeometry(0.2, 12, 8));
  const orbMat = keep(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.5 }));
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(side * 1.2, 1.1, 0);
    post.castShadow = true;
    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.position.set(side * 1.2, 2.35, 0);
    g.add(post, orb);
  }
  const light = new THREE.PointLight(color, 6, 7, 1.5);
  light.position.y = 1.6;
  g.add(light);
  return g;
}

// ------------------------------------------------------------------ textures

/** Grey grain around 0.5 that is multiplied into the ground colour; tiles seamlessly. */
function detailTexture(dungeon: boolean): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgb(128,128,128)';
  g.fillRect(0, 0, size, size);
  const blot = (n: number, rMin: number, rMax: number, light: number, alpha: number) => {
    for (let i = 0; i < n; i++) {
      const x = hash(i, n, 1) * size;
      const y = hash(i, n, 2) * size;
      const r = rMin + hash(i, n, 3) * (rMax - rMin);
      const v = Math.round(128 + (hash(i, n, 4) - 0.5) * 2 * light);
      g.globalAlpha = alpha;
      g.fillStyle = `rgb(${v},${v},${v})`;
      for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]] as const) {
        g.beginPath();
        g.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        g.fill();
      }
    }
  };
  blot(60, 10, 40, 22, 0.25);
  blot(1500, 0.5, 2, dungeon ? 40 : 55, 0.5);
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** A tiling normal map of soft ripples for water. */
function rippleTexture(): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  const h = (x: number, y: number) =>
    Math.sin((x / size) * Math.PI * 2 * 3 + Math.sin((y / size) * Math.PI * 2 * 2) * 1.5) * 0.5 +
    Math.sin((y / size) * Math.PI * 2 * 4 + Math.cos((x / size) * Math.PI * 2 * 2) * 1.2) * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = h(x + 1, y) - h(x - 1, y);
      const dy = h(x, y + 1) - h(x, y - 1);
      const n = new THREE.Vector3(-dx, -dy, 1).normalize();
      const i = (y * size + x) * 4;
      data[i] = (n.x * 0.5 + 0.5) * 255;
      data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(40, 40);
  tex.needsUpdate = true;
  return tex;
}

/** Rough masonry for mine walls. */
function stoneTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#6d675d';
  g.fillRect(0, 0, size, size);
  for (let row = 0; row < 6; row++) {
    const y = (row / 6) * size;
    const shift = (row % 2) * 24;
    for (let col = -1; col < 5; col++) {
      const x = col * 56 + shift;
      const v = 90 + Math.round(hash(row, col, 1) * 40);
      g.fillStyle = `rgb(${v},${v - 6},${v - 14})`;
      g.fillRect(x + 2, y + 2, 52, size / 6 - 4);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
