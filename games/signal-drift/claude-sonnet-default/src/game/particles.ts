import * as THREE from 'three';
import { makeSoftDotTexture } from './textures';

interface Slot {
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  baseSize: number;
}

/** A single pooled point-sprite burst/trail system shared by pickups, impacts and the engine trail. */
export class ParticleSystem {
  readonly points: THREE.Points;
  private geometry: THREE.BufferGeometry;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private slots: Slot[];
  private cursor = 0;
  private readonly count: number;

  constructor(count = 500) {
    this.count = count;
    this.geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.sizes = new Float32Array(count).fill(0);
    this.slots = Array.from({ length: count }, () => ({
      velocity: new THREE.Vector3(),
      life: 0,
      maxLife: 1,
      baseSize: 6,
    }));

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: makeSoftDotTexture() } },
      vertexShader: `
        attribute float aSize;
        attribute vec3 aColor;
        varying vec3 vColor;
        varying float vSize;
        void main() {
          vColor = aColor;
          vSize = aSize;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (220.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vSize;
        void main() {
          if (vSize <= 0.0) discard;
          vec4 tex = texture2D(uMap, gl_PointCoord);
          if (tex.a < 0.02) discard;
          gl_FragColor = vec4(vColor, tex.a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, material);
    this.points.frustumCulled = false;
  }

  emit(
    origin: THREE.Vector3,
    color: THREE.Color,
    opts: { count: number; speed: number; life: number; size: number; spread?: number },
  ): void {
    const spread = opts.spread ?? 1;
    for (let i = 0; i < opts.count; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % this.count;
      const dir = new THREE.Vector3(
        (Math.random() * 2 - 1) * spread,
        (Math.random() * 2 - 1) * spread,
        (Math.random() * 2 - 1) * spread,
      );
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
      dir.normalize().multiplyScalar(opts.speed * (0.4 + Math.random() * 0.6));
      const slot = this.slots[idx];
      slot.velocity.copy(dir);
      slot.life = opts.life;
      slot.maxLife = opts.life;
      slot.baseSize = opts.size;
      this.positions[idx * 3] = origin.x;
      this.positions[idx * 3 + 1] = origin.y;
      this.positions[idx * 3 + 2] = origin.z;
      this.colors[idx * 3] = color.r;
      this.colors[idx * 3 + 1] = color.g;
      this.colors[idx * 3 + 2] = color.b;
      this.sizes[idx] = opts.size;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.count; i++) {
      const slot = this.slots[i];
      if (slot.life <= 0) {
        if (this.sizes[i] !== 0) this.sizes[i] = 0;
        continue;
      }
      slot.life -= dt;
      if (slot.life <= 0) {
        this.sizes[i] = 0;
        continue;
      }
      this.positions[i * 3] += slot.velocity.x * dt;
      this.positions[i * 3 + 1] += slot.velocity.y * dt - dt * 0.6;
      this.positions[i * 3 + 2] += slot.velocity.z * dt;
      slot.velocity.multiplyScalar(1 - Math.min(1, dt * 1.2));
      const frac = slot.life / slot.maxLife;
      this.sizes[i] = frac * frac * slot.baseSize;
    }
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
  }
}
