import * as THREE from 'three';
import { Course, type ArcSpot, type DrifterSpot, type SweeperSpot } from './course';
import { PALETTE, TUNING } from './config';
import { clamp, distanceToSegmentSq, lerp, makeLabelTexture, makeSoftSprite, smoothstep } from './util';

export type GateState = 'locked' | 'active' | 'restored';

export interface FieldHit {
  kind: 'sweeper' | 'drifter' | 'arc';
  point: THREE.Vector3;
  depth: number;
}

const MEMBRANE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const MEMBRANE_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uState;     // 0 locked, 1 active, 2 restored
  uniform float uPulse;     // transient flare 0..1
  uniform vec3 uColorA;
  uniform vec3 uColorB;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    float ang = atan(c.y, c.x);
    float rim = smoothstep(1.0, 0.84, r);
    float inner = smoothstep(0.05, 0.32, r);
    float chev = sin(ang * 6.0 + uTime * 1.6 - r * 9.0);
    chev = smoothstep(0.35, 0.95, chev) * 0.8;
    float grid = step(0.86, fract(r * 9.0 - uTime * 0.35)) * 0.35;
    float grain = noise(vec2(ang * 6.0, r * 22.0 - uTime * 0.8)) * 0.5 + 0.25;

    vec3 col = mix(uColorA, uColorB, clamp(chev + grain * 0.4, 0.0, 1.0));
    float alpha;
    if (uState < 0.5) {
      alpha = (grid + 0.05) * grain;
      col = mix(uColorA, uColorB, 0.12);
    } else if (uState < 1.5) {
      alpha = (0.10 + 0.32 * chev + 0.18 * grid) * (0.75 + 0.25 * sin(uTime * 2.2));
    } else {
      alpha = 0.12 + 0.18 * grain * (0.6 + 0.4 * sin(uTime * 1.1 - r * 3.0));
    }
    alpha *= rim * inner;
    alpha += uPulse * 0.5 * rim * (0.4 + 0.6 * (1.0 - r));
    col += uColorB * uPulse * 1.6;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

