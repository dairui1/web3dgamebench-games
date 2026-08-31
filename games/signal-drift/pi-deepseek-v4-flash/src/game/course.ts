import * as THREE from 'three';
import { mulberry32 } from './rng';

export const SEED = 94721;
export const GATE_ZS = [380, 920, 1520] as const;
export const EXTRACT_Z = 2220;
export const PLAN_END = EXTRACT_Z + 780;

const ORB_CAP = 460;
const DRONE_CAP = 56;
const TUMB_CAP = 30;
const STRIKE_CAP = 12;
const PYLON_CAP = 240;

export const STRIKE_SPEED = 68;

export interface OrbEnt {
  z: number; x: number; y: number;
  active: boolean; collected: boolean;
}
export interface DroneEnt {
  z: number;
  cx: number; cy: number; ax: number; ay: number;
  fx: number; fy: number; px: number; py: number;
  active: boolean; x: number; y: number; r: number;
}
export interface TumblerEnt {
  z: number; bx: number; y: number; scale: number; ph: number;
  rx: number; ry: number; rz: number; rs: number;
  active: boolean; x: number; r: number;
}
export interface StrikerEnt {
  z0: number; z: number; x0: number; y0: number; ph: number;
  active: boolean; x: number; y: number; r: number;
}
export interface PylonEnt {
  z: number; x: number; h: number; active: boolean;
}

export type CourseEvent =
  | { type: 'relay'; index: number }
  | { type: 'extract' }
  | { type: 'locked' };

const ORB_COLOR = 0x8df6ff;
const DRONE_COLOR = 0xff5330;
const TUMB_COLOR = 0x4a403c;
const STRIKE_COLOR = 0xffb03a;
const RAIL_COLOR = 0x4fd8ff;
const TIP_COLOR = 0x9ff4ff;

export class Course {
  orbs: OrbEnt[] = [];
  drones: DroneEnt[] = [];
  tumblers: TumblerEnt[] = [];
  strikers: StrikerEnt[] = [];
  pylons: PylonEnt[] = [];

  readonly gates: GateView[] = [];
  readonly extract: ExtractView;

  private orbMesh: THREE.InstancedMesh;
  private droneMesh: THREE.InstancedMesh;
  private tumbMesh: THREE.InstancedMesh;
  private strikeMesh: THREE.InstancedMesh;
  private pylonMesh: THREE.InstancedMesh;
  private tipMesh: THREE.InstancedMesh;
  private waypoints: THREE.Mesh[] = [];

  private oCur = 0;
  private dCur = 0;
  private tCur = 0;
  private sCur = 0;
  private pCur = 0;

  private mat4 = new THREE.Matrix4();
  private zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
  private quat = new THREE.Quaternion();
  private euler = new THREE.Euler();
  private vec = new THREE.Vector3();
  private scaleV = new THREE.Vector3();
  private zeroScale = new THREE.Vector3(0, 0, 0);

  private t = 0;

  constructor(scene: THREE.Scene, seed: number) {
    const rng = mulberry32(seed);

    // ---- build the deterministic plan ------------------------------------
    this.buildPlan(rng);

    // ---- pools ------------------------------------------------------------
    const orbGeo = new THREE.SphereGeometry(0.62, 10, 8);
    const orbMat = new THREE.MeshBasicMaterial({
      color: ORB_COLOR, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.orbMesh = new THREE.InstancedMesh(orbGeo, orbMat, ORB_CAP);
    this.orbMesh.frustumCulled = false;
    scene.add(this.orbMesh);

    const droneGeo = new THREE.IcosahedronGeometry(1.0, 0);
    const droneMat = new THREE.MeshStandardMaterial({
      color: 0x2a1622, emissive: DRONE_COLOR, emissiveIntensity: 2.4,
      roughness: 0.4, metalness: 0.3,
    });
    this.droneMesh = new THREE.InstancedMesh(droneGeo, droneMat, DRONE_CAP);
    this.droneMesh.frustumCulled = false;
    scene.add(this.droneMesh);

    const tumbGeo = new THREE.IcosahedronGeometry(1.0, 1);
    const tumbMat = new THREE.MeshStandardMaterial({
      color: TUMB_COLOR, roughness: 0.92, metalness: 0.05,
    });
    this.tumbMesh = new THREE.InstancedMesh(tumbGeo, tumbMat, TUMB_CAP);
    this.tumbMesh.frustumCulled = false;
    scene.add(this.tumbMesh);

    const strikeGeo = new THREE.SphereGeometry(0.7, 10, 8);
    const strikeMat = new THREE.MeshBasicMaterial({
      color: STRIKE_COLOR, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, fog: false,
    });
    this.strikeMesh = new THREE.InstancedMesh(strikeGeo, strikeMat, STRIKE_CAP);
    this.strikeMesh.frustumCulled = false;
    scene.add(this.strikeMesh);

    const shaftGeo = new THREE.CylinderGeometry(0.42, 0.62, 1, 6);
    const shaftMat = new THREE.MeshStandardMaterial({
      color: 0x1d2a3e, roughness: 0.6, metalness: 0.45,
    });
    this.pylonMesh = new THREE.InstancedMesh(shaftGeo, shaftMat, PYLON_CAP);
    this.pylonMesh.frustumCulled = false;
    scene.add(this.pylonMesh);

    const tipGeo = new THREE.BoxGeometry(0.62, 0.62, 0.62);
    const tipMat = new THREE.MeshBasicMaterial({
      color: TIP_COLOR, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, fog: false,
    });
    this.tipMesh = new THREE.InstancedMesh(tipGeo, tipMat, PYLON_CAP);
    this.tipMesh.frustumCulled = false;
    scene.add(this.tipMesh);

    // ---- rails (continuous corridor edges) --------------------------------
    const railLen = PLAN_END + 300;
    const railMat = new THREE.MeshBasicMaterial({
      color: RAIL_COLOR, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    for (const sx of [-1, 1]) {
      for (const sy of [7.5, 22.5]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, railLen), railMat);
        rail.position.set(36 * sx, sy, (railLen - 240) / 2 - 60);
        rail.frustumCulled = false;
        scene.add(rail);
      }
    }

    // ---- slalom waypoint rings (non-colliding course markers) -------------
    const ringGeo = new THREE.TorusGeometry(1, 0.16, 8, 30);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x59e6ff, transparent: true, opacity: 0.34,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    for (let i = 0; i < 11; i++) {
      let z = 90 + i * 205 + rng() * 30;
      if ([380, 920, 1520, 2220].some((gz) => Math.abs(gz - z) < 58)) z += 90;
      const wp = new THREE.Mesh(ringGeo, ringMat);
      wp.scale.setScalar(4.2 + rng() * 1.4);
      const side = i % 2 === 0 ? 1 : -1;
      wp.rotation.y = Math.PI / 2;
      wp.rotation.z = rng() * 0.5;
      wp.position.set(side * (9 + rng() * 7), 4 + rng() * 17, z);
      wp.userData.base = wp.position.clone();
      wp.userData.tilt = wp.rotation.z;
      this.waypoints.push(wp);
      scene.add(wp);
    }

    // ---- relay gates + extraction ring ------------------------------------
    for (let i = 0; i < 3; i++) {
      this.gates.push(new GateView(scene, i, GATE_ZS[i], 12));
    }
    this.extract = new ExtractView(scene, EXTRACT_Z, 12);

    this.reset();
  }

  // ========================================================================
  //  Deterministic course planning
  // ========================================================================
  private buildPlan(rng: () => number): void {
    const orbs: OrbEnt[] = [];
    const drones: DroneEnt[] = [];
    const tumblers: TumblerEnt[] = [];
    const strikers: StrikerEnt[] = [];
    const pylons: PylonEnt[] = [];

    const addOrb = (x: number, y: number, z: number) => {
      if (z > 20 && z < PLAN_END) orbs.push({ z, x, y, active: false, collected: false });
    };
    const orbLine = (cx: number, cy: number, cz: number, n: number, spacing: number, curve: number, dy: number) => {
      for (let i = 0; i < n; i++) {
        const f = i / Math.max(1, n - 1) - 0.5;
        addOrb(cx + Math.sin(f * 2.1) * curve, cy + f * dy, cz + i * spacing);
      }
    };
    const orbHoop = (cx: number, cy: number, cz: number, n: number, radius: number) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng() * 0.6;
        addOrb(cx + Math.cos(a) * radius * (0.8 + rng() * 0.4), cy + Math.sin(a) * radius * 0.8, cz + rng() * 6);
      }
    };
    const orbScatter = (cz: number, n: number) => {
      for (let i = 0; i < n; i++) {
        addOrb((rng() - 0.5) * 52, 4 + rng() * 17, cz + rng() * 26);
      }
    };

    let z = 40;
    let chunk = 0;
    let gateIdx = 0;
    const gateZ = (): number => (gateIdx < GATE_ZS.length ? GATE_ZS[gateIdx] : Infinity);

    while (z < PLAN_END) {
      const gz = gateZ();
      let len = 135 + rng() * 65;
      if (gz < z + len + 40) len = Math.max(64, gz - z - 12);
      const zEnd = z + len;
      chunk++;
      const nearGate = gz - z < 90;

      // ---- orbs: 2-3 groups per chunk
      const groups = chunk <= 1 ? 3 : rng() < 0.35 ? 2 : 3;
      for (let g = 0; g < groups; g++) {
        const cz = rangeJitter(rng, z + 14, Math.min(zEnd - 14, gz - 30));
        if (cz <= z + 12) continue;
      const roll = rng();
        if (roll < 0.5) {
          const cx = (rng() - 0.5) * 30;
          orbLine(cx, 5 + rng() * 15, cz, 3 + Math.floor(rng() * 3), 15 + rng() * 7, 7 + rng() * 9, 3 + rng() * 6);
        } else if (roll < 0.8) {
          orbHoop((rng() - 0.5) * 20, 7 + rng() * 11, cz, 5 + Math.floor(rng() * 2), 5 + rng() * 4.5);
        } else {
          orbScatter(cz, 3 + Math.floor(rng() * 3));
        }
      }

      // ---- hazards (never in the first two chunks, never near gates)
      const safeZone = chunk <= 2 || nearGate;
      if (!safeZone) {
        const p = rng();
        if (p < 0.34) {
          // one sweeping drone
          const cx = (rng() - 0.5) * 30;
          const cy = 4 + rng() * 15;
          drones.push({
            z: rangeJitter(rng, z + 10, zEnd - 10), cx, cy,
            ax: 6 + rng() * 8, ay: 3 + rng() * 4,
            fx: 0.5 + rng() * 0.8, fy: 0.4 + rng() * 0.9,
            px: rng() * 6.28, py: rng() * 6.28,
            active: false, x: 0, y: 0, r: 3.3,
          });
        } else if (p < 0.6) {
          // drifting tumbler
          tumblers.push({
            z: rangeJitter(rng, z + 12, zEnd - 12),
            bx: (rng() - 0.5) * 32, y: 5 + rng() * 14,
            scale: 3.6 + rng() * 1.9, ph: rng() * 6.28,
            rx: rng(), ry: rng(), rz: rng(), rs: 0.4 + rng() * 0.8,
            active: false, x: 0, r: 4.5,
          });
        } else if (p < 0.85) {
          // twin drones in a counter-sweep
          const cx = (rng() - 0.5) * 26;
          const cy = 6 + rng() * 12;
          const dz = rangeJitter(rng, z + 10, zEnd - 10);
          drones.push({ z: dz, cx: cx - 6, cy: cy + 4, ax: 7 + rng() * 6, ay: 3, fx: 0.55, fy: 0.7, px: 0.6, py: 2.1, active: false, x: 0, y: 0, r: 3.3 });
          drones.push({ z: dz + 26, cx: cx + 6, cy: cy - 4, ax: 7 + rng() * 6, ay: 3, fx: 0.55, fy: 0.7, px: 3.5, py: 4.4, active: false, x: 0, y: 0, r: 3.3 });
        } else {
          // combo: tumbler + drone offset laterally
          tumblers.push({
            z: rangeJitter(rng, z + 12, zEnd - 12),
            bx: -10 - rng() * 8, y: 6 + rng() * 10,
            scale: 3.4 + rng() * 1.4, ph: rng() * 6.28,
            rx: rng(), ry: rng(), rz: rng(), rs: 0.5 + rng() * 0.6,
            active: false, x: 0, r: 4.4,
          });
          drones.push({
            z: rangeJitter(rng, z + 16, zEnd - 10),
            cx: 12 + rng() * 8, cy: 8 + rng() * 10,
            ax: 5 + rng() * 5, ay: 4,
            fx: 0.6 + rng() * 0.5, fy: 0.5 + rng() * 0.6,
            px: rng() * 6.28, py: rng() * 6.28,
            active: false, x: 0, y: 0, r: 3.3,
          });
        }
      }

      z = zEnd + 16;
      if (z >= gz - 24) z = gz + 26;

      // ---- pylons at regular rhythm
      if (chunk % 2 === 1) {
        const px = (rng() < 0.5 ? -1 : 1) * (37 + rng() * 6);
        const h = 20 + rng() * 14;
        pylons.push({ z: z - 26, x: px, h, active: false });
      }
      gateIdx = 0;
      if (gz <= z) gateIdx++;
      if (gz <= z && gateIdx < GATE_ZS.length) {
        // keep cursor correct for next gate
      }
      // compute actual next gate index
      let gi = 0;
      while (gi < GATE_ZS.length && GATE_ZS[gi] < z) gi++;
      gateIdx = gi;
    }

    // two fast strikers late in the run (clear of the gate approaches)
    const s1 = 1060 + Math.floor(rng() * 180);
    const s2 = 1720 + Math.floor(rng() * 220);
    strikers.push({ z0: s1, z: s1, x0: (rng() - 0.5) * 22, y0: 6 + rng() * 12, ph: rng() * 6.28, active: false, x: 0, y: 0, r: 2.4 });
    strikers.push({ z0: s2, z: s2, x0: (rng() - 0.5) * 22, y0: 6 + rng() * 12, ph: rng() * 6.28, active: false, x: 0, y: 0, r: 2.4 });

    this.orbs = orbs;
    this.drones = drones;
    this.tumblers = tumblers;
    this.strikers = strikers;
    this.pylons = pylons;
  }

  // ========================================================================
  reset(): void {
    this.t = 0;
    this.oCur = this.dCur = this.tCur = this.sCur = this.pCur = 0;
    const zero = this.zeroMat;
    for (const o of this.orbs) { o.active = false; o.collected = false; }
    for (const d of this.drones) d.active = false;
    for (const t of this.tumblers) t.active = false;
    for (const s of this.strikers) { s.active = false; s.z = s.z0; }
    for (const p of this.pylons) p.active = false;
    this.writeMesh(this.orbMesh, zero, 0, ORB_CAP);
    this.writeMesh(this.droneMesh, zero, 0, DRONE_CAP);
    this.writeMesh(this.tumbMesh, zero, 0, TUMB_CAP);
    this.writeMesh(this.strikeMesh, zero, 0, STRIKE_CAP);
    this.writeMesh(this.pylonMesh, zero, 0, PYLON_CAP);
    this.writeMesh(this.tipMesh, zero, 0, PYLON_CAP);
    for (const g of this.gates) g.setRestored(false);
    this.extract.setUnlocked(false);
    this.extract.setCrossed(false);
  }

  private writeMesh(mesh: THREE.InstancedMesh, m: THREE.Matrix4, from: number, to: number): void {
    for (let i = from; i < to; i++) mesh.setMatrixAt(i, m);
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Advance the course simulation. `craftZ` drives activation/recycling. */
  update(dt: number, craftZ: number): void {
    this.t += dt;
    const ahead = craftZ + 820;
    const behind = craftZ - 150;

    // activate by z order
    while (this.oCur < this.orbs.length && this.orbs[this.oCur].z < ahead) this.orbs[this.oCur++].active = true;
    while (this.dCur < this.drones.length && this.drones[this.dCur].z < ahead) this.drones[this.dCur++].active = true;
    while (this.tCur < this.tumblers.length && this.tumblers[this.tCur].z < ahead) this.tumblers[this.tCur++].active = true;
    while (this.sCur < this.strikers.length && this.strikers[this.sCur].z < ahead) this.strikers[this.sCur++].active = true;
    while (this.pCur < this.pylons.length && this.pylons[this.pCur].z < ahead) this.pylons[this.pCur++].active = true;

    const t = this.t;
    const m = this.mat4, q = this.quat, e = this.euler, v = this.vec, sv = this.scaleV;

    // orbs (static; gentle pulse)
    const breathe = 1 + Math.sin(t * 3.1) * 0.08;
    for (let i = 0; i < this.orbs.length; i++) {
      const o = this.orbs[i];
      if (!o.active || o.collected) continue;
      if (o.z < behind) { o.active = false; this.orbMesh.setMatrixAt(i, m.makeScale(0, 0, 0)); continue; }
      v.set(o.x, o.y, o.z);
      sv.set(breathe, breathe, breathe);
      m.compose(v, q.identity(), sv);
      this.orbMesh.setMatrixAt(i, m);
    }
    this.orbMesh.instanceMatrix.needsUpdate = true;

    // drones: sweeping motion
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i];
      if (!d.active) continue;
      if (d.z < behind) { d.active = false; this.droneMesh.setMatrixAt(i, m.makeScale(0, 0, 0)); continue; }
      d.x = d.cx + Math.sin(t * d.fx + d.px) * d.ax;
      d.y = d.cy + Math.sin(t * d.fy + d.py) * d.ay;
      v.set(d.x, d.y, d.z);
      e.set(t * 2.2 + i, t * 1.4, t * 3.0);
      q.setFromEuler(e);
      sv.set(1.15, 1.15, 1.15);
      m.compose(v, q, sv);
      this.droneMesh.setMatrixAt(i, m);
    }
    this.droneMesh.instanceMatrix.needsUpdate = true;

    // tumblers: drifting + tumbling
    for (let i = 0; i < this.tumblers.length; i++) {
      const tb = this.tumblers[i];
      if (!tb.active) continue;
      if (tb.z < behind) { tb.active = false; this.tumbMesh.setMatrixAt(i, m.makeScale(0, 0, 0)); continue; }
      tb.x = tb.bx + Math.sin(t * 0.45 + tb.ph) * 2.4;
      v.set(tb.x, tb.y, tb.z);
      e.set(t * tb.rs * tb.rx, t * tb.rs * tb.ry, t * tb.rs * tb.rz);
      q.setFromEuler(e);
      sv.set(tb.scale, tb.scale, tb.scale);
      m.compose(v, q, sv);
      this.tumbMesh.setMatrixAt(i, m);
    }
    this.tumbMesh.instanceMatrix.needsUpdate = true;

    // strikers: they fly TOWARD the player
    for (let i = 0; i < this.strikers.length; i++) {
      const s = this.strikers[i];
      if (!s.active) continue;
      s.z -= STRIKE_SPEED * dt;
      s.x = s.x0 + Math.sin(t * 2.4 + s.ph) * 2.2;
      s.y = s.y0 + Math.cos(t * 1.9 + s.ph) * 1.2;
      if (s.z < craftZ - 26) { s.active = false; this.strikeMesh.setMatrixAt(i, m.makeScale(0, 0, 0)); continue; }
      v.set(s.x, s.y, s.z);
      sv.set(1, 1, 1);
      m.compose(v, q.identity(), sv);
      this.strikeMesh.setMatrixAt(i, m);
    }
    this.strikeMesh.instanceMatrix.needsUpdate = true;

    // pylons
    for (let i = 0; i < this.pylons.length; i++) {
      const p = this.pylons[i];
      if (!p.active) continue;
      if (p.z < behind) {
        p.active = false;
        this.pylonMesh.setMatrixAt(i, m.makeScale(0, 0, 0));
        this.tipMesh.setMatrixAt(i, m);
        continue;
      }
      v.set(p.x, -8 + p.h * 0.12, p.z);
      sv.set(1, p.h, 1);
      m.compose(v, q.identity(), sv);
      this.pylonMesh.setMatrixAt(i, m);
      v.set(p.x, -8 + p.h * 0.12 + p.h + 0.6, p.z);
      m.compose(v, q.identity(), sv.set(0.8, 0.8, 0.8));
      this.tipMesh.setMatrixAt(i, m);
    }
    this.pylonMesh.instanceMatrix.needsUpdate = true;
    this.tipMesh.instanceMatrix.needsUpdate = true;

    for (const g of this.gates) g.update(t, dt);
    this.extract.update(t, dt);

    // waypoints bob gently
    const wpT = this.t;
    for (const wp of this.waypoints) {
      wp.position.y = wp.userData.base.y + Math.sin(wpT * 0.9 + wp.userData.base.z * 0.01) * 1.1;
      wp.rotation.z = wp.userData.tilt + Math.sin(wpT * 0.6) * 0.15;
      wp.rotation.x = Math.sin(wpT * 0.8) * 0.3;
    }
  }

  /** Detects crossing a gate plane while moving forward. */
  tryGateCross(prevZ: number, z: number, x: number, y: number): CourseEvent | null {
    for (let i = 0; i < this.gates.length; i++) {
      const g = this.gates[i];
      if (prevZ < g.z && z >= g.z) {
        const dx = x - g.x, dy = y - g.y;
        if (dx * dx + dy * dy < 9.2 * 9.2) return { type: 'relay', index: i };
      }
    }
    const ex = this.extract;
    if (prevZ < ex.z && z >= ex.z) {
      const dx = x - ex.x, dy = y - ex.y;
      if (dx * dx + dy * dy < 14 * 14) {
        if (this.extract.unlocked) return { type: 'extract' };
        return { type: 'locked' };
      }
    }
    return null;
  }

  /** Remove a collected orb from the active set (visual+state). */
  collectOrb(i: number): void {
    const o = this.orbs[i];
    if (!o || !o.active || o.collected) return;
    o.collected = true;
    this.orbMesh.setMatrixAt(i, this.mat4.makeScale(0, 0, 0));
    this.orbMesh.instanceMatrix.needsUpdate = true;
  }

  markRelayRestored(index: number): void {
    this.gates[index]?.setRestored(true);
  }

  /** collect orbs near a point; returns number collected; writes orb indices into out[] */
  tryCollectOrbs(x: number, y: number, z: number, r: number, out: number[]): void {
    const r2 = r * r;
    for (let i = 0; i < this.orbs.length; i++) {
      const o = this.orbs[i];
      if (!o.active || o.collected) continue;
      const dx = o.x - x, dy = o.y - y, dz = o.z - z;
      if (dx * dx + dy * dy + dz * dz < r2) {
        o.collected = true;
        out.push(i);
        this.orbMesh.setMatrixAt(i, this.mat4.makeScale(0, 0, 0));
      }
    }
    this.orbMesh.instanceMatrix.needsUpdate = true;
  }

  collectCount(): number {
    let n = 0;
    for (const o of this.orbs) if (o.collected) n++;
    return n;
  }
}

function rangeJitter(rng: () => number, a: number, b: number): number {
  return a + rng() * (b - a);
}

// ========================================================================
//  Gate visuals
// ========================================================================
export class GateView {
  readonly group = new THREE.Group();
  readonly z: number;
  readonly x: number;
  readonly y: number;
  restored = false;

  private ringMat: THREE.MeshStandardMaterial;
  private discMat: THREE.MeshBasicMaterial;
  private beam: THREE.Mesh;
  private glowMat: THREE.SpriteMaterial;
  private glow: THREE.Sprite;
  private ringTorus: THREE.Mesh;
  private spokes: THREE.Group;
  private beacon: THREE.Mesh;

  constructor(scene: THREE.Scene, index: number, z: number, y: number) {
    this.z = z;
    this.x = 0;
    this.y = y;
    const g = this.group;

    this.ringMat = new THREE.MeshStandardMaterial({
      color: 0x4a341a,
      emissive: new THREE.Color(0xffb347).multiplyScalar(1.15),
      emissiveIntensity: 1.15,
      roughness: 0.35,
      metalness: 0.55,
      fog: false,
    });
    this.ringTorus = new THREE.Mesh(new THREE.TorusGeometry(8.7, 0.55, 12, 56), this.ringMat);
    this.ringTorus.rotation.x = Math.PI / 2;
    g.add(this.ringTorus);

    // inner pass disc (the "gate mouth")
    this.discMat = new THREE.MeshBasicMaterial({
      color: 0x7fe9ff, transparent: true, opacity: 0.16,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false,
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(7.9, 40), this.discMat);
    g.add(disc);

    // slow-rotating spokes
    const rot = new THREE.Group();
    this.spokes = rot;
    for (let i = 0; i < 6; i++) {
      const arm = new THREE.Group();
      arm.rotation.z = (i / 6) * Math.PI * 2;
      const sp = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 6.6, 0.14),
        new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
      );
      sp.position.y = 3.4;
      arm.add(sp);
      rot.add(arm);
    }
    g.add(rot);

    // towers
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x222c40, roughness: 0.5, metalness: 0.5, fog: false });
    for (const sx of [-1, 1]) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.9, 19, 8), towerMat);
      tower.position.set(10.6 * sx, -6, 0);
      g.add(tower);
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 17, 0.16),
        new THREE.MeshBasicMaterial({ color: 0x8ff0ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
      );
      strip.position.set(10.6 * sx + 0.0, -5.5, 0.32);
      g.add(strip);
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.6, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
      );
      cap.position.set(10.6 * sx, 3.6, 0);
      g.add(cap);
    }

    // glow sprite
    const glowTex = makeGlowTexture();
    this.glowMat = new THREE.SpriteMaterial({
      map: glowTex, color: 0xffb347, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.glow = new THREE.Sprite(this.glowMat);
    this.glow.scale.set(42, 42, 1);
    g.add(this.glow);

    // restore beam (hidden until restored)
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 1.6, 58, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffd873, transparent: true, opacity: 0.0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
      }),
    );
    this.beam.position.set(0, 29, 0);
    g.add(this.beam);

    // "next target" beacon (tall thin column above the gate, punches through fog)
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.55, 34, 6, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffcd7d, transparent: true, opacity: 0.0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
      }),
    );
    this.beacon.position.set(0, 29.5, 0);
    this.beacon.visible = false;
    g.add(this.beacon);

    g.position.set(this.x, this.y, this.z);
    g.frustumCulled = false;
    scene.add(g);
    // signed-relay ticks: index+1 small diamonds on ring top
    for (let i = 0; i <= index; i++) {
      const tick = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.42),
        new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
      );
      tick.position.set(-2.2 + i * 2.2, 9.6, 0);
      g.add(tick);
    }
  }

  setRestored(v: boolean): void {
    if (this.restored === v) return;
    this.restored = v;
    if (v) {
      this.ringMat.emissive.setHex(0xffd873);
      this.ringMat.emissiveIntensity = 2.4;
      this.discMat.opacity = 0.34;
      (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.16;
      this.glowMat.color.setHex(0xffcf7a);
      this.glowMat.opacity = 0.85;
      this.beacon.visible = false;
    } else {
      this.ringMat.emissive.setHex(0xffb347);
      this.ringMat.emissiveIntensity = 1.15;
      this.discMat.opacity = 0.16;
      (this.beam.material as THREE.MeshBasicMaterial).opacity = 0;
      this.glowMat.color.setHex(0xffb347);
      this.glowMat.opacity = 0.55;
    }
  }

  /** Marks this gate as the current target with a tall pulsing beacon. */
  setHighlight(v: boolean): void {
    this.beacon.visible = v && !this.restored;
  }

  update(t: number, dt: number): void {
    void t; void dt;
    this.spokes.rotation.z += dt * 0.5;
    this.glow.scale.setScalar(40 + Math.sin(t * 2.2) * 5);
    const pulse = 1.05 + Math.sin(t * 3.0) * 0.12;
    this.ringTorus.scale.setScalar(pulse * (this.restored ? 1.0 : 1.0));
    const beamMat = this.beam.material as THREE.MeshBasicMaterial;
    if (this.restored) beamMat.opacity = 0.13 + Math.sin(t * 4.0) * 0.05;
    if (this.beacon.visible) {
      const bm = this.beacon.material as THREE.MeshBasicMaterial;
      bm.opacity = 0.10 + 0.08 * Math.sin(t * 3.4);
    }
  }
}

// ========================================================================
//  Extraction ring
// ========================================================================
export class ExtractView {
  readonly group = new THREE.Group();
  readonly z: number;
  readonly x: number;
  readonly y: number;
  crossed = false;
  unlocked = false;

  private ringMat: THREE.MeshStandardMaterial;
  private ring: THREE.Mesh;
  private beam: THREE.Mesh;
  private glow: THREE.Sprite;
  private glowMat: THREE.SpriteMaterial;
  private halo: THREE.Mesh;

  constructor(scene: THREE.Scene, z: number, y: number) {
    this.z = z;
    this.x = 0;
    this.y = y;
    const g = this.group;

    this.ringMat = new THREE.MeshStandardMaterial({
      color: 0x8a7a3a,
      emissive: new THREE.Color(0xfff3c4).multiplyScalar(1.6),
      emissiveIntensity: 2.0,
      roughness: 0.3,
      metalness: 0.7,
      fog: false,
    });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(13.2, 0.7, 14, 72), this.ringMat);
    this.ring.rotation.x = Math.PI / 2;
    g.add(this.ring);

    // inner halo
    this.halo = new THREE.Mesh(
      new THREE.CircleGeometry(12.0, 48),
      new THREE.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 0.12, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    g.add(this.halo);

    // marker diamonds around the rim
    const dm = new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    for (let i = 0; i < 8; i++) {
      const d = new THREE.Mesh(new THREE.OctahedronGeometry(0.7), dm);
      const a = (i / 8) * Math.PI * 2;
      d.position.set(Math.cos(a) * 13.2, Math.sin(a) * 13.2, 0);
      g.add(d);
    }

    // beacon beam
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 2.6, 90, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff9e0, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    this.beam.position.set(0, 45, 0);
    g.add(this.beam);

    this.glowMat = new THREE.SpriteMaterial({
      map: makeGlowTexture(), color: 0xfff2c4, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.glow = new THREE.Sprite(this.glowMat);
    this.glow.scale.set(110, 110, 1);
    g.add(this.glow);

    g.position.set(this.x, this.y, this.z);
    g.frustumCulled = false;
    scene.add(g);
  }

  setCrossed(v: boolean): void {
    this.crossed = v;
    this.ringMat.emissiveIntensity = v ? 3.4 : this.unlocked ? 2.6 : 1.3;
    (this.beam.material as THREE.MeshBasicMaterial).opacity = v ? 0.3 : this.unlocked ? 0.12 : 0.05;
  }

  setUnlocked(v: boolean): void {
    this.unlocked = v;
    this.ringMat.emissiveIntensity = v ? 2.6 : 1.3;
    (this.beam.material as THREE.MeshBasicMaterial).opacity = v ? 0.12 : 0.05;
  }

  update(t: number, dt: number): void {
    this.ring.rotation.z += dt * 0.16;
    this.halo.rotation.z -= dt * 0.4;
    this.glow.scale.setScalar(105 + Math.sin(t * 2.0) * 8 + (this.crossed ? 14 : 0));
    const pulse = 1.0 + Math.sin(t * 2.4) * 0.03;
    this.ring.scale.setScalar(pulse);
    (this.halo.material as THREE.MeshBasicMaterial).opacity = 0.09 + Math.sin(t * 3.2) * 0.05;
    (this.beam.material as THREE.MeshBasicMaterial).opacity = this.crossed ? 0.28 + Math.sin(t * 6) * 0.08 : 0.1 + Math.sin(t * 2.0) * 0.04;
  }
}

let glowTextureCache: THREE.CanvasTexture | null = null;
function makeGlowTexture(): THREE.CanvasTexture {
  if (glowTextureCache) return glowTextureCache;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.32)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  glowTextureCache = tex;
  return tex;
}