// Canyon Strike - streamed chunk manager (visible play area only, no full-map mesh).
import * as THREE from 'three';
import { CHUNK, VIEW, BOUND } from './world';
import { buildChunkGeo } from './meshes';

interface ChunkNode {
  cx: number;
  cz: number;
  terrain: THREE.Mesh | null;
  props: THREE.Mesh | null;
  veg: THREE.Mesh | null;
  glow: THREE.Mesh | null;
  water: THREE.Mesh | null;
}

function noiseTexture(size = 128, scale = 6, base = 0.55): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let v = 0;
        let a = 0.5;
        let f = 1;
        for (let o = 0; o < 4; o++) {
          const ix = Math.floor((x / size) * scale * f);
          const iy = Math.floor((y / size) * scale * f);
          const h = (Math.sin(ix * 12.9898 + iy * 78.233) * 43758.5453) % 1;
          v += a * Math.abs(h);
          a *= 0.5;
          f *= 2.1;
        }
        const g = Math.max(0, Math.min(1, base + (v - 0.5) * 0.9));
        const i = (y * size + x) * 4;
        img.data[i] = 255;
        img.data[i + 1] = 255;
        img.data[i + 2] = 255;
        img.data[i + 3] = Math.floor(60 + g * 195);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class Chunks {
  readonly group = new THREE.Group();
  readonly matTer: THREE.MeshLambertMaterial;
  readonly matProp: THREE.MeshLambertMaterial;
  readonly matVeg: THREE.MeshLambertMaterial;
  readonly matGlow: THREE.MeshBasicMaterial;
  readonly matWater: THREE.MeshPhongMaterial;
  private waterTex: THREE.CanvasTexture;
  private map = new Map<string, ChunkNode>();
  private queue: { cx: number; cz: number }[] = [];
  shadows = true;
  built = 0;

  constructor() {
    this.matTer = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.matProp = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.matVeg = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.matGlow = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    this.waterTex = noiseTexture(128, 5, 0.6);
    this.matWater = new THREE.MeshPhongMaterial({
      color: 0x2c4a52,
      map: this.waterTex,
      transparent: true,
      opacity: 0.86,
      shininess: 90,
      specular: 0xa9dfe0,
      side: THREE.DoubleSide,
    });
    this.group.name = 'chunks';
  }

  private key(cx: number, cz: number): string {
    return cx + ',' + cz;
  }

  /** Build every chunk within VIEW radius of a world position (blocking; used once at boot). */
  prime(x: number, z: number): void {
    this.update(x, z, Infinity);
  }

  /** Stream chunks in around the camera; budget limits meshes built per call. */
  update(x: number, z: number, budget = 2): void {
    const pcx = Math.floor(x / CHUNK);
    const pcz = Math.floor(z / CHUNK);
    const want = new Set<string>();
    for (let dz = -VIEW; dz <= VIEW; dz++) {
      for (let dx = -VIEW; dx <= VIEW; dx++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        if (Math.abs(cx * CHUNK) > BOUND + CHUNK * 2 || Math.abs(cz * CHUNK) > BOUND + CHUNK * 3) continue;
        want.add(this.key(cx, cz));
      }
    }
    // drop far chunks
    for (const [k, n] of this.map) {
      if (want.has(k)) continue;
      for (const m of [n.terrain, n.props, n.veg, n.glow, n.water]) {
        if (!m) continue;
        this.group.remove(m);
        m.geometry.dispose();
      }
      this.map.delete(k);
    }
    // queue missing chunks nearest-first
    const missing: { cx: number; cz: number; d: number }[] = [];
    for (const k of want) {
      if (this.map.has(k)) continue;
      const [sx, sz] = k.split(',');
      const cx = Number(sx);
      const cz = Number(sz);
      missing.push({ cx, cz, d: Math.hypot(cx - pcx, cz - pcz) });
    }
    missing.sort((a, b) => a.d - b.d);
    this.queue = missing.map((m) => ({ cx: m.cx, cz: m.cz }));
    let n = 0;
    while (this.queue.length && n < budget) {
      const it = this.queue.shift() as { cx: number; cz: number };
      if (!want.has(this.key(it.cx, it.cz))) continue;
      this.build(it.cx, it.cz);
      n++;
    }
    // shadow range falloff
    for (const node of this.map.values()) {
      const d = Math.hypot(node.cx * CHUNK - x, node.cz * CHUNK - z);
      const near = d < 90 && this.shadows;
      if (node.props) {
        node.props.castShadow = near;
        node.props.receiveShadow = near;
      }
      if (node.terrain) node.terrain.receiveShadow = near;
    }
  }

  pending(): number {
    return this.queue.length;
  }

  private build(cx: number, cz: number): void {
    const geo = buildChunkGeo(cx, cz);
    const mk = (g: THREE.BufferGeometry | null, mat: THREE.Material): THREE.Mesh | null => {
      if (!g) return null;
      const m = new THREE.Mesh(g, mat);
      m.frustumCulled = true;
      this.group.add(m);
      return m;
    };
    const node: ChunkNode = {
      cx,
      cz,
      terrain: mk(geo.terrain, this.matTer),
      props: mk(geo.props, this.matProp),
      veg: mk(geo.veg, this.matVeg),
      glow: mk(geo.glow, this.matGlow),
      water: mk(geo.water, this.matWater),
    };
    if (node.terrain) node.terrain.receiveShadow = true;
    this.map.set(this.key(cx, cz), node);
    this.built++;
  }

  tick(dt: number): void {
    this.waterTex.offset.x += dt * 0.014;
    this.waterTex.offset.y += dt * 0.009;
  }

  /** Debug helper: number of resident chunks. */
  count(): number {
    return this.map.size;
  }
}
