import * as THREE from 'three';
import { Rng, clamp01 } from '../core/mathutil';

function radialTexture(inner: string, outer: string, hard = 0.0): THREE.Texture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, size * hard * 0.5, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.45, outer);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function smokeTexture(): THREE.Texture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const rng = new Rng(551);
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.42)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 24; i++) {
    const r = rng.range(6, 22);
    ctx.beginPath();
    ctx.arc(rng.range(10, 118), rng.range(10, 118), r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,0,0,${rng.range(0.05, 0.22)})`;
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const particleVert = /* glsl */ `
attribute float size;
attribute float alpha;
varying vec3 vColor;
varying float vAlpha;
varying float vFog;
uniform float uFogDensity;
void main() {
  vColor = color;
  vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = -mv.z;
  vFog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  gl_PointSize = size * (420.0 / max(dist, 1.0));
  gl_Position = projectionMatrix * mv;
}
`;

/** Manual linear -> sRGB encode: raw ShaderMaterials bypass three's output pass. */
const ENCODE = /* glsl */ `
vec3 toOutput(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(0.41666)) - 0.055, step(0.0031308, c));
}
`;

const particleFragAdd = /* glsl */ `
uniform sampler2D uMap;
varying vec3 vColor;
varying float vAlpha;
varying float vFog;
${ENCODE}
void main() {
  vec4 tex = texture2D(uMap, gl_PointCoord);
  float a = tex.a * vAlpha * (1.0 - vFog * 0.85);
  if (a < 0.004) discard;
  gl_FragColor = vec4(toOutput(vColor * tex.rgb), a);
}
`;

const particleFragAlpha = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uFogColor;
varying vec3 vColor;
varying float vAlpha;
varying float vFog;
${ENCODE}
void main() {
  vec4 tex = texture2D(uMap, gl_PointCoord);
  float a = tex.a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(toOutput(mix(vColor, uFogColor, vFog)), a);
}
`;

interface PoolOptions {
  count: number;
  additive: boolean;
  map: THREE.Texture;
  fogColor: THREE.Color;
  fogDensity: number;
}

class ParticlePool {
  points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grow: Float32Array;
  private drag: Float32Array;
  private grav: Float32Array;
  private baseAlpha: Float32Array;
  private cursor = 0;
  private capacity: number;
  private geo: THREE.BufferGeometry;

  constructor(opts: PoolOptions) {
    const n = opts.count;
    this.capacity = n;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.baseAlpha = new Float32Array(n);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = geo;

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: opts.map },
        uFogDensity: { value: opts.fogDensity },
        uFogColor: { value: opts.fogColor },
      },
      vertexShader: particleVert,
      fragmentShader: opts.additive ? particleFragAdd : particleFragAlpha,
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexColors: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = opts.additive ? 10 : 5;
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
    alpha = 1,
    grow = 0,
    drag = 1.2,
    gravity = 0
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.col[i3] = color.r;
    this.col[i3 + 1] = color.g;
    this.col[i3 + 2] = color.b;
    this.size[i] = size;
    this.alpha[i] = alpha;
    this.baseAlpha[i] = alpha;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grow[i] = grow;
    this.drag[i] = drag;
    this.grav[i] = gravity;
  }

  update(dt: number): void {
    const n = this.capacity;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const i3 = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= d;
      this.vel[i3 + 1] = this.vel[i3 + 1] * d + this.grav[i] * dt;
      this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = clamp01(this.life[i] / this.maxLife[i]);
      this.alpha[i] = this.baseAlpha[i] * (t > 0.75 ? (1 - t) / 0.25 : t / 0.75);
      if (this.life[i] <= 0) this.alpha[i] = 0;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
  }
}

const C_FIRE = new THREE.Color(0xffb347);
const C_HOT = new THREE.Color(0xfff3c4);
const C_EMBER = new THREE.Color(0xff6a2a);
const C_SMOKE_DARK = new THREE.Color(0x2b2723);
const C_SMOKE_LIGHT = new THREE.Color(0x9a9187);

interface Ring {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  scale: number;
  growth: number;
}

/** Fire, smoke, sparks, debris and shockwaves. */
export class Effects {
  private add: ParticlePool;
  private smoke: ParticlePool;
  private rings: Ring[] = [];
  private flash: THREE.PointLight;
  private flashLife = 0;
  private rng = new Rng(2024);
  private tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene, fogColor: THREE.Color, fogDensity: number) {
    this.add = new ParticlePool({
      count: 2600,
      additive: true,
      map: radialTexture('rgba(255,255,255,1)', 'rgba(255,190,110,0.75)'),
      fogColor,
      fogDensity,
    });
    this.smoke = new ParticlePool({
      count: 1800,
      additive: false,
      map: smokeTexture(),
      fogColor,
      fogDensity,
    });
    scene.add(this.add.points, this.smoke.points);

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd9a0,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ringGeo = new THREE.RingGeometry(0.82, 1, 28);
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(ringGeo, ringMat.clone());
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({ mesh, life: 0, maxLife: 1, scale: 1, growth: 1 });
    }

    this.flash = new THREE.PointLight(0xffa64d, 0, 700, 2);
    scene.add(this.flash);
  }

  spark(pos: THREE.Vector3, dir: THREE.Vector3, count = 8, speed = 40, color = C_HOT): void {
    for (let i = 0; i < count; i++) {
      const vx = dir.x * speed + this.rng.range(-1, 1) * speed * 0.7;
      const vy = dir.y * speed + this.rng.range(-1, 1) * speed * 0.7;
      const vz = dir.z * speed + this.rng.range(-1, 1) * speed * 0.7;
      this.add.spawn(
        pos.x,
        pos.y,
        pos.z,
        vx,
        vy,
        vz,
        color,
        this.rng.range(1.1, 2.6),
        this.rng.range(0.15, 0.4),
        1,
        -1,
        3.2,
        -20
      );
    }
  }

  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3): void {
    this.add.spawn(
      pos.x + dir.x * 2,
      pos.y + dir.y * 2,
      pos.z + dir.z * 2,
      dir.x * 30,
      dir.y * 30,
      dir.z * 30,
      C_HOT,
      3.2,
      0.06,
      0.9,
      -8,
      6
    );
  }

  trail(pos: THREE.Vector3, color = C_SMOKE_LIGHT, size = 2.4, life = 1.1, alpha = 0.5): void {
    this.smoke.spawn(
      pos.x,
      pos.y,
      pos.z,
      this.rng.range(-2, 2),
      this.rng.range(1, 4),
      this.rng.range(-2, 2),
      color,
      size,
      life,
      alpha,
      size * 2.2,
      0.6,
      2
    );
  }

  burnerGlow(pos: THREE.Vector3, dir: THREE.Vector3, intensity: number): void {
    if (intensity < 0.02) return;
    this.add.spawn(
      pos.x,
      pos.y,
      pos.z,
      -dir.x * 30,
      -dir.y * 30,
      -dir.z * 30,
      C_FIRE,
      2.4 + intensity * 3.4,
      0.12,
      0.35 * intensity,
      -4,
      2
    );
  }

  explosion(pos: THREE.Vector3, scale = 1, sound = true): void {
    void sound;
    const n = Math.round(16 + scale * 14);
    for (let i = 0; i < n; i++) {
      const sp = this.rng.range(8, 40) * scale;
      const dx = this.rng.range(-1, 1);
      const dy = this.rng.range(-0.4, 1);
      const dz = this.rng.range(-1, 1);
      const len = Math.hypot(dx, dy, dz) || 1;
      this.add.spawn(
        pos.x,
        pos.y,
        pos.z,
        (dx / len) * sp,
        (dy / len) * sp,
        (dz / len) * sp,
        i % 3 === 0 ? C_HOT : i % 3 === 1 ? C_FIRE : C_EMBER,
        this.rng.range(3, 9) * scale,
        this.rng.range(0.28, 0.7),
        1,
        this.rng.range(2, 12) * scale,
        1.8,
        6
      );
    }
    const m = Math.round(10 + scale * 10);
    for (let i = 0; i < m; i++) {
      const sp = this.rng.range(4, 20) * scale;
      this.smoke.spawn(
        pos.x,
        pos.y,
        pos.z,
        this.rng.range(-1, 1) * sp,
        this.rng.range(0, 1.4) * sp,
        this.rng.range(-1, 1) * sp,
        this.rng.next() < 0.6 ? C_SMOKE_DARK : C_SMOKE_LIGHT,
        this.rng.range(6, 14) * scale,
        this.rng.range(1.4, 3.4),
        0.72,
        this.rng.range(6, 16) * scale,
        1.1,
        3
      );
    }
    this.ring(pos, scale);
    this.flash.position.copy(pos);
    this.flash.intensity = 700 * scale;
    this.flash.distance = 500 * scale;
    this.flashLife = 0.22;
  }

  private ring(pos: THREE.Vector3, scale: number): void {
    const r = this.rings.find((x) => x.life <= 0);
    if (!r) return;
    r.mesh.position.copy(pos);
    r.mesh.visible = true;
    r.life = r.maxLife = 0.45;
    r.scale = 4 * scale;
    r.growth = 190 * scale;
    r.mesh.scale.setScalar(r.scale);
    (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55;
  }

  debris(pos: THREE.Vector3, count = 10, scale = 1): void {
    for (let i = 0; i < count; i++) {
      const sp = this.rng.range(14, 55) * scale;
      const dx = this.rng.range(-1, 1);
      const dy = this.rng.range(0.2, 1.2);
      const dz = this.rng.range(-1, 1);
      const len = Math.hypot(dx, dy, dz) || 1;
      this.add.spawn(
        pos.x,
        pos.y,
        pos.z,
        (dx / len) * sp,
        (dy / len) * sp,
        (dz / len) * sp,
        C_EMBER,
        this.rng.range(1.4, 3) * scale,
        this.rng.range(0.8, 1.8),
        0.9,
        -0.6,
        0.35,
        -55
      );
    }
  }

  /** Persistent column of fire + smoke for a wrecked installation. */
  fireColumn(pos: THREE.Vector3, dt: number, intensity = 1): void {
    if (this.rng.next() > dt * 26 * intensity) return;
    this.tmp.set(pos.x + this.rng.range(-6, 6), pos.y + 2, pos.z + this.rng.range(-6, 6));
    this.add.spawn(
      this.tmp.x,
      this.tmp.y,
      this.tmp.z,
      this.rng.range(-3, 3),
      this.rng.range(10, 26),
      this.rng.range(-3, 3),
      this.rng.next() < 0.5 ? C_FIRE : C_EMBER,
      this.rng.range(4, 9) * intensity,
      this.rng.range(0.4, 0.9),
      0.85,
      3,
      0.9,
      4
    );
    this.smoke.spawn(
      this.tmp.x,
      this.tmp.y + 6,
      this.tmp.z,
      this.rng.range(-4, 4),
      this.rng.range(9, 20),
      this.rng.range(-4, 4),
      C_SMOKE_DARK,
      this.rng.range(9, 18) * intensity,
      this.rng.range(3, 6),
      0.55,
      12,
      0.35,
      3
    );
  }

  damageSmoke(pos: THREE.Vector3, vel: THREE.Vector3, severity: number): void {
    this.smoke.spawn(
      pos.x,
      pos.y,
      pos.z,
      vel.x * 0.2 + this.rng.range(-3, 3),
      vel.y * 0.2 + this.rng.range(0, 5),
      vel.z * 0.2 + this.rng.range(-3, 3),
      severity > 0.6 ? C_SMOKE_DARK : C_SMOKE_LIGHT,
      this.rng.range(3, 6),
      this.rng.range(1.1, 2.2),
      0.45 * severity,
      12,
      0.7,
      2
    );
    if (severity > 0.65) {
      this.add.spawn(
        pos.x,
        pos.y,
        pos.z,
        this.rng.range(-4, 4),
        this.rng.range(-2, 6),
        this.rng.range(-4, 4),
        C_FIRE,
        this.rng.range(1.5, 3.4),
        0.3,
        0.7,
        -2,
        1.4,
        3
      );
    }
  }

  flareBurn(pos: THREE.Vector3): void {
    this.add.spawn(
      pos.x,
      pos.y,
      pos.z,
      this.rng.range(-6, 6),
      this.rng.range(-6, 2),
      this.rng.range(-6, 6),
      C_HOT,
      this.rng.range(3, 6),
      0.55,
      1,
      -2,
      1.1,
      -14
    );
    this.smoke.spawn(
      pos.x,
      pos.y,
      pos.z,
      0,
      2,
      0,
      C_SMOKE_LIGHT,
      3,
      1.3,
      0.35,
      8,
      0.7,
      1
    );
  }

  waterSplash(pos: THREE.Vector3): void {
    for (let i = 0; i < 8; i++) {
      this.smoke.spawn(
        pos.x,
        pos.y,
        pos.z,
        this.rng.range(-12, 12),
        this.rng.range(8, 26),
        this.rng.range(-12, 12),
        new THREE.Color(0xbcd6e6),
        this.rng.range(2, 5),
        this.rng.range(0.5, 1.1),
        0.6,
        5,
        1.4,
        -30
      );
    }
  }

  update(dt: number): void {
    this.add.update(dt);
    this.smoke.update(dt);
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      r.scale += r.growth * dt;
      r.mesh.scale.setScalar(r.scale);
      const t = clamp01(r.life / r.maxLife);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = t * 0.55;
      if (r.life <= 0) r.mesh.visible = false;
    }
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      this.flash.intensity *= Math.exp(-9 * dt);
      if (this.flashLife <= 0) this.flash.intensity = 0;
    }
  }

  faceCamera(camera: THREE.Camera): void {
    for (const r of this.rings) {
      if (r.mesh.visible) r.mesh.quaternion.copy(camera.quaternion);
    }
  }
}
