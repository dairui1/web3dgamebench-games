// Canyon world: procedural mountain terrain carved around a sinuous river
// canyon spline, plus river ribbon, instanced rocks/trees, clouds and sky.

import * as THREE from 'three';
import { fbm, noise2, smoothstep, clamp, bell, lerp } from './math';
import { makeCloudTexture, makeGlowTexture, makeRockMaterial, makeTreeFoliageTexture } from './models';

export const WORLD_HALF = 8200; // x extent
// terrain depth is larger than the spline span so the map has solid ground
// past the canyon mouth
const TERRAIN_DEPTH = 12500;
export const WORLD_DEPTH = TERRAIN_DEPTH; // z extent
// WORLD_DEPTH only used as the spline/watch span; terrain spans z ∈ [-6250, 6250]
export const TERRAIN_SPAN = 6250;
export const START_Z = 4900;
export const EXTRACT_Z = -4900;

export class Canyon {
  readonly spline: THREE.CatmullRomCurve3;
  /** Sampled spline points (x, h, z, s-tangent yaw, floor height). */
  private sx: Float32Array;
  private sy: Float32Array;
  private sz: Float32Array;
  private syaw: Float32Array;
  private floorH: number[]; // along sample
  private segLen: number;
  readonly samples: number;
  readonly totalLen: number;

  readonly group = new THREE.Group();
  private treeMat: THREE.Material = new THREE.MeshStandardMaterial();
  private rockMat: THREE.Material = new THREE.MeshStandardMaterial();

  constructor() {
    const ctl = [
      new THREE.Vector3(60, 0, 4900),
      new THREE.Vector3(430, 0, 4300),
      new THREE.Vector3(170, 0, 3600),
      new THREE.Vector3(-380, 0, 2750),
      new THREE.Vector3(-180, 0, 1950),
      new THREE.Vector3(520, 0, 1200),
      new THREE.Vector3(90, 0, 450),
      new THREE.Vector3(-460, 0, -380),
      new THREE.Vector3(-130, 0, -1250),
      new THREE.Vector3(460, 0, -2150),
      new THREE.Vector3(180, 0, -3000),
      new THREE.Vector3(-400, 0, -3850),
      new THREE.Vector3(-60, 0, -4900),
    ];
    this.spline = new THREE.CatmullRomCurve3(ctl, false, 'catmullrom', 0.6);
    this.samples = 560;
    const pts = this.spline.getSpacedPoints(this.samples);
    this.totalLen = this.spline.getLength();
    this.segLen = this.totalLen / this.samples;
    this.sx = new Float32Array(this.samples + 1);
    this.sy = new Float32Array(this.samples + 1);
    this.sz = new Float32Array(this.samples + 1);
    this.syaw = new Float32Array(this.samples + 1);
    this.floorH = new Array(this.samples + 1).fill(0) as number[];
    for (let i = 0; i <= this.samples; i++) {
      const p = i < pts.length ? pts[i] : pts[pts.length - 1];
      this.sx[i] = p.x;
      this.sz[i] = p.z;
      this.floorH[i] = 92 + (fbm(p.z * 0.003 + 41, p.x * 0.005, 3) - 0.5) * 60 + (p.z - START_Z) * 0.0016;
      this.sy[i] = this.floorH[i];
    }
    for (let i = 0; i <= this.samples; i++) {
      const a = this.sz[clamp(i - 1, 0, this.samples)];
      const b = this.sz[clamp(i + 1, 0, this.samples)];
      const ca = this.sx[clamp(i - 1, 0, this.samples)];
      const cb = this.sx[clamp(i + 1, 0, this.samples)];
      // Plane forward is -Z at yaw 0: forward = (-sin(yaw), -cos(yaw)) in XZ.
      // Heading along travel dir (dx, dz) requires yaw = atan2(-dx, -dz).
      this.syaw[i] = Math.atan2(-(cb - ca), -(b - a));
    }
  }

  /** Distance to the canyon centerline (approximate, cheap). */
  distToSpline(x: number, z: number): number {
    const n = this.samples;
    let best = 1e9;
    for (let i = 0; i <= n; i += 16) {
      const dx = this.sx[i] - x;
      const dz = this.sz[i] - z;
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  /** Closest sample index to (x,z). */
  closestS(x: number, z: number): number {
    const n = this.samples;
    let bestI = 0;
    let best = 1e18;
    for (let i = 0; i <= n; i += 16) {
      const dx = this.sx[i] - x;
      const dz = this.sz[i] - z;
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        bestI = i;
      }
    }
    // refine locally
    for (let k = -8; k <= 8; k++) {
      const i = clamp(bestI + k, 0, n);
      const dx = this.sx[i] - x;
      const dz = this.sz[i] - z;
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        bestI = i;
      }
    }
    return bestI;
  }

  /** Point on spline at sample index. */
  sampleAt(i: number): { x: number; y: number; z: number; yaw: number; floor: number; i: number } {
    const k = clamp(Math.round(i), 0, this.samples);
    return { x: this.sx[k], y: this.sy[k], z: this.sz[k], yaw: this.syaw[k], floor: this.floorH[k], i: k };
  }

  /** World height at (x,z). */
  heightAt(x: number, z: number): number {
    const d = this.distToSpline(x, z);
    const s = this.closestS(x, z);
    const floor = this.floorH[s];
    // Deep riverbed notch under the centerline
    const notch = 4.6 * bell(d / 17);
    const floorFinal = floor - notch;
    // Rugged mountains
    const m = fbm(x * 0.00032 + 7.3, z * 0.00032 - 2.1, 5);
    let mount = (m * m * 1.18 + m * 0.22) * 640;
    mount += fbm(x * 0.0011, z * 0.0011, 2) * 90;
    const wall = smoothstep(60, 620, d);
    let h = lerp(floorFinal, mount, wall);
    // small-scale roughness on walls
    const rough = (noise2(x * 0.02, z * 0.02) - 0.5) * (1.2 + wall * 13);
    h += rough * (0.25 + wall);
    return clamp(h, -5, 2400);
  }

  /** Stylized height used for coloring (cheaper). */
  colorHeight(x: number, z: number): number {
    return this.heightAt(x, z);
  }

  private buildTerrain(): void {
    const w = WORLD_HALF * 2;
    const d = TERRAIN_SPAN * 2;
    const segW = 190;
    const segD = 196;
    const geo = new THREE.PlaneGeometry(w, d, segW, segD);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, 0);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const tmp = new THREE.Color();

    const sand = tmp.setRGB(0.42, 0.36, 0.26);
    const grass = tmp.setRGB(0.19, 0.3, 0.14);
    const rock = tmp.setRGB(0.3, 0.28, 0.26);
    const darkRock = tmp.setRGB(0.22, 0.2, 0.18);
    const snow = tmp.setRGB(0.88, 0.9, 0.92);

    const v = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const x = v.x;
      const z = v.z;
      const h = v.y;
      const dSpline = this.distToSpline(x, z);
      const s = this.closestS(x, z);
      const floor = this.floorH[s];
      // Base color by elevation with noise breakup
      const n = fbm(x * 0.0031, z * 0.0031, 3);
      const clif = smoothstep(floor + 40, floor + 340, h);
      const snowAmt = smoothstep(1050, 1350, h) * (0.55 + n * 0.45);
      const grassAmt = smoothstep(floor + 18, floor + 90, h) * (1 - clif) * (0.35 + n * 0.65);
      const inCanyon = dSpline < 105;
      // Rock hue variation
      const rockN = fbm(x * 0.0013 + 9, z * 0.0013 + 4, 3);
      const r = lerp(0.26, 0.34, rockN);
      const g = lerp(0.24, 0.3, rockN);
      const b = lerp(0.22, 0.26, rockN + 0.05);
      c.setRGB(r, g, b);
      if (inCanyon && clif < 0.12) {
        const riverAmt = 1 - smoothstep(0, 95, dSpline);
        const sandN = noise2(x * 0.05, z * 0.05);
        c.lerp(sand, clamp(riverAmt, 0, 1) * (0.85 + sandN * 0.3));
      }
      c.lerp(grass, grassAmt * 0.75);
      c.lerp(darkRock, smoothstep(floor + 90, floor + 200, h) * clif * 0.4 * n);
      c.lerp(snow, snowAmt);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.02, flatShading: false });
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -2;
    const mesh = new THREE.Mesh(geo, material);
    this.group.add(mesh);
  }

  private buildRiver(): void {
    const pts: THREE.Vector3[] = [];
    const n = 130;
    for (let i = 0; i <= n; i++) {
      const s = this.sampleAt((i / n) * this.samples);
      pts.push(new THREE.Vector3(s.x, s.floor - 2.2, s.z));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.BufferGeometry();
    const segs = 260;
    const halfW = 15;
    const positions = new Float32Array((segs + 1) * 2 * 3);
    const uv = new Float32Array((segs + 1) * 2 * 2);
    const p = new THREE.Vector3();
    const t = new THREE.Vector3();
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      curve.getPointAt(u, p);
      curve.getTangentAt(u, t);
      const tx = -t.z;
      const tz = t.x;
      const len = Math.hypot(tx, tz) || 1;
      tx / len;
      const Nx = tx / len;
      const Nz = tz / len;
      positions.set([p.x + Nx * halfW, p.y, p.z + Nz * halfW], i * 6);
      positions.set([p.x - Nx * halfW, p.y, p.z - Nz * halfW], i * 6 + 3);
      uv.set([u, 0], i * 4);
      uv.set([u, 1], i * 4 + 2);
    }
    const idx: number[] = [];
    for (let i = 0; i < segs; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2e7fae,
      roughness: 0.25,
      metalness: 0.55,
      transparent: true,
      opacity: 0.88,
      emissive: 0x0a2c40,
      emissiveIntensity: 0.5,
    });
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = 1;
    mat.polygonOffsetUnits = 2;
    const river = new THREE.Mesh(geo, mat);
    this.group.add(river);
  }

  private buildScatter(): void {
    // Rocks
    const rockCount = 950;
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    rockGeo.scale(1, 0.75, 1);
    this.rockMat = makeRockMaterial();
    const rocks = new THREE.InstancedMesh(rockGeo, this.rockMat, rockCount);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    const pv = new THREE.Vector3();
    let placed = 0;
    let guard = 0;
    while (placed < rockCount && guard++ < rockCount * 20) {
      const x = randIn(-WORLD_HALF + 200, WORLD_HALF - 200);
      const z = randIn(-TERRAIN_SPAN + 200, TERRAIN_SPAN - 200);
      const h = this.heightAt(x, z);
      const d = this.distToSpline(x, z);
      if (d < 40 && Math.random() < 0.55) {
        // canyon floor boulders
        const s = (d > 14 ? 2.5 : 6) * randIn(0.5, 1.4);
        pv.set(x, h + s * 0.1, z);
        e.set(randIn(0, 6.3), randIn(0, 6.3), randIn(0, 6.3));
        q.setFromEuler(e);
        sc.set(s, s * randIn(0.8, 1.1), s);
        m4.compose(pv, q, sc);
        rocks.setMatrixAt(placed, m4);
        placed++;
      } else if (d >= 130 && d < 1500 && h > this.sampleAt(0).floor + 60 && h < 800 && Math.random() < 0.05) {
        const s = randIn(0.4, 1.5);
        pv.set(x, h + s * 0.15, z);
        e.set(randIn(0, 6.3), randIn(0, 6.3), randIn(0, 6.3));
        q.setFromEuler(e);
        sc.set(s, s, s);
        m4.compose(pv, q, sc);
        rocks.setMatrixAt(placed, m4);
        placed++;
      }
    }
    rocks.count = placed;
    rocks.instanceMatrix.needsUpdate = true;
    this.group.add(rocks);

    // Trees
    const treeCount = 1500;
    const foliageTex = makeTreeFoliageTexture();
    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.4, 2.4, 5);
    const leafGeo = new THREE.ConeGeometry(1.7, 4.6, 7);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3624, roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, map: foliageTex });
    leafMat.alphaTest = 0.35;
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, treeCount);
    const q2 = new THREE.Quaternion();
    const sc2 = new THREE.Vector3();
    let placed2 = 0;
    guard = 0;
    while (placed2 < treeCount && guard++ < treeCount * 24) {
      const x = randIn(-WORLD_HALF + 400, WORLD_HALF - 400);
      const z = randIn(-TERRAIN_SPAN + 300, TERRAIN_SPAN - 300);
      const h = this.heightAt(x, z);
      const d = this.distToSpline(x, z);
      const sIdx = this.closestS(x, z);
      const floor = this.floorH[sIdx];
      if (d < 90 || d > 1600) continue;
      if (h < floor + 30 || h > floor + 420) continue;
      if (Math.random() < 0.5) continue;
      const s = randIn(0.7, 1.9);
      pv.set(x, h, z);
      q2.identity();
      sc2.set(1, 1, 1);
      m4.compose(pv, q2, sc2);
      trunks.setMatrixAt(placed2, m4);
      const le = new THREE.Matrix4();
      pv.set(x, h + 3.6 * s, z);
      sc2.set(s, s, s);
      e.set(randIn(-0.15, 0.15), randIn(0, 6.3), randIn(-0.15, 0.15));
      q2.setFromEuler(e);
      le.compose(pv, q2, sc2);
      leaves.setMatrixAt(placed2, le);
      placed2++;
    }
    trunks.count = placed2;
    leaves.count = placed2;
    trunks.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;
    this.group.add(trunks);
    this.group.add(leaves);
  }

  private buildSkyAndClouds(): void {
    // Gradient sky dome
    const cv = document.createElement('canvas');
    cv.width = 32;
    cv.height = 256;
    const ctx = cv.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#234a75');
    g.addColorStop(0.45, '#7796b5');
    g.addColorStop(0.68, '#c9a97c');
    g.addColorStop(0.78, '#e3c79a');
    g.addColorStop(1, '#8a6f4e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 256);
    const tex = new THREE.CanvasTexture(cv);
    const skyGeo = new THREE.SphereGeometry(16000, 24, 14);
    const skyMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.position.y = -2000;
    this.group.add(sky);

    // Sun disc
    const sunTex = makeGlowTexture({ inner: 'rgba(255,244,214,1)', outer: 'rgba(255,220,150,0.5)' });
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, fog: false, transparent: true, depthWrite: false }));
    sun.position.set(2600, 2200, -4000);
    sun.scale.set(900, 900, 1);
    this.group.add(sun);

    // Clouds
    const cloudTex = makeCloudTexture();
    const clouds = new THREE.Group();
    for (let i = 0; i < 46; i++) {
      const spr = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: randIn(0.5, 0.85), depthWrite: false, fog: true })
      );
      const a = randIn(0, Math.PI * 2);
      const r = randIn(1600, 6400);
      spr.position.set(Math.cos(a) * r, randIn(1050, 1700), Math.sin(a) * r);
      const s = randIn(500, 1250);
      spr.scale.set(s * randIn(1.4, 2.6), s * 0.55, 1);
      clouds.add(spr);
    }
    this.group.add(clouds);
    this.group.userData.clouds = clouds;
  }

  build(scene: THREE.Scene): void {
    this.buildTerrain();
    this.buildRiver();
    this.buildScatter();
    this.buildSkyAndClouds();
    scene.add(this.group);
  }

  update(dt: number, clock: number): void {
    const clouds = this.group.userData.clouds as THREE.Group | undefined;
    if (clouds) {
      clouds.position.x = Math.sin(clock * 0.006) * 60;
      clouds.position.z = Math.cos(clock * 0.005) * 60;
    }
    void dt;
  }

  /** Cheap LOS check: returns true if the point is visible from origin (no terrain between). */
  hasLOS(ox: number, oy: number, oz: number, tx: number, ty: number, tz: number): boolean {
    const dx = tx - ox;
    const dz = tz - oz;
    const dist = Math.hypot(dx, dz);
    if (dist < 4) return true;
    const steps = Math.ceil(dist / 130);
    for (let i = 1; i < steps; i++) {
      const u = i / steps;
      const x = ox + dx * u;
      const z = oz + dz * u;
      const y = oy + (ty - oy) * u;
      if (this.heightAt(x, z) > y + 5) return false;
    }
    return true;
  }
}

function randIn(a: number, b: number): number {
  return a + Math.random() * (b - a);
}