import * as THREE from 'three';

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (uScale / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
  vAlpha = aAlpha;
  vColor = aColor;
}`;

const FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.05, d) * vAlpha;
  gl_FragColor = vec4(vColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface EmitOptions {
  life: number;
  size: number;
  color: THREE.Color | number;
  growth?: number;
  drag?: number;
  gravity?: number;
}

/** Pooled point-sprite particle system with a dense, swap-removed buffer. */
export class ParticleSystem {
  readonly points: THREE.Points;
  private max: number;
  private count = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private growth: Float32Array;
  private drag: Float32Array;
  private gravity: Float32Array;
  private alpha: Float32Array;
  private color: Float32Array;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private tmpColor = new THREE.Color();

  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.growth = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.color = new Float32Array(max * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    // Generous bounding sphere so the points never get culled.
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  }

  setViewportHeight(h: number, fovDeg: number): void {
    this.mat.uniforms.uScale.value = h / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, o: EmitOptions): void {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.size[i] = o.size;
    this.growth[i] = o.growth ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.gravity[i] = o.gravity ?? 0;
    this.alpha[i] = 1;
    const c = typeof o.color === 'number' ? this.tmpColor.setHex(o.color) : o.color;
    this.color[i * 3] = c.r; this.color[i * 3 + 1] = c.g; this.color[i * 3 + 2] = c.b;
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.swapRemove(i);
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.gravity[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.growth[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = t < 0.6 ? t / 0.6 : 1;
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }

  private swapRemove(i: number): void {
    const j = --this.count;
    if (i === j) return;
    for (let k = 0; k < 3; k++) {
      this.pos[i * 3 + k] = this.pos[j * 3 + k];
      this.vel[i * 3 + k] = this.vel[j * 3 + k];
      this.color[i * 3 + k] = this.color[j * 3 + k];
    }
    this.life[i] = this.life[j];
    this.maxLife[i] = this.maxLife[j];
    this.size[i] = this.size[j];
    this.growth[i] = this.growth[j];
    this.drag[i] = this.drag[j];
    this.gravity[i] = this.gravity[j];
    this.alpha[i] = this.alpha[j];
  }
}
