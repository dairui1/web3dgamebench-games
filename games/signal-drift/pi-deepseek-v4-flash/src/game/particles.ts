import * as THREE from 'three';

interface Particle {
  alive: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  size: number;
  r: number; g: number; b: number;
  drag: number;    // velocity exponential damp per second
  gravity: number; // world units / s^2 (negative = sinks)
}

export interface BurstOptions {
  count: number;
  color: THREE.Color | [number, number, number];
  speed?: number;
  spread?: number;   // 0..1 directional openness
  dirX?: number; dirY?: number; dirZ?: number;
  life?: number;     // seconds
  size?: number;
  gravity?: number;
  drag?: number;
  inheritVX?: number; inheritVY?: number; inheritVZ?: number;
}

/**
 * Single additively-blended points cloud used for trails, sparks, bursts.
 */
export class Particles {
  readonly points: THREE.Points;
  private cap: number;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private data: Particle[];
  private cursor = 0;
  private frag: string;
  private uniformPixelRatio = { value: 1 };

  constructor(capacity = 2200, scene: THREE.Scene) {
    this.cap = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.data = [];
    for (let i = 0; i < capacity; i++) {
      this.data.push({
        alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1, size: 1, r: 1, g: 1, b: 1, drag: 0, gravity: 0,
      });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    // Spawn all dead particles far below so nothing is ever visible before drawRange kicks in.
    for (let i = 0; i < capacity; i++) this.positions[i * 3 + 1] = -99999;

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uPixelRatio: this.uniformPixelRatio, uScale: { value: 300.0 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        varying vec3 vColor;
        uniform float uScale;
        uniform float uPixelRatio;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale * uPixelRatio / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.08, d);
          if (a < 0.003) discard;
          gl_FragColor = vec4(vColor * a, a);
        }
      `,
    });
    this.frag = '';
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setPixelRatio(r: number): void {
    this.uniformPixelRatio.value = r;
  }

  resize(cap: number): void {
    // no-op placeholder for API stability
    void cap;
  }

  private alloc(): Particle | null {
    for (let n = 0; n < this.cap; n++) {
      const i = (this.cursor + n) % this.cap;
      const p = this.data[i];
      if (!p.alive) {
        p.alive = true;
        this.cursor = (i + 1) % this.cap;
        return p;
      }
    }
    return null;
  }

  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, size: number,
    r: number, g: number, b: number, drag = 0, gravity = 0,
  ): void {
    const p = this.alloc();
    if (!p) return;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.maxLife = life; p.life = life;
    p.size = size;
    p.r = r; p.g = g; p.b = b;
    p.drag = drag;
    p.gravity = gravity;
  }

  burst(bx: number, by: number, bz: number, opts: BurstOptions): void {
    const { count, color, speed = 18, spread = 1, dirX = 0, dirY = 0, dirZ = 1,
      life = 0.8, size = 1.6, gravity = 0, drag = 1.2,
      inheritVX = 0, inheritVY = 0, inheritVZ = 0 } = opts;
    const c = Array.isArray(color) ? new THREE.Color(color[0], color[1], color[2]) : color;
    for (let i = 0; i < count; i++) {
      // Direction cone biased toward (dirX, dirY, dirZ).
      let dx = (Math.random() - 0.5) * 2 * (1 - spread * 0.85);
      let dy = (Math.random() - 0.5) * 2 * (1 - spread * 0.85);
      let dz = (Math.random() - 0.5) * 2 * (1 - spread * 0.85);
      const bc = Math.hypot(dirX, dirY, dirZ) || 1;
      dx += (dirX / bc) * spread;
      dy += (dirY / bc) * spread;
      dz += (dirZ / bc) * spread;
      const len = Math.hypot(dx, dy, dz) || 1;
      const s = speed * (0.35 + Math.random() * 0.9);
      this.spawn(
        bx, by, bz,
        (dx / len) * s + inheritVX,
        (dy / len) * s + inheritVY,
        (dz / len) * s + inheritVZ,
        life * (0.5 + Math.random() * 0.9),
        size * (0.5 + Math.random() * 0.9),
        c.r, c.g, c.b, drag, gravity,
      );
    }
  }

  /** Continuous emitter helper: spawns `rate*dt` particles (fractional accumulation handled by caller). */
  trickle(x: number, y: number, z: number, vx: number, vy: number, vz: number, count: number, life: number, size: number, r: number, g: number, b: number, drag = 2, gravity = 0): void {
    const n = Math.floor(count);
    for (let i = 0; i < n; i++) {
      this.spawn(
        x + (Math.random() - 0.5) * 0.6,
        y + (Math.random() - 0.5) * 0.6,
        z + (Math.random() - 0.5) * 0.6,
        vx + (Math.random() - 0.5) * 2,
        vy + (Math.random() - 0.5) * 2,
        vz + (Math.random() - 0.5) * 2,
        life * (0.55 + Math.random() * 0.7),
        size * (0.6 + Math.random() * 0.8),
        r, g, b, drag, gravity,
      );
    }
  }

  update(dt: number): void {
    let alive = 0;
    const pos = this.positions;
    const col = this.colors;
    const sizes = this.sizes;
    for (let i = 0; i < this.cap; i++) {
      const p = this.data[i];
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        pos[i * 3 + 1] = -99999;
        continue;
      }
      if (p.drag > 0) {
        const damp = Math.exp(-p.drag * dt);
        p.vx *= damp; p.vy *= damp; p.vz *= damp;
      }
      if (p.gravity) p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      const lt = Math.max(0, p.life / p.maxLife);
      col[i * 3] = p.r * lt;
      col[i * 3 + 1] = p.g * lt;
      col[i * 3 + 2] = p.b * lt;
      sizes[i] = p.size * (0.45 + 0.55 * lt);
      alive++;
    }
    const geo = this.points.geometry as THREE.BufferGeometry;
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    this.points.geometry.setDrawRange(0, alive);
  }

  clear(): void {
    for (const p of this.data) {
      p.alive = false;
    }
    this.positions.fill(0);
    for (let i = 0; i < this.cap; i++) this.positions[i * 3 + 1] = -99999;
    this.points.geometry.setDrawRange(0, 0);
  }
}