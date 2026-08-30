import * as THREE from 'three';
import { mulberry32, COURSE_SEED } from './rng';
import { makeGlowTexture } from './textures';

export const CHUNK_LEN = 280;
export const RELAY_Z = [-1050, -2400, -3800];
export const EXTRACTION_Z = -4900;

/** Gentle winding course spine in X. */
export function pathX(z: number): number {
  return 15 * Math.sin(z * 0.0017 + 2.1) + 8 * Math.sin(z * 0.0043 - 0.6);
}
/** Gentle course spine in Y. */
export function pathY(z: number): number {
  return 4 * Math.sin(z * 0.0029 + 1.25) + 2.5 * Math.sin(z * 0.0083 + 2.6);
}

export interface Orb {
  mesh: THREE.Mesh;
  x: number; y: number; z: number;
  phase: number;
  spin: number;
  taken: boolean;
}
export interface Mine {
  group: THREE.Group;
  core: THREE.MeshStandardMaterial;
  x: number; y: number; z: number;
  phase: number;
  gone: boolean;
}
export interface Drone {
  group: THREE.Group;
  baseX: number; baseY: number;
  amp: number; speed: number; phase: number;
  z: number;
  spin: number;
  rotors: THREE.Mesh[];
  gone: boolean;
}
export interface Arch {
  ring: THREE.Mesh;
  x: number; y: number; z: number;
  spin: number;
  used: boolean;
}
export interface Island {
  group: THREE.Group;
  x: number; y: number; z: number;
  r: number; h: number;
}
export interface Spire {
  group: THREE.Group;
  tip: THREE.MeshStandardMaterial;
  x: number; y: number; z: number;
  gone: boolean;
}

/* ---------------------------------------------------------------- */
/* Shared materials / geometries                                     */
/* ---------------------------------------------------------------- */
const GLOW_TEX = makeGlowTexture();

const M = {
  rock: new THREE.MeshStandardMaterial({ color: 0x3a4657, metalness: 0.25, roughness: 0.85 }),
  rockDark: new THREE.MeshStandardMaterial({ color: 0x232c3b, metalness: 0.2, roughness: 0.9 }),
  rim: new THREE.MeshStandardMaterial({ color: 0x0c1a1f, emissive: 0x2fd6c6, emissiveIntensity: 0.85, metalness: 0.6, roughness: 0.4 }),
  crystal: new THREE.MeshStandardMaterial({ color: 0x0d2b34, emissive: 0x39e6d8, emissiveIntensity: 1.5, metalness: 0.3, roughness: 0.3 }),
  pylon: new THREE.MeshStandardMaterial({ color: 0x1c2636, metalness: 0.7, roughness: 0.45 }),
  pylonTip: new THREE.MeshStandardMaterial({ color: 0x062018, emissive: 0x4fe8dd, emissiveIntensity: 2.4 }),
  spire: new THREE.MeshStandardMaterial({ color: 0x151d2b, metalness: 0.75, roughness: 0.4 }),
  spireTip: new THREE.MeshStandardMaterial({ color: 0x1a0e08, emissive: 0xff7744, emissiveIntensity: 2.0 }),
  arch: new THREE.MeshStandardMaterial({ color: 0x0b2230, emissive: 0x2aa8c0, emissiveIntensity: 0.75, metalness: 0.55, roughness: 0.4 }),
  orb: new THREE.MeshStandardMaterial({ color: 0x0a2a2c, emissive: 0x4fe8dd, emissiveIntensity: 3.2 }),
  mineBody: new THREE.MeshStandardMaterial({ color: 0x22090d, metalness: 0.6, roughness: 0.5 }),
  mineSpike: new THREE.MeshStandardMaterial({ color: 0x3a0d14, emissive: 0xff3355, emissiveIntensity: 0.8, metalness: 0.5, roughness: 0.5 }),
  droneBody: new THREE.MeshStandardMaterial({ color: 0x2a1213, metalness: 0.7, roughness: 0.4 }),
  diamond: new THREE.MeshStandardMaterial({ color: 0x0a2a2c, emissive: 0x7df3ea, emissiveIntensity: 2.4 }),
  frame: new THREE.MeshStandardMaterial({ color: 0x25324a, metalness: 0.8, roughness: 0.35 }),
  frameAccent: new THREE.MeshStandardMaterial({ color: 0x0d1a24, emissive: 0x39d9c8, emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.4 }),
  shard: new THREE.MeshStandardMaterial({ color: 0x0e1622, metalness: 0.7, roughness: 0.3 }),
  startPad: new THREE.MeshStandardMaterial({ color: 0x0c1a1f, emissive: 0x39d9c8, emissiveIntensity: 1.6 }),
};

const GEO = {
  island: new THREE.DodecahedronGeometry(1, 0),
  orb: new THREE.IcosahedronGeometry(1, 0),
  diamond: new THREE.OctahedronGeometry(1, 0),
  crystal: new THREE.OctahedronGeometry(1, 0),
  mineCore: new THREE.IcosahedronGeometry(1, 0),
  mineSpike: new THREE.ConeGeometry(1, 1, 6),
  droneBody: new THREE.CapsuleGeometry(1, 1, 4, 10),
  rotor: new THREE.BoxGeometry(1, 1, 1),
  shard: new THREE.TetrahedronGeometry(1, 0),
  ring: new THREE.TorusGeometry(1, 1, 12, 48),
};

