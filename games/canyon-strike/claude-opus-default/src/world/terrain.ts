import * as THREE from 'three';
import { clamp, fbm, ridged, smoothstep, lerp } from '../core/mathutil';

/**
 * Procedural canyon terrain. The canyon meanders along +Z; everything else is
 * derived analytically so that collision queries agree exactly with the mesh.
 */
export const WORLD = {
  zStart: -3400,
  zEnd: 3600,
  zMin: -3900,
  zMax: 4100,
  xHalf: 1850,
  /** Player must stay within this lateral distance of the canyon centre line. */
  corridor: 1150,
  ceiling: 1250,
  waterLevel: 30,
};

const CHUNK_Z = 520;
const STEP = 17;

export function pathX(z: number): number {
  return (
    360 * Math.sin(z * 0.00072) +
    170 * Math.sin(z * 0.00191 + 1.7) +
    82 * Math.sin(z * 0.00427 + 0.4)
  );
}

export function pathTangent(z: number): THREE.Vector3 {
  const dx =
    360 * 0.00072 * Math.cos(z * 0.00072) +
    170 * 0.00191 * Math.cos(z * 0.00191 + 1.7) +
    82 * 0.00427 * Math.cos(z * 0.00427 + 0.4);
  return new THREE.Vector3(dx, 0, 1).normalize();
}

export function canyonHalfWidth(z: number): number {
  return 235 + 95 * Math.sin(z * 0.00212 + 2.2) + 42 * Math.sin(z * 0.0057);
}

/** Distance from the canyon centre line (approximate but monotonic). */
export function distFromPath(x: number, z: number): number {
  return Math.abs(x - pathX(z));
}

function floorHeight(x: number, z: number, d: number): number {
  const bed = smoothstep(0, 140, d) * 34;
  const bumps = fbm(x * 0.0042, z * 0.0042, 2) * 11;
  const ripple = Math.sin(z * 0.011 + x * 0.004) * 3;
  return 14 + bed + bumps + ripple;
}

function mountainHeight(x: number, z: number): number {
  const r = ridged(x * 0.00041, z * 0.00041, 4);
  const soft = fbm(x * 0.0013, z * 0.0013, 3) * 0.5 + 0.5;
  const detail = fbm(x * 0.0067, z * 0.0067, 2) * 26;
  return 250 + r * 560 + soft * 170 + detail;
}

export function heightAt(x: number, z: number): number {
  const d = distFromPath(x, z);
  const w = canyonHalfWidth(z);
  // Wall profile: near-vertical cliffs just outside the canyon floor.
  let t = smoothstep(w * 0.82, w + 210, d);
  t = t * t * (3 - 2 * t);
  const h =
    t <= 0.001
      ? floorHeight(x, z, d)
      : t >= 0.999
        ? mountainHeight(x, z)
        : lerp(floorHeight(x, z, d), mountainHeight(x, z), t);

  // Bounding ridges keep the mission inside a readable corridor.
  const outX = smoothstep(1230, WORLD.xHalf, d);
  const outZ =
    smoothstep(WORLD.zEnd + 180, WORLD.zMax, z) + smoothstep(-WORLD.zStart + 180, -WORLD.zMin, -z);
  const bound = clamp(outX + outZ, 0, 1);
  return h + bound * 900;
}

export function normalAt(x: number, z: number, eps = 6): THREE.Vector3 {
  const hL = heightAt(x - eps, z);
  const hR = heightAt(x + eps, z);
  const hD = heightAt(x, z - eps);
  const hU = heightAt(x, z + eps);
  return new THREE.Vector3(hL - hR, 2 * eps, hD - hU).normalize();
}

/** A point on the canyon floor centre line, lifted by `alt`. */
export function pathPoint(z: number, alt = 0): THREE.Vector3 {
  const x = pathX(z);
  return new THREE.Vector3(x, heightAt(x, z) + alt, z);
}

const C_SAND = new THREE.Color(0x9c7549);
const C_BED = new THREE.Color(0x6f5a3d);
const C_RUST = new THREE.Color(0x8c4b32);
const C_OCHRE = new THREE.Color(0xa9723f);
const C_ROCK = new THREE.Color(0x6d6257);
const C_HIGH = new THREE.Color(0x8a8177);
const C_SNOW = new THREE.Color(0xe6ecf2);

const tmpColor = new THREE.Color();

