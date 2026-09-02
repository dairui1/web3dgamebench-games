// Canyon Strike - low-poly geometry builder and every prop / structure / unit mesh.
import * as THREE from 'three';
import { clamp, hash2, lerp, shade } from './rng';
import { Q, SEG, CHUNK, ground, groundColor, slopeAt, roadZ, riverZ, riverLevel, waterAt, surfaceAt, vegForChunk, structs, waters, PLAZA, type StructDef } from './world';

export const COL = {
  concrete: 0x9b968c,
  concreteDk: 0x7d786f,
  metal: 0x7d858d,
  metalDk: 0x4f565c,
  rust: 0x8f5a37,
  rustDk: 0x6b4028,
  wood: 0x8a6a44,
  woodDk: 0x5f4830,
  paintWhite: 0xd8d3c6,
  paintBlue: 0x3f6480,
  paintGreen: 0x4d6b45,
  paintRed: 0x9c3f33,
  paintYellow: 0xd8b23c,
  glass: 0x2f4148,
  glassLit: 0xffd98a,
  asphalt: 0x55555a,
  gravel: 0x9b8f79,
  bark: 0x4b3a2b,
  pine: 0x33472f,
  pineDk: 0x24341f,
  leaf: 0x5f7a3a,
  sage: 0x7b8a5c,
  grass: 0x74854a,
  grassDk: 0x53602f,
  reed: 0x63803f,
  cattail: 0x6d4a2c,
  stone: 0x7d7469,
  stoneRed: 0x9a6145,
  sand: 0xc1ab7f,
  cloth: 0xb9a887,
  clothDk: 0x8a7c60,
  skin: 0xc08f62,
  jacket: 0x4a5c3a,
  pants: 0x6b5a3c,
  hat: 0x8c7a4e,
  tank: 0x5d6a4f,
  enemyA: 0x53333a,
  enemyB: 0x2f2429,
  enemyGlow: 0x8fd14a,
  boss: 0x3a2020,
};

type V3 = [number, number, number];

/** Accumulates flat-shaded, vertex-coloured triangles. */
export class GB {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];

  get tris(): number {
    return this.pos.length / 9;
  }

  tri(a: V3, b: V3, c: V3, color: number, light = true): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    let c0 = color;
    if (light) c0 = shade(color, 0.8 + 0.3 * Math.abs(ny) + 0.06 * (Math.abs(nx) + Math.abs(nz)));
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) this.nor.push(nx, ny, nz);
    for (let i = 0; i < 3; i++) this.col.push(((c0 >> 16) & 255) / 255, ((c0 >> 8) & 255) / 255, (c0 & 255) / 255);
  }

  /** Quad with winding auto-corrected so the face points away from `centre`. */
  quad(a: V3, b: V3, c: V3, d: V3, color: number, centre?: V3): void {
    const mx = (a[0] + b[0] + c[0] + d[0]) / 4;
    const my = (a[1] + b[1] + c[1] + d[1]) / 4;
    const mz = (a[2] + b[2] + c[2] + d[2]) / 4;
    let flip = false;
    if (centre) {
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = c[0] - a[0];
      const vy = c[1] - a[1];
      const vz = c[2] - a[2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      flip = nx * (mx - centre[0]) + ny * (my - centre[1]) + nz * (mz - centre[2]) < 0;
    }
    if (flip) {
      this.tri(a, d, c, color);
      this.tri(a, c, b, color);
    } else {
      this.tri(a, b, c, color);
      this.tri(a, c, d, color);
    }
  }

  box(x: number, y: number, z: number, w: number, h: number, d: number, color: number, ry = 0, rx = 0, rz = 0): void {
    const cx = new THREE.Euler(rx, ry, rz, 'YXZ');
    const m = new THREE.Matrix4().makeRotationFromEuler(cx);
    const hw = w / 2;
    const hh = h / 2;
    const hd = d / 2;
    const raw: V3[] = [
      [-hw, -hh, -hd],
      [hw, -hh, -hd],
      [hw, -hh, hd],
      [-hw, -hh, hd],
      [-hw, hh, -hd],
      [hw, hh, -hd],
      [hw, hh, hd],
      [-hw, hh, hd],
    ];
    const v = new THREE.Vector3();
    const p: V3[] = raw.map((q) => {
      v.set(q[0], q[1], q[2]).applyMatrix4(m);
      return [v.x + x, v.y + y, v.z + z];
    });
    const c: V3 = [x, y, z];
    this.quad(p[0], p[3], p[2], p[1], color, c);
    this.quad(p[4], p[5], p[6], p[7], color, c);
    this.quad(p[0], p[1], p[5], p[4], color, c);
    this.quad(p[3], p[7], p[6], p[2], color, c);
    this.quad(p[0], p[4], p[7], p[3], color, c);
    this.quad(p[1], p[2], p[6], p[5], color, c);
  }

  /** Gable roof prism sitting on top of a box. */
  roof(x: number, y: number, z: number, w: number, h: number, d: number, color: number, ry = 0): void {
    const e = new THREE.Euler(0, ry, 0, 'YXZ');
    const m = new THREE.Matrix4().makeRotationFromEuler(e);
    const v = new THREE.Vector3();
    const pts: V3[] = [
      [-w / 2, 0, -d / 2],
      [w / 2, 0, -d / 2],
      [w / 2, 0, d / 2],
      [-w / 2, 0, d / 2],
      [0, h, -d / 2],
      [0, h, d / 2],
    ].map((q) => {
      v.set(q[0], q[1], q[2]).applyMatrix4(m);
      return [v.x + x, v.y + y, v.z + z];
    });
    const c: V3 = [x, y + h * 0.3, z];
    this.tri(pts[0], pts[1], pts[4], color);
    this.tri(pts[2], pts[3], pts[5], color);
    this.tri(pts[0], pts[4], pts[5], color);
    this.tri(pts[0], pts[5], pts[3], color);
    this.tri(pts[1], pts[2], pts[5], color);
    this.tri(pts[1], pts[5], pts[4], color);
  }

  /** Cylinder / cone / pipe around a local axis (default +Y). */
  cyl(x: number, y: number, z: number, rb: number, rt: number, h: number, seg: number, color: number, ry = 0, axis: 'y' | 'x' | 'z' = 'y', caps = true): void {
    seg = Math.max(3, Math.round(seg));
    const ring = (yy: number, r: number): V3[] => {
      const out: V3[] = [];
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2 + ry;
        let px = Math.cos(a) * r;
        let py = yy;
        let pz = Math.sin(a) * r;
        if (axis === 'x') {
          const t = px;
          px = yy;
          py = t;
        } else if (axis === 'z') {
          const t = pz;
          pz = yy;
          py = t;
        }
        out.push([px + x, py + y, pz + z]);
      }
      return out;
    };
    const lo = ring(0, rb);
    const hi = ring(h, rt);
    const c: V3 = [x, y + h / 2, z];
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      if (rt > 0.0001) this.quad(lo[i], lo[j], hi[j], hi[i], color, c);
      else this.tri(lo[i], lo[j], hi[i], color);
    }
    if (caps) {
      if (rt > 0.0001) {
        for (let i = 1; i < seg - 1; i++) this.tri(hi[0], hi[i], hi[i + 1], color);
        for (let i = 1; i < seg - 1; i++) this.tri(lo[0], lo[i + 1], lo[i], color);
      } else {
        for (let i = 1; i < seg - 1; i++) this.tri(lo[0], lo[i + 1], lo[i], color);
      }
    }
  }

  /** Thin quad slab (billboards, cards, panels). */
  slab(a: V3, b: V3, c: V3, d: V3, color: number): void {
    this.quad(a, b, c, d, color);
  }

  tube(a: V3, b: V3, r: number, seg: number, color: number): void {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    const up: V3 = Math.abs(dy / len) > 0.99 ? [1, 0, 0] : [0, 1, 0];
    let ux = up[1] * dz - up[2] * dy;
    let uy = up[2] * dx - up[0] * dz;
    let uz = up[0] * dy - up[1] * dx;
    let l = Math.hypot(ux, uy, uz) || 1;
    ux /= l;
    uy /= l;
    uz /= l;
    let vx = (dy * uz - dz * uy) / len;
    let vy = (dz * ux - dx * uz) / len;
    let vz = (dx * uy - dy * ux) / len;
    l = Math.hypot(vx, vy, vz) || 1;
    vx /= l;
    vy /= l;
    vz /= l;
    const nw = { x: uy * vz - uz * vy, y: uz * vx - ux * vz, z: ux * vy - uy * vx };
    const ringA: V3[] = [];
    const ringB: V3[] = [];
    for (let i = 0; i < seg; i++) {
      const ang = (i / seg) * Math.PI * 2;
      const ca = Math.cos(ang) * r;
      const sa = Math.sin(ang) * r;
      ringA.push([a[0] + ux * ca + vx * sa, a[1] + uy * ca + vy * sa, a[2] + uz * ca + vz * sa]);
      ringB.push([b[0] + ux * ca + vx * sa, b[1] + uy * ca + vy * sa, b[2] + uz * ca + vz * sa]);
    }
    const ctr: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    void nw;
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      this.quad(ringA[i], ringA[j], ringB[j], ringB[i], color, ctr);
    }
    this.tri(ringA[0], ringA[Math.min(seg - 1, 1 + (seg >> 2))], ringA[Math.min(seg - 1, 1 + (seg >> 1))], color);
  }

  merge(o: GB): void {
    for (let i = 0; i < o.pos.length; i++) this.pos.push(o.pos[i]);
    for (let i = 0; i < o.nor.length; i++) this.nor.push(o.nor[i]);
    for (let i = 0; i < o.col.length; i++) this.col.push(o.col[i]);
  }

  /** Apply a matrix to everything accumulated so far (positions and normals). */
  transform(m: THREE.Matrix4): GB {
    const v = new THREE.Vector3();
    for (let i = 0; i < this.pos.length; i += 3) {
      v.set(this.pos[i], this.pos[i + 1], this.pos[i + 2]).applyMatrix4(m);
      this.pos[i] = v.x;
      this.pos[i + 1] = v.y;
      this.pos[i + 2] = v.z;
    }
    const rm = new THREE.Matrix4().extractRotation(m);
    for (let i = 0; i < this.nor.length; i += 3) {
      v.set(this.nor[i], this.nor[i + 1], this.nor[i + 2]).applyMatrix4(rm).normalize();
      this.nor[i] = v.x;
      this.nor[i + 1] = v.y;
      this.nor[i + 2] = v.z;
    }
    return this;
  }

  geom(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }

  mesh(mat: THREE.Material): THREE.Mesh {
    return new THREE.Mesh(this.geom(), mat);
  }
}

