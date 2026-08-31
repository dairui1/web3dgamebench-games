import * as THREE from 'three';
import { makeSoftSprite } from './util';

interface PoolOptions {
  count: number;
  texture?: THREE.Texture;
}

/** Additive CPU particle pool used for sparks, motes, splashes and dust. */
export class Particles {
  readonly points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private drag: Float32Array;
  private cursor = 0;
  private count: number;

  constructor(opts: PoolOptions) {
    this.count = opts.count;
    this.pos = new Float32Array(this.count * 3);
    this.vel = new Float32Array(this.count * 3);
    this.col = new Float32Array(this.count * 3);
    this.size = new Float32Array(this.count);
    this.life = new Float32Array(this.count);
    this.maxLife = new Float32Array(this.count);
    this.drag = new Float32Array(this.count);
    for (let i = 0; i < this.count; i += 1) this.pos[i * 3 + 1] = -99999;

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uMap: { value: opts.texture ?? makeSoftSprite(96, 2.4) },
        uPixelRatio: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aLife;
        varying vec3 vColor;
        varying float vLife;
        uniform float uPixelRatio;
        void main() {
          vColor = aColor;
          vLife = aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(1.0, aSize * uPixelRatio * (52.0 / max(1.0, -mv.z)));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vLife;
        uniform sampler2D uMap;
        void main() {
          if (vLife <= 0.0) discard;
          float m = texture2D(uMap, gl_PointCoord).a;
          float a = m * vLife;
          if (a < 0.008) discard;
          gl_FragColor = vec4(vColor * (0.6 + vLife * 1.4), a);
        }
      `,
    });
    this.points = new THREE.Points(this.geo, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setPixelRatio(ratio: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uPixelRatio.value = ratio;
  }

  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    color: THREE.Color,
    size: number,
    life: number,
    dragValue = 1.4,
  ): void {
    const i = this.cursor % this.count;
    this.cursor += 1;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r;
    this.col[i * 3 + 1] = color.g;
    this.col[i * 3 + 2] = color.b;
    this.size[i] = size;
    this.life[i] = 1;
    this.maxLife[i] = life;
    this.drag[i] = dragValue;
  }

  burst(
    origin: THREE.Vector3,
    amount: number,
    spread: number,
    color: THREE.Color,
    size: number,
    life: number,
    drift?: THREE.Vector3,
  ): void {
    for (let i = 0; i < amount; i += 1) {
      const theta = Math.random() * Math.PI * 2;
      const z = Math.random() * 2 - 1;
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      const speed = spread * (0.35 + Math.random() * 0.9);
      this.spawn(
        origin.x,
        origin.y,
        origin.z,
        Math.cos(theta) * r * speed + (drift?.x ?? 0),
        z * speed + (drift?.y ?? 0),
        Math.sin(theta) * r * speed + (drift?.z ?? 0),
        color,
        size * (0.6 + Math.random() * 0.8),
        life * (0.6 + Math.random() * 0.8),
      );
    }
  }

  update(dt: number): void {
    const { pos, vel, life, maxLife, drag, size } = this;
    for (let i = 0; i < this.count; i += 1) {
      if (life[i] <= 0) continue;
      life[i] -= dt / maxLife[i];
      if (life[i] <= 0) {
        life[i] = 0;
        pos[i * 3 + 1] = -99999;
        continue;
      }
      const dampFactor = Math.max(0, 1 - drag[i] * dt);
      vel[i * 3] *= dampFactor;
      vel[i * 3 + 1] *= dampFactor;
      vel[i * 3 + 2] *= dampFactor;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      size[i] *= 1 - dt * 0.35;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aLife') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
  }

  reset(): void {
    this.life.fill(0);
    for (let i = 0; i < this.count; i += 1) this.pos[i * 3 + 1] = -99999;
    this.update(0);
  }
}
