import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, LIGHTNING } from '../config';
import { RNG } from '../core/rng';
import type { Course } from './course';
import { getPuffTexture } from './textures';

export interface StrikeEvent {
  pos: THREE.Vector3;
}

const SKY_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uDeep;
uniform float uTime;
uniform float uFlash;
varying vec3 vWorld;
void main() {
  vec3 dir = normalize(vWorld - cameraPosition);
  float h = dir.y;
  vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.24, h));
  col = mix(col, uZenith, smoothstep(0.16, 0.6, h));
  col = mix(uDeep, col, smoothstep(-0.3, -0.02, h));
  col += vec3(0.07, 0.16, 0.19) * exp(-abs(h + 0.01) * 7.0);
  float band = sin(dir.x * 4.0 + uTime * 0.05) * sin(dir.z * 3.0 - uTime * 0.04);
  col += vec3(0.012, 0.022, 0.028) * band;
  col += uFlash * vec3(0.55, 0.75, 1.0) * (0.25 + 0.75 * exp(-abs(h) * 3.0));
  gl_FragColor = vec4(col, 1.0);
}`;

const CLOUD_FRAG = /* glsl */ `
uniform vec3 uDeep;
uniform vec3 uCrest;
uniform vec3 uFogColor;
uniform float uTime;
uniform float uFlash;
varying vec3 vWorld;

float hash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 p = vWorld.xz;
  float n1 = fbm(p * 0.0045 + vec2(uTime * 0.013, uTime * 0.007));
  float n2 = fbm(p * 0.017 - vec2(uTime * 0.031, uTime * 0.011));
  float n = n1 * 0.76 + n2 * 0.24;
  vec3 col = mix(uDeep, uCrest, smoothstep(0.3, 0.8, n));
  col += uCrest * pow(smoothstep(0.55, 0.95, n), 2.0) * 0.45;
  float d = distance(cameraPosition, vWorld);
  float f = smoothstep(140.0, 950.0, d);
  col = mix(col, uFogColor, f);
  // match the sky's horizon glow so the sea meets the sky seamlessly
  vec3 viewDir = normalize(vWorld - cameraPosition);
  col += vec3(0.05, 0.11, 0.13) * exp(-abs(viewDir.y) * 7.0);
  col += uFlash * vec3(0.5, 0.7, 1.0) * (0.35 + 0.65 * n);
  gl_FragColor = vec4(col, 1.0);
}`;

const CLOUD_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

interface Puff {
  sprite: THREE.Sprite;
  baseY: number;
  phase: number;
}

interface Blinker {
  mat: THREE.MeshBasicMaterial;
  phase: number;
  speed: number;
}

interface Buoy {
  mesh: THREE.Mesh;
  phase: number;
}

type BoltState = 'idle' | 'warn' | 'strike' | 'fade';

/** Storm environment: sky dome, cloud sea, debris field, rain and lightning. */
export class World {
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private cloudMat: THREE.ShaderMaterial;
  private hemi: THREE.HemisphereLight;
  private rainGeo: THREE.BufferGeometry;
  private rainDrops: Float32Array;
  private readonly RAIN_COUNT = 420;
  private puffs: Puff[] = [];
  private blinkers: Blinker[] = [];
  private buoys: Buoy[] = [];
  private wind = 9;

  private boltState: BoltState = 'idle';
  private boltTimer = 6;
  private boltPos = new THREE.Vector3();
  private warnMesh: THREE.Mesh;
  private warnMat: THREE.MeshBasicMaterial;
  private boltGroup: THREE.Group | null = null;
  private boltLight: THREE.PointLight;
  private cloudPlane: THREE.Mesh;
  private flash = 0;

  private runRng: RNG;

  constructor(private scene: THREE.Scene, private course: Course, layoutRng: RNG, runRng: RNG) {
    this.runRng = runRng;

    /* ---------------- lights ---------------- */
    this.hemi = new THREE.HemisphereLight(0x3d5a68, 0x0d1116, 0.85);
    scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0x9fc8d8, 1.15);
    sun.position.set(220, 340, 120);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x37586a, 0.5);
    rim.position.set(-260, 120, -220);
    scene.add(rim);

    /* ---------------- sky dome ---------------- */
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color(PALETTE.skyZenith) },
        uMid: { value: new THREE.Color(PALETTE.skyMid) },
        uHorizon: { value: new THREE.Color(PALETTE.skyHorizon) },
        uDeep: { value: new THREE.Color(PALETTE.fog) },
        uTime: { value: 0 },
        uFlash: { value: 0 },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(4200, 24, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    /* ---------------- cloud sea ---------------- */
    this.cloudMat = new THREE.ShaderMaterial({
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      fog: false,
      uniforms: {
        uDeep: { value: new THREE.Color(PALETTE.cloudDeep) },
        uCrest: { value: new THREE.Color(PALETTE.cloudCrest) },
        uFogColor: { value: new THREE.Color(PALETTE.fog) },
        uTime: { value: 0 },
        uFlash: { value: 0 },
      },
    });
    const cloudPlane = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), this.cloudMat);
    cloudPlane.rotation.x = -Math.PI / 2;
    cloudPlane.frustumCulled = false;
    this.cloudPlane = cloudPlane;
    scene.add(cloudPlane);

    /* ---------------- guide ribbon ---------------- */
    const ribbon = new THREE.Mesh(
      new THREE.TubeGeometry(course.curve, 640, 0.22, 5, false),
      new THREE.MeshBasicMaterial({
        color: PALETTE.cyan,
        transparent: true,
        opacity: 0.085,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    ribbon.renderOrder = 2;
    scene.add(ribbon);

    /* ---------------- buoys ---------------- */
    this.buildBuoys();

    /* ---------------- cloud puffs ---------------- */
    this.buildPuffs(layoutRng);

    /* ---------------- debris ---------------- */
    this.buildDebris(layoutRng);

    /* ---------------- rain ---------------- */
    this.rainDrops = new Float32Array(this.RAIN_COUNT * 4); // x, y, z, speed
    this.rainGeo = new THREE.BufferGeometry();
    this.rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.RAIN_COUNT * 6), 3));
    const rainMat = new THREE.LineBasicMaterial({
      color: 0x9fd0e0,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const rain = new THREE.LineSegments(this.rainGeo, rainMat);
    rain.frustumCulled = false;
    scene.add(rain);

    /* ---------------- lightning ---------------- */
    this.warnMat = new THREE.MeshBasicMaterial({
      color: PALETTE.red,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.warnMesh = new THREE.Mesh(new THREE.TorusGeometry(15, 0.5, 6, 36), this.warnMat);
    this.warnMesh.rotation.x = -Math.PI / 2;
    this.warnMesh.visible = false;
    scene.add(this.warnMesh);

    this.boltLight = new THREE.PointLight(0xdff2ff, 0, 600, 1.6);
    scene.add(this.boltLight);
  }

  setRunRng(rng: RNG): void {
    this.runRng = rng;
    this.boltState = 'idle';
    this.boltTimer = this.runRng.range(LIGHTNING.intervalMin, LIGHTNING.intervalMax) * 0.6;
    if (this.boltGroup) {
      this.scene.remove(this.boltGroup);
      this.disposeBoltGroup();
      this.boltGroup = null;
    }
    this.warnMesh.visible = false;
    this.flash = 0;
  }

  private disposeBoltGroup(): void {
    if (!this.boltGroup) return;
    this.boltGroup.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
  }

  /* ------------------------------------------------------------------ */

  private buildBuoys(): void {
    const armL = new THREE.BoxGeometry(3.6, 0.5, 0.55);
    armL.rotateY(0.62);
    armL.translate(-1.35, 0, -0.7);
    const armR = new THREE.BoxGeometry(3.6, 0.5, 0.55);
    armR.rotateY(-0.62);
    armR.translate(1.35, 0, -0.7);
    const chevron = mergeGeometries([armL, armR])!;

    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(PALETTE.cyan).multiplyScalar(1.05),
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });

    const count = Math.floor(this.course.length / 52);
    for (let k = 0; k < count; k++) {
      const t = 0.004 + (k / count) * 0.995;
      const pos = this.course.nearPoint(t, (k % 2 === 0 ? 1 : -1) * 7.5, 0);
      pos.y -= 2.5;
      const mesh = new THREE.Mesh(chevron, mat);
      mesh.position.copy(pos);
      const tan = this.course.tangentAt(t);
      mesh.lookAt(pos.x + tan.x, pos.y + tan.y, pos.z + tan.z);
      this.scene.add(mesh);
      this.buoys.push({ mesh, phase: k * 0.55 });
    }
  }

  private buildPuffs(rng: RNG): void {
    const tex = getPuffTexture();
    const count = 66;
    for (let i = 0; i < count; i++) {
      const t = rng.next();
      const pos = this.course.nearPoint(t, rng.sign() * rng.range(20, 170), 0);
      pos.y = rng.range(2, 9);
      const mat = new THREE.SpriteMaterial({
        map: tex,
        color: new THREE.Color(0x54707e).lerp(new THREE.Color(0x7b95a2), rng.next()),
        transparent: true,
        opacity: rng.range(0.22, 0.4),
        depthWrite: false,
        fog: true,
      });
      const s = new THREE.Sprite(mat);
      s.position.copy(pos);
      const sc = rng.range(42, 100);
      s.scale.set(sc, sc * rng.range(0.4, 0.6), 1);
      this.scene.add(s);
      this.puffs.push({ sprite: s, baseY: pos.y, phase: rng.range(0, Math.PI * 2) });
    }
  }

  private buildDebris(rng: RNG): void {
    const darkGeoms: THREE.BufferGeometry[] = [];
    const rustGeoms: THREE.BufferGeometry[] = [];
    const tmpM = new THREE.Matrix4();
    const e = new THREE.Euler();

    const scatterPos = (): THREE.Vector3 => {
      const t = rng.next();
      const pos = this.course.nearPoint(t, rng.sign() * rng.range(30, 200), 0);
      pos.y = Math.max(6, pos.y + rng.range(-30, 66));
      return pos;
    };

    for (let i = 0; i < 150; i++) {
      const pos = scatterPos();
      e.set(rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28));
      tmpM.makeRotationFromEuler(e);
      tmpM.setPosition(pos);
      const kind = rng.int(0, 4);
      let g: THREE.BufferGeometry;
      switch (kind) {
        case 0:
          g = new THREE.BoxGeometry(rng.range(4, 9), rng.range(0.18, 0.4), rng.range(5, 11));
          break;
        case 1:
          g = new THREE.BoxGeometry(1, rng.range(6, 15), 1);
          break;
        case 2: {
          g = new THREE.CylinderGeometry(rng.range(0.3, 0.7), rng.range(0.3, 0.7), rng.range(5, 13), 7);
          break;
        }
        case 3:
          g = new THREE.TorusGeometry(rng.range(3, 6), 0.42, 6, 14, rng.range(1, 2.6));
          break;
        default: {
          const mast = new THREE.CylinderGeometry(0.14, 0.2, rng.range(9, 17), 6);
          const cross = new THREE.BoxGeometry(rng.range(3, 6), 0.2, 0.2);
          cross.translate(0, 2.5, 0);
          g = mergeGeometries([mast, cross])!;
          break;
        }
      }
      g.applyMatrix4(tmpM);
      (rng.next() < 0.72 ? darkGeoms : rustGeoms).push(g);
    }

    // three wrecked relay gates off the course, for story texture
    for (const [t, side] of [[0.1, 1], [0.35, -1], [0.62, 1]] as const) {
      const pos = this.course.nearPoint(t, side * rng.range(70, 120), 0);
      pos.y += rng.range(10, 40);
      const ring = new THREE.TorusGeometry(10, 0.9, 8, 30);
      e.set(rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28));
      tmpM.makeRotationFromEuler(e);
      tmpM.setPosition(pos);
      ring.applyMatrix4(tmpM);
      darkGeoms.push(ring);
    }

    if (darkGeoms.length) {
      const dark = new THREE.Mesh(
        mergeGeometries(darkGeoms)!,
        new THREE.MeshStandardMaterial({ color: 0x39434c, metalness: 0.7, roughness: 0.8 }),
      );
      this.scene.add(dark);
    }
    if (rustGeoms.length) {
      const rust = new THREE.Mesh(
        mergeGeometries(rustGeoms)!,
        new THREE.MeshStandardMaterial({ color: 0x5a4638, metalness: 0.35, roughness: 0.9 }),
      );
      this.scene.add(rust);
    }

    // blinking hazard lights scattered in the debris
    const blinkGeo = new THREE.SphereGeometry(0.55, 8, 6);
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(PALETTE.red).multiplyScalar(2.2),
        transparent: true,
        opacity: 0.8,
        fog: false,
      });
      const s = new THREE.Mesh(blinkGeo, mat);
      s.position.copy(scatterPos());
      this.scene.add(s);
      this.blinkers.push({ mat, phase: rng.range(0, 6.28), speed: rng.range(1.5, 3.5) });
    }
  }

  /* ------------------------------------------------------------------ */

  /** Advance environment; returns a strike event the instant lightning lands. */
  update(dt: number, time: number, camPos: THREE.Vector3, playerPos: THREE.Vector3): StrikeEvent | null {
    this.skyMat.uniforms.uTime.value = time;
    this.cloudMat.uniforms.uTime.value = time;
    this.sky.position.set(camPos.x, 0, camPos.z);
    this.cloudPlane.position.set(camPos.x, 0, camPos.z);

    // puffs bob gently
    for (const p of this.puffs) {
      p.sprite.position.y = p.baseY + Math.sin(time * 0.35 + p.phase) * 1.6;
    }
    // beacon blinkers
    for (const b of this.blinkers) {
      b.mat.opacity = 0.25 + 0.6 * Math.max(0, Math.sin(time * b.speed + b.phase));
    }
    // buoy wave
    for (const b of this.buoys) {
      const s = 1 + 0.28 * Math.sin(time * 3 - b.phase);
      b.mesh.scale.setScalar(s);
    }

    this.updateRain(dt, camPos);
    return this.updateLightning(dt, playerPos);
  }

  private updateRain(dt: number, camPos: THREE.Vector3): void {
    const attr = this.rainGeo.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const half = { x: 130, y: 80, z: 170 };
    for (let i = 0; i < this.RAIN_COUNT; i++) {
      let x = this.rainDrops[i * 4];
      let y = this.rainDrops[i * 4 + 1];
      let z = this.rainDrops[i * 4 + 2];
      const speed = this.rainDrops[i * 4 + 3];
      y -= (66 + speed * 34) * dt;
      x += this.wind * dt;
      if (y < camPos.y - half.y || Math.abs(x - camPos.x) > half.x + 20 || Math.abs(z - camPos.z) > half.z + 20) {
        x = camPos.x + (Math.random() * 2 - 1) * half.x;
        z = camPos.z + (Math.random() * 2 - 1) * half.z;
        y = camPos.y + half.y * (0.4 + Math.random() * 0.6);
      }
      this.rainDrops[i * 4] = x;
      this.rainDrops[i * 4 + 1] = y;
      this.rainDrops[i * 4 + 2] = z;
      const i6 = i * 6;
      arr[i6] = x;
      arr[i6 + 1] = y;
      arr[i6 + 2] = z;
      arr[i6 + 3] = x - this.wind * 0.05;
      arr[i6 + 4] = y + (66 + speed * 34) * 0.055;
      arr[i6 + 5] = z;
    }
    attr.needsUpdate = true;
  }

  private updateLightning(dt: number, playerPos: THREE.Vector3): StrikeEvent | null {
    let strikeEvent: StrikeEvent | null = null;
    this.flash = Math.max(0, this.flash - dt * 2.4);

    switch (this.boltState) {
      case 'idle': {
        this.boltTimer -= dt;
        if (this.boltTimer <= 0) {
          const ang = this.runRng.range(0, Math.PI * 2);
          const dist = this.runRng.range(35, 190);
          this.boltPos.set(
            playerPos.x + Math.cos(ang) * dist,
            0,
            playerPos.z + Math.sin(ang) * dist,
          );
          this.boltState = 'warn';
          this.boltTimer = LIGHTNING.warnTime;
          this.warnMesh.position.set(this.boltPos.x, 3, this.boltPos.z);
          this.warnMesh.visible = true;
        }
        break;
      }
      case 'warn': {
        this.boltTimer -= dt;
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.03);
        this.warnMat.opacity = 0.22 + 0.4 * pulse;
        this.warnMesh.scale.setScalar(1 + 0.12 * pulse);
        if (this.boltTimer <= 0) {
          this.buildBolt();
          this.boltState = 'strike';
          this.boltTimer = LIGHTNING.strikeTime;
          this.flash = 1;
          this.boltLight.position.set(this.boltPos.x, 90, this.boltPos.z);
          this.boltLight.intensity = 1000;
          this.warnMesh.visible = false;
          strikeEvent = { pos: this.boltPos.clone() };
        }
        break;
      }
      case 'strike': {
        this.boltTimer -= dt;
        this.boltLight.intensity = 1000 * Math.max(0, this.boltTimer / LIGHTNING.strikeTime);
        if (this.boltTimer <= 0) {
          this.boltState = 'fade';
          this.boltTimer = LIGHTNING.fadeTime;
        }
        break;
      }
      case 'fade': {
        this.boltTimer -= dt;
        if (this.boltGroup) {
          const k = Math.max(0, this.boltTimer / LIGHTNING.fadeTime);
          this.boltGroup.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) (m.material as THREE.MeshBasicMaterial).opacity = k;
          });
        }
        if (this.boltTimer <= 0) {
          this.boltState = 'idle';
          this.boltTimer = this.runRng.range(LIGHTNING.intervalMin, LIGHTNING.intervalMax);
          if (this.boltGroup) {
            this.scene.remove(this.boltGroup);
            this.disposeBoltGroup();
            this.boltGroup = null;
          }
        }
        break;
      }
    }

    this.skyMat.uniforms.uFlash.value = this.flash;
    this.cloudMat.uniforms.uFlash.value = this.flash;
    this.hemi.intensity = 0.85 + this.flash * 2.6;
    return strikeEvent;
  }

  private buildBolt(): void {
    const pts: THREE.Vector3[] = [];
    const N = 9;
    for (let i = 0; i <= N; i++) {
      const f = i / N;
      const y = 2 + f * 330;
      const j = Math.sin(f * Math.PI) * 16;
      pts.push(new THREE.Vector3(
        this.boltPos.x + (Math.random() * 2 - 1) * j,
        y,
        this.boltPos.z + (Math.random() * 2 - 1) * j,
      ));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 40, 0.55, 5, false),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xeaf6ff).multiplyScalar(2.2),
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    group.add(core);
    const halo = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 40, 2.4, 5, false),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0x9fd8ff).multiplyScalar(1.2),
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    group.add(halo);
    this.boltGroup = group;
    this.scene.add(group);
  }

  getFlash(): number {
    return this.flash;
  }
}
