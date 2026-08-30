import * as THREE from 'three';
import { makeDotTexture } from './textures';

interface P {
  alive: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  r: number; g: number; b: number;
  size: number;
  drag: number;
  gravity: number;
}

/** CPU-driven additive particle pool rendered as a single Points object. */
export class Particles {
  readonly points: THREE.Points;
  private readonly pool: P[] = [];
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private cursor = 0;
  private readonly max: number;

  constructor(scene: THREE.Scene, max = 720) {
    this.max = max;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({
      size: 0.9,
      map: makeDotTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < max; i++) {
      this.pool.push({
        alive: false,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1,
        r: 1, g: 1, b: 1,
        size: 1,
        drag: 0.92,
        gravity: 0,
      });
    }
  }

  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number,
    color: THREE.ColorRepresentation,
    opts: { size?: number; drag?: number; gravity?: number } = {}
  ): void {
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    p.alive = true;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life;
    p.maxLife = life;
    p.size = opts.size ?? 1;
    p.drag = opts.drag ?? 0.9;
    p.gravity = opts.gravity ?? 0;
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    p.r = c.r; p.g = c.g; p.b = c.b;
  }

  burst(
    x: number, y: number, z: number,
    count: number,
    color: THREE.ColorRepresentation,
    speed: number,
    life: number,
    opts: { size?: number; drag?: number; gravity?: number; up?: number } = {}
  ): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI - Math.PI / 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.spawn(
        x, y, z,
        Math.cos(a) * Math.cos(e) * s,
        Math.sin(e) * s + (opts.up ?? 0),
        Math.sin(a) * Math.cos(e) * s,
        life * (0.5 + Math.random() * 0.7),
        color,
        opts
      );
    }
  }

  update(dt: number): void {
    // integrate
    for (let i = 0; i < this.max; i++) {
      const p = this.pool[i];
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        this.pos[i * 3] = 0;
        this.pos[i * 3 + 1] = -9999; // hide
        this.pos[i * 3 + 2] = 0;
        continue;
      }
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy = p.vy * Math.pow(p.drag, dt * 60) + p.gravity * dt;
      p.vz *= Math.pow(p.drag, dt * 60);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
    }
    // write buffers
    for (let i = 0; i < this.max; i++) {
      const p = this.pool[i];
      const k = p.maxLife > 0 ? Math.max(0, p.life / p.maxLife) : 0;
      this.pos[i * 3] = p.alive ? p.x : 0;
      this.pos[i * 3 + 1] = p.alive ? p.y : -9999;
      this.pos[i * 3 + 2] = p.alive ? p.z : 0;
      const fade = Math.min(1, k * 1.6);
      this.col[i * 3] = p.r * fade;
      this.col[i * 3 + 1] = p.g * fade;
      this.col[i * 3 + 2] = p.b * fade;
    }
    const g = this.points.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    for (const p of this.pool) p.alive = false;
  }
}