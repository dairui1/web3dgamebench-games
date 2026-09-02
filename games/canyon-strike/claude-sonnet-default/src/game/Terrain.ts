import * as THREE from 'three';
import { clamp, fbm2D, smoothstep } from './utils.ts';

export const CANYON_LENGTH = 6000;
export const CANYON_START_Z = -200;
export const CANYON_END_Z = CANYON_START_Z + CANYON_LENGTH;
export const WORLD_HALF_WIDTH = 1400;

/** Horizontal center-line offset of the canyon floor at a given z. */
export function pathX(z: number): number {
  return (
    Math.sin(z * 0.0011) * 260 +
    Math.sin(z * 0.00037 + 1.4) * 340 +
    Math.sin(z * 0.0027 + 4.1) * 60
  );
}

function wallHeight(z: number): number {
  return 260 + Math.sin(z * 0.0009 + 2.2) * 70 + fbm2D(z * 0.0006, 5.2, 2) * 60;
}

/** Terrain elevation (y) at world x,z. Shared by rendering and collision. */
export function heightAt(x: number, z: number): number {
  const cx = pathX(z);
  const lateral = x - cx;
  const abs = Math.abs(lateral);

  const floorNoise = fbm2D(x * 0.004, z * 0.004, 3) * 10 + fbm2D(x * 0.02, z * 0.02, 2) * 3;

  const wallStart = 95;
  const wallEnd = 280;
  const peak = wallHeight(z);

  let h: number;
  if (abs < wallStart) {
    h = floorNoise * smoothstep(0, wallStart, abs) * 0.5 + floorNoise * 0.5;
  } else if (abs < wallEnd) {
    const t = (abs - wallStart) / (wallEnd - wallStart);
    const rugged = fbm2D(x * 0.006, z * 0.006, 4) * 40 * t;
    h = smoothstep(0, 1, t) * peak + rugged;
  } else {
    const beyond = clamp((abs - wallEnd) / 900, 0, 1);
    const mountain = fbm2D(x * 0.0028, z * 0.0028, 5) * 220;
    h = peak + beyond * 380 + mountain * (0.4 + beyond);
  }
  return h;
}

function colorFor(h: number, slopeFactor: number): THREE.Color {
  const rock = new THREE.Color(0x5c5347);
  const rockLight = new THREE.Color(0x7c7061);
  const dirt = new THREE.Color(0x6b5a3d);
  const snow = new THREE.Color(0xe8ecef);
  const grass = new THREE.Color(0x4f5d3a);

  let c: THREE.Color;
  if (h < 20) {
    c = grass.clone().lerp(dirt, clamp(slopeFactor * 1.5, 0, 1));
  } else if (h < 260) {
    const t = clamp((h - 20) / 240, 0, 1);
    c = dirt.clone().lerp(rock, t);
  } else if (h < 520) {
    const t = clamp((h - 260) / 260, 0, 1);
    c = rock.clone().lerp(rockLight, t);
  } else {
    const t = clamp((h - 520) / 260, 0, 1);
    c = rockLight.clone().lerp(snow, t);
  }
  // darken steep slopes slightly for pseudo-AO
  c = c.clone().lerp(new THREE.Color(0x14120f), clamp(slopeFactor * 0.35, 0, 0.35));
  return c;
}

export function buildTerrainMesh(): THREE.Mesh {
  const segsX = 180;
  const segsZ = 420;
  const width = WORLD_HALF_WIDTH * 2;

  const geometry = new THREE.BufferGeometry();
  const vertCount = (segsX + 1) * (segsZ + 1);
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);

  const heights = new Float32Array(vertCount);

  let idx = 0;
  for (let iz = 0; iz <= segsZ; iz++) {
    const z = CANYON_START_Z + (iz / segsZ) * CANYON_LENGTH;
    for (let ix = 0; ix <= segsX; ix++) {
      const x = -WORLD_HALF_WIDTH + (ix / segsX) * width;
      const h = heightAt(x, z);
      heights[idx] = h;
      positions[idx * 3] = x;
      positions[idx * 3 + 1] = h;
      positions[idx * 3 + 2] = z;
      idx++;
    }
  }

  // compute simple slope-based color + normals via central differences
  const stepX = width / segsX;
  const stepZ = CANYON_LENGTH / segsZ;
  idx = 0;
  for (let iz = 0; iz <= segsZ; iz++) {
    for (let ix = 0; ix <= segsX; ix++) {
      const hL = heights[iz * (segsX + 1) + Math.max(ix - 1, 0)];
      const hR = heights[iz * (segsX + 1) + Math.min(ix + 1, segsX)];
      const hD = heights[Math.max(iz - 1, 0) * (segsX + 1) + ix];
      const hU = heights[Math.min(iz + 1, segsZ) * (segsX + 1) + ix];
      const nx = (hL - hR) / (2 * stepX);
      const nz = (hD - hU) / (2 * stepZ);
      const n = new THREE.Vector3(nx, 1, nz).normalize();
      normals[idx * 3] = n.x;
      normals[idx * 3 + 1] = n.y;
      normals[idx * 3 + 2] = n.z;

      const slope = 1 - n.y;
      const col = colorFor(heights[idx], slope);
      colors[idx * 3] = col.r;
      colors[idx * 3 + 1] = col.g;
      colors[idx * 3 + 2] = col.b;
      idx++;
    }
  }

  const indices: number[] = [];
  for (let iz = 0; iz < segsZ; iz++) {
    for (let ix = 0; ix < segsX; ix++) {
      const a = iz * (segsX + 1) + ix;
      const b = a + 1;
      const c = a + (segsX + 1);
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 1,
    metalness: 0,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = false;
  mesh.name = 'terrain';
  return mesh;
}

export function buildSkyDome(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(4500, 24, 16);
  const top = new THREE.Color(0x1c5fd6);
  const horizon = new THREE.Color(0xbfe0ff);
  const colors = geo.attributes.position.array as Float32Array;
  const colorAttr = new Float32Array(colors.length);
  for (let i = 0; i < colors.length; i += 3) {
    const y = colors[i + 1];
    const t = clamp((y / 4500) * 1.6 + 0.15, 0, 1);
    const c = horizon.clone().lerp(top, t);
    colorAttr[i] = c.r;
    colorAttr[i + 1] = c.g;
    colorAttr[i + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colorAttr, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky';
  return mesh;
}
