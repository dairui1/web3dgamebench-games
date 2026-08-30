import * as THREE from 'three';
import { Course } from '../world/course';
import { Rng } from '../core/rng';

/**
 * CPU-driven additive point sprites used for thruster wash, impact sparks,
 * pickup absorption and relay ignition bursts.
 */
export class ParticleSystem {
  readonly points: THREE.Points;

  private readonly max: number;
  private readonly position: Float32Array;
  private readonly color: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly velocity: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly drag: Float32Array;
  private readonly baseSize: Float32Array;
  private count = 0;

  constructor(max = 900) {
    this.max = max;
    this.position = new Float32Array(max * 3);
    this.color = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.velocity = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.baseSize = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.position, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(1.0, aSize * uScale / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 d = gl_PointCoord - vec2(0.5);
          float r = dot(d, d);
          if (r > 0.25) discard;
          float falloff = pow(1.0 - r * 4.0, 1.7);
          gl_FragColor = vec4(vColor * falloff, vAlpha * falloff);
        }
      `,
    });

    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 12;
  }

  setViewportScale(height: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = height * 0.55;
  }

  spawn(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    color: THREE.Color,
    size: number,
    life: number,
    drag = 1.6,
  ): void {
    const i = this.count < this.max ? this.count++ : Math.floor(Math.random() * this.max);
    this.position[i * 3] = pos.x;
    this.position[i * 3 + 1] = pos.y;
    this.position[i * 3 + 2] = pos.z;
    this.velocity[i * 3] = vel.x;
    this.velocity[i * 3 + 1] = vel.y;
    this.velocity[i * 3 + 2] = vel.z;
    this.color[i * 3] = color.r;
    this.color[i * 3 + 1] = color.g;
    this.color[i * 3 + 2] = color.b;
    this.baseSize[i] = size;
    this.size[i] = size;
    this.alpha[i] = 1;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.drag[i] = drag;
  }

  burst(
    pos: THREE.Vector3,
    color: THREE.Color,
    amount: number,
    speed: number,
    size = 0.9,
    life = 0.8,
  ): void {
    const v = new THREE.Vector3();
    for (let i = 0; i < amount; i++) {
      v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(speed * (0.35 + Math.random() * 0.9));
      this.spawn(pos, v, color, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.7));
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.count; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const last = this.count - 1;
        if (i !== last) this.swap(i, last);
        this.count--;
        i--;
        continue;
      }
      const damping = Math.exp(-this.drag[i] * dt);
      this.velocity[i * 3] *= damping;
      this.velocity[i * 3 + 1] *= damping;
      this.velocity[i * 3 + 2] *= damping;
      this.position[i * 3] += this.velocity[i * 3] * dt;
      this.position[i * 3 + 1] += this.velocity[i * 3 + 1] * dt;
      this.position[i * 3 + 2] += this.velocity[i * 3 + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = t * t;
      this.size[i] = this.baseSize[i] * (0.35 + t * 0.85);
    }

    const geo = this.points.geometry;
    geo.setDrawRange(0, this.count);
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.count = 0;
    this.points.geometry.setDrawRange(0, 0);
  }

  private swap(a: number, b: number): void {
    for (let k = 0; k < 3; k++) {
      const pa = a * 3 + k;
      const pb = b * 3 + k;
      const p = this.position[pa];
      this.position[pa] = this.position[pb];
      this.position[pb] = p;
      const v = this.velocity[pa];
      this.velocity[pa] = this.velocity[pb];
      this.velocity[pb] = v;
      const c = this.color[pa];
      this.color[pa] = this.color[pb];
      this.color[pb] = c;
    }
    const swapScalar = (arr: Float32Array) => {
      const t = arr[a];
      arr[a] = arr[b];
      arr[b] = t;
    };
    swapScalar(this.size);
    swapScalar(this.alpha);
    swapScalar(this.life);
    swapScalar(this.maxLife);
    swapScalar(this.drag);
    swapScalar(this.baseSize);
  }
}

const STREAKS = 190;

/** Corridor-aligned light streaks that sell forward speed. */
export class SpeedStreaks {
  readonly lines: THREE.LineSegments;

  private readonly offsets = new Float32Array(STREAKS);
  private readonly angles = new Float32Array(STREAKS);
  private readonly radii = new Float32Array(STREAKS);
  private readonly bright = new Float32Array(STREAKS);
  private readonly position: Float32Array;
  private readonly color: Float32Array;
  private readonly rng: Rng;

  constructor(rng: Rng) {
    this.rng = rng;
    this.position = new Float32Array(STREAKS * 6);
    this.color = new Float32Array(STREAKS * 6);
    for (let i = 0; i < STREAKS; i++) this.respawn(i, true);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.position, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.color, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.lines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 10;
  }

  private respawn(i: number, initial = false): void {
    this.offsets[i] = initial ? this.rng.range(-30, 150) : this.rng.range(120, 175);
    this.angles[i] = this.rng.range(0, Math.PI * 2);
    this.radii[i] = this.rng.range(0.62, 1.4);
    this.bright[i] = this.rng.range(0.25, 1);
  }

  update(course: Course, playerDistance: number, travelled: number, speed01: number): void {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const len = 4 + speed01 * 26;
    const intensity = 0.06 + speed01 * 0.34;
    for (let i = 0; i < STREAKS; i++) {
      this.offsets[i] -= travelled;
      if (this.offsets[i] < -45) this.respawn(i);
      const d = playerDistance + this.offsets[i];
      const lat = Math.cos(this.angles[i]) * course.radiusX * this.radii[i];
      const vert = Math.sin(this.angles[i]) * course.radiusY * this.radii[i];
      course.toWorld(d, lat, vert, a);
      course.toWorld(d - len, lat, vert, b);
      const o = i * 6;
      this.position[o] = a.x;
      this.position[o + 1] = a.y;
      this.position[o + 2] = a.z;
      this.position[o + 3] = b.x;
      this.position[o + 4] = b.y;
      this.position[o + 5] = b.z;
      // Fade streaks in as they spawn far ahead and out as they sweep past
      // the camera, so nothing flares across the middle of the screen.
      const off = this.offsets[i];
      const fade =
        Math.min(1, Math.max(0, (off - 6) / 26)) * Math.min(1, Math.max(0, (165 - off) / 30));
      const g = this.bright[i] * intensity * fade;
      this.color[o] = g * 0.3;
      this.color[o + 1] = g * 0.75;
      this.color[o + 2] = g;
      this.color[o + 3] = 0;
      this.color[o + 4] = 0;
      this.color[o + 5] = 0;
    }
    const geo = this.lines.geometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}