/* ---------------------------------------------------------------- */
/* Relay gate                                                        */
/* ---------------------------------------------------------------- */
export class Relay {
  readonly group = new THREE.Group();
  readonly idx: number;
  readonly x: number; readonly y: number; readonly z: number;
  restored = false;
  restoreT = -1;
  active = false;
  private ringMat: THREE.MeshStandardMaterial;
  private coreMat: THREE.MeshStandardMaterial;
  private beaconMat: THREE.MeshBasicMaterial;
  private beaconRing: THREE.Mesh;
  private beaconRingMat: THREE.MeshBasicMaterial;
  private diamonds: THREE.Mesh[] = [];
  private shards: THREE.Mesh[] = [];
  private ringMesh: THREE.Mesh;
  private baseRing: THREE.MeshStandardMaterial;

  private beacon: THREE.Group;
  private beaconTip: THREE.Sprite;
  private coreMesh: THREE.Mesh;

  constructor(idx: number, z: number) {
    this.idx = idx;
    this.z = z;
    this.x = pathX(z);
    this.y = pathY(z);
    this.group.position.set(this.x, this.y, this.z);
    this.beacon = new THREE.Group();
    this.beaconTip = new THREE.Sprite();

    // main ring
    this.ringMat = new THREE.MeshStandardMaterial({
      color: idx === 2 ? 0x0a2430 : 0x0a2a2c,
      emissive: idx === 2 ? 0x4fd8ff : 0x4fe8dd,
      emissiveIntensity: 0.35,
      metalness: 0.6,
      roughness: 0.35,
    });
    this.ringMesh = new THREE.Mesh(new THREE.TorusGeometry(7, 0.55, 14, 56), this.ringMat);
    this.group.add(this.ringMesh);

    // inner technical ring
    const inner = new THREE.Mesh(new THREE.TorusGeometry(6.3, 0.12, 8, 40), this.ringMat);
    inner.rotation.x = 0.35;
    this.group.add(inner);

    // frame pylons + base
    const pylonGeo = new THREE.BoxGeometry(0.9, 11, 0.9);
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(pylonGeo, M.frame);
      p.position.set(s * 9.5, -3.4, 0);
      this.group.add(p);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), M.frameAccent);
      cap.position.set(s * 9.5, 2.2, 0);
      this.group.add(cap);
    }
    const base = new THREE.Mesh(new THREE.BoxGeometry(15, 1.1, 2.2), M.frame);
    base.position.set(0, -8.9, 0);
    this.group.add(base);
    this.baseRing = new THREE.MeshStandardMaterial({
      color: 0x0c1a1f, emissive: 0x39d9c8, emissiveIntensity: 0.8, metalness: 0.6, roughness: 0.4,
    });
    const baseStrip = new THREE.Mesh(new THREE.TorusGeometry(6.4, 0.16, 8, 36), this.baseRing);
    baseStrip.rotation.x = -Math.PI / 2;
    baseStrip.position.y = -8.2;
    this.group.add(baseStrip);

    // core emitter
    this.coreMat = new THREE.MeshStandardMaterial({
      color: 0x0a2a2c, emissive: 0x8ffbf2, emissiveIntensity: 1.2, metalness: 0.2, roughness: 0.3,
    });
    this.coreMesh = new THREE.Mesh(new THREE.SphereGeometry(0.95, 20, 16), this.coreMat);
    this.group.add(this.coreMesh);

    // ring signal sprite
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: GLOW_TEX, color: idx === 2 ? 0x4fd8ff : 0x4fe8dd,
        transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    halo.scale.set(16, 16, 1);
    this.group.add(halo);

    // orbiting diamonds
    for (let k = 0; k < 4; k++) {
      const d = new THREE.Mesh(GEO.diamond, M.diamond);
      d.scale.setScalar(0.55);
      this.group.add(d);
      this.diamonds.push(d);
    }

    // broken shards floating near the ring
    for (let k = 0; k < 3; k++) {
      const sh = new THREE.Mesh(GEO.shard, M.shard);
      const a = (k / 3) * Math.PI * 2;
      sh.position.set(Math.cos(a) * 7.6, Math.sin(a) * 7.6, 0);
      sh.scale.setScalar(0.7 + k * 0.25);
      const rot = new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      sh.rotation.copy(rot);
      this.group.add(sh);
      this.shards.push(sh);
    }

    // beacon (light pillar), hidden until active
    this.beaconMat = new THREE.MeshBasicMaterial({
      map: GLOW_TEX, color: idx === 2 ? 0x7fd8ff : 0x7df3ea,
      transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const beacon = this.beacon;
    for (const s of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(9, 66), this.beaconMat);
      b.rotation.y = s * Math.PI * 0.5;
      b.position.y = 34;
      beacon.add(b);
    }
    this.beaconRingMat = new THREE.MeshBasicMaterial({
      color: idx === 2 ? 0x7fd8ff : 0x7df3ea,
      transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.beaconRing = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.16, 8, 40), this.beaconRingMat);
    this.beaconRing.rotation.x = Math.PI / 2;
    this.beaconRing.position.y = 1.2;
    beacon.add(this.beaconRing);
    // beacon tip light
    const tipLight = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: GLOW_TEX, color: idx === 2 ? 0x7fd8ff : 0x7df3ea,
        transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    tipLight.scale.set(6, 6, 1);
    tipLight.position.y = 66;
    this.beaconTip = tipLight;
    beacon.add(tipLight);
    this.beacon.visible = false;
    this.group.add(this.beacon);
  }

  startRestore(): void {
    this.restored = true;
    this.restoreT = 0;
  }

  reset(): void {
    this.restored = false;
    this.restoreT = -1;
    this.active = false;
    this.ringMat.emissiveIntensity = 0.35;
    this.coreMat.emissiveIntensity = 1.2;
    this.beaconMat.opacity = 0;
    this.beaconRingMat.opacity = 0;
    this.beacon.visible = false;
    (this.beaconTip.material as THREE.SpriteMaterial).opacity = 0;
  }

  update(dt: number, t: number): void {
    // diamonds orbit
    const speed = this.restored ? 0.9 : 0.4;
    const a0 = t * speed;
    for (let k = 0; k < this.diamonds.length; k++) {
      const a = a0 + (k / this.diamonds.length) * Math.PI * 2;
      const d = this.diamonds[k];
      d.position.set(Math.cos(a) * 4.6, Math.sin(a) * 4.6, 0.6);
      d.rotation.y = t * 2 + k;
      d.rotation.z = t * 1.3 + k;
    }

    // beacon visibility
    const bc = this.active && !this.restored ? 1 : 0;
    if (this.beaconMat.opacity !== bc) {
      this.beaconMat.opacity = bc;
      this.beaconRingMat.opacity = bc;
      (this.beaconTip.material as THREE.SpriteMaterial).opacity = bc;
      this.beacon.visible = bc > 0.5;
    }
    if (bc > 0.5) {
      const fl = 0.85 + Math.sin(t * 9.3) * 0.1 + Math.random() * 0.08;
      this.beaconMat.opacity = bc * fl * 0.5;
      this.beaconRingMat.opacity = bc * fl;
      this.beaconRing.rotation.z = t * 1.1;
      this.beacon.visible = true;
    }

    if (this.restoreT >= 0) {
      this.restoreT += dt;
      const k = Math.min(1, this.restoreT / 1.35);
      const ease = 1 - Math.pow(1 - k, 3);
      this.ringMat.emissiveIntensity = 0.3 + 3.2 * ease;
      this.coreMat.emissiveIntensity = 1.4 + 4.5 * ease;
      const pulse = 1 + 0.5 * Math.sin(k * Math.PI);
      this.coreScale(pulse);
      if (k >= 1) this.restoreT = -1;
    } else if (this.restored) {
      this.ringMat.emissiveIntensity = 1.9 + Math.sin(t * 2.4) * 0.2;
      this.coreMat.emissiveIntensity = 3.4 + Math.sin(t * 3.1) * 0.5;
      this.coreScale(1 + Math.sin(t * 3) * 0.06);
    } else {
      // damaged flicker
      const fl = Math.random() < 0.94 ? 0.3 + Math.sin(t * 7.1) * 0.08 : 1.6;
      this.ringMat.emissiveIntensity = fl;
      this.coreMat.emissiveIntensity = 0.9 + Math.sin(t * 5.3) * 0.35;
      this.baseRing.emissiveIntensity = 0.5 + Math.sin(t * 4.1) * 0.2;
    }

    // shards drift
    for (let k = 0; k < this.shards.length; k++) {
      const sh = this.shards[k];
      sh.position.x += Math.sin(t * 1.3 + k * 2.1) * 0.006;
      sh.position.y += Math.cos(t * 1.1 + k * 1.7) * 0.006;
    }
  }

  private coreScale(s: number): void {
    this.coreMesh.scale.setScalar(s);
  }
}

