import * as THREE from 'three';
import { mulberry32, makeRandRange } from './rng';

export interface CorridorFrame {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
}

export interface HazardDef {
  t: number;
  u: number;
  v: number;
  ampU: number;
  ampV: number;
  speed: number;
  phase: number;
  radius: number;
  spin: THREE.Vector3;
}

export interface OrbDef {
  t: number;
  u: number;
  v: number;
  bobPhase: number;
  collected: boolean;
}

export interface GateDef {
  t: number;
  index: number;
  radius: number;
}

export interface PylonDef {
  t: number;
  side: 1 | -1;
  height: number;
}

export interface Course {
  curve: THREE.CatmullRomCurve3;
  length: number;
  corridorRadius: number;
  softRadius: number;
  gates: GateDef[];
  extraction: { t: number; radius: number };
  hazards: HazardDef[];
  orbs: OrbDef[];
  pylons: PylonDef[];
  getFrame(t: number): CorridorFrame;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export function buildCourse(seed: number): Course {
  const rng = mulberry32(seed);
  const rand = makeRandRange(rng);

  const segCount = 13;
  const segLength = 62;
  const points: THREE.Vector3[] = [new THREE.Vector3(0, 12, 0)];
  let heading = 0;
  let climb = 12;
  for (let i = 1; i <= segCount; i++) {
    heading += rand(-0.5, 0.5);
    heading = THREE.MathUtils.clamp(heading, -1.1, 1.1);
    climb += rand(-6, 6);
    climb = THREE.MathUtils.clamp(climb, 4, 46);
    const prev = points[i - 1];
    const next = new THREE.Vector3(
      prev.x + Math.sin(heading) * segLength,
      climb,
      prev.z - Math.cos(heading) * segLength,
    );
    points.push(next);
  }

  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.4);
  const length = curve.getLength();
  const corridorRadius = 15;
  const softRadius = 21;

  const getFrame = (tRaw: number): CorridorFrame => {
    const t = THREE.MathUtils.clamp(tRaw, 0, 1);
    const position = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    let right = new THREE.Vector3().crossVectors(tangent, WORLD_UP);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(right, tangent).normalize();
    return { position, tangent, right, up };
  };

  const gateTs = [0.24, 0.5, 0.76];
  const gates: GateDef[] = gateTs.map((t, index) => ({ t, index, radius: 7.5 }));
  const extraction = { t: 0.94, radius: 9 };

  const hazards: HazardDef[] = [];
  const hazardBands: [number, number][] = [
    [0.08, 0.21],
    [0.29, 0.47],
    [0.55, 0.73],
    [0.8, 0.9],
  ];
  for (const [a, b] of hazardBands) {
    const count = Math.round(rand(4, 6));
    for (let i = 0; i < count; i++) {
      const t = rand(a, b);
      hazards.push({
        t,
        u: rand(-corridorRadius * 0.8, corridorRadius * 0.8),
        v: rand(-corridorRadius * 0.55, corridorRadius * 0.7),
        ampU: rand(3, 9),
        ampV: rand(1.5, 5),
        speed: rand(0.4, 1.1),
        phase: rand(0, Math.PI * 2),
        radius: rand(1.6, 3.4),
        spin: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(),
      });
    }
  }

  const orbs: OrbDef[] = [];
  for (let t = 0.03; t < 0.98; t += rand(0.018, 0.03)) {
    const clusterSize = Math.round(rand(1, 3));
    for (let c = 0; c < clusterSize; c++) {
      orbs.push({
        t: THREE.MathUtils.clamp(t + rand(-0.006, 0.006), 0.01, 0.99),
        u: rand(-corridorRadius * 0.7, corridorRadius * 0.7),
        v: rand(-corridorRadius * 0.4, corridorRadius * 0.6),
        bobPhase: rand(0, Math.PI * 2),
        collected: false,
      });
    }
  }

  const pylons: PylonDef[] = [];
  for (let t = 0.015; t < 0.99; t += 0.028) {
    pylons.push({ t, side: 1, height: rand(6, 13) });
    pylons.push({ t, side: -1, height: rand(6, 13) });
  }

  return { curve, length, corridorRadius, softRadius, gates, extraction, hazards, orbs, pylons, getFrame };
}
