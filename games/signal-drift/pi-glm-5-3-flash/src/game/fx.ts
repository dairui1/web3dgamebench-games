import * as THREE from 'three';

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  size: number; grow: number;
  r: number; g: number; b: number;
  drag: number; grav: number;
}

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (260.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float a = smoothstep(0.5, 0.06, length(d)) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}`;

/** Pooled additive particle system for trails, bursts and sparks. */
export class ParticleSystem {
  readonly points: THREE.Points;
  private parts: Particle[] = [];
  private pool: Particle[] = [];
  private geo: THREE.BufferGeometry;
  private posAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;
  private colorAttr: THREE.BufferAttribute;

  constructor(private capacity = 900) {
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(capacity), 1);
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(capacity), 1);
    this.colorAttr = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('aSize', this.sizeAttr);
    this.geo.setAttribute('aAlpha', this.alphaAttr);
    this.geo.setAttribute('aColor', this.colorAttr);
    this.geo.setDrawRange(0, 0);

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  private obtain(): Particle {
    const p = this.pool.pop();
    if (p) return p;
    return {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      life: 0, maxLife: 1, size: 1, grow: 0,
      r: 1, g: 1, b: 1, drag: 0, grav: 0,
    };
  }

  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, size: number,
    color: THREE.Color,
    opts?: { grow?: number; drag?: number; grav?: number },
  ): void {
    if (this.parts.length >= this.capacity) return;
    const p = this.obtain();
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life; p.maxLife = life;
    p.size = size; p.grow = opts?.grow ?? 0;
    p.r = color.r; p.g = color.g; p.b = color.b;
    p.drag = opts?.drag ?? 0.6;
    p.grav = opts?.grav ?? 0;
    this.parts.push(p);
  }

  burst(
    pos: THREE.Vector3,
    count: number,
    speed: number,
    life: number,
    size: number,
    color: THREE.Color,
    opts?: { grav?: number; spread?: number; dir?: THREE.Vector3 },
  ): void {
    for (let i = 0; i < count; i++) {
      const sp = speed * (0.35 + Math.random() * 0.65);
      let vx = (Math.random() * 2 - 1) * sp;
      let vy = (Math.random() * 2 - 1) * sp;
      let vz = (Math.random() * 2 - 1) * sp;
      if (opts?.dir) {
        const s = opts.spread ?? 0.5;
        vx = opts.dir.x * sp + (Math.random() * 2 - 1) * sp * s;
        vy = opts.dir.y * sp + (Math.random() * 2 - 1) * sp * s;
        vz = opts.dir.z * sp + (Math.random() * 2 - 1) * sp * s;
      }
      this.spawn(
        pos.x, pos.y, pos.z, vx, vy, vz,
        life * (0.6 + Math.random() * 0.7),
        size * (0.6 + Math.random() * 0.8),
        color,
        { grav: opts?.grav ?? 6, drag: 1.4 },
      );
    }
  }

  update(dt: number): void {
    // compact in place
    let w = 0;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.pool.push(p);
        continue;
      }
      const dragF = Math.max(0, 1 - p.drag * dt);
      p.vx *= dragF; p.vy *= dragF; p.vz *= dragF;
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.size += p.grow * dt;
      this.parts[w++] = p;
    }
    this.parts.length = w;

    const pos = this.posAttr.array as Float32Array;
    const col = this.colorAttr.array as Float32Array;
    const size = this.sizeAttr.array as Float32Array;
    const alpha = this.alphaAttr.array as Float32Array;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      col[i * 3] = p.r; col[i * 3 + 1] = p.g; col[i * 3 + 2] = p.b;
      size[i] = p.size;
      const f = p.life / p.maxLife;
      alpha[i] = f * f;
    }
    this.posAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.geo.setDrawRange(0, this.parts.length);
  }

  clear(): void {
    for (const p of this.parts) this.pool.push(p);
    this.parts.length = 0;
    this.geo.setDrawRange(0, 0);
  }
}