/* ---------------------------------------------------------------- */
/* Extraction ring                                                   */
/* ---------------------------------------------------------------- */
export class ExtractionGate {
  readonly group = new THREE.Group();
  readonly x: number; readonly y: number; readonly z: number;
  active = false;
  private mainMat: THREE.MeshBasicMaterial;
  private outerA: THREE.Mesh;
  private outerB: THREE.Mesh;
  private beaconMat: THREE.MeshBasicMaterial;
  private beaconRing: THREE.Mesh;

  constructor(z: number) {
    this.z = z;
    this.x = pathX(z);
    this.y = pathY(z) + 3;
    this.group.position.set(this.x, this.y, this.z);

    this.mainMat = new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const main = new THREE.Mesh(new THREE.TorusGeometry(10, 0.7, 14, 72), this.mainMat);
    this.group.add(main);

    const outMat = new THREE.MeshBasicMaterial({
      color: 0xffb860, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.outerA = new THREE.Mesh(new THREE.TorusGeometry(12.4, 0.1, 8, 72), outMat);
    this.outerA.rotation.x = 0.5;
    this.group.add(this.outerA);
    this.outerB = new THREE.Mesh(new THREE.TorusGeometry(13.5, 0.1, 8, 72), outMat.clone());
    this.outerB.rotation.x = -0.4;
    this.outerB.rotation.z = 0.5;
    this.group.add(this.outerB);

    // center emitter
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 20, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending })
    );
    this.group.add(core);

