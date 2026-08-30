import * as THREE from 'three';
import { Rng } from '../core/rng';

export interface Frame {
  pos: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);

function makeFrame(): Frame {
  return {
    pos: new THREE.Vector3(),
    tangent: new THREE.Vector3(0, 0, 1),
    right: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
  };
}

/**
 * The flight corridor: a closed spline through the relay field plus the
 * local frame maths used by every entity in the game. Everything in the
 * course is authored in corridor space (distance along the loop, lateral
 * offset, vertical offset) and converted to world space on demand.
 */
export class Course {
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;
  readonly sampleCount: number;
  readonly radiusX = 27;
  readonly radiusY = 17;

  private readonly frames: Frame[] = [];
  private readonly step: number;
  private readonly scratch = makeFrame();

  constructor(rng: Rng, sampleCount = 1024) {
    const controls: THREE.Vector3[] = [];
    const lobes = 11;
    for (let i = 0; i < lobes; i++) {
      const a = (i / lobes) * Math.PI * 2;
      const radius = 300 + rng.range(-70, 110) + Math.sin(a * 2.0) * 45;
      const height = 40 + Math.sin(a * 3.0 + 0.7) * 34 + rng.spread(16);
      controls.push(new THREE.Vector3(Math.cos(a) * radius, height, Math.sin(a) * radius));
    }

    this.curve = new THREE.CatmullRomCurve3(controls, true, 'catmullrom', 0.5);
    this.length = this.curve.getLength();
    this.sampleCount = sampleCount;
    this.step = this.length / sampleCount;

    const tangent = new THREE.Vector3();
    for (let i = 0; i < sampleCount; i++) {
      const u = i / sampleCount;
      const frame = makeFrame();
      this.curve.getPointAt(u, frame.pos);
      this.curve.getTangentAt(u, tangent);
      frame.tangent.copy(tangent).normalize();
      frame.right.copy(WORLD_UP).cross(frame.tangent).normalize();
      frame.up.copy(frame.tangent).cross(frame.right).normalize();
      this.frames.push(frame);
    }
  }

  /** Wrap a distance into [0, length). */
  wrap(distance: number): number {
    const d = distance % this.length;
    return d < 0 ? d + this.length : d;
  }

  /** Shortest signed distance from `a` to `b` around the loop. */
  delta(a: number, b: number): number {
    let d = this.wrap(b) - this.wrap(a);
    if (d > this.length * 0.5) d -= this.length;
    if (d < -this.length * 0.5) d += this.length;
    return d;
  }

  frameAt(distance: number, out: Frame = this.scratch): Frame {
    const f = this.wrap(distance) / this.step;
    const i0 = Math.floor(f) % this.sampleCount;
    const i1 = (i0 + 1) % this.sampleCount;
    const t = f - Math.floor(f);
    const a = this.frames[i0];
    const b = this.frames[i1];

    out.pos.lerpVectors(a.pos, b.pos, t);
    out.tangent.lerpVectors(a.tangent, b.tangent, t).normalize();
    out.up.lerpVectors(a.up, b.up, t);
    out.right.copy(WORLD_UP).cross(out.tangent).normalize();
    out.up.copy(out.tangent).cross(out.right).normalize();
    return out;
  }

  /** Corridor space -> world space. */
  toWorld(
    distance: number,
    lateral: number,
    vertical: number,
    out: THREE.Vector3 = new THREE.Vector3(),
  ): THREE.Vector3 {
    const f = this.frameAt(distance);
    out.copy(f.pos);
    out.addScaledVector(f.right, lateral);
    out.addScaledVector(f.up, vertical);
    return out;
  }

  /** How far outside the elliptical corridor wall a local offset sits (0 = inside). */
  wallOverlap(lateral: number, vertical: number): number {
    const r = Math.hypot(lateral / this.radiusX, vertical / this.radiusY);
    return r > 1 ? r - 1 : 0;
  }

  /** Orientation for a body flying forward along the corridor at `distance`. */
  orientation(distance: number, out: THREE.Quaternion): THREE.Quaternion {
    const f = this.frameAt(distance);
    return this.orientationFromFrame(f, out);
  }

  orientationFromFrame(f: Frame, out: THREE.Quaternion): THREE.Quaternion {
    // Models are authored nose-down -Z, so the basis Z axis is the reverse tangent.
    _z.copy(f.tangent).negate();
    _y.copy(f.up);
    _x.copy(_y).cross(_z).normalize();
    _m.makeBasis(_x, _y, _z);
    return out.setFromRotationMatrix(_m);
  }
}

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
