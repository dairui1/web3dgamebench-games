import * as THREE from 'three';
import { Noise2D } from './noise';

export const WORLD_SIZE = 7000;
export const WORLD_HALF = WORLD_SIZE / 2;
export const MISSION_BOUND = 3350;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Procedural mountain canyon. The canyon floor snakes along the Z axis;
 * heights are analytic so collision queries never need the mesh.
 */
export class Terrain {
  readonly mesh: THREE.Mesh;
  private noise = new Noise2D(4242);

  constructor() {
    this.mesh = this.buildMesh();
  }

  canyonCenterX(z: number): number {
    return 520 * Math.sin(z / 950) + 230 * Math.sin(z / 380 + 1.7) + 70 * Math.sin(z / 140);
  }

  canyonHalfWidth(z: number): number {
    return 280 + 90 * Math.sin(z / 610 + 0.4) + 40 * Math.sin(z / 230);
  }

  floorHeightAt(x: number, z: number): number {
    return 12 + this.noise.fbm(x * 0.006, z * 0.006, 2) * 6;
  }

  heightAt(x: number, z: number): number {
    const cx = this.canyonCenterX(z);
    const hw = this.canyonHalfWidth(z);
    const d = Math.abs(x - cx) - hw;
    const n = this.noise;
    const floor = this.floorHeightAt(x, z);
    if (d <= -30) return floor;
    const ridge = n.fbm(x * 0.0009, z * 0.0009, 4);
    const mountain = 430 + ridge * 170 + n.fbm(x * 0.004, z * 0.004, 3) * 45;
    const t = smoothstep(-30, 230, d);
    const shelf = 1 + 0.18 * Math.sin(d * 0.06) * (1 - t);
    const wallNoise = n.fbm(x * 0.012, z * 0.012, 3) * 28 * t;
    return floor + (mountain - floor) * Math.pow(t, 0.8) * shelf + wallNoise;
  }

  /** Normal estimated by finite differences. */
  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = 2;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e);
    const hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  private buildMesh(): THREE.Mesh {
    const segs = 240;
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const count = pos.count;
    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, this.heightAt(x, z));
    }
    geo.computeVertexNormals();
    const normal = geo.attributes.normal as THREE.BufferAttribute;
    const colors = new Float32Array(count * 3);
    const c = new THREE.Color();
    const sand = new THREE.Color(0.6, 0.53, 0.38);
    const scrub = new THREE.Color(0.42, 0.48, 0.3);
    const rockA = new THREE.Color(0.66, 0.36, 0.2);
    const rockB = new THREE.Color(0.5, 0.29, 0.2);
    const highRock = new THREE.Color(0.5, 0.46, 0.42);
    const snow = new THREE.Color(0.92, 0.93, 0.96);
    const dark = new THREE.Color(0.3, 0.2, 0.15);
    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const slope = 1 - normal.getY(i);
      const v = this.noise.fbm(x * 0.02, z * 0.02, 2) * 0.5 + 0.5;
      if (y < 40) {
        c.copy(sand).lerp(scrub, v * 0.8);
      } else {
        const band = 0.5 + 0.5 * Math.sin(y * 0.07 + v * 2);
        c.copy(rockA).lerp(rockB, band);
        c.lerp(highRock, smoothstep(300, 480, y));
        if (slope < 0.55) c.lerp(snow, smoothstep(540, 640, y) * (1 - slope * 1.4));
      }
      if (slope > 0.5) c.lerp(dark, Math.min(1, (slope - 0.5) * 1.6));
      c.multiplyScalar(0.92 + v * 0.16);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'terrain';
    return mesh;
  }
}