function quatFromFrame(entry: {
  frame: { tangent: THREE.Vector3; side: THREE.Vector3; up: THREE.Vector3 };
}): THREE.Quaternion {
  const m = new THREE.Matrix4();
  m.makeBasis(entry.frame.side, entry.frame.up, entry.frame.tangent);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

/** One relay gate: torus frame, spinning inner ring, energy membrane, stencil label. */
export class RelayGate {
  readonly group = new THREE.Group();
  readonly membraneMat: THREE.ShaderMaterial;
  readonly shockMat: THREE.MeshBasicMaterial;
  readonly quaternion: THREE.Quaternion;
  state: GateState = 'locked';

  private innerRing: THREE.Mesh;
  private rimMat: THREE.MeshStandardMaterial;
  private shock: THREE.Mesh;
  private beam: THREE.Mesh | null = null;
  private label: THREE.Mesh;
  private spinSpeed = 0.2;
  private tmpV = new THREE.Vector3();
  private tmpN = new THREE.Vector3();

  constructor(
    readonly index: number,
    center: THREE.Vector3,
    quaternion: THREE.Quaternion,
    readonly radius: number,
    readonly aperture: number,
    labelAccent: string,
    withBeam = false,
  ) {
    this.quaternion = quaternion.clone();
    this.group.position.copy(center);
    this.group.quaternion.copy(quaternion);

    const metal = new THREE.MeshStandardMaterial({ color: 0x27323d, roughness: 0.6, metalness: 0.85 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x131a21, roughness: 0.9, metalness: 0.4 });
    this.rimMat = new THREE.MeshStandardMaterial({
      color: 0x0a1218,
      emissive: new THREE.Color(PALETTE.cyan),
      emissiveIntensity: 0.4,
      roughness: 0.4,
      metalness: 0.3,
    });

    this.group.add(new THREE.Mesh(new THREE.TorusGeometry(radius, 2.0, 10, 60), metal));
    this.group.add(new THREE.Mesh(new THREE.TorusGeometry(radius - 1.7, 0.42, 6, 56), this.rimMat));
    this.group.add(new THREE.Mesh(new THREE.TorusGeometry(radius + 3.4, 0.3, 6, 48), this.rimMat));

    this.innerRing = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.74, 0.8, 6, 40, Math.PI * 1.35),
      this.rimMat,
    );
    this.group.add(this.innerRing);

    for (let i = 0; i < 4; i += 1) {
      const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const strut = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.55, 1.5, 1.5), darkMetal);
      strut.position.set(Math.cos(ang) * (radius * 1.3), Math.sin(ang) * (radius * 1.3), 0);
      strut.rotation.z = ang;
      this.group.add(strut);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(3.6, 5.6, 3.6), metal);
      foot.position.set(Math.cos(ang) * (radius * 1.55), Math.sin(ang) * (radius * 1.55), 0);
      foot.rotation.z = ang;
      this.group.add(foot);
    }

    for (let i = 0; i < 2; i += 1) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, radius * 2.2, 6), darkMetal);
      bar.rotation.z = Math.PI / 2 + (i === 0 ? 0.35 : -0.55);
      bar.position.z = -3.8 - i * 2.4;
      this.group.add(bar);
    }

    const housing = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.8, radius * 0.3, 3.4), metal);
    housing.position.set(0, radius * 1.42, -1.2);
    this.group.add(housing);

    const membraneGeo = new THREE.CircleGeometry(radius * 0.985, 48);
    this.membraneMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uState: { value: 0 },
        uPulse: { value: 0 },
        uColorA: { value: new THREE.Color(PALETTE.violet) },
        uColorB: { value: new THREE.Color(PALETTE.cyan) },
      },
      vertexShader: MEMBRANE_VERT,
      fragmentShader: MEMBRANE_FRAG,
    });
    const membrane = new THREE.Mesh(membraneGeo, this.membraneMat);
    membrane.position.z = 0.1;
    this.group.add(membrane);

    const labelTex = makeLabelTexture(
      withBeam ? ['EXTRACT 00', 'SIGNAL TETHER'] : [`RELAY 0${index + 1}`, 'SIGNAL TETHER'],
      labelAccent,
    );
    this.label = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 0.95, radius * 0.24),
      new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    this.label.position.set(0, radius * 1.42, 0.9);
    this.group.add(this.label);

    this.shockMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(PALETTE.amber),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.shock = new THREE.Mesh(new THREE.RingGeometry(radius * 0.45, radius * 0.99, 44, 1), this.shockMat);
    this.shock.position.z = 0.5;
    this.group.add(this.shock);

    if (withBeam) {
      this.beam = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.8, radius * 0.98, 620, 22, 1, true),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(PALETTE.cyan),
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      this.beam.rotation.x = Math.PI / 2;
      this.beam.position.z = 0;
      this.group.add(this.beam);
    }
  }

  get beamOpacity(): number {
    return this.beam ? (this.beam.material as THREE.MeshBasicMaterial).opacity : 0;
  }

  setState(state: GateState): void {
    this.state = state;
    this.membraneMat.uniforms.uState.value = state === 'locked' ? 0 : state === 'active' ? 1 : 2;
    const color = state === 'restored' ? PALETTE.amber : state === 'active' ? PALETTE.cyan : 0x2a3a48;
    this.rimMat.emissive.setHex(color);
    this.rimMat.emissiveIntensity = state === 'active' ? 2.8 : state === 'restored' ? 2.1 : 0.3;
    this.shockMat.color.setHex(state === 'restored' ? PALETTE.amber : PALETTE.cyan);
    this.spinSpeed = state === 'active' ? 1.2 : state === 'restored' ? 0.45 : 0.12;
  }

  flare(): void {
    this.shockLife = 1;
    this.membraneMat.uniforms.uPulse.value = 1;
  }

  private shockLife = 0;

  setBeam(level: number): void {
    if (this.beam) {
      const mat = this.beam.material as THREE.MeshBasicMaterial;
      mat.opacity = clamp(level, 0, 1) * 0.34;
      this.beam.visible = mat.opacity > 0.01;
    }
  }

  update(dt: number, time: number, cameraPos: THREE.Vector3): void {
    this.membraneMat.uniforms.uTime.value = time;
    const pulse = this.membraneMat.uniforms.uPulse;
    pulse.value = Math.max(0, pulse.value - dt * 1.3);
    this.innerRing.rotation.z += this.spinSpeed * dt;
    this.group.scale.setScalar(this.state === 'active' ? 1 + Math.sin(time * 3.4) * 0.012 : 1);
    if (this.shockLife > 0) {
      this.shockLife = Math.max(0, this.shockLife - dt * 0.8);
      const k = 1 - this.shockLife;
      this.shockMat.opacity = Math.pow(this.shockLife, 1.4) * 0.95;
      this.shock.scale.setScalar(lerp(0.4, 3.6, k));
    } else {
      this.shockMat.opacity = 0;
    }
    this.tmpN.set(0, 0, 1).applyQuaternion(this.group.quaternion);
    this.tmpV.copy(cameraPos).sub(this.group.position);
    this.label.visible = this.tmpV.dot(this.tmpN) > 0;
    if (this.beam) this.beam.rotation.z = time * 0.25;
  }

  /** Signed distance in front of the gate plane, plus radial offset. */
  measure(p: THREE.Vector3, out: { along: number; radial: number }): void {
    this.tmpV.copy(p).sub(this.group.position);
    const along = this.tmpV.dot(this.tmpN.set(0, 0, 1).applyQuaternion(this.group.quaternion));
    const perp = this.tmpV.addScaledVector(this.tmpN, -along);
    out.along = along;
    out.radial = perp.length();
  }
}