    // beacon pillar
    this.beaconMat = new THREE.MeshBasicMaterial({
      map: GLOW_TEX, color: 0xffc857, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const beacon = new THREE.Group();
    for (const s of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(12, 80), this.beaconMat);
      b.rotation.y = s * Math.PI * 0.5;
      b.position.y = 42;
      beacon.add(b);
    }
    this.beaconRing = new THREE.Mesh(new THREE.TorusGeometry(5.4, 0.2, 8, 44), this.beaconMat);
    this.beaconRing.rotation.x = Math.PI / 2;
    this.beaconRing.position.y = 1.6;
    beacon.add(this.beaconRing);
    this.beacon = beacon;
    this.group.add(beacon);
  }

  private beacon: THREE.Group;

  setActive(a: boolean): void {
    this.active = a;
    this.group.visible = true;
  }

  reset(): void {
    this.active = false;
    this.group.visible = false;
    this.beaconMat.opacity = 0;
  }

  update(dt: number, t: number): void {
    if (!this.active) return;
    this.outerA.rotation.z += dt * 0.7;
    this.outerB.rotation.z -= dt * 0.5;
    const pulse = 0.7 + Math.sin(t * 5.2) * 0.18;
    this.mainMat.opacity = pulse * 0.9;
    const fl = 0.9 + Math.sin(t * 8.1) * 0.1;
    this.beaconMat.opacity = fl * 0.5;
    this.beaconRing.rotation.z = t * 1.4;
    this.beacon.visible = true;
  }
}

/* ---------------------------------------------------------------- */
/* World                                                             */
/* ---------------------------------------------------------------- */
export class World {
  readonly group = new THREE.Group();
  relays: Relay[] = [];
  extraction!: ExtractionGate;
  orbs: Orb[] = [];
  mines: Mine[] = [];
  drones: Drone[] = [];
  arches: Arch[] = [];
  islands: Island[] = [];
  spires: Spire[] = [];
  activeRelay = 0; // 0..2 while progress < 3
  /** Ambient/lightning flash 0..1 exposed for the game loop. */
  strikeFlash = 0;
  private chunks = new Map<number, THREE.Group>();
  private cloudMats: THREE.ShaderMaterial[] = [];
  private skyGroup = new THREE.Group();
  private stormSprites: THREE.Sprite[] = [];
  private bolt: THREE.Line | null = null;
  private nextBolt = 4;
  private boltLife = 0;

  constructor(private readonly seed: number) {}

  init(scene: THREE.Scene): void {
    this.buildSky();
    this.buildClouds();
    this.buildStart();
    for (let i = 0; i < RELAY_Z.length; i++) {
      const rel = new Relay(i, RELAY_Z[i]);
      this.relays.push(rel);
      this.group.add(rel.group);
    }
    this.extraction = new ExtractionGate(EXTRACTION_Z);
    this.extraction.group.visible = false;
    this.group.add(this.extraction.group);
    scene.add(this.group);
  }

  /* ---------------- sky + storm ---------------- */
  private buildSky(): void {
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec3 vP;
        void main() {
          vP = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vP;
        uniform float uTime;
        void main() {
          float y = normalize(vP).y;
          vec3 top = vec3(0.016, 0.035, 0.10);
          vec3 mid = vec3(0.09, 0.16, 0.30);
          vec3 horizon = vec3(0.22, 0.24, 0.34);
          vec3 abyss = vec3(0.015, 0.02, 0.05);
          float h = smoothstep(0.02, 0.45, y);
          vec3 col = mix(horizon, mid, h);
          col = mix(col, top, smoothstep(0.2, 0.85, y));
          // aurora band
          float band = smoothstep(0.12, 0.28, y) * (1.0 - smoothstep(0.4, 0.55, y));
          band *= 0.5 + 0.5 * sin(vP.x * 0.01 + uTime * 0.05);
          col += vec3(0.10, 0.34, 0.38) * band * 0.5;
          // storm glow near horizon
          float storm = (1.0 - smoothstep(0.0, 0.10, y));
          col = mix(col, vec3(0.5, 0.28, 0.16), storm * 0.55);
          // below horizon: abyss
          col = mix(col, abyss, smoothstep(0.0, -0.06, y));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2300, 32, 20), skyMat);
    this.skyGroup.add(dome);

    // stars
    const count = 520;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.acos(0.35 + Math.random() * 0.62);
      const r = 2100;
      pos[i * 3] = Math.cos(a) * Math.cos(e) * r;
      pos[i * 3 + 1] = Math.sin(e) * r;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(
      sgeo,
      new THREE.PointsMaterial({ color: 0xb9d4ff, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false })
    );
    this.skyGroup.add(stars);

    // distant storm clouds (dark sprites) + teal glow
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      const e = 0.06 + Math.random() * 0.1;
      const r = 2100;
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: GLOW_TEX,
          color: Math.random() < 0.6 ? 0x0a0f22 : 0x1c2338,
          transparent: true,
          opacity: 0.16 + Math.random() * 0.2,
          depthWrite: false,
          blending: THREE.NormalBlending,
        })
      );
      sp.position.set(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r * 0.85, Math.sin(a) * Math.cos(e) * r);
      const s = 260 + Math.random() * 340;
      sp.scale.set(s, s * 0.62, 1);
      this.skyGroup.add(sp);
      this.stormSprites.push(sp);
    }

    this.group.add(this.skyGroup);
  }

  private buildClouds(): void {
    const makeLayer = (yLevel: number, scrollMul: number, density: number, bright: number, alphaMul: number) => {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: { value: 0 }, uScroll: { value: 0 }, uY: { value: yLevel } },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uScroll;
          varying vec2 vUv;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p){
            vec2 i = floor(p); vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                       mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
          }
          float fbm(vec2 p){
            float v = 0.0; float a = 0.5;
            for (int k = 0; k < 5; k++){ v += a * noise(p); p = p * 2.1 + vec2(3.1, 1.7); a *= 0.5; }
            return v;
          }
          void main(){
            vec2 p = vUv * vec2(2.2, 7.0);
            p.x += uScroll * 0.55;
            float n = fbm(p * ${density.toFixed(2)} + vec2(0.0, uScroll * ${scrollMul.toFixed(2)}));
            n += 0.12 * sin(p.x * 2.6 + uTime * 0.35) * sin(p.y * 3.4 - uTime * 0.22);
            float a = smoothstep(${0.5 - bright * 0.14}, 0.72, n);
            // fade at far edge of the plane
            float farFade = smoothstep(0.86, 1.0, vUv.y);
            // fade near the start so it drops under the player cleanly
            float nearFade = smoothstep(0.0005, 0.03, vUv.y);
            a *= (1.0 - farFade) * nearFade * ${alphaMul};
            vec3 dark = vec3(0.028, 0.04, 0.075);
            vec3 lit  = vec3(${0.55 * bright + 0.38}, ${0.62 * bright + 0.42}, ${0.74 * bright + 0.5});
            vec3 col = mix(dark, lit, smoothstep(0.5, 0.78, n));
            float night = 0.55 + 0.45 * (1.0 - farFade);
            col *= night;
            gl_FragColor = vec4(col, a);
          }
        `,
      });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1700, 9000), mat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(0, yLevel, -4400);
      this.group.add(plane);
      this.cloudMats.push(mat);
    };
    makeLayer(-72, 0.5, 1.6, 0.62, 0.85);
    makeLayer(-63, 1.0, 2.3, 0.85, 0.6);
  }

  /** Start platform + entrance arch right where the run begins. */
  private buildStart(): void {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(7, 8.4, 0.8, 28), M.startPad);
    pad.position.set(0, -2.6, 34);
    this.group.add(pad);

    const arch = new THREE.Mesh(
      new THREE.TorusGeometry(9, 0.65, 12, 56),
      new THREE.MeshBasicMaterial({ color: 0x4fe8dd, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending })
    );
    arch.position.set(0, 1.2, 16);
    this.group.add(arch);
  }

  /* ---------------- chunk system ---------------- */
  ensureChunks(pz: number): void {
    const iMin = Math.max(0, Math.floor((-pz - 880) / CHUNK_LEN));
    const iMax = Math.floor((-pz + 150) / CHUNK_LEN);
    for (let i = iMin; i <= iMax; i++) {
      if (!this.chunks.has(i)) this.buildChunk(i);
    }
    for (const [i, g] of this.chunks) {
      if (i < iMin || i > iMax) this.removeChunk(i, g);
    }
  }

  private removeChunk(i: number, group: THREE.Group): void {
    this.chunks.delete(i);
    // dispose per-instance materials/geometries created for this chunk
    const dis = (group.userData.disposables ?? []) as (THREE.Material | THREE.BufferGeometry)[];
    for (const d of dis) d.dispose();
    this.group.remove(group);
    const zNear = -i * CHUNK_LEN;
    const zFar = zNear - CHUNK_LEN;
    const inZone = (z: number) => z <= zNear + 10 && z >= zFar - 10;
    const drop = <T extends { z: number }>(arr: T[], pred: (o: T) => boolean): void => {
      for (let n = arr.length - 1; n >= 0; n--) {
        const o = arr[n];
        if (pred(o)) {
          arr.splice(n, 1);
          const g = (o as { gone?: boolean }).gone;
          if (g !== undefined) (o as unknown as { gone: boolean }).gone = true;
        }
      }
    };
    drop(this.orbs, (o) => inZone(o.z));
    drop(this.mines, (o) => inZone(o.z));
    drop(this.drones, (o) => inZone(o.z));
    drop(this.arches, (o) => inZone(o.z));
    drop(this.islands, (o) => inZone(o.z));
    drop(this.spires, (o) => inZone(o.z));
  }

  private buildChunk(i: number): void {
    const rng = mulberry32((this.seed ^ Math.imul(i + 1, 2654435761)) >>> 0);
    rng(); rng(); rng();
    const g = new THREE.Group();
    const disposables: (THREE.Material | THREE.BufferGeometry)[] = [];
    const zNear = -i * CHUNK_LEN;
    const zFar = zNear - CHUNK_LEN;
    const nearGate = (z: number) =>
      RELAY_Z.some((rz) => Math.abs(z - rz) < 55) || Math.abs(z - EXTRACTION_Z) < 70;

    /* islands */
    const nIsl = 3 + (i % 3);
    for (let k = 0; k < nIsl; k++) {
      const z = zNear - rng() * CHUNK_LEN;
      if (nearGate(z)) continue;
      const side = rng() < 0.5 ? -1 : 1;
      const lat = 15 + rng() * 16;
      const x = pathX(z) + side * lat;
      let y = pathY(z) + (rng() - 0.5) * 26;
      y = Math.max(-20, Math.min(26, y));
      const r = 6.5 + rng() * 7.5;
      const group = new THREE.Group();
      const rock = new THREE.Mesh(GEO.island, M.rock);
      rock.scale.set(r, r * 0.52, r);
      rock.position.y = -r * 0.16;
      group.add(rock);
      const under = new THREE.Mesh(GEO.island, M.rockDark);
      under.scale.set(r * 0.86, r * 0.46, r * 0.86);
      under.position.y = -r * 0.62;
      under.rotation.y = 1.1;
      group.add(under);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.92, 0.16, 8, 40), M.rim);
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = r * 0.32;
      rim.rotation.z = rng() * Math.PI;
      group.add(rim);
      const nc = 1 + Math.floor(rng() * 3);
      for (let c = 0; c < nc; c++) {
        const cr = new THREE.Mesh(GEO.crystal, M.crystal);
        const ca = rng() * Math.PI * 2;
        const cd = r * (0.2 + rng() * 0.45);
        cr.position.set(Math.cos(ca) * cd, r * 0.42 + rng() * r * 0.1, Math.sin(ca) * cd);
        cr.scale.set(0.6 + rng() * 0.8, 1.1 + rng() * 0.9, 0.6 + rng() * 0.8);
        cr.rotation.set(rng(), rng() * 3, rng());
        group.add(cr);
      }
      group.position.set(x, y, z);
      group.rotation.y = rng() * Math.PI * 2;
      this.group.add(group);
      g.add(group);
      this.islands.push({ group, x, y, z, r, h: r * 0.9 });
    }

    /* edge pylons */
    const nP = 3;
    for (let k = 0; k < nP; k++) {
      const z = zNear - ((k + 0.5 + (rng() - 0.5) * 0.5) / nP) * CHUNK_LEN;
      const side = rng() < 0.5 ? -1 : 1;
      const x = pathX(z) + side * (26 + rng() * 5);
      const baseY = -18 + rng() * 10;
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.7, 26, 0.7), M.pylon);
      pole.position.set(x, baseY + 13, z);
      pole.rotation.z = side * (0.02 + rng() * 0.05);
      g.add(pole);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 10), M.pylonTip);
      tip.position.set(x, baseY + 26.4, z);
      tip.scale.set(1, 1.4, 1);
      g.add(tip);
    }

    /* storm spires */
    const nSp = 2;
    for (let k = 0; k < nSp; k++) {
      const z = zNear - (0.2 + rng() * 0.6) * CHUNK_LEN;
      const side = rng() < 0.5 ? -1 : 1;
      const x = pathX(z) + side * (20 + rng() * 14);
      const baseY = -16 + rng() * 10;
      const group = new THREE.Group();
      const spire = new THREE.Mesh(new THREE.BoxGeometry(0.5, 46, 0.5), M.spire);
      spire.position.y = 23;
      group.add(spire);
      const tipMat = new THREE.MeshStandardMaterial({
        color: 0x1a0e08, emissive: 0xff7744, emissiveIntensity: 1.2, metalness: 0.5, roughness: 0.4,
      });
      disposables.push(tipMat);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), tipMat);
      tip.position.y = 46.5;
      group.add(tip);
      group.position.set(x, baseY, z);
      group.rotation.z = side * 0.045;
      g.add(group);
      this.spires.push({ group, tip: tipMat, x, y: baseY + 46.5, z, gone: false });
    }

    /* signal arch (i >= 1) */
    if (i >= 1) {
      const z = zNear - (0.3 + rng() * 0.45) * CHUNK_LEN;
      const x = pathX(z);
      const y = pathY(z) + 1.5;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(8, 0.4, 12, 48), M.arch);
      ring.position.set(x, y, z);
      g.add(ring);
      this.arches.push({ ring, x, y, z, spin: rng() * 10, used: false });
    }

    /* charge orbs */
    const nGrp = 2 + (i % 2);
    for (let gr = 0; gr < nGrp; gr++) {
      const zStart = zNear - (0.12 + rng() * 0.4) * CHUNK_LEN;
      const count = 8 + Math.floor(rng() * 3);
      const dir = rng() < 0.5 ? 1 : -1;
      const lat = (rng() * 2 - 1) * 9;
      const yOff = (rng() * 2 - 1) * 6;
      for (let k = 0; k < count; k++) {
        const z = zStart - dir * k * 3.2;
        if (z < zFar + 4 || z > zNear - 4 || nearGate(z)) continue;
        const x = pathX(z) + lat + Math.sin(k * 0.62) * 3;
        const y = pathY(z) + yOff + Math.sin(k * 0.7) * 2.5;
        const mesh = new THREE.Mesh(GEO.orb, M.orb);
        mesh.scale.setScalar(0.44 + rng() * 0.12);
        mesh.position.set(x, y, z);
        const phase = rng() * 6.28;
        this.orbs.push({ mesh, x, y, z, phase, spin: rng() * 6.28, taken: false });
        g.add(mesh);
      }
    }

    /* storm mines (from chunk 1) */
    if (i >= 1) {
      const n = Math.min(3, 1 + Math.floor(i / 2));
      for (let k = 0; k < n; k++) {
        const z = zNear - (0.15 + rng() * 0.6) * CHUNK_LEN;
        if (nearGate(z)) continue;
        const side = rng() < 0.5 ? -1 : 1;
        const x = pathX(z) + side * (4 + rng() * 16);
        const y = pathY(z) + (rng() - 0.5) * 10;
        const group = new THREE.Group();
        const core = new THREE.MeshStandardMaterial({
          color: 0x330a10, emissive: 0xff3355, emissiveIntensity: 2.2, metalness: 0.4, roughness: 0.4,
        });
        disposables.push(core);
        const body = new THREE.Mesh(GEO.mineCore, core);
        body.scale.setScalar(0.95);
        group.add(body);
        for (let s = 0; s < 8; s++) {
          const spike = new THREE.Mesh(GEO.mineSpike, M.mineSpike);
          const a = (s / 8) * Math.PI * 2;
          const e = (s % 2 === 0 ? 1 : -1) * (0.2 + Math.random() * 0.5);
          spike.position.set(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)).normalize().multiplyScalar(1.5);
          spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), spike.position.clone().normalize());
          spike.scale.set(0.16, 0.9, 0.16);
          group.add(spike);
        }
        const glow = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: GLOW_TEX, color: 0xff3355, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        disposables.push(glow.material);
        glow.scale.set(4.4, 4.4, 1);
        group.add(glow);
        group.position.set(x, y, z);
        g.add(group);
        this.mines.push({ group, core, x, y, z, phase: rng() * 6.28, gone: false });
      }
    }

    /* patrol drones (from chunk 2) */
    if (i >= 2) {
      const nD = i >= 8 ? 2 : 1;
      for (let k = 0; k < nD; k++) {
        const z = zNear - (0.12 + rng() * 0.55) * CHUNK_LEN;
        const group = new THREE.Group();
        const body = new THREE.Mesh(GEO.droneBody, M.droneBody);
        body.rotation.x = Math.PI / 2;
        body.scale.set(0.55, 1, 0.75);
        group.add(body);
        const coreMat = new THREE.MeshStandardMaterial({
          color: 0x33100d, emissive: 0xff4433, emissiveIntensity: 2.6, metalness: 0.4, roughness: 0.3,
        });
        disposables.push(coreMat);
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 12), coreMat);
        core.position.y = 0.15;
        group.add(core);
        const rotors: THREE.Mesh[] = [];
        for (const [rx, ry] of [
          [-0.9, 0.28],
          [0.9, 0.28],
        ]) {
          const arm = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.1, 0.14), M.droneBody);
          arm.position.set(rx, ry, 0);
          group.add(arm);
          const blade = new THREE.Mesh(GEO.rotor, new THREE.MeshStandardMaterial({ color: 0x0d141f, metalness: 0.6, roughness: 0.4 }));
          disposables.push(blade.material);
          blade.scale.set(0.9, 0.03, 0.22);
          blade.position.set(rx, ry + 0.16, 0);
          group.add(blade);
          rotors.push(blade);
        }
        const tail = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.0, 8), M.droneBody);
        tail.rotation.x = Math.PI / 2;
        tail.position.z = 1.1;
        group.add(tail);
        const glow = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: GLOW_TEX, color: 0xff4433, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        disposables.push(glow.material);
        glow.scale.set(3.2, 3.2, 1);
        group.add(glow);
        const baseX = pathX(z) + (rng() - 0.5) * 8;
        const baseY = pathY(z) + (rng() - 0.5) * 9;
        group.position.set(baseX, baseY, z);
        g.add(group);
        this.drones.push({
          group, baseX, baseY,
          amp: 11 + rng() * 11,
          speed: 0.65 + rng() * 0.55,
          phase: rng() * 6.28,
          z, spin: rng() * 6.28, rotors, gone: false,
        });
      }
    }

    this.chunks.set(i, g);
    g.userData.disposables = disposables;
    this.group.add(g);
  }

  /* ---------------- per-frame update ---------------- */
  /**
   * @param simT accumulated time while playing (hazards use this)
   * @param cosT always-advancing cosmetic time
   */
  update(dt: number, simT: number, cosT: number, shipPos: THREE.Vector3 | null): void {
    // sky follows the ship
    if (shipPos) {
      this.skyGroup.position.set(shipPos.x * 0.3, 0, shipPos.z * 0.3);
    } else {
      this.skyGroup.position.set(0, 0, 0);
    }

    // cloud shader
    for (const m of this.cloudMats) {
      m.uniforms.uTime.value = cosT;
      const mul = m === this.cloudMats[1] ? 1.0 : 0.5;
      m.uniforms.uScroll.value = cosT * (4 + mul * 5);
    }

    // relays
    for (const r of this.relays) r.update(dt, cosT);
    this.extraction.update(dt, cosT);

    // orbs
    for (const o of this.orbs) {
      if (o.taken) continue;
      // gentle magnet: orbs within 7u lean toward the ship (arcade forgiveness)
      if (shipPos) {
        const mx = shipPos.x - o.mesh.position.x;
        const my = shipPos.y - o.mesh.position.y;
        const mz = shipPos.z - o.mesh.position.z;
        const md2 = mx * mx + my * my + mz * mz;
        if (md2 < 49) {
          const md = Math.sqrt(md2) || 1;
          const pull = ((7 - md) / 7) * dt * 7;
          o.mesh.position.x += (mx / md) * pull;
          o.mesh.position.z += (mz / md) * pull;
        }
      }
      o.mesh.rotation.y += dt * 2.6;
      o.mesh.rotation.x += dt * 1.4;
      o.mesh.position.y = o.y + Math.sin(cosT * 2.1 + o.phase) * 0.14;
    }

    // mines
    for (const m of this.mines) {
      if (m.gone) continue;
      const pulse = 1 + 0.09 * Math.sin(cosT * 5.2 + m.phase);
      m.group.scale.setScalar(pulse);
      m.core.emissiveIntensity = 1.6 + Math.sin(cosT * 6.4 + m.phase) * 1.1;
      if (simT > 0) {
        m.group.position.x = m.x + Math.sin(simT * 1.7 + m.phase) * 0.6;
        m.group.position.y = m.y + Math.sin(simT * 2.3 + m.phase * 2) * 0.5;
      } else {
        m.group.position.x = m.x;
        m.group.position.y = m.y;
      }
      m.group.rotation.x = simT * 0.8 + m.phase;
      m.group.rotation.y = simT * 1.3 + m.phase;
    }

    // drones
    for (const d of this.drones) {
      if (d.gone) continue;
      if (simT > 0) {
        const a = simT * d.speed + d.phase;
        d.group.position.x = d.baseX + Math.sin(a) * d.amp;
        d.group.position.y = d.baseY + Math.sin(simT * 1.4 + d.phase * 1.7) * 2.1;
        d.group.rotation.z = Math.cos(a) * 0.22;
        d.group.rotation.x = Math.sin(a * 0.7) * 0.14;
      }
      for (const r of d.rotors) r.rotation.y += dt * (7 + d.speed * 5);
    }

    // arches
    for (const a of this.arches) {
      a.ring.rotation.z = Math.sin(cosT * 0.6 + a.spin) * 0.5;
      a.ring.rotation.y = cosT * 0.25 + a.spin;
    }

    // lightning
    this.nextBolt -= dt;
    if (this.nextBolt <= 0) {
      this.nextBolt = 7 + Math.random() * 9;
      this.strike(shipPos);
    }
    if (this.boltLife > 0) {
      this.boltLife -= dt;
      if (this.bolt && this.boltLife <= 0) this.bolt.visible = false;
    }
    this.strikeFlash *= Math.exp(-dt * 6.5);

    // storm sprite shimmer
    for (let sIdx = 0; sIdx < this.stormSprites.length; sIdx++) {
      const sp = this.stormSprites[sIdx];
      (sp.material as THREE.SpriteMaterial).opacity =
        0.16 + 0.1 * Math.sin(cosT * 0.8 + sIdx * 1.7);
    }
  }

  private strike(shipPos: THREE.Vector3 | null): void {
    if (!shipPos) return;
    // prefer a nearby spire
    let tx = -9999;
    let tz = 0;
    let tTop = 0;
    const near = this.spires.filter(
      (s) => !s.gone && Math.abs(s.z - shipPos.z) < 520 && Math.abs(s.x - shipPos.x) < 320
    );
    if (near.length > 0) {
      const s = near[Math.floor(Math.random() * near.length)];
      tx = s.x; tz = s.z; tTop = s.y + 4;
      s.tip.emissiveIntensity = 6;
    } else {
      // horizon strike
      const sp = this.stormSprites[Math.floor(Math.random() * this.stormSprites.length)];
      const v = sp.position.clone().sub(this.skyGroup.position);
      tx = shipPos.x + v.x * 0.2;
      tz = shipPos.z + v.z * 0.2;
      tTop = 150;
    }
    const pts: THREE.Vector3[] = [];
    const x0 = tx + (Math.random() - 0.5) * 6;
    const segs = 7;
    for (let k = 0; k <= segs; k++) {
      const f = k / segs;
      const y = tTop - f * (tTop + 40);
      const spread = Math.max(1, (1 - f) * 14);
      pts.push(new THREE.Vector3(x0 + (Math.random() - 0.5) * spread, y, tz + (Math.random() - 0.5) * spread));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    if (!this.bolt) {
      this.bolt = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({
          color: 0xcfe4ff,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      this.group.add(this.bolt);
    } else {
      this.bolt.geometry.dispose();
      this.bolt.geometry = geo;
    }
    this.bolt.visible = true;
    this.boltLife = 0.14;
    this.strikeFlash = Math.min(1, this.strikeFlash + 0.85);
  }

  /** Called by the game loop when a run restarts. */
  reset(): void {
    for (const [, g] of this.chunks) this.group.remove(g);
    this.chunks.clear();
    this.orbs.length = 0;
    this.mines.length = 0;
    this.drones.length = 0;
    this.arches.length = 0;
    this.islands.length = 0;
    this.spires.length = 0;
    for (const r of this.relays) r.reset();
    this.extraction.reset();
    this.activeRelay = 0;
    this.strikeFlash = 0;
  }
}