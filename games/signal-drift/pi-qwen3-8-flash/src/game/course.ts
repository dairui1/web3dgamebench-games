import * as THREE from 'three';
import { Rng, clamp } from './util';
import { SEED, TUNING } from './config';

export interface Frame {
  pos: THREE.Vector3;
  tangent: THREE.Vector3;
  /** Right-hand vector of the corridor. */
  side: THREE.Vector3;
  up: THREE.Vector3;
}

export interface BeaconSpot {
  frame: Frame;
  offset: THREE.Vector3;
  height: number;
  kind: 'pylon' | 'lens' | 'mast';
}

export interface CellSpot {
  position: THREE.Vector3;
  t: number;
  cluster: number;
}

export type SweeperMode = 'windmill' | 'keel';

export interface SweeperSpot {
  center: THREE.Vector3;
  /** Rotation basis: two orthogonal vectors spanning the arm plane. */
  axisA: THREE.Vector3;
  axisB: THREE.Vector3;
  axis: THREE.Vector3;
  length: number;
  speed: number;
  phase: number;
  arms: number;
  t: number;
  mode: SweeperMode;
}

export interface DrifterSpot {
  center: THREE.Vector3;
  ampA: number;
  ampB: number;
  freqA: number;
  freqB: number;
  phase: number;
  radius: number;
  t: number;
}

export interface ArcSpot {
  a: THREE.Vector3;
  b: THREE.Vector3;
  period: number;
  phase: number;
  warmup: number;
  live: number;
  t: number;
}

export interface WreckSpot {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: number;
  kind: number;
  spin: THREE.Vector3;
}

const WAYPOINTS: [number, number, number][] = [
  [0, 12, 178],
  [0, 4, 88],
  [14, -6, 4],
  [40, -6, -104],
  [60, 2, -196],
  [112, 24, -268],
  [150, 32, -350],
  [146, 24, -446],
  [92, 4, -520],
  [10, -16, -580],
  [-62, -14, -646],
  [-92, 6, -736],
  [-64, 32, -818],
  [-4, 44, -872],
  [58, 48, -930],
  [128, 54, -984],
];

/** Fractional arc positions of the three relays and the extraction ring. */
const RELAY_POINTS = [3, 6, 9];
const EXTRACTION_POINT = 14;

function frameFromBasis(pos: THREE.Vector3, tangent: THREE.Vector3): Frame {
  const tan = tangent.clone().normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(worldUp, tan);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize();
  const up = new THREE.Vector3().crossVectors(tan, side).normalize();
  return { pos, tangent: tan, side, up };
}

/** The relay field: one continuous spline corridor with everything hung off it. */
export class Course {
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;
  readonly relays: { center: THREE.Vector3; frame: Frame; radius: number }[] = [];
  readonly extraction: { center: THREE.Vector3; frame: Frame; radius: number };
  readonly spawn: Frame;
  readonly beacons: BeaconSpot[] = [];
  readonly cells: CellSpot[] = [];
  readonly sweepers: SweeperSpot[] = [];
  readonly drifters: DrifterSpot[] = [];
  readonly arcs: ArcSpot[] = [];
  readonly wreck: WreckSpot[] = [];
  readonly puffField: THREE.Vector3[] = [];
  readonly samples: THREE.Vector3[] = [];

  constructor(readonly seed: number = SEED) {
    const points = WAYPOINTS.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    this.curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
    this.length = this.curve.getLength();

    const divisions = 420;
    for (let i = 0; i <= divisions; i += 1) this.samples.push(this.curve.getPointAt(i / divisions));

    const tOf = (index: number) => {
      const target = points[index];
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i <= divisions; i += 1) {
        const d = this.samples[i].distanceToSquared(target);
        if (d < bestD) {
          bestD = d;
          best = i / divisions;
        }
      }
      return clamp(best, 0.02, 0.995);
    };

    const relayRadius = TUNING.gates.relayRadius;
    for (const wp of RELAY_POINTS) {
      const t = tOf(wp);
      const pos = this.curve.getPointAt(t);
      this.relays.push({
        center: pos.clone(),
        frame: frameFromBasis(pos.clone(), this.curve.getTangentAt(t)),
        radius: relayRadius,
      });
    }

    const exT = tOf(EXTRACTION_POINT);
    const exPos = this.curve.getPointAt(exT);
    this.extraction = {
      center: exPos.clone(),
      frame: frameFromBasis(exPos.clone(), this.curve.getTangentAt(exT)),
      radius: TUNING.gates.extractionRadius,
    };

    const spawnT = 0.012;
    this.spawn = frameFromBasis(
      this.curve.getPointAt(spawnT),
      this.curve.getTangentAt(spawnT),
    );

    this.buildBeacons();
    this.buildCells();
    this.buildHazards();
    this.buildWreck();
    this.buildPuffs();
  }

  frameAt(t: number): Frame {
    const c = clamp(t, 0, 1);
    return frameFromBasis(this.curve.getPointAt(c), this.curve.getTangentAt(c));
  }

  /** Nearest curve parameter for a world position (coarse scan + refine). */
  nearestT(p: THREE.Vector3, hint = 0.5): number {
    let best = hint;
    let bestD = Infinity;
    const step = 0.004;
    for (let t = 0; t <= 1.0001; t += step) {
      const d = this.curve.getPointAt(Math.min(1, t)).distanceToSquared(p);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  private buildBeacons(): void {
    const rng = new Rng(this.seed + 11);
    const count = 74;
    for (let i = 0; i < count; i += 1) {
      const t = 0.02 + (i / count) * 0.965;
      const frame = this.frameAt(t);
      // Keep the gate mouths clear so rings read as gates.
      let nearGate = false;
      for (const relay of this.relays) {
        if (frame.pos.distanceToSquared(relay.center) < 46 * 46) nearGate = true;
      }
      if (frame.pos.distanceToSquared(this.extraction.center) < 56 * 56) nearGate = true;
      if (nearGate) continue;
      const slot = i % 4;
      const lateral = 20 + rng.float(0, 12);
      const vertical = 15 + rng.float(0, 10);
      let offset: THREE.Vector3;
      let kind: BeaconSpot['kind'];
      if (slot === 0) {
        offset = frame.side.clone().multiplyScalar(lateral).addScaledVector(frame.up, -vertical * 1.35);
        kind = 'pylon';
      } else if (slot === 1) {
        offset = frame.side.clone().multiplyScalar(-lateral).addScaledVector(frame.up, -vertical * 1.35);
        kind = 'pylon';
      } else if (slot === 2) {
        offset = frame.up.clone().multiplyScalar(vertical * 1.5).addScaledVector(frame.side, lateral * 0.4);
        kind = 'mast';
      } else {
        offset = frame.side.clone().multiplyScalar(-lateral).addScaledVector(frame.up, vertical * 1.15);
        kind = 'lens';
      }
      this.beacons.push({
        frame: { ...frame, pos: frame.pos.clone(), tangent: frame.tangent, side: frame.side, up: frame.up },
        offset,
        height: 7 + rng.float(0, 9),
        kind,
      });
    }
  }

  private buildCells(): void {
    const rng = new Rng(this.seed + 37);
    let cluster = 0;
    let placed = 0;
    let guard = 0;
    while (placed < TUNING.cells.count && guard < 400) {
      guard += 1;
      const t = 0.06 + rng.float(0, 0.9);
      const frame = this.frameAt(t);
      const size = rng.int(2, 4);
      const swing = rng.float(0.55, 1.35);
      const baseSide = rng.sign() * rng.float(3, 17);
      const baseUp = rng.sign() * rng.float(0, 11);
      const curveBend = rng.float(-0.5, 0.5);
      for (let i = 0; i < size; i += 1) {
        if (placed >= TUNING.cells.count) break;
        const k = size === 1 ? 0 : i / (size - 1) - 0.5;
        const side = baseSide + Math.sin(k * Math.PI * swing) * 13 * swing + k * 10 * curveBend;
        const up = baseUp + k * 9 * swing;
        const pos = frame.pos
          .clone()
          .addScaledVector(frame.side, side)
          .addScaledVector(frame.up, up)
          .addScaledVector(frame.tangent, k * 8);
        this.cells.push({ position: pos, t, cluster });
        placed += 1;
      }
      cluster += 1;
    }
  }

  private buildHazards(): void {
    const rng = new Rng(this.seed + 101);

    // Windmill sweepers sit just before each relay and in the tight legs.
    const sweeperTs = [0.145, 0.345, 0.47, 0.635, 0.845];
    sweeperTs.slice(0, TUNING.hazards.sweeperCount).forEach((t, i) => {
      const frame = this.frameAt(t);
      const mode: SweeperMode = i % 2 === 0 ? 'windmill' : 'keel';
      const center = frame.pos
        .clone()
        .addScaledVector(frame.side, mode === 'windmill' ? 0 : rng.float(-6, 6))
        .addScaledVector(frame.up, mode === 'windmill' ? 0 : rng.float(-4, 4));
      const armPlaneA = mode === 'windmill' ? frame.up.clone() : frame.side.clone();
      const armPlaneB = mode === 'windmill' ? frame.side.clone() : frame.tangent.clone();
      const axis =
        mode === 'windmill' ? frame.tangent.clone() : frame.up.clone();
      this.sweepers.push({
        center,
        axisA: armPlaneA,
        axisB: armPlaneB,
        axis: axis.normalize(),
        length: rng.float(34, 44),
        speed: rng.float(0.42, 0.62) * rng.sign(),
        phase: rng.float(0, Math.PI * 2),
        arms: 2,
        t,
        mode,
      });
    });

    // Storm drifters wander around the corridor.
    for (let i = 0; i < TUNING.hazards.drifterCount; i += 1) {
      const t = 0.08 + (i / TUNING.hazards.drifterCount) * 0.88 + rng.float(-0.015, 0.015);
      const frame = this.frameAt(t);
      const side = rng.float(-24, 24);
      const up = rng.float(-16, 20);
      this.drifters.push({
        center: frame.pos.clone().addScaledVector(frame.side, side).addScaledVector(frame.up, up),
        ampA: rng.float(9, 21),
        ampB: rng.float(8, 18),
        freqA: rng.float(0.18, 0.42),
        freqB: rng.float(0.15, 0.38),
        phase: rng.float(0, Math.PI * 2),
        radius: rng.float(5.2, 8.2),
        t,
      });
    }

    // Charged arcs straddling the corridor.
    for (let i = 0; i < TUNING.hazards.arcCount; i += 1) {
      const t = 0.2 + (i / TUNING.hazards.arcCount) * 0.72 + rng.float(-0.02, 0.02);
      const frame = this.frameAt(t);
      const lateral = rng.float(20, 27);
      const vertical = rng.float(19, 26);
      const a = frame.pos.clone().addScaledVector(frame.side, lateral).addScaledVector(frame.up, vertical * 0.35);
      const b = frame.pos.clone().addScaledVector(frame.side, -lateral * 0.72).addScaledVector(frame.up, -vertical * 0.8);
      this.arcs.push({
        a,
        b,
        period: rng.float(3.6, 5.2),
        phase: rng.float(0, 5),
        warmup: 0.85,
        live: 0.75,
        t,
      });
    }
  }

  private buildWreck(): void {
    const rng = new Rng(this.seed + 202);
    for (let i = 0; i < 34; i += 1) {
      const t = rng.float(0.02, 0.99);
      const frame = this.frameAt(t);
      const side = rng.sign() * rng.float(38, 120);
      const up = rng.float(-42, 46);
      this.wreck.push({
        position: frame.pos.clone().addScaledVector(frame.side, side).addScaledVector(frame.up, up),
        rotation: new THREE.Euler(rng.float(0, 6.28), rng.float(0, 6.28), rng.float(0, 6.28)),
        scale: rng.float(2.4, 9.5),
        kind: rng.int(0, 3),
        spin: new THREE.Vector3(rng.float(-0.09, 0.09), rng.float(-0.12, 0.12), rng.float(-0.09, 0.09)),
      });
    }
    // Far-off towers give the horizon scale.
    for (let i = 0; i < 16; i += 1) {
      const t = rng.float(0.05, 0.95);
      const frame = this.frameAt(t);
      const side = rng.sign() * rng.float(260, 520);
      this.wreck.push({
        position: frame.pos
          .clone()
          .addScaledVector(frame.side, side)
          .addScaledVector(frame.up, rng.float(-60, -22)),
        rotation: new THREE.Euler(0, rng.float(0, 6.28), 0),
        scale: rng.float(16, 42),
        kind: 4,
        spin: new THREE.Vector3(0, 0, 0),
      });
    }
  }

  private buildPuffs(): void {
    const rng = new Rng(this.seed + 303);
    for (let i = 0; i < 260; i += 1) {
      const t = rng.float(0, 1);
      const frame = this.frameAt(t);
      const side = rng.sign() * Math.pow(rng.float(0, 1), 0.6) * rng.float(30, 260);
      const up = rng.float(-46, 34);
      this.puffField.push(
        frame.pos.clone().addScaledVector(frame.side, side).addScaledVector(frame.up, up),
      );
    }
    for (let i = 0; i < 220; i += 1) {
      const t = rng.float(0, 1);
      const frame = this.frameAt(t);
      const side = rng.sign() * rng.float(10, 300);
      this.puffField.push(
        frame.pos
          .clone()
          .addScaledVector(frame.side, side)
          .addScaledVector(frame.up, rng.float(-34, -14)),
      );
    }
  }
}