/** Sphere-collidable charge pickup with a soft magnet. */
export class ChargeCell {
  readonly mesh: THREE.Mesh;
  readonly glow: THREE.Sprite;
  readonly position: THREE.Vector3;
  collected = false;
  private baseY: number;

  constructor(pos: THREE.Vector3, geo: THREE.BufferGeometry, mat: THREE.Material, sprite: THREE.Texture) {
    this.position = pos.clone();
    this.baseY = pos.y;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.copy(pos);
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sprite,
        color: new THREE.Color(PALETTE.cyan),
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.glow.scale.setScalar(9);
    this.glow.position.copy(pos);
  }

  update(time: number, dt: number, craftPos: THREE.Vector3): void {
    const bob = Math.sin(time * 1.6 + this.position.x * 0.1) * 1.6;
    this.mesh.position.set(this.position.x, this.baseY + bob, this.position.z);
    this.mesh.rotation.y += dt * 1.3;
    this.mesh.rotation.x += dt * 0.8;
    const d = this.mesh.position.distanceTo(craftPos);
    if (d < TUNING.cells.magnetRadius) {
      this.mesh.position.lerp(craftPos, clamp((1 - d / TUNING.cells.magnetRadius) * dt * 6, 0, 0.6));
      this.baseY = this.mesh.position.y;
    }
    this.glow.position.copy(this.mesh.position);
    this.glow.scale.setScalar(8 + Math.sin(time * 4 + this.position.z) * 1.4);
    this.position.copy(this.mesh.position);
  }

  dispose(): void {
    this.mesh.visible = false;
    this.glow.visible = false;
    this.collected = true;
  }

  revive(spawn: THREE.Vector3): void {
    this.collected = false;
    this.position.copy(spawn);
    this.baseY = spawn.y;
    this.mesh.visible = true;
    this.glow.visible = true;
  }
}

/** Rotating hazard arm; collides as a capsule between its two tips. */
export class Sweeper {
  readonly group = new THREE.Group();
  readonly a = new THREE.Vector3();
  readonly b = new THREE.Vector3();
  private angle = 0;
  private dir = new THREE.Vector3();
  private xAxis = new THREE.Vector3();
  private basis = new THREE.Matrix4();