const TAU = Math.PI * 2;

/** Ground scatter helper (small rocks, planks, trash). */
export function scatter(g: GB, x: number, z: number, n: number, seed: number, color: number, size = 0.5): void {
  for (let i = 0; i < n; i++) {
    const a = hash2(seed + i * 7, i * 13 + 3) * Math.PI * 2;
    const r = 0.6 + hash2(seed + i, i * 3 + 11) * 3.2;
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    const s = size * (0.4 + hash2(i + seed, seed) * 0.9);
    g.box(px, ground(px, pz) + s * 0.3, pz, s, s * 0.7, s * (0.6 + hash2(seed, i) * 0.8), shade(color, 0.8 + hash2(i, seed + i) * 0.4), hash2(seed + i, 5) * 3);
  }
}

// ------------------------------------------------------------- structures ----
/** Fill `g` (solid) and `gl` (emissive) with a structure's geometry. */
export function buildStruct(g: GB, gl: GB, s: StructDef): void {
  const gy = ground(s.x, s.z);
  const ry = s.ry;
  const k = s.s;
  switch (s.t) {
    case 'hangar': {
      g.box(s.x, gy + 3.2 * k, s.z, 16 * k, 6.4 * k, 11 * k, COL.concrete, ry);
      g.cyl(s.x, gy + 6.2 * k, s.z, 5.6 * k, 5.6 * k, 16 * k, 9, COL.metal, ry, 'x');
      g.box(s.x + Math.cos(ry) * 5.7 * k, gy + 2.6 * k, s.z - Math.sin(ry) * 5.7 * k, 7 * k, 5.2 * k, 0.5 * k, COL.metalDk, ry);
      gl.box(s.x + Math.cos(ry) * 5.8 * k, gy + 5 * k, s.z - Math.sin(ry) * 5.8 * k, 1.2 * k, 0.5 * k, 0.4 * k, COL.glassLit, ry);
      break;
    }
    case 'barracks':
    case 'mess':
    case 'section': {
      const w = s.t === 'barracks' ? 15 : 9;
      g.box(s.x, gy + 1.9 * k, s.z, w * k, 3.8 * k, 7 * k, COL.paintWhite, ry);
      g.roof(s.x, gy + 3.8 * k, s.z, (w + 1) * k, 2 * k, 7.6 * k, COL.paintGreen, ry);
      g.box(s.x, gy + 0.5, s.z, (w + 1.6) * k, 0.7, 8.4 * k, COL.concreteDk, ry);
      g.box(s.x + (w / 2 - 1.4) * k * Math.cos(ry), gy + 1.2 * k, s.z - (w / 2 - 1.4) * k * Math.sin(ry), 1.4 * k, 2.4 * k, 0.3, COL.woodDk, ry);
      for (let i = -1; i <= 1; i++) {
        g.box(s.x + i * 3 * k * Math.cos(ry), gy + 2.3 * k, s.z - i * 3 * k * Math.sin(ry), 1.5 * k, 1.2 * k, 0.25, COL.glass, ry);
        gl.box(s.x + i * 3 * k * Math.cos(ry), gy + 2.3 * k, s.z - i * 3 * k * Math.sin(ry), 1.2 * k, 0.9 * k, 0.3, COL.glassLit, ry);
      }
      if (s.t === 'mess') {
        g.box(s.x - 5 * k, gy + 2.6 * k, s.z + 2 * k, 1.4 * k, 3 * k, 1.4 * k, 0x9c5b45, ry);
      }
      break;
    }
    case 'fueldepot': {
      g.cyl(s.x, gy + 1.9 * k, s.z, 1.9 * k, 1.9 * k, 9 * k, 10, COL.paintWhite, ry, 'x');
      g.cyl(s.x + 1 * k, gy + 4.3 * k, s.z, 1.7 * k, 1.7 * k, 8 * k, 10, COL.rust, ry + 0.02, 'x');
      g.box(s.x - 5 * k, gy + 1, s.z, 1.2 * k, 2 * k, 3 * k, COL.concreteDk, ry);
      g.box(s.x + 5 * k, gy + 1, s.z, 1.2 * k, 2 * k, 3 * k, COL.concreteDk, ry);
      g.tube([s.x - 6 * k, gy + 5.4 * k, s.z - 3 * k], [s.x + 6 * k, gy + 5.4 * k, s.z - 3 * k], 0.22 * k, 6, COL.metal);
      g.tube([s.x + 6 * k, gy + 5.4 * k, s.z - 3 * k], [s.x + 6 * k, gy + 1, s.z - 3 * k], 0.22 * k, 6, COL.metal);
      scatter(g, s.x + 3, s.z + 4, 5, 22, COL.rustDk, 0.4);
      break;
    }
    case 'tower': {
      for (let i = 0; i < 4; i++) {
        const a = ry + (i * Math.PI) / 2 + 0.785;
        g.tube([s.x + Math.cos(a) * 2 * k, gy, s.z + Math.sin(a) * 2 * k], [s.x + Math.cos(a) * 1.2 * k, gy + 11 * k, s.z + Math.sin(a) * 1.2 * k], 0.25 * k, 5, COL.concreteDk);
      }
      g.box(s.x, gy + 12.4 * k, s.z, 4.6 * k, 2.8 * k, 4.6 * k, COL.paintWhite, ry);
      g.roof(s.x, gy + 13.8 * k, s.z, 5.4 * k, 1.5 * k, 5.4 * k, COL.paintRed, ry);
      g.box(s.x, gy + 12.2 * k, s.z, 4.9 * k, 1.4 * k, 4.9 * k, COL.glass, ry);
      gl.box(s.x, gy + 12.2 * k, s.z, 4.4 * k, 1.1 * k, 4.4 * k, COL.glassLit, ry);
      break;
    }
    case 'watertank': {
      for (let i = 0; i < 3; i++) {
        const a = ry + (i * TAU) / 3;
        g.tube([s.x + Math.cos(a) * 3 * k, gy, s.z + Math.sin(a) * 3 * k], [s.x + Math.cos(a) * 1.6 * k, gy + 9 * k, s.z + Math.sin(a) * 1.6 * k], 0.3 * k, 5, COL.metalDk);
      }
      g.cyl(s.x, gy + 9 * k, s.z, 3.4 * k, 3.4 * k, 4 * k, 12, COL.rust, ry);
      g.cyl(s.x, gy + 13 * k, s.z, 3.4 * k, 0.4 * k, 1.6 * k, 12, COL.metalDk, ry);
      break;
    }
    case 'silo': {
      g.cyl(s.x, gy, s.z, 2.2 * k, 2.2 * k, 13 * k, 10, COL.paintWhite, ry);
      g.cyl(s.x, gy + 13 * k, s.z, 2.3 * k, 0.6 * k, 1.8 * k, 10, COL.metalDk, ry);
      g.box(s.x + 2.2 * k, gy + 6 * k, s.z, 0.4 * k, 12 * k, 0.6 * k, COL.metal, ry);
      g.tube([s.x - 2.2 * k, gy + 11 * k, s.z], [s.x - 6 * k, gy + 4 * k, s.z + 2 * k], 0.35 * k, 6, COL.rust);
      break;
    }
    case 'containers': {
      const cc = [COL.paintBlue, COL.rust, COL.paintRed];
      for (let i = 0; i < 3; i++) {
        const a = hash2(i + s.x, s.z);
        g.box(s.x + (i - 1) * 3.4 * k, gy + 1.4 * k + (i === 2 ? 2.9 : 0), s.z + a * 1.5, 3.1 * k, 2.7 * k, 6.4 * k, cc[i], ry + a * 0.1 - 0.05);
        for (let r = 0; r < 5; r++) g.box(s.x + (i - 1) * 3.4 * k + 1.6 * k, gy + 0.5 * k + r * 0.55 * k + (i === 2 ? 2.9 : 0), s.z + a * 1.5, 0.15, 0.3, 6 * k, COL.metalDk, ry);
      }
      break;
    }
    case 'shed': {
      g.box(s.x, gy + 1.5 * k, s.z, 6 * k, 3 * k, 4 * k, COL.wood, ry);
      g.roof(s.x, gy + 3 * k, s.z, 6.6 * k, 1.1 * k, 4.4 * k, COL.metalDk, ry);
      break;
    }
    case 'billboard': {
      g.box(s.x, gy + 3 * k, s.z, 0.5 * k, 6 * k, 0.5 * k, COL.metalDk, ry);
      g.box(s.x + 3 * k, gy + 3 * k, s.z, 0.5 * k, 6 * k, 0.5 * k, COL.metalDk, ry);
      g.box(s.x + 1.5 * k, gy + 7.4 * k, s.z, 8 * k, 4 * k, 0.4 * k, COL.paintYellow, ry);
      g.box(s.x + 1.5 * k, gy + 7.4 * k, s.z + 0.25 * k, 7.2 * k, 3.2 * k, 0.1, COL.paintRed, ry);
      gl.box(s.x + 1.5 * k, gy + 9.3 * k, s.z + 0.4 * k, 7.8 * k, 0.25 * k, 0.2 * k, 0xfff0c0, ry);
      break;
    }
    case 'pylon': {
      const h = 13 * k;
      g.tube([s.x - 1.6, gy, s.z - 1.2], [s.x - 0.5, gy + h, s.z - 0.4], 0.28, 4, COL.metalDk);
      g.tube([s.x + 1.6, gy, s.z - 1.2], [s.x + 0.5, gy + h, s.z - 0.4], 0.28, 4, COL.metalDk);
      g.tube([s.x - 1.6, gy, s.z + 1.2], [s.x - 0.5, gy + h, s.z + 0.4], 0.28, 4, COL.metalDk);
      g.tube([s.x + 1.6, gy, s.z + 1.2], [s.x + 0.5, gy + h, s.z + 0.4], 0.28, 4, COL.metalDk);
      g.tube([s.x - 0.5, gy + h, s.z - 0.4], [s.x + 0.5, gy + h, s.z + 0.4], 0.24, 4, COL.metalDk);
      g.box(s.x, gy + h * 0.72, s.z, 7 * k, 0.3, 0.3, COL.metal, 0);
      g.box(s.x, gy + h * 0.88, s.z, 5.2 * k, 0.3, 0.3, COL.metal, 1.57);
      g.box(s.x, gy + h, s.z, 0.4, 1.2, 0.4, COL.metal);
      for (const sxn of [-1, 1]) {
        g.tube([s.x + sxn * 3.5, gy + h * 0.72, s.z], [s.x + sxn * 33, gy + h * 0.62, s.z], 0.06, 3, 0x2a2f33);
        g.tube([s.x + sxn * 2.6, gy + h * 0.88, s.z], [s.x + sxn * 33, gy + h * 0.8, s.z], 0.06, 3, 0x2a2f33);
      }
      break;
    }
    case 'house': {
      const tilt = (hash2(s.x, s.z) - 0.5) * 0.14;
      g.box(s.x, gy + 1.8 * k, s.z, 7 * k, 3.6 * k, 6 * k, COL.paintWhite, ry, tilt * 0.3, tilt);
      g.roof(s.x, gy + 3.6 * k, s.z, 7.8 * k, 2.1 * k, 6.8 * k, COL.woodDk, ry);
      g.box(s.x + 1.6 * k, gy + 4.6 * k, s.z - 1 * k, 0.8 * k, 2.2 * k, 0.8 * k, COL.concreteDk, ry);
      g.box(s.x - 1.5 * k, gy + 1.3 * k, s.z + 3.05 * k * Math.cos(0), 1.3 * k, 2.6 * k, 0.2, COL.woodDk, ry);
      gl.box(s.x + 1.8 * k, gy + 2.2 * k, s.z + 3.1, 1.3 * k, 1.2 * k, 0.24, COL.glassLit, ry);
      g.box(s.x - 4.2 * k, gy + 0.6, s.z + 2 * k, 2.4, 0.4, 2.4, COL.concreteDk, ry);
      scatter(g, s.x + 2, s.z - 4, 6, s.x * 3, COL.concreteDk, 0.4);
      break;
    }
    case 'diner': {
      g.box(s.x, gy + 2 * k, s.z, 12 * k, 4 * k, 6 * k, COL.paintWhite, ry);
      g.cyl(s.x, gy + 3.9 * k, s.z, 3.1 * k, 3.1 * k, 12.4 * k, 8, COL.paintRed, ry, 'x');
      g.box(s.x, gy + 2.3 * k, s.z + 3 * k, 9 * k, 2 * k, 0.3, COL.glass, ry);
      gl.box(s.x, gy + 2.3 * k, s.z + 3.15 * k, 8.4 * k, 1.6 * k, 0.2, COL.glassLit, ry);
      g.box(s.x - 5 * k, gy + 5.4 * k, s.z, 3 * k, 1.6 * k, 0.4, COL.paintYellow, ry);
      g.box(s.x + 6.4 * k, gy + 2.4 * k, s.z, 1.6 * k, 4.8 * k, 1.6 * k, COL.concreteDk, ry);
      break;
    }
    case 'church': {
      g.box(s.x, gy + 2.6 * k, s.z, 7 * k, 5.2 * k, 11 * k, COL.paintWhite, ry);
      g.roof(s.x, gy + 5.2 * k, s.z, 7.6 * k, 2.6 * k, 11.4 * k, COL.woodDk, ry);
      g.box(s.x, gy + 8 * k, s.z - 4 * k, 2.4 * k, 7 * k, 2.4 * k, COL.paintWhite, ry);
      g.cyl(s.x, gy + 11.5 * k, s.z - 4 * k, 1.7 * k, 0.2, 3.4 * k, 6, COL.metalDk, ry);
      g.box(s.x, gy + 15.4 * k, s.z - 4 * k, 0.3, 2.2, 0.3, COL.paintYellow, ry);
      g.box(s.x, gy + 15.9 * k, s.z - 4 * k, 1.2, 0.3, 0.3, COL.paintYellow, ry);
      gl.box(s.x, gy + 3 * k, s.z + 5.6 * k, 1.6 * k, 2.4 * k, 0.3, COL.glassLit, ry);
      break;
    }
    case 'overpass': {
      const dir = ry;
      const ca = Math.cos(dir);
      const sa = Math.sin(dir);
      for (let i = -2; i <= 2; i++) {
        const along = i * 11 * k;
        const px = s.x + ca * along;
        const pz = s.z + sa * along;
        const broken = i === 0 || i === 1;
        g.box(px, gy + (broken ? 3.5 : 8) * k, pz, 3 * k, (broken ? 6 : 1.2) * k, 3 * k, COL.concreteDk, dir);
        if (!broken) g.box(px, gy + 8.8 * k, pz, 12 * k, 1.3 * k, 11 * k, COL.concrete, dir);
      }
      g.box(s.x + ca * 24 * k, gy + 6 * k, s.z + sa * 24 * k, 14 * k, 1.4 * k, 11 * k, COL.concrete, dir + 0.25, 0, 0.22);
      scatter(g, s.x, s.z, 16, 71, COL.concreteDk, 0.9);
      for (let i = 0; i < 6; i++) {
        const a = hash2(i, 71) * 6.28;
        g.tube([s.x + Math.cos(a) * 4, gy + 0.4, s.z + Math.sin(a) * 4], [s.x + Math.cos(a) * 7, gy + 2.4 + hash2(i, 5) * 2, s.z + Math.sin(a) * 7], 0.07, 3, COL.rustDk);
      }
      break;
    }
    case 'mill': {
      g.box(s.x, gy + 3 * k, s.z, 8 * k, 6 * k, 8 * k, COL.concreteDk, ry);
      g.box(s.x, gy + 8.5 * k, s.z, 5 * k, 5 * k, 5 * k, COL.concrete, ry);
      g.cyl(s.x, gy + 11 * k, s.z, 3 * k, 3 * k, 1.2 * k, 8, COL.rust, ry);
      g.box(s.x + 4 * k, gy + 5 * k, s.z, 5 * k, 1 * k, 1.4 * k, COL.metalDk, ry + 0.3);
      g.box(s.x, gy + 13.6 * k, s.z, 0.4, 3, 0.4, COL.metal);
      break;
    }
    case 'corral': {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const px = s.x + Math.cos(a) * 7 * k;
        const pz = s.z + Math.sin(a) * 6 * k;
        const lean = i === 4 || i === 9 ? 0.5 : 0;
        g.box(px, gy + 1.1 * k, pz, 0.22, 2.2 * k, 0.22, COL.woodDk, a + lean, lean);
        if (i < 11 && i !== 4) {
          const b = ((i + 1) / 12) * Math.PI * 2;
          const qx = s.x + Math.cos(b) * 7 * k;
          const qz = s.z + Math.sin(b) * 6 * k;
          g.tube([px, gy + 1.7 * k, pz], [qx, gy + 1.7 * k, qz], 0.09, 3, COL.wood);
          g.tube([px, gy + 0.9 * k, pz], [qx, gy + 0.9 * k, qz], 0.09, 3, COL.wood);
        }
      }
      scatter(g, s.x, s.z, 5, 33, COL.woodDk, 0.4);
      break;
    }
    case 'headframe': {
      g.tube([s.x - 3, gy, s.z - 2], [s.x, gy + 14, s.z], 0.35, 4, COL.metalDk);
      g.tube([s.x + 3, gy, s.z - 2], [s.x, gy + 14, s.z], 0.35, 4, COL.metalDk);
      g.tube([s.x - 3, gy, s.z + 2], [s.x, gy + 14, s.z], 0.35, 4, COL.metalDk);
      g.tube([s.x + 3, gy, s.z + 2], [s.x, gy + 14, s.z], 0.35, 4, COL.metalDk);
      for (let i = 1; i < 5; i++) g.box(s.x, gy + i * 2.8, s.z, 6 - i * 0.9, 0.2, 0.2, COL.metal);
      g.cyl(s.x, gy + 13, s.z, 1.6, 1.6, 0.6, 8, COL.rust, 0, 'z');
      g.box(s.x + 4, gy + 1.5, s.z + 2, 4, 3, 3.5, COL.woodDk, ry);
      scatter(g, s.x, s.z + 5, 8, 12, COL.stone, 0.6);
      break;
    }
    case 'bridge': {
      const len = 26 * k;
      const horiz = Math.abs(Math.cos(ry)) > 0.5;
      g.box(s.x, gy + 1.5, s.z, horiz ? len : 8, 0.7, horiz ? 8 : len, COL.asphalt, ry);
      for (let i = -2; i <= 2; i++) {
        const along = i * 6;
        const px = s.x + (horiz ? along : 0);
        const pz = s.z + (horiz ? 0 : along);
        for (const side of [-1, 1]) {
          const sx2 = px + (horiz ? 0 : side * 3.6);
          const sz2 = pz + (horiz ? side * 3.6 : 0);
          g.box(sx2, gy + 3.4, sz2, 0.4, 4.4, 0.4, COL.rust, ry);
          if (i < 2) {
            const nx = px + (horiz ? 6 : 0) + (horiz ? 0 : side * 3.6);
            const nz = pz + (horiz ? 0 : 6) + (horiz ? side * 3.6 : 0);
            g.tube([sx2, gy + 5.2, sz2], [nx, gy + 1.8, nz], 0.14, 4, COL.rust);
            g.tube([sx2, gy + 1.8, sz2], [nx, gy + 5.2, nz], 0.14, 4, COL.rust);
          }
        }
        g.box(px, gy + 5.4, pz + (horiz ? 0 : 0), horiz ? 0.3 : 8, 0.3, horiz ? 8 : 0.3, COL.rust, ry);
      }
      break;
    }
    case 'dam': {
      const horiz = Math.abs(Math.cos(ry)) > 0.5;
      const w = horiz ? 6 : 30;
      const d = horiz ? 30 : 6;
      g.box(s.x, gy + 5, s.z, w, 12, d, COL.concrete, ry);
      g.box(s.x, gy + 11.2, s.z, w + 1, 0.8, d + 1, COL.concreteDk, ry);
      for (let i = -2; i <= 2; i++) {
        const px = s.x + (horiz ? i * 6 : 0);
        const pz = s.z + (horiz ? 0 : i * 6);
        g.box(px, gy + 6, pz, horiz ? 3.6 : 1.4, 6, horiz ? 1.4 : 3.6, COL.concreteDk, ry);
      }
      g.box(s.x, gy + 1.6, s.z + (horiz ? 0 : 14), horiz ? 20 : 4, 2.4, horiz ? 4 : 6, COL.asphalt, ry);
      break;
    }
    case 'spillway': {
      g.box(s.x, gy + 1.2, s.z, 5, 2.4, 18, COL.concreteDk, ry);
      g.box(s.x - 2.6, gy + 2, s.z, 0.8, 3, 18, COL.concrete, ry);
      g.box(s.x + 2.6, gy + 2, s.z, 0.8, 3, 18, COL.concrete, ry);
      break;
    }
    case 'mast': {
      const h = 26 * k;
      for (let i = 0; i < 3; i++) {
        const a = ry + (i * TAU) / 3;
        g.tube([s.x + Math.cos(a) * 3, gy, s.z + Math.sin(a) * 3], [s.x, gy + h, s.z], 0.22, 4, COL.metalDk);
      }
      for (let i = 1; i < 7; i++) g.cyl(s.x, gy + (i * h) / 7, s.z, 1.6 - i * 0.18, 1.6 - i * 0.18, 0.16, 6, COL.metal, 0, 'y', false);
      g.box(s.x, gy + h + 1, s.z, 0.5, 2, 0.5, COL.metal);
      gl.box(s.x, gy + h + 2.2, s.z, 0.6, 0.6, 0.6, 0xff4433);
      for (let i = 0; i < 3; i++) {
        const a = ry + (i * TAU) / 3 + 1;
        g.tube([s.x, gy + h * 0.75, s.z], [s.x + Math.cos(a) * 12, gy, s.z + Math.sin(a) * 12], 0.05, 3, COL.metalDk);
      }
      break;
    }
    case 'radome': {
      g.cyl(s.x, gy, s.z, 5 * k, 5 * k, 1.4 * k, 10, COL.concreteDk, ry);
      g.cyl(s.x, gy + 1.4 * k, s.z, 4.6 * k, 0.4 * k, 4.4 * k, 10, COL.paintWhite, ry);
      break;
    }
    case 'traincar': {
      g.box(s.x, gy + 2.6 * k, s.z, 16 * k, 4.4 * k, 5 * k, COL.rust, ry, 0, 0.06);
      g.box(s.x, gy + 5 * k, s.z, 16.4 * k, 0.5 * k, 5.4 * k, COL.rustDk, ry);
      for (const o of [-5.5, 5.5]) {
        for (const side of [-2, 2]) {
          g.cyl(s.x + o * k * Math.cos(ry), gy + 0.9, s.z + side * k * Math.sin(ry), 0.9, 0.9, 0.6, 8, COL.metalDk, ry, 'x');
        }
      }
      scatter(g, s.x + 6, s.z + 5, 10, 55, COL.rustDk, 0.5);
      break;
    }
    case 'windmill': {
      for (let i = 0; i < 4; i++) {
        const a = ry + (i * TAU) / 4 + 0.78;
        g.tube([s.x + Math.cos(a) * 2.6, gy, s.z + Math.sin(a) * 2.6], [s.x + Math.cos(a) * 0.5, gy + 12, s.z + Math.sin(a) * 0.5], 0.16, 4, COL.metalDk);
      }
      g.cyl(s.x, gy + 12, s.z, 0.5, 0.5, 1.6, 6, COL.metal);
      g.cyl(s.x, gy + 13.4, s.z, 1.1, 1.1, 0.8, 6, COL.rust, 0, 'z');
      g.cyl(s.x - 3.4, gy + 4, s.z, 2.2, 2.2, 0.5, 8, COL.metalDk, 0, 'y');
      g.box(s.x, gy + 0.4, s.z, 6, 0.8, 6, COL.concreteDk, ry);
      break;
    }
    case 'truck': {
      g.box(s.x, gy + 1.4 * k, s.z, 5.6 * k, 1.7 * k, 2.4 * k, COL.paintBlue, ry);
      g.box(s.x + 2.4 * k, gy + 2.6 * k, s.z, 1.8 * k, 1.6 * k, 2.3 * k, COL.paintBlue, ry);
      gl.box(s.x + 3.3 * k, gy + 2.8 * k, s.z, 0.3, 0.9, 1.6, COL.glassLit, ry);
      for (const o of [-1.8, 1.6]) for (const side of [-1.2, 1.2]) g.cyl(s.x + o * k, gy + 0.55, s.z + side * k * Math.cos(ry), 0.55, 0.55, 0.4, 8, 0x24262a, ry, 'x');
      break;
    }
    case 'bus': {
      g.box(s.x, gy + 1.9 * k, s.z, 10 * k, 3.2 * k, 3 * k, COL.paintRed, ry, 0, 0.05);
      g.box(s.x, gy + 3.6 * k, s.z, 9.6 * k, 0.5 * k, 2.9 * k, COL.cloth, ry);
      for (let i = -2; i <= 2; i++) gl.box(s.x + i * 1.8 * k, gy + 2.6 * k, s.z + 1.55 * k, 1.4 * k, 1.1 * k, 0.15, 0x2b3138, ry);
      for (const o of [-3.4, 3.4]) for (const side of [-1.4, 1.4]) g.cyl(s.x + o * k, gy + 0.6, s.z + side * k, 0.7, 0.7, 0.45, 8, 0x24262a, ry, 'x');
      break;
    }
    case 'tent': {
      const w = 3.2 * k;
      const d = 4.2 * k;
      g.slab([s.x - w, gy, s.z - d], [s.x - w, gy, s.z + d], [s.x, gy + 2.6 * k, s.z + d], [s.x, gy + 2.6 * k, s.z - d], COL.cloth);
      g.slab([s.x + w, gy, s.z + d], [s.x + w, gy, s.z - d], [s.x, gy + 2.6 * k, s.z - d], [s.x, gy + 2.6 * k, s.z + d], COL.cloth);
      g.slab([s.x - w, gy, s.z - d], [s.x + w, gy, s.z - d], [s.x, gy + 2.6 * k, s.z - d], [s.x, gy + 2.6 * k, s.z - d], COL.clothDk);
      g.box(s.x, gy + 1.3 * k, s.z, 0.12, 2.7 * k, 0.12, COL.woodDk);
      g.cyl(s.x, gy + 0.05, s.z + 2.6, 0.9, 0.9, 0.2, 8, 0x39322c);
      g.cyl(s.x, gy + 0.2, s.z + 2.6, 0.55, 0.7, 0.35, 7, COL.wood, 0, 'y', false);
      break;
    }
    case 'shanty': {
      g.box(s.x, gy + 1.4 * k, s.z, 5 * k, 2.8 * k, 4 * k, COL.woodDk, ry);
      g.slab([s.x - 3 * k, gy + 3.2 * k, s.z - 2.6 * k], [s.x + 3.4 * k, gy + 2.4 * k, s.z - 2.8 * k], [s.x + 3.4 * k, gy + 2.4 * k, s.z + 2.8 * k], [s.x - 3 * k, gy + 3.2 * k, s.z + 2.6 * k], COL.clothDk);
      g.box(s.x + 2, gy + 0.9, s.z - 2.2, 2.4, 1.8, 0.2, COL.metalDk, ry + 0.4);
      scatter(g, s.x, s.z + 3, 5, s.z, COL.rustDk, 0.4);
      break;
    }
    case 'cratepile': {
      for (let i = 0; i < 4; i++) {
        const a = hash2(i, s.x) * 1.2 - 0.6;
        const px = s.x + (i % 2) * 1.5 - 0.7;
        const pz = s.z + Math.floor(i / 2) * 1.4 - 0.7;
        const hgt = 1.2 + hash2(i, 3) * 0.5;
        g.box(px, gy + hgt / 2 + (i > 2 ? 1.2 : 0), pz, 1.2, hgt, 1.2, i > 2 ? COL.paintGreen : COL.wood, a);
        g.box(px, gy + hgt / 2 + (i > 2 ? 1.2 : 0), pz + 0.62, 1.24, 0.16, 0.05, COL.woodDk, a);
      }
      g.slab([s.x - 2, gy + 0.12, s.z - 2], [s.x + 2.4, gy + 0.12, s.z - 1.2], [s.x + 2, gy + 0.12, s.z + 2.2], [s.x - 1.4, gy + 0.12, s.z + 1.8], COL.clothDk);
      break;
    }
    case 'barrelpile': {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + ry;
        const px = s.x + Math.cos(a) * 1.5;
        const pz = s.z + Math.sin(a) * 1.5;
        if (i === 3) g.cyl(px, gy + 0.5, pz, 0.55, 0.55, 1.1, 8, COL.rust, a, 'z');
        else g.cyl(px, gy, pz, 0.55, 0.55, 1.5, 8, i % 2 ? COL.paintGreen : COL.rust, a);
      }
      g.cyl(s.x, gy + 0.04, s.z + 0.4, 2.4, 2.4, 0.06, 9, 0x2a2118);
      break;
    }
    case 'debris':
    case 'rubble': {
      const n = s.t === 'rubble' ? 12 : 7;
      for (let i = 0; i < n; i++) {
        const a = hash2(i * 3, s.x + s.z) * TAU;
        const rr = (0.5 + hash2(i, s.z) * 2.6) * k;
        const px = s.x + Math.cos(a) * rr;
        const pz = s.z + Math.sin(a) * rr;
        const sz2 = (0.4 + hash2(i * 5, s.x) * 1.3) * k;
        g.box(px, ground(px, pz) + sz2 * 0.35, pz, sz2, sz2 * 0.7, sz2 * (0.6 + hash2(i, 9) * 0.9), s.t === 'rubble' ? COL.concreteDk : hash2(i, 2) > 0.5 ? COL.stone : COL.stoneRed, a, (hash2(i, 4) - 0.5) * 0.5);
      }
      for (let i = 0; i < 3; i++) {
        const a = hash2(i + 9, s.x) * TAU;
        g.tube([s.x, gy + 0.2, s.z], [s.x + Math.cos(a) * 2.6, gy + 1.4 + hash2(i, 1) * 1.2, s.z + Math.sin(a) * 2.6], 0.06, 3, COL.rustDk);
      }
      break;
    }
    case 'wallseg': {
      const horiz = Math.abs(Math.cos(ry)) > 0.5;
      g.box(s.x, gy + 1.1, s.z, horiz ? 9 : 1.2, 2.2, horiz ? 1.2 : 9, COL.concreteDk, ry);
      g.box(s.x, gy + 2.35, s.z, horiz ? 9.4 : 1.5, 0.35, horiz ? 1.5 : 9.4, COL.concrete, ry);
      break;
    }
    case 'culvert': {
      g.cyl(s.x, gy + 0.2, s.z, 1.7 * k, 1.7 * k, 9 * k, 9, COL.concreteDk, ry, 'z');
      g.cyl(s.x, gy + 0.2, s.z, 1.45 * k, 1.45 * k, 9.4 * k, 9, 0x24281f, ry, 'z', false);
      g.box(s.x, gy + 0.1, s.z, 5 * k, 0.4, 6 * k, COL.gravel, ry);
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------- vegetation -------
export function buildVeg(g: GB, v: { t: string; x: number; z: number; s: number; ry: number }): void {
  const y = ground(v.x, v.z);
  const k = v.s;
  switch (v.t) {
    case 'pine': {
      g.cyl(v.x, y, v.z, 0.28 * k, 0.2 * k, 2.2 * k, 5, COL.bark, v.ry);
      g.cyl(v.x, y + 1.6 * k, v.z, 2 * k, 0.1, 3.4 * k, 7, COL.pine, v.ry);
      g.cyl(v.x, y + 3.6 * k, v.z, 1.5 * k, 0.1, 2.9 * k, 7, COL.pineDk, v.ry + 0.3);
      g.cyl(v.x, y + 5.4 * k, v.z, 1 * k, 0.05, 2.2 * k, 6, COL.pine, v.ry);
      break;
    }
    case 'aspen': {
      g.cyl(v.x, y, v.z, 0.2 * k, 0.14 * k, 5 * k, 5, 0xbdbcae, v.ry);
      g.cyl(v.x, y + 4.4 * k, v.z, 1.7 * k, 0.4, 2.6 * k, 6, COL.leaf, v.ry);
      break;
    }
    case 'juniper': {
      g.cyl(v.x, y, v.z, 1.5 * k, 0.5, 2.2 * k, 6, COL.pineDk, v.ry);
      g.cyl(v.x, y + 1.6 * k, v.z, 1 * k, 0.2, 1.4 * k, 6, COL.pine, v.ry + 0.4);
      break;
    }
    case 'cactus': {
      g.cyl(v.x, y, v.z, 0.3 * k, 0.24 * k, 2.6 * k, 6, 0x4f6f3c, v.ry);
      g.cyl(v.x + 0.6 * k, y + 0.4, v.z, 0.22 * k, 0.2 * k, 1.3 * k, 5, 0x4f6f3c, v.ry);
      g.cyl(v.x - 0.55 * k, y + 0.2, v.z + 0.2, 0.2 * k, 0.18 * k, 1 * k, 5, 0x4f6f3c, v.ry);
      break;
    }
    case 'sage': {
      for (let i = 0; i < 3; i++) {
        const a = v.ry + (i / 3) * Math.PI;
        const w = 1.5 * k;
        g.slab([v.x - Math.cos(a) * w, y, v.z - Math.sin(a) * w], [v.x + Math.cos(a) * w, y, v.z + Math.sin(a) * w], [v.x + Math.cos(a) * w, y + 1.1 * k, v.z + Math.sin(a) * w], [v.x - Math.cos(a) * w, y + 1.1 * k, v.z - Math.sin(a) * w], COL.sage);
      }
      break;
    }
    case 'grass': {
      for (let i = 0; i < 3; i++) {
        const a = v.ry + (i / 3) * Math.PI;
        const w = 0.85 * k;
        const hgt = (0.65 + hash2(v.x + i, v.z) * 0.5) * k;
        g.slab([v.x - Math.cos(a) * w, y, v.z - Math.sin(a) * w], [v.x + Math.cos(a) * w, y, v.z + Math.sin(a) * w], [v.x + Math.cos(a) * w * 0.5, y + hgt, v.z + Math.sin(a) * w * 0.5], [v.x - Math.cos(a) * w * 0.5, y + hgt, v.z - Math.sin(a) * w * 0.5], i === 1 ? COL.grass : COL.grassDk);
      }
      break;
    }
    case 'flower': {
      g.slab([v.x - 0.4, y, v.z - 0.4], [v.x + 0.4, y, v.z + 0.4], [v.x + 0.4, y + 0.5, v.z + 0.4], [v.x - 0.4, y + 0.5, v.z - 0.4], COL.grassDk);
      g.box(v.x, y + 0.62, v.z, 0.24, 0.16, 0.24, hash2(v.x, v.z) > 0.5 ? 0xd9d06a : 0xb27fc0, v.ry);
      break;
    }
    case 'reed': {
      for (let i = 0; i < 5; i++) {
        const a = hash2(v.x + i, v.z) * TAU;
        const dx = Math.cos(a) * 0.5;
        const dz = Math.sin(a) * 0.5;
        const hgt = (1.3 + hash2(i, v.z) * 0.9) * k;
        g.slab([v.x + dx - 0.09, y - 0.2, v.z + dz], [v.x + dx + 0.09, y - 0.2, v.z + dz], [v.x + dx * 1.8 + 0.05, y + hgt, v.z + dz * 1.8], [v.x + dx * 1.8 - 0.05, y + hgt, v.z + dz * 1.8], COL.reed);
      }
      break;
    }
    case 'cattail': {
      for (let i = 0; i < 4; i++) {
        const a = hash2(v.x, v.z + i) * TAU;
        const dx = Math.cos(a) * 0.4;
        const dz = Math.sin(a) * 0.4;
        const hgt = (2 + hash2(i, v.x) * 0.8) * k;
        g.slab([v.x + dx - 0.1, y - 0.2, v.z + dz], [v.x + dx + 0.1, y - 0.2, v.z + dz], [v.x + dx * 2 + 0.06, y + hgt, v.z + dz * 2], [v.x + dx * 2 - 0.06, y + hgt, v.z + dz * 2], COL.reed);
        g.cyl(v.x + dx * 2, y + hgt, v.z + dz * 2, 0.11, 0.09, 0.55, 5, COL.cattail, 0);
      }
      break;
    }
    case 'rock': {
      for (let i = 0; i < 3; i++) {
        const sz2 = (0.7 + hash2(i, v.x * v.z) * 1.2) * k;
        const px = v.x + (hash2(i + 1, v.z) - 0.5) * 1.6 * k;
        const pz = v.z + (hash2(i + 3, v.x) - 0.5) * 1.6 * k;
        g.box(px, ground(px, pz) + sz2 * 0.3, pz, sz2, sz2 * 0.8, sz2 * 0.85, hash2(i, v.x) > 0.6 ? COL.stoneRed : COL.stone, v.ry + i, hash2(i, 7) * 0.3);
      }
      break;
    }
    case 'dead': {
      g.cyl(v.x, y, v.z, 0.32 * k, 0.12 * k, 4.4 * k, 5, COL.bark, v.ry);
      for (let i = 0; i < 4; i++) {
        const a = v.ry + (i / 4) * TAU;
        g.tube([v.x, y + (2 + i * 0.5) * k, v.z], [v.x + Math.cos(a) * 1.7 * k, y + (3.2 + i * 0.55) * k, v.z + Math.sin(a) * 1.7 * k], 0.09 * k, 4, COL.bark);
      }
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------- chunks -----
/** Terrain + roads + props + vegetation + water for one chunk. */
export interface ChunkGeo {
  terrain: THREE.BufferGeometry | null;
  props: THREE.BufferGeometry | null;
  veg: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
  water: THREE.BufferGeometry | null;
}

export function buildChunkGeo(cx: number, cz: number): ChunkGeo {
  const ter = new GB();
  const prop = new GB();
  const veg = new GB();
  const glow = new GB();
  const wat = new GB();
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  const CS = Q;

  const hg: number[][] = [];
  const col: number[][] = [];
  for (let i = 0; i <= SEG; i++) {
    hg[i] = [];
    col[i] = [];
    for (let j = 0; j <= SEG; j++) {
      const x = x0 + j * CS;
      const z = z0 + i * CS;
      const h = ground(x, z);
      const sl = slopeAt(x, z);
      hg[i][j] = h;
      col[i][j] = groundColor(x, z, h, sl);
    }
  }
  for (let i = 0; i < SEG; i++) {
    for (let j = 0; j < SEG; j++) {
      const x = x0 + j * CS;
      const z = z0 + i * CS;
      const h00 = hg[i][j];
      const h10 = hg[i][j + 1];
      const h01 = hg[i + 1][j];
      const h11 = hg[i + 1][j + 1];
      const mx = x + CS / 2;
      const mz = z + CS / 2;
      const hh = (h00 + h10 + h01 + h11) / 4;
      const sl = slopeAt(mx, mz);
      const base = groundColor(mx, mz, hh, sl);
      const a: V3 = [x, h00, z];
      const b: V3 = [x + CS, h10, z];
      const c: V3 = [x + CS, h11, z + CS];
      const d: V3 = [x, h01, z + CS];
      const surf = surfaceAt(mx, mz, hh, sl);
      ter.quad(a, b, c, d, base);
      const zr = roadZ(mx);
      const drr = Math.abs(mz - zr);
      if (drr < 7.8) {
        // road edge lines, wheel ruts and dashed centre line, drawn just above the surface
        const yq = hh + 0.05;
        if (drr > 6.3) ter.quad([x, h00 + 0.05, z], [x + CS, h10 + 0.05, z], [x + CS, h11 + 0.05, z + CS], [x, h01 + 0.05, z + CS], COL.gravel);
        if (Math.abs(drr - 2.6) < 0.75) ter.quad([x, yq, z], [x + CS, yq, z], [x + CS, yq, z + CS], [x, yq, z + CS], shade(COL.gravel, 0.84));
        if (drr < 2 && Math.floor((mx % 9) / 4.5) === 0)
          ter.quad([mx - 1.7, yq, zr - 0.3], [mx + 1.7, yq, zr - 0.3], [mx + 1.7, yq, zr + 0.3], [mx - 1.7, yq, zr + 0.3], 0xd8d0a8);
      } else if (surf === 'gravel' && Math.hypot(mx - PLAZA.x, mz - PLAZA.z) < 26) {
        // town plaza paving
        const pk = hash2(Math.floor(mx / 2.6), Math.floor(mz / 2.6));
        ter.quad([x, h00 + 0.04, z], [x + CS, h10 + 0.04, z], [x + CS, h11 + 0.04, z + CS], [x, h01 + 0.04, z + CS], pk > 0.5 ? 0xa8a294 : 0x999386);
      }
      // shoreline sand band
      const wl = waterAt(mx, mz);
      if (wl < -1e8) {
        for (let w = 0; w < waters.length; w++) {
          const wb = waters[w];
          const dd = Math.hypot(mx - wb.x, mz - wb.z);
          if (dd < wb.r + 6 && dd > wb.r - 2) ter.tri(a, b, c, COL.sand);
        }
      }
    }
  }

  // water surfaces
  for (let i = 0; i < waters.length; i++) {
    const w = waters[i];
    if (Math.abs(w.x - (x0 + CHUNK / 2)) < CHUNK + w.r && Math.abs(w.z - (z0 + CHUNK / 2)) < CHUNK + w.r) {
      const seg = 14;
      const cy = w.level;
      for (let ring = 0; ring < 3; ring++) {
        const r0 = (w.r * ring) / 3;
        const r1 = (w.r * (ring + 1)) / 3;
        for (let s = 0; s < seg; s++) {
          const a0 = (s / seg) * TAU;
          const a1 = ((s + 1) / seg) * TAU;
          const p = (r: number, a: number): V3 => {
            const px = w.x + Math.cos(a) * r;
            const pz = w.z + Math.sin(a) * r;
            return [px, cy + Math.sin(px * 0.3 + pz * 0.2) * 0.03, pz];
          };
          if (r0 === 0) ter.tri(p(0, 0), p(r1, a0), p(r1, a1), 0x2f4b52);
          else wat.quad(p(r0, a0), p(r0, a1), p(r1, a1), p(r1, a0), ring === 2 ? 0x39585f : 0x2f4b52);
        }
      }
    }
  }
  // river ribbon
  {
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const xa = x0 + (i / steps) * CHUNK;
      const xb = x0 + ((i + 1) / steps) * CHUNK;
      const za = riverZ(xa);
      const zb = riverZ(xb);
      const la = riverLevel(xa);
      const lb = riverLevel(xb);
      const wd = 10.5;
      wat.quad([xa, la, za - wd], [xb, lb, zb - wd], [xb, lb - 0.02, zb + wd], [xa, la - 0.02, za + wd], 0x32515a);
    }
  }

  // static structures assigned to this chunk
  const hx = x0 + CHUNK / 2;
  const hz = z0 + CHUNK / 2;
  for (const s of structs) {
    if (Math.abs(s.x - hx) > CHUNK * 1.1 || Math.abs(s.z - hz) > CHUNK * 1.1) continue;
    if (Math.hypot(s.x - PLAZA.x, s.z - PLAZA.z) < 34 && s.t === 'house') continue;
    buildStruct(prop, glow, s);
  }
  // town hub decoration ring (concrete pads, planters, barriers)
  if (Math.hypot(hx - PLAZA.x, hz - PLAZA.z) < CHUNK + 40) {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      const px = PLAZA.x + Math.cos(a) * 24;
      const pz = PLAZA.z + Math.sin(a) * 24;
      prop.box(px, ground(px, pz) + 0.4, pz, 1.6, 0.8, 0.7, COL.concreteDk, a);
      if (i % 4 === 0) prop.box(px, ground(px, pz) + 1.1, pz, 0.5, 0.6, 0.5, COL.paintYellow, a);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.4;
      const px = PLAZA.x + Math.cos(a) * 12;
      const pz = PLAZA.z + Math.sin(a) * 12;
      prop.cyl(px, ground(px, pz), pz, 1.1, 1.1, 0.35, 7, COL.concrete, a);
    }
  }

  for (const v of vegForChunk(cx, cz)) buildVeg(veg, v);

  const nz = (gb: GB): THREE.BufferGeometry | null => (gb.pos.length ? gb.geom() : null);
  return { terrain: nz(ter), props: nz(prop), veg: nz(veg), glow: nz(glow), water: nz(wat) };
}
