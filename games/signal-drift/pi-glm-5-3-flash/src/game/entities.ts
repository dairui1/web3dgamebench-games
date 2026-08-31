import * as THREE from 'three';
import { GATE, EXTRACT, PALETTE, PLAY } from '../config';
import { distPointSegment2D } from '../core/mathutil';
import { getGlowTexture, getLabelTexture, getStreakTexture, makeLabel } from './textures';

/** MeshBasicMaterial with HDR color so it feeds bloom. */
export function neonMat(hex: number, intensity: number, opts?: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
  const c = new THREE.Color(hex).multiplyScalar(intensity);
  return new THREE.MeshBasicMaterial({ color: c, fog: false, ...opts });
}

export function makeBeaconColumn(color: number, opacity: number, height = 420): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(1.35, 1.35, height, 10, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    map: getStreakTexture(),
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = height / 2;
  mesh.renderOrder = 4;
  return mesh;
}

function makeGlowSprite(color: number, scale: number, opacity: number): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(scale, scale, 1);
  s.renderOrder = 4;
  return s;
}

/** Shared plane-crossing test for gates and the extraction ring. */
abstract class PlaneCrosser {
  readonly group = new THREE.Group();
  readonly center = new THREE.Vector3();
  readonly normal = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  protected orient(pos: THREE.Vector3, tangent: THREE.Vector3): void {
    this.group.position.copy(pos);
    this.center.copy(pos);
    this.normal.copy(tangent).normalize();
    this.group.lookAt(pos.x + this.normal.x, pos.y + this.normal.y, pos.z + this.normal.z);
  }

  /**
   * Detect flight through the ring plane. Returns 'through' when the craft
   * crossed inside `radius`, 'near' when it clipped close outside, else null.
   */
  checkCross(prev: THREE.Vector3, cur: THREE.Vector3, radius: number, nearBand: number): 'through' | 'near' | null {
    // craft approaches from the negative side (normal points along the path)
    const s0 = this.tmp.subVectors(prev, this.center).dot(this.normal);
    const s1 = this.tmp.subVectors(cur, this.center).dot(this.normal);
    if (!(s0 < 0 && s1 >= 0)) return null;
    const f = s0 / (s0 - s1);
    const cx = prev.x + (cur.x - prev.x) * f;
    const cy = prev.y + (cur.y - prev.y) * f;
    const cz = prev.z + (cur.z - prev.z) * f;
    const dx = cx - this.center.x;
    const dy = cy - this.center.y;
    const dz = cz - this.center.z;
    const along = dx * this.normal.x + dy * this.normal.y + dz * this.normal.z;
    const rx = dx - this.normal.x * along;
    const ry = dy - this.normal.y * along;
    const rz = dz - this.normal.z * along;
    const radial = Math.hypot(rx, ry, rz);
    if (radial <= radius) return 'through';
    if (radial <= radius + nearBand) return 'near';
    return null;
  }

  distanceTo(p: THREE.Vector3): number {
    return this.tmp.subVectors(p, this.center).length();
  }
}

/* ------------------------------------------------------------------ */

export type GateState = 'dark' | 'active' | 'restored';

export class RelayGate extends PlaneCrosser {
  readonly index: number;
  state: GateState = 'dark';

  private ringMat: THREE.MeshBasicMaterial;
  private beacon: THREE.Mesh;
  private beaconMat: THREE.MeshBasicMaterial;
  private light: THREE.PointLight;
  private label: THREE.Sprite;
  private labelMat: THREE.SpriteMaterial;

  constructor(index: number, pos: THREE.Vector3, tangent: THREE.Vector3) {
    super();
    this.index = index;
    this.orient(pos, tangent);

    const metal = new THREE.MeshStandardMaterial({ color: 0x2b333b, metalness: 0.85, roughness: 0.45 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(GATE.ringRadius, GATE.tube, 10, 42), metal);
    this.group.add(ring);

    // battle damage: dark plates bolted over the ring
    const dmgMat = new THREE.MeshStandardMaterial({ color: 0x1c2229, metalness: 0.6, roughness: 0.8 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.6;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.5, 0.5), dmgMat);
      plate.position.set(Math.cos(a) * GATE.ringRadius, Math.sin(a) * GATE.ringRadius, 0.4);
      plate.rotation.z = a + 0.7;
      this.group.add(plate);
    }

    this.ringMat = neonMat(PALETTE.amber, 0.12);
    const glowRing = new THREE.Mesh(new THREE.TorusGeometry(GATE.ringRadius - 1.35, 0.22, 8, 48), this.ringMat);
    this.group.add(glowRing);

    // pylon pods at the four cardinals
    const podMat = new THREE.MeshStandardMaterial({ color: 0x39434c, metalness: 0.7, roughness: 0.5 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const pod = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.4, 2.6), podMat);
      pod.position.set(Math.cos(a) * (GATE.ringRadius + 1.4), Math.sin(a) * (GATE.ringRadius + 1.4), 0);
      pod.rotation.z = a;
      this.group.add(pod);
    }

    this.beaconMat = new THREE.MeshBasicMaterial({
      map: getStreakTexture(),
      color: PALETTE.amber,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.beacon = makeBeaconColumn(PALETTE.amber, 0);
    this.beacon.material = this.beaconMat;
    this.beacon.position.y = 60;
    this.group.add(this.beacon);

    this.light = new THREE.PointLight(PALETTE.amber, 0, 140, 1.8);
    this.group.add(this.light);

    this.label = makeLabel(`RELAY ${index + 1}`, '#ffd9a0', 15, 'OFFLINE');
    this.labelMat = this.label.material as THREE.SpriteMaterial;
    this.label.position.set(0, GATE.ringRadius + 11, 0);
    this.group.add(this.label);
  }

  setActive(): void {
    this.state = 'active';
    this.ringMat.color.setHex(PALETTE.amber).multiplyScalar(2.6);
    this.beaconMat.opacity = 0.34;
    this.light.intensity = 90;
    this.labelMat.map = getLabelTexture(`RELAY ${this.index + 1}`, '#ffd9a0', 'SIGNAL WEAK');
    this.labelMat.needsUpdate = true;
  }

  setRestored(): void {
    this.state = 'restored';
    this.ringMat.color.setHex(PALETTE.cyan).multiplyScalar(2.8);
    this.beaconMat.opacity = 0;
    this.light.color.setHex(PALETTE.cyan);
    this.light.intensity = 40;
    this.labelMat.map = getLabelTexture(`RELAY ${this.index + 1}`, '#aef4ff', 'RESTORED');
    this.labelMat.needsUpdate = true;
  }

  setReset(): void {
    this.state = 'dark';
    this.ringMat.color.setHex(PALETTE.amber).multiplyScalar(0.12);
    this.beaconMat.opacity = 0;
    this.light.color.setHex(PALETTE.amber);
    this.light.intensity = 0;
    this.labelMat.map = getLabelTexture(`RELAY ${this.index + 1}`, '#ffd9a0', 'OFFLINE');
    this.labelMat.needsUpdate = true;
  }

  update(dt: number, time: number): void {
    if (this.state === 'active') {
      const pulse = 0.75 + 0.25 * Math.sin(time * 5.2);
      this.light.intensity = 50 + 35 * pulse;
      this.ringMat.color.setHex(PALETTE.amber).multiplyScalar(1.3 + 1.1 * pulse);
      this.beaconMat.opacity = 0.2 + 0.1 * pulse;
    } else if (this.state === 'restored') {
      const pulse = 0.9 + 0.1 * Math.sin(time * 2.2 + this.index);
      this.ringMat.color.setHex(PALETTE.cyan).multiplyScalar(2.4 * pulse);
    }
    this.beacon.visible = this.beaconMat.opacity > 0.01;
  }
}

/* ------------------------------------------------------------------ */

export class ExtractionRing extends PlaneCrosser {
  active = false;
  crossed = false;

  private ringMat: THREE.MeshBasicMaterial;
  private dashGroup = new THREE.Group();
  private beaconMat: THREE.MeshBasicMaterial;
  private beacon: THREE.Mesh;
  private light: THREE.PointLight;
  private labelMat: THREE.SpriteMaterial;
  private label: THREE.Sprite;

  constructor(pos: THREE.Vector3, tangent: THREE.Vector3) {
    super();
    this.orient(pos, tangent);

    const metal = new THREE.MeshStandardMaterial({ color: 0x2e3840, metalness: 0.85, roughness: 0.4 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(EXTRACT.radius, 1.6, 12, 56), metal);
    this.group.add(ring);

    this.ringMat = neonMat(PALETTE.cyan, 0.22);
    const glow = new THREE.Mesh(new THREE.TorusGeometry(EXTRACT.radius - 2.1, 0.34, 8, 56), this.ringMat);
    this.group.add(glow);

    const dashMat = neonMat(PALETTE.cyan, 1.0);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.5), dashMat);
      dash.position.set(Math.cos(a) * (EXTRACT.radius - 3.4), Math.sin(a) * (EXTRACT.radius - 3.4), 0);
      dash.rotation.z = a;
      this.dashGroup.add(dash);
    }
    this.group.add(this.dashGroup);

    const bMat = () => new THREE.MeshBasicMaterial({
      map: getStreakTexture(),
      color: PALETTE.cyan,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.beaconMat = bMat();
    const beacon = makeBeaconColumn(PALETTE.cyan, 0);
    beacon.material = this.beaconMat;
    beacon.position.y = 70;
    this.group.add(beacon);
    this.beacon = beacon;

    this.light = new THREE.PointLight(PALETTE.cyan, 0, 200, 1.8);
    this.group.add(this.light);

    this.label = makeLabel('EXTRACTION', '#bfefff', 20, 'SEALED');
    this.labelMat = this.label.material as THREE.SpriteMaterial;
    this.label.position.set(0, EXTRACT.radius + 12, 0);
    this.group.add(this.label);
  }

  activate(): void {
    this.active = true;
    this.ringMat.color.setHex(PALETTE.cyan).multiplyScalar(2.0);
    this.beaconMat.opacity = 0.3;
    this.light.intensity = 90;
    this.labelMat.map = getLabelTexture('EXTRACTION', '#d9fbff', 'ONLINE — FLY THROUGH');
    this.labelMat.needsUpdate = true;
  }

  reset(): void {
    this.active = false;
    this.crossed = false;
    this.ringMat.color.setHex(PALETTE.cyan).multiplyScalar(0.22);
    this.beaconMat.opacity = 0;
    this.light.intensity = 0;
    this.labelMat.map = getLabelTexture('EXTRACTION', '#bfefff', 'SEALED');
    this.labelMat.needsUpdate = true;
  }

  update(dt: number, time: number): void {
    this.dashGroup.rotation.z += dt * (this.active ? 0.9 : 0.12);
    if (this.active) {
      const pulse = 0.8 + 0.2 * Math.sin(time * 3.4);
      this.ringMat.color.setHex(PALETTE.cyan).multiplyScalar(1.6 + 0.8 * pulse);
      this.light.intensity = 70 + 40 * pulse;
      this.beaconMat.opacity = 0.22 + 0.1 * pulse;
    }
    this.beacon.visible = this.beaconMat.opacity > 0.01;
  }
}

/* ------------------------------------------------------------------ */

export class ChargeCell {
  readonly group = new THREE.Group();
  collected = false;

  private core: THREE.Mesh;
  private ring: THREE.Mesh;
  private glow: THREE.Sprite;
  private baseY: number;
  private phase: number;
  private tmp = new THREE.Vector3();

  constructor(pos: THREE.Vector3) {
    this.group.position.copy(pos);
    this.baseY = pos.y;
    this.phase = pos.x * 0.31 + pos.z * 0.17;

    this.core = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.5),
      new THREE.MeshStandardMaterial({
        color: 0x3d2b10,
        emissive: PALETTE.amber,
        emissiveIntensity: 1.8,
        metalness: 0.2,
        roughness: 0.3,
      }),
    );
    this.group.add(this.core);

    this.ring = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.12, 6, 26), neonMat(PALETTE.amber, 2.2));
    this.group.add(this.ring);

    this.glow = makeGlowSprite(PALETTE.amber, 7, 0.32);
    this.group.add(this.glow);
  }

  /** Magnetic pull toward the craft while close. Returns the distance. */
  attract(target: THREE.Vector3, dt: number): number {
    const d = this.group.position.distanceTo(target);
    if (d > 0.001 && d < PLAY.cellMagnetRadius) {
      this.tmp.subVectors(target, this.group.position);
      const step = Math.min(d, PLAY.cellMagnetSpeed * dt);
      this.tmp.normalize().multiplyScalar(step);
      this.group.position.add(this.tmp);
      this.baseY += this.tmp.y;
    }
    return d;
  }

  collect(): void {
    this.collected = true;
    this.group.visible = false;
  }

  reset(): void {
    this.collected = false;
    this.group.visible = true;
  }

  update(time: number): void {
    if (this.collected) return;
    this.core.rotation.y = time * 1.7 + this.phase;
    this.core.rotation.x = time * 0.9;
    this.ring.rotation.x = time * 1.3 + this.phase;
    this.ring.rotation.y = time * 0.8;
    this.group.position.y = this.baseY + Math.sin(time * 1.6 + this.phase) * 1.1;
    const p = 0.26 + 0.1 * Math.sin(time * 4 + this.phase * 2);
    (this.glow.material as THREE.SpriteMaterial).opacity = p;
  }
}

/* ------------------------------------------------------------------ */

export class Mine {
  readonly group = new THREE.Group();
  private anchor = new THREE.Vector3();
  private perp: THREE.Vector3;
  private amp: number;
  private speed: number;
  private phase: number;
  private vert: number;
  private blink: THREE.Sprite;
  readonly radius = 4.6;

  constructor(anchor: THREE.Vector3, perp: THREE.Vector3, amp: number, speed: number, phase: number, vert: number) {
    this.anchor.copy(anchor);
    this.perp = perp.clone();
    this.amp = amp;
    this.speed = speed;
    this.phase = phase;
    this.vert = vert;

    const geoms: THREE.BufferGeometry[] = [];
    const asTriangles = (g: THREE.BufferGeometry): THREE.BufferGeometry => (g.index ? g.toNonIndexed() : g);
    const core = new THREE.IcosahedronGeometry(1.7);
    core.deleteAttribute('uv');
    geoms.push(asTriangles(core));
    for (let i = 0; i < 8; i++) {
      const dir = new THREE.Vector3(
        Math.sin(i * 2.4), Math.cos(i * 1.7), Math.sin(i * 0.9 + 1.3),
      ).normalize();
      const spike = new THREE.ConeGeometry(0.42, 2.6, 5);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      m.compose(dir.clone().multiplyScalar(2.4), q, new THREE.Vector3(1, 1, 1));
      spike.applyMatrix4(m);
      spike.deleteAttribute('uv');
      geoms.push(asTriangles(spike));
    }
    const merged = (() => {
      // simple manual merge: concat position/normal
      let total = 0;
      for (const g of geoms) total += g.getAttribute('position').count;
      const pos = new Float32Array(total * 3);
      const nor = new Float32Array(total * 3);
      let o = 0;
      for (const g of geoms) {
        const p = g.getAttribute('position') as THREE.BufferAttribute;
        const n = g.getAttribute('normal') as THREE.BufferAttribute;
        pos.set(p.array as Float32Array, o * 3);
        nor.set(n.array as Float32Array, o * 3);
        o += p.count;
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      return out;
    })();

    const body = new THREE.Mesh(
      merged,
      new THREE.MeshStandardMaterial({ color: 0x2a3138, metalness: 0.75, roughness: 0.5 }),
    );
    this.group.add(body);

    const heart = new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x330b10, emissive: PALETTE.red, emissiveIntensity: 3.2 }),
    );
    this.group.add(heart);

    this.blink = makeGlowSprite(PALETTE.red, 7, 0.55);
    this.group.add(this.blink);

    this.group.position.copy(anchor);
  }

  update(dt: number, time: number): void {
    this.phase += dt * this.speed;
    const s = Math.sin(this.phase);
    this.group.position.copy(this.anchor);
    this.group.position.addScaledVector(this.perp, s * this.amp);
    this.group.position.y += Math.sin(this.phase * 0.63 + 1.7) * this.vert;
    this.group.rotation.x = time * 0.7;
    this.group.rotation.y = time * 0.9;
    (this.blink.material as THREE.SpriteMaterial).opacity = 0.35 + 0.3 * Math.sin(time * 7 + this.phase * 3);
  }
}

/* ------------------------------------------------------------------ */

export class Spinner {
  readonly group = new THREE.Group();
  private arms = new THREE.Group();
  private rotSpeed: number;
  private warnMat: THREE.MeshBasicMaterial;
  readonly armLen = 9.6;
  readonly hubRadius = 3.0;

  constructor(pos: THREE.Vector3, tangent: THREE.Vector3, rotSpeed: number) {
    this.rotSpeed = rotSpeed;
    this.group.position.copy(pos);
    this.group.lookAt(pos.x + tangent.x, pos.y + tangent.y, pos.z + tangent.z);

    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(2.1, 2.1, 2.4, 10),
      new THREE.MeshStandardMaterial({ color: 0x2a3138, metalness: 0.8, roughness: 0.45 }),
    );
    hub.rotation.x = Math.PI / 2;
    this.group.add(hub);

    const heart = new THREE.Mesh(
      new THREE.SphereGeometry(0.8, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x330b10, emissive: PALETTE.red, emissiveIntensity: 2.8 }),
    );
    this.group.add(heart);

    const armMat = new THREE.MeshStandardMaterial({ color: 0x39434c, metalness: 0.75, roughness: 0.5 });
    const tipMat = neonMat(PALETTE.red, 2.4);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(this.armLen, 0.85, 0.7), armMat);
      arm.position.set(Math.cos(a) * this.armLen * 0.5, Math.sin(a) * this.armLen * 0.5, 0);
      arm.rotation.z = a;
      this.arms.add(arm);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.1), tipMat);
      tip.position.set(Math.cos(a) * (this.armLen - 0.6), Math.sin(a) * (this.armLen - 0.6), 0);
      this.arms.add(tip);
    }
    this.group.add(this.arms);

    this.warnMat = new THREE.MeshBasicMaterial({
      color: PALETTE.red,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    const warn = new THREE.Mesh(new THREE.TorusGeometry(12.5, 0.3, 6, 40), this.warnMat);
    this.group.add(warn);
  }

  update(dt: number, time: number): void {
    this.arms.rotation.z += dt * this.rotSpeed;
    this.warnMat.opacity = 0.1 + 0.1 * Math.sin(time * 5);
  }

  /** Collision test in the spinner's local plane. Returns true on contact. */
  hits(p: THREE.Vector3): boolean {
    this.group.updateMatrixWorld();
    const local = this.group.worldToLocal(p.clone());
    if (Math.hypot(local.x, local.y) < this.hubRadius && Math.abs(local.z) < 2.2) return true;
    if (Math.abs(local.z) > 1.5) return false;
    const r = Math.hypot(local.x, local.y);
    if (r > this.armLen + 1 || r < 1.2) return false;
    const ang = Math.atan2(local.y, local.x);
    const armPhase = (this.arms.rotation.z % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    for (let i = 0; i < 3; i++) {
      const a0 = armPhase + (i / 3) * Math.PI * 2;
      const ax = Math.cos(a0) * 2.2;
      const ay = Math.sin(a0) * 2.2;
      const bx = Math.cos(a0) * this.armLen;
      const by = Math.sin(a0) * this.armLen;
      if (distPointSegment2D(local.x, local.y, ax, ay, bx, by) < 1.6) return true;
    }
    return false;
  }
}