  constructor(private spot: SweeperSpot, metal: THREE.Material, glowMat: THREE.Material) {
    this.group.position.copy(spot.center);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 3.8, 12), metal);
    hub.rotation.x = Math.PI / 2;
    this.group.add(hub);
    for (let i = 0; i < spot.arms; i += 1) {
      const pivot = new THREE.Group();
      pivot.rotation.z = (i / spot.arms) * Math.PI * 2;
      this.group.add(pivot);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.8, spot.length, 1.8), metal);
      arm.position.y = spot.length * 0.5;
      pivot.add(arm);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.95, spot.length * 0.9, 0.5), glowMat);
      stripe.position.set(0, spot.length * 0.5, 0.9);
      pivot.add(stripe);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(2.1, 10, 8), glowMat);
      tip.position.y = spot.length;
      pivot.add(tip);
    }
    this.group.add(new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 0), glowMat));
    this.update(0);
  }

  update(dt: number): void {
    this.angle += this.spot.speed * dt;
    const s = Math.sin(this.angle);
    const c = Math.cos(this.angle);
    this.dir
      .copy(this.spot.axisA)
      .multiplyScalar(c)
      .addScaledVector(this.spot.axisB, s)
      .normalize();
    this.a.copy(this.spot.center).addScaledVector(this.dir, this.spot.length);
    this.b.copy(this.spot.center).addScaledVector(this.dir, -this.spot.length);
    this.xAxis.copy(this.dir).cross(this.spot.axis).normalize();
    this.basis.makeBasis(this.xAxis, this.dir, this.spot.axis);
    this.group.quaternion.setFromRotationMatrix(this.basis);
    this.group.position.copy(this.spot.center);
  }

  collide(p: THREE.Vector3, radius: number, closest: THREE.Vector3): number {
    const d = distanceToSegmentSq(p, this.a, this.b, closest);
    const rr = radius + 1.4;
    return d < rr * rr ? 1 - Math.sqrt(d) / rr : -1;
  }
}

/** Drifting storm cell: deforming shell, wire cage, halo. */
export class Drifter {
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector3();
  readonly radius: number;
  private mat: THREE.ShaderMaterial;
  private cage: THREE.Mesh;

  constructor(spot: DrifterSpot) {
    this.radius = spot.radius;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCore: { value: new THREE.Color(0x160a12) },
        uRim: { value: new THREE.Color(PALETTE.magenta) },
        uSeed: { value: spot.phase },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uSeed;
        varying float vNoise;
        varying vec3 vNormal;
        float h(vec3 p) {
          return fract(sin(dot(p, vec3(27.1, 61.7, 12.9))) * 24631.3);
        }
        float n(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y),
            f.z);
        }
        void main() {
          vNormal = normalize(normalMatrix * normal);
          float d = n(normalize(position) * 2.6 + vec3(uTime * 0.6 + uSeed, uTime * 0.4, uTime * 0.5));
          vNoise = d;
          vec3 p = position * (1.0 + 0.17 * (d - 0.5));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uCore;
        uniform vec3 uRim;
        uniform float uTime;
        varying float vNoise;
        varying vec3 vNormal;
        void main() {
          float vein = smoothstep(0.5, 0.85, vNoise);
          vec3 col = mix(uCore, uRim, clamp(vein * 1.5, 0.0, 1.0));
          col += uRim * pow(1.0 - abs(vNormal.z), 2.0) * 0.5;
          col *= 0.8 + 0.4 * sin(uTime * 5.0 + vNoise * 12.0);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.group.add(new THREE.Mesh(new THREE.IcosahedronGeometry(spot.radius, 3), this.mat));
    this.cage = new THREE.Mesh(
      new THREE.IcosahedronGeometry(spot.radius * 1.4, 1),
      new THREE.MeshBasicMaterial({
        color: PALETTE.magenta,
        wireframe: true,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
    );
    this.group.add(this.cage);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeSoftSprite(96, 2.2),
        color: new THREE.Color(PALETTE.magenta),
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    halo.scale.setScalar(spot.radius * 6);
    this.group.add(halo);
  }

  update(time: number, dt: number, spot: DrifterSpot): void {
    const a = time * spot.freqA * Math.PI * 2 + spot.phase;
    const b = time * spot.freqB * Math.PI * 2 + spot.phase * 1.7;
    this.position.set(
      spot.center.x + Math.cos(a) * spot.ampA,
      spot.center.y + Math.sin(b) * spot.ampB * 0.55,
      spot.center.z + Math.sin(a) * spot.ampA + Math.cos(b * 0.7) * spot.ampB * 0.35,
    );
    this.group.position.copy(this.position);
    this.mat.uniforms.uTime.value = time;
    this.cage.rotation.y += dt * 0.5;
    this.cage.rotation.x += dt * 0.24;
  }

  collide(p: THREE.Vector3, radius: number, closest: THREE.Vector3): number {
    const d = p.distanceToSquared(this.position);
    const rr = radius + this.radius;
    return d < rr * rr ? 1 - Math.sqrt(d) / rr : -1;
  }

  /** Static discharge that shoves the craft before contact. */
  gust(p: THREE.Vector3, out: THREE.Vector3): number {
    const reach = this.radius * 4.2;
    const d = p.distanceTo(this.position);
    if (d > reach || d < 1e-3) return 0;
    const k = Math.pow(1 - d / reach, 2);
    out.copy(p).sub(this.position).normalize().multiplyScalar(k);
    return k;
  }
}

/** Twin pylons that discharge across the corridor on a cycle. */
export class ArcNode {
  readonly group = new THREE.Group();
  readonly bolt: THREE.Line;
  live = false;
  charge = 0;
  private boltMat: THREE.LineBasicMaterial;
  private lamps: THREE.MeshStandardMaterial[] = [];
  private tmp = new THREE.Vector3();

  constructor(readonly spot: ArcSpot, metal: THREE.Material) {
    const s = this.spot;
    const mid = s.a.clone().add(s.b).multiplyScalar(0.5);
    this.group.position.copy(mid);
    const half = s.a.clone().sub(s.b).multiplyScalar(0.5);
    const len = half.length();
    for (let i = 0; i < 2; i += 1) {
      const dirSign = i === 0 ? 1 : -1;
      const p = half.clone().multiplyScalar(dirSign);
      const lampMat = new THREE.MeshStandardMaterial({
        color: 0x0c141a,
        emissive: new THREE.Color(PALETTE.magenta),
        emissiveIntensity: 0.4,
        roughness: 0.4,
        metalness: 0.5,
      });
      this.lamps.push(lampMat);
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, Math.max(3, len * 0.12)), metal);
      pylon.position.copy(p);
      pylon.lookAt(this.group.position.clone().add(p).add(p));
      this.group.add(pylon);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(2.3, 12, 8), lampMat);
      lamp.position.copy(p).multiplyScalar(0.92);
      this.group.add(lamp);
      const fin = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 16, 5), metal);
      fin.position.copy(p).add(new THREE.Vector3(0, 8, 0));
      this.group.add(fin);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(22 * 3), 3));
    this.boltMat = new THREE.LineBasicMaterial({
      color: 0xffe6f2,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.bolt = new THREE.Line(geo, this.boltMat);
    this.bolt.frustumCulled = false;
    this.group.add(this.bolt);
  }

  update(time: number): void {
    const s = this.spot;
    const phase = ((time + s.phase) % s.period) / s.period;
    const warmEnd = s.warmup / s.period;
    const liveEnd = (s.warmup + s.live) / s.period;
    this.live = false;
    if (phase < warmEnd) {
      this.charge = smoothstep(0, warmEnd, phase);
    } else if (phase < liveEnd) {
      this.charge = 1;
      this.live = true;
    } else {
      this.charge = Math.max(0, 1 - (phase - liveEnd) * 6);
    }
    const glow = 0.25 + this.charge * 6;
    for (const lamp of this.lamps) lamp.emissiveIntensity = glow;
    const attr = this.bolt.geometry.getAttribute('position') as THREE.BufferAttribute;
    if (this.charge > 0.05) {
      const pts = attr.count;
      const localA = this.tmp.copy(s.a).sub(this.group.position);
      for (let i = 0; i < pts; i += 1) {
        const t = i / (pts - 1);
        const jitter = this.live ? 2.8 : 1.2;
        const wave = Math.sin(t * Math.PI);
        attr.setXYZ(
          i,
          lerp(localA.x, -localA.x, t) + Math.sin(t * 22 + time * 37 + i) * jitter * wave,
          lerp(localA.y, -localA.y, t) + Math.cos(t * 17 + time * 41 + i * 2) * jitter * wave,
          lerp(localA.z, -localA.z, t) + Math.sin(t * 13 + time * 29) * jitter * wave * 0.6,
        );
      }
      attr.needsUpdate = true;
      this.boltMat.opacity = this.live ? 1 : this.charge * 0.35;
      this.bolt.visible = true;
    } else {
      this.bolt.visible = false;
    }
  }

  collide(p: THREE.Vector3, radius: number, closest: THREE.Vector3): number {
    if (!this.live) return -1;
    const d = distanceToSegmentSq(p, this.spot.a, this.spot.b, closest);
    const rr = radius + 2.8;
    return d < rr * rr ? 1 - Math.sqrt(d) / rr : -1;
  }
}

/** All interactive field objects; built once, reset between runs. */
export class FieldEntities {
  readonly group = new THREE.Group();
  readonly gates: RelayGate[] = [];
  readonly cells: ChargeCell[] = [];
  readonly sweepers: Sweeper[] = [];
  readonly drifters: Drifter[] = [];
  readonly arcs: ArcNode[] = [];
  readonly extraction: RelayGate;
  private cellSpawns: THREE.Vector3[] = [];
  private cellGeo: THREE.OctahedronGeometry;
  private cellMat: THREE.MeshStandardMaterial;
  private sprite: THREE.Texture;
  private metal: THREE.MeshStandardMaterial;
  private hazardGlow: THREE.MeshStandardMaterial;
  private closest = new THREE.Vector3();
  private hit: FieldHit = { kind: 'sweeper', point: new THREE.Vector3(), depth: 0 };

  constructor(private course: Course) {
    this.sprite = makeSoftSprite(96, 2.2);
    this.cellGeo = new THREE.OctahedronGeometry(1.9, 0);
    this.cellMat = new THREE.MeshStandardMaterial({
      color: 0x0b1a20,
      emissive: new THREE.Color(PALETTE.cyan),
      emissiveIntensity: 2.6,
      roughness: 0.25,
      metalness: 0.4,
    });
    this.metal = new THREE.MeshStandardMaterial({ color: 0x212b35, roughness: 0.7, metalness: 0.8 });
    this.hazardGlow = new THREE.MeshStandardMaterial({
      color: 0x1a0912,
      emissive: new THREE.Color(PALETTE.magenta),
      emissiveIntensity: 2.4,
      roughness: 0.5,
      metalness: 0.2,
    });

    course.relays.forEach((relay, i) => {
      const gate = new RelayGate(
        i,
        relay.center,
        quatFromFrame(relay),
        relay.radius,
        TUNING.gates.relayAperture,
        '#ffbe5c',
      );
      this.gates.push(gate);
      this.group.add(gate.group);
    });

    this.extraction = new RelayGate(
      3,
      course.extraction.center,
      quatFromFrame(course.extraction),
      course.extraction.radius,
      TUNING.gates.extractionAperture,
      '#63f7ff',
      true,
    );
    this.group.add(this.extraction.group);

    course.cells.forEach((c) => {
      this.cellSpawns.push(c.position.clone());
      const cell = new ChargeCell(c.position, this.cellGeo, this.cellMat, this.sprite);
      this.cells.push(cell);
      this.group.add(cell.mesh, cell.glow);
    });

    course.sweepers.forEach((s) => {
      const sweeper = new Sweeper(s, this.metal, this.hazardGlow);
      this.sweepers.push(sweeper);
      this.group.add(sweeper.group);
    });
    course.drifters.forEach((d) => {
      const drifter = new Drifter(d);
      this.drifters.push(drifter);
      this.group.add(drifter.group);
    });
    course.arcs.forEach((a) => {
      const arc = new ArcNode(a, this.metal);
      this.arcs.push(arc);
      this.group.add(arc.group);
    });
  }

