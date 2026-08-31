import * as THREE from 'three';

export interface CourseSample {
  pos: THREE.Vector3;
  tangent: THREE.Vector3;
  t: number;
}

export interface NearestInfo {
  sample: CourseSample;
  distSq: number;
  lateral: number;
  lateralDir: THREE.Vector3;
}

const CONTROL_POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 58, 0],
  [-30, 64, -180],
  [-130, 78, -340],
  [-70, 92, -530],
  [120, 82, -660],
  [300, 66, -750],
  [430, 84, -900],
  [380, 108, -1080],
  [200, 98, -1200],
  [30, 84, -1340],
  [-140, 96, -1490],
  [-60, 116, -1660],
  [170, 124, -1780],
  [380, 110, -1830],
  [470, 92, -1960],
];

/** The relay course: an arc-length parameterized spline through the storm field. */
export class Course {
  readonly curve: THREE.CatmullRomCurve3;
  readonly samples: CourseSample[];
  readonly length: number;
  readonly gateT: readonly number[] = [0.2, 0.48, 0.76];
  readonly extractT = 1.0;

  constructor() {
    const pts = CONTROL_POINTS.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    this.curve.arcLengthDivisions = 800;
    this.length = this.curve.getLength();

    const N = 900;
    this.samples = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      this.samples.push({
        pos: this.curve.getPointAt(t),
        tangent: this.curve.getTangentAt(t).normalize(),
        t,
      });
    }
  }

  pointAt(t: number, out?: THREE.Vector3): THREE.Vector3 {
    return this.curve.getPointAt(THREE.MathUtils.clamp(t, 0, 1), out);
  }

  tangentAt(t: number, out?: THREE.Vector3): THREE.Vector3 {
    return this.curve.getTangentAt(THREE.MathUtils.clamp(t, 0, 1), out).normalize();
  }

  /** Horizontal direction perpendicular to the path at t (unit length). */
  lateralAt(t: number, out?: THREE.Vector3): THREE.Vector3 {
    const tan = this.tangentAt(t);
    const lat = out ?? new THREE.Vector3();
    lat.set(-tan.z, 0, tan.x).normalize();
    return lat;
  }

  /** Nearest sampled point on the path to p, with lateral (horizontal) offset. */
  nearest(p: THREE.Vector3, out?: NearestInfo): NearestInfo {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.samples.length; i++) {
      const s = this.samples[i].pos;
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      const dz = p.z - s.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const sample = this.samples[best];
    const tan = sample.tangent;
    const lat = out?.lateralDir ?? new THREE.Vector3();
    lat.set(-tan.z, 0, tan.x).normalize();
    const off = out ?? ({} as NearestInfo);
    off.sample = sample;
    off.distSq = bestD;
    off.lateral = (p.x - sample.pos.x) * lat.x + (p.z - sample.pos.z) * lat.z;
    off.lateralDir = lat;
    return off;
  }

  /** Scatter helper: a point near the path at t, offset laterally/vertically. */
  nearPoint(t: number, lateral: number, up: number, out?: THREE.Vector3): THREE.Vector3 {
    const pos = this.pointAt(t, out);
    const lat = this.lateralAt(t);
    pos.addScaledVector(lat, lateral);
    pos.y += up;
    return pos;
  }
}
