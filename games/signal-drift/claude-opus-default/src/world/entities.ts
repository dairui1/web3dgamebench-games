import * as THREE from 'three';
import { Rng } from '../core/rng';
import { Course } from './course';

export type RelayState = 'locked' | 'active' | 'restored';

const GATE_APERTURE = 11.5;

/** A relay gate: fly through the aperture to bring the node back online. */
export class RelayGate {
  readonly group = new THREE.Group();
  readonly distance: number;
  readonly index: number;
  readonly aperture: number;
  /** Aperture centre in corridor space — the player must line up with it. */
  readonly offsetLateral: number;
  readonly offsetVertical: number;

  state: RelayState = 'locked';

  private readonly collar: THREE.Mesh;
  private readonly ringMaterial: THREE.MeshStandardMaterial;
  private readonly fieldUniforms;
  private readonly light: THREE.PointLight;
  private ignite = 0;

  constructor(
    course: Course,
    distance: number,
    index: number,
    offsetLateral = 0,
    offsetVertical = 0,
    isExtraction = false,
  ) {
    this.distance = distance;
    this.index = index;
    this.offsetLateral = offsetLateral;
    this.offsetVertical = offsetVertical;
    this.aperture = isExtraction ? GATE_APERTURE * 1.35 : GATE_APERTURE;

    const f = course.frameAt(distance);
    this.group.position
      .copy(f.pos)
      .addScaledVector(f.right, offsetLateral)
      .addScaledVector(f.up, offsetVertical);
    course.orientationFromFrame(f, this.group.quaternion);

    this.ringMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a3340,
      roughness: 0.35,
      metalness: 0.9,
      emissive: 0x552211,
      emissiveIntensity: 1,
      flatShading: true,
    });

    const radius = this.aperture;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.85, 8, 36), this.ringMaterial);
    this.group.add(ring);

    this.collar = new THREE.Mesh(
      new THREE.TorusGeometry(radius + 1.9, 0.4, 6, 24, Math.PI * 1.4),
      this.ringMaterial,
    );
    this.group.add(this.collar);

    // Support arms reaching out to the corridor structure.
    const armMaterial = new THREE.MeshStandardMaterial({
      color: 0x39424f,
      roughness: 0.6,
      metalness: 0.7,
      flatShading: true,
    });
    const spokes = isExtraction ? 6 : 4;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2 + Math.PI / spokes;
      const length = 12;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.7, length, 0.7), armMaterial);
      arm.position.set(
        Math.cos(a) * (radius + length / 2),
        Math.sin(a) * (radius + length / 2),
        0,
      );
      arm.rotation.z = a - Math.PI / 2;
      this.group.add(arm);
    }

    // Energy membrane across the aperture.
    this.fieldUniforms = {
      uTime: { value: 0 },
      uState: { value: 0 },
      uIgnite: { value: 0 },
      uColor: { value: new THREE.Color(0xff6a3c) },
    };
    const field = new THREE.Mesh(
      new THREE.CircleGeometry(radius - 0.6, 48),
      new THREE.ShaderMaterial({
        uniforms: this.fieldUniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv * 2.0 - 1.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform float uState; uniform float uIgnite; uniform vec3 uColor;
          varying vec2 vUv;
          void main() {
            float r = length(vUv);
            float ang = atan(vUv.y, vUv.x);
            float swirl = sin(ang * 5.0 + uTime * 2.2 - r * 9.0) * 0.5 + 0.5;
            float rings = sin(r * 22.0 - uTime * (1.5 + uState * 2.5)) * 0.5 + 0.5;
            float edge = smoothstep(1.0, 0.72, r);
            float core = smoothstep(0.9, 0.0, r) * 0.35;
            float a = (rings * 0.30 + swirl * 0.20 + core) * edge;
            a *= 0.35 + uState * 0.55 + uIgnite * 1.4;
            gl_FragColor = vec4(uColor * (0.8 + uIgnite * 2.0), a);
          }
        `,
      }),
    );
    this.group.add(field);

    this.light = new THREE.PointLight(0xff6a3c, 60, 150, 2);
    this.group.add(this.light);

    this.setState('locked');
  }

  setState(state: RelayState): void {
    this.state = state;
    const color =
      state === 'restored' ? 0x4ff5d0 : state === 'active' ? 0xffb23a : 0xff4d38;
    this.fieldUniforms.uColor.value.setHex(color);
    this.fieldUniforms.uState.value = state === 'active' ? 1 : state === 'restored' ? 0.6 : 0.15;
    this.ringMaterial.emissive.setHex(color);
    this.ringMaterial.emissiveIntensity = state === 'locked' ? 0.35 : 1.6;
    this.light.color.setHex(color);
    this.light.intensity = state === 'locked' ? 18 : 90;
    if (state === 'restored') this.ignite = 1;
  }

  update(dt: number, elapsed: number): void {
    this.fieldUniforms.uTime.value = elapsed;
    this.ignite = Math.max(0, this.ignite - dt * 1.1);
    this.fieldUniforms.uIgnite.value = this.ignite * this.ignite;
    const spin = this.state === 'active' ? 1.4 : this.state === 'restored' ? 0.5 : 0.12;
    this.collar.rotation.z += dt * spin;
    const pulse = this.state === 'active' ? 1 + Math.sin(elapsed * 5) * 0.35 : 1;
    this.light.intensity = (this.state === 'locked' ? 18 : 90) * pulse + this.ignite * 220;
  }
}

export interface Pickup {
  distance: number;
  lateral: number;
  vertical: number;
  phase: number;
  active: boolean;
  respawn: number;
}

/** Charge motes strung along the corridor in drifting ribbons. */
export class ChargeField {
  readonly mesh: THREE.InstancedMesh;
  readonly items: Pickup[] = [];

  private readonly material: THREE.MeshStandardMaterial;
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();

  constructor(private readonly course: Course, rng: Rng, avoid: number[]) {
    const ribbons = 26;
    for (let r = 0; r < ribbons; r++) {
      let start = rng.range(0, course.length);
      let guard = 0;
      while (avoid.some((d) => Math.abs(course.delta(d, start)) < 34) && guard++ < 24) {
        start = rng.range(0, course.length);
      }
      const count = rng.int(4, 8);
      const angle = rng.range(0, Math.PI * 2);
      const swing = rng.range(0.15, 0.6);
      const radius = rng.range(0.15, 0.72);
      for (let i = 0; i < count; i++) {
        const t = i / count;
        const a = angle + t * swing * Math.PI;
        this.items.push({
          distance: course.wrap(start + i * 7),
          lateral: Math.cos(a) * course.radiusX * radius,
          vertical: Math.sin(a) * course.radiusY * radius,
          phase: rng.range(0, Math.PI * 2),
          active: true,
          respawn: 0,
        });
      }
    }

    this.material = new THREE.MeshStandardMaterial({
      color: 0x0d3540,
      emissive: 0x3ff0c8,
      emissiveIntensity: 1.1,
      roughness: 0.25,
      metalness: 0.1,
      flatShading: true,
    });
    this.mesh = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.8, 0),
      this.material,
      this.items.length,
    );
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  reset(): void {
    for (const item of this.items) {
      item.active = true;
      item.respawn = 0;
    }
  }

  update(dt: number, elapsed: number): void {
    let n = 0;
    for (const item of this.items) {
      if (!item.active) {
        item.respawn -= dt;
        if (item.respawn <= 0) item.active = true;
        else continue;
      }
      const bob = Math.sin(elapsed * 1.6 + item.phase) * 1.4;
      this.course.toWorld(item.distance, item.lateral, item.vertical + bob, this.pos);
      this.quat.setFromEuler(
        new THREE.Euler(elapsed * 0.9 + item.phase, elapsed * 1.5 + item.phase, 0),
      );
      const s = 0.9 + Math.sin(elapsed * 4 + item.phase) * 0.12;
      this.matrix.compose(this.pos, this.quat, this.scale.set(s, s, s));
      this.mesh.setMatrixAt(n++, this.matrix);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.material.emissiveIntensity = 1.0 + Math.sin(elapsed * 6) * 0.25;
  }
}

export type HazardKind = 'drifter' | 'sweeper';

export interface Hazard {
  kind: HazardKind;
  distance: number;
  ampL: number;
  ampV: number;
  rate: number;
  phase: number;
  radius: number;
  halfLength: number;
  lateral: number;
  vertical: number;
  angle: number;
  nearMissArmed: boolean;
}

/** Storm-tossed drones and rotating arc bars sweeping the corridor. */
export class HazardField {
  readonly hazards: Hazard[] = [];
  readonly drifters: THREE.InstancedMesh;
  readonly cores: THREE.InstancedMesh;
  readonly sweepers: THREE.InstancedMesh;

  private readonly coreMaterial: THREE.MeshBasicMaterial;
  private readonly barMaterial: THREE.MeshStandardMaterial;
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly spin = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3(0, 0, 1);
  private readonly scale = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();

  constructor(private readonly course: Course, rng: Rng, avoid: number[]) {
    const spacing = 34;
    for (let d = 0; d < course.length; d += spacing) {
      const distance = course.wrap(d + rng.spread(9));
      if (avoid.some((a) => Math.abs(course.delta(a, distance)) < 44)) continue;
      if (rng.next() < 0.4) continue;
      const sweeper = rng.next() < 0.3;
      if (sweeper) {
        this.hazards.push({
          kind: 'sweeper',
          distance,
          ampL: 0,
          ampV: 0,
          rate: rng.range(0.35, 0.85) * (rng.next() < 0.5 ? -1 : 1),
          phase: rng.range(0, Math.PI * 2),
          radius: 2.1,
          halfLength: course.radiusX * rng.range(0.4, 0.62),
          lateral: 0,
          vertical: 0,
          angle: 0,
          nearMissArmed: true,
        });
      } else {
        this.hazards.push({
          kind: 'drifter',
          distance,
          ampL: rng.range(0, 0.75) * course.radiusX,
          ampV: rng.range(0, 0.6) * course.radiusY,
          rate: rng.range(0.35, 1.1),
          phase: rng.range(0, Math.PI * 2),
          radius: rng.range(2.2, 3.4),
          halfLength: 0,
          lateral: 0,
          vertical: 0,
          angle: 0,
          nearMissArmed: true,
        });
      }
    }

    const drifterCount = this.hazards.filter((h) => h.kind === 'drifter').length;
    const sweeperCount = this.hazards.length - drifterCount;

    const shellMaterial = new THREE.MeshStandardMaterial({
      color: 0x1d222b,
      roughness: 0.5,
      metalness: 0.8,
      emissive: 0x3a0a06,
      emissiveIntensity: 1.1,
      flatShading: true,
    });
    this.drifters = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      shellMaterial,
      Math.max(1, drifterCount),
    );
    this.coreMaterial = new THREE.MeshBasicMaterial({
      color: 0xff5a33,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.cores = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 8, 6),
      this.coreMaterial,
      Math.max(1, drifterCount),
    );
    this.barMaterial = new THREE.MeshStandardMaterial({
      color: 0x241a12,
      roughness: 0.45,
      metalness: 0.7,
      emissive: 0xff7a24,
      emissiveIntensity: 1.8,
      flatShading: true,
    });
    this.sweepers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      this.barMaterial,
      Math.max(1, sweeperCount),
    );

    for (const mesh of [this.drifters, this.cores, this.sweepers]) {
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
  }

  reset(): void {
    for (const h of this.hazards) h.nearMissArmed = true;
  }

  update(elapsed: number): void {
    let di = 0;
    let si = 0;
    for (const h of this.hazards) {
      if (h.kind === 'drifter') {
        h.lateral = Math.sin(elapsed * h.rate + h.phase) * h.ampL;
        h.vertical = Math.cos(elapsed * h.rate * 0.8 + h.phase) * h.ampV;
        this.course.toWorld(h.distance, h.lateral, h.vertical, this.pos);
        this.quat.setFromEuler(new THREE.Euler(elapsed * 0.6 + h.phase, elapsed * 0.8, 0));
        this.matrix.compose(this.pos, this.quat, this.scale.setScalar(h.radius));
        this.drifters.setMatrixAt(di, this.matrix);
        this.matrix.compose(
          this.pos,
          this.quat,
          this.scale.setScalar(h.radius * (0.45 + Math.sin(elapsed * 7 + h.phase) * 0.06)),
        );
        this.cores.setMatrixAt(di, this.matrix);
        di++;
      } else {
        h.angle = elapsed * h.rate + h.phase;
        const f = this.course.frameAt(h.distance);
        this.course.orientationFromFrame(f, this.quat);
        this.spin.setFromAxisAngle(this.axis, h.angle);
        this.quat.multiply(this.spin);
        this.matrix.compose(
          f.pos,
          this.quat,
          this.scale.set(h.halfLength * 2, h.radius * 1.1, h.radius * 1.1),
        );
        this.sweepers.setMatrixAt(si, this.matrix);
        si++;
      }
    }
    this.drifters.count = di;
    this.cores.count = di;
    this.sweepers.count = si;
    this.drifters.instanceMatrix.needsUpdate = true;
    this.cores.instanceMatrix.needsUpdate = true;
    this.sweepers.instanceMatrix.needsUpdate = true;
    this.coreMaterial.opacity = 0.6 + Math.sin(elapsed * 9) * 0.25;
    this.barMaterial.emissiveIntensity = 1.5 + Math.sin(elapsed * 5) * 0.6;
  }

  /** Local-space separation of a point from a hazard body; <= 0 means contact. */
  separation(h: Hazard, lateral: number, vertical: number): number {
    if (h.kind === 'drifter') {
      return Math.hypot(lateral - h.lateral, vertical - h.vertical) - h.radius;
    }
    const c = Math.cos(-h.angle);
    const s = Math.sin(-h.angle);
    const x = lateral * c - vertical * s;
    const y = lateral * s + vertical * c;
    const dx = Math.max(0, Math.abs(x) - h.halfLength);
    const dy = Math.abs(y);
    return Math.hypot(dx, dy) - h.radius;
  }
}