  reset(): void {
    this.cells.forEach((cell, i) => cell.revive(this.cellSpawns[i]));
    this.gates.forEach((g) => g.setState('locked'));
    this.extraction.setState('locked');
    this.extraction.setBeam(0);
  }

  update(dt: number, time: number, cameraPos: THREE.Vector3, craftPos: THREE.Vector3): void {
    this.gates.forEach((g) => g.update(dt, time, cameraPos));
    this.extraction.update(dt, time, cameraPos);
    this.sweepers.forEach((s) => s.update(dt));
    this.drifters.forEach((d, i) => d.update(time, dt, this.course.drifters[i]));
    this.arcs.forEach((a) => a.update(time));
    const cull2 = 720 * 720;
    for (const cell of this.cells) {
      if (cell.collected) continue;
      if (cell.mesh.position.distanceToSquared(cameraPos) > cull2) {
        cell.mesh.visible = false;
        cell.glow.visible = false;
        continue;
      }
      cell.mesh.visible = true;
      cell.glow.visible = true;
      cell.update(time, dt, craftPos);
    }
  }

  /** Consume every cell inside the pickup bubble; returns how many. */
  collectCells(craftPos: THREE.Vector3): number {
    const r2 = TUNING.cells.pickupRadius * TUNING.cells.pickupRadius;
    let got = 0;
    for (const cell of this.cells) {
      if (cell.collected) continue;
      if (cell.mesh.position.distanceToSquared(craftPos) < r2) {
        cell.dispose();
        got += 1;
      }
    }
    return got;
  }

  /** Deepest hazard overlap for this frame, or null. */
  resolveHit(craftPos: THREE.Vector3, radius: number): FieldHit | null {
    let best: FieldHit | null = null;
    this.hit.depth = 0;
    for (const sweeper of this.sweepers) {
      if (sweeper.group.position.distanceToSquared(craftPos) > 90 * 90) continue;
      const d = sweeper.collide(craftPos, radius, this.closest);
      if (d > 0 && (!best || d > this.hit.depth)) {
        this.hit.kind = 'sweeper';
        this.hit.depth = d;
        this.hit.point.copy(this.closest);
        best = this.hit;
      }
    }
    for (const drifter of this.drifters) {
      if (drifter.position.distanceToSquared(craftPos) > 90 * 90) continue;
      const d = drifter.collide(craftPos, radius, this.closest);
      if (d > 0 && (!best || d > this.hit.depth)) {
        this.hit.kind = 'drifter';
        this.hit.depth = d;
        this.hit.point.copy(drifter.position);
        best = this.hit;
      }
    }
    for (const arc of this.arcs) {
      if (!arc.live) continue;
      const d = arc.collide(craftPos, radius, this.closest);
      if (d > 0 && (!best || d > this.hit.depth)) {
        this.hit.kind = 'arc';
        this.hit.depth = d;
        this.hit.point.copy(this.closest);
        best = this.hit;
      }
    }
    return best;
  }

  /** Combined storm push from nearby cells (returns 0..1 danger). */
  stormForce(craftPos: THREE.Vector3, out: THREE.Vector3): number {
    out.set(0, 0, 0);
    let danger = 0;
    const push = new THREE.Vector3();
    for (const drifter of this.drifters) {
      const k = drifter.gust(craftPos, push);
      if (k > 0) {
        out.addScaledVector(push, k);
        danger = Math.max(danger, k);
      }
    }
    return danger;
  }
}