function colorAt(x: number, y: number, z: number, slope: number, target: THREE.Color): void {
  // Sedimentary banding.
  const band = Math.sin(y * 0.055 + fbm(x * 0.002, z * 0.002, 2) * 2.2) * 0.5 + 0.5;
  tmpColor.copy(C_RUST).lerp(C_OCHRE, band);
  const low = smoothstep(20, 120, y);
  target.copy(C_BED).lerp(C_SAND, smoothstep(16, 60, y)).lerp(tmpColor, low);
  target.lerp(C_ROCK, smoothstep(180, 420, y));
  target.lerp(C_HIGH, smoothstep(430, 700, y));
  target.lerp(C_SNOW, smoothstep(690, 830, y) * smoothstep(0.75, 0.35, slope));
  // Exposed cliff faces read darker and greyer.
  const cliff = smoothstep(0.62, 0.14, slope);
  target.lerp(C_ROCK, cliff * 0.45);
  const grain = fbm(x * 0.02, z * 0.02, 2) * 0.09 + fbm(x * 0.11, z * 0.11, 2) * 0.05;
  target.offsetHSL(0, 0, grain);
}

export interface TerrainBuild {
  group: THREE.Group;
  water: THREE.Mesh;
  chunks: THREE.Mesh[];
}

export function buildTerrain(): TerrainBuild {
  const group = new THREE.Group();
  group.name = 'terrain';
  const chunks: THREE.Mesh[] = [];

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });

  // Sample the height field once into a shared grid; chunks and slopes are
  // derived from it so the expensive noise is evaluated a single time.
  const cols = Math.ceil((WORLD.xHalf * 2) / STEP) + 1;
  const totalRows = Math.ceil((WORLD.zMax - WORLD.zMin) / STEP) + 1;
  const grid = new Float32Array(cols * totalRows);
  const xAt = (c: number): number => Math.min(WORLD.xHalf, -WORLD.xHalf + c * STEP);
  const zAt = (r: number): number => Math.min(WORLD.zMax, WORLD.zMin + r * STEP);
  for (let r = 0; r < totalRows; r++) {
    const z = zAt(r);
    const base = r * cols;
    for (let c = 0; c < cols; c++) grid[base + c] = heightAt(xAt(c), z);
  }
  const sample = (c: number, r: number): number =>
    grid[Math.min(totalRows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))];

  const rowsPerChunk = Math.max(2, Math.round(CHUNK_Z / STEP));
  const color = new THREE.Color();
  const invLen = 1 / (2 * STEP);

  for (let r0 = 0; r0 < totalRows - 1; r0 += rowsPerChunk) {
    const r1 = Math.min(totalRows - 1, r0 + rowsPerChunk);
    const rows = r1 - r0 + 1;

    const positions = new Float32Array(cols * rows * 3);
    const colors = new Float32Array(cols * rows * 3);
    const indices: number[] = [];

    for (let r = 0; r < rows; r++) {
      const gr = r0 + r;
      const z = zAt(gr);
      for (let c = 0; c < cols; c++) {
        const x = xAt(c);
        const y = sample(c, gr);
        const i = (r * cols + c) * 3;
        positions[i] = x;
        positions[i + 1] = y;
        positions[i + 2] = z;
        // Slope from grid neighbours (only the up component is needed).
        const dx = (sample(c - 1, gr) - sample(c + 1, gr)) * invLen;
        const dz = (sample(c, gr - 1) - sample(c, gr + 1)) * invLen;
        const up = 1 / Math.sqrt(dx * dx + dz * dz + 1);
        colorAt(x, y, z, up, color);
        colors[i] = color.r;
        colors[i + 1] = color.g;
        colors[i + 2] = color.b;
      }
    }

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const cc = a + cols;
        const d = cc + 1;
        indices.push(a, cc, b, b, cc, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, material);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.userData.centerZ = (zAt(r0) + zAt(r1)) * 0.5;
    chunks.push(mesh);
    group.add(mesh);
  }

  // River threading the canyon floor.
  const waterGeo = new THREE.PlaneGeometry(1, 1, 1, 220);
  const wPos = waterGeo.attributes.position as THREE.BufferAttribute;
  const span = WORLD.zMax - WORLD.zMin;
  for (let i = 0; i < wPos.count; i++) {
    const u = wPos.getX(i);
    const v = wPos.getY(i);
    const z = WORLD.zMin + (v + 0.5) * span;
    const width = 120 + 45 * Math.sin(z * 0.003);
    wPos.setXYZ(i, pathX(z) + u * width, 0, z);
  }
  waterGeo.computeVertexNormals();
  const water = new THREE.Mesh(
    waterGeo,
    new THREE.MeshStandardMaterial({
      color: 0x2a4f63,
      roughness: 0.15,
      metalness: 0.5,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
    })
  );
  water.position.y = WORLD.waterLevel;
  water.renderOrder = -1;
  group.add(water);

  return { group, water, chunks };
}

/** Hides chunks that fog would swallow anyway. */
export function updateTerrainVisibility(chunks: THREE.Mesh[], cameraZ: number, range: number): void {
  for (const c of chunks) {
    c.visible = Math.abs((c.userData.centerZ as number) - cameraZ) < range;
  }
}
