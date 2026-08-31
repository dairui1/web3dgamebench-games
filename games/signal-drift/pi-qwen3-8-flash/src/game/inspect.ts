import { SEED, TUNING } from './config';
import type { Phase } from './hud';

/** Plain, JSON-serializable runtime inspection record. */
export interface Inspection {
  phase: Phase;
  score: number;
  player: { x: number; y: number; z: number };
  relaysRestored: number;
  charge: number;
  seed: number;
  restartCount: number;
  speed: number;
  throttle: number;
  heading: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  objective: string;
  distanceToTarget: number;
  target: { x: number; y: number; z: number } | null;
  impacts: number;
  cellsRemaining: number;
  elapsedMs: number;
  fps: number;
  quality: string;
  controls: 'keyboard' | 'touch';
  message: string;
  hull: number;
}

declare global {
  interface Window {
    __WEB3DGAMEBENCH__?: Inspection;
  }
}

const finite = (v: number): number => (Number.isFinite(v) ? v : 0);

export function createInspection(): Inspection {
  const record: Inspection = {
    phase: 'ready',
    score: 0,
    player: { x: 0, y: 0, z: 0 },
    relaysRestored: 0,
    charge: TUNING.charge.start,
    seed: SEED,
    restartCount: 0,
    speed: 0,
    throttle: 0,
    heading: { x: 0, y: 0, z: -1 },
    velocity: { x: 0, y: 0, z: 0 },
    objective: 'STAND BY',
    distanceToTarget: 0,
    target: null,
    impacts: 0,
    cellsRemaining: 0,
    elapsedMs: 0,
    fps: 0,
    quality: 'high',
    controls: 'keyboard',
    message: '',
    hull: 1,
  };
  // Keep the object identity stable so external pollers can hold a reference.
  window.__WEB3DGAMEBENCH__ = record;
  return record;
}

export function sanitise(record: Inspection): void {
  record.score = finite(record.score);
  record.charge = finite(record.charge);
  record.player.x = finite(record.player.x);
  record.player.y = finite(record.player.y);
  record.player.z = finite(record.player.z);
  record.heading.x = finite(record.heading.x);
  record.heading.y = finite(record.heading.y);
  record.heading.z = finite(record.heading.z);
  record.velocity.x = finite(record.velocity.x);
  record.velocity.y = finite(record.velocity.y);
  record.velocity.z = finite(record.velocity.z);
  record.seed = SEED;
  record.relaysRestored = Math.max(0, Math.min(3, Math.round(finite(record.relaysRestored))));
  record.restartCount = Math.max(0, Math.round(finite(record.restartCount)));
  record.speed = finite(record.speed);
  record.distanceToTarget = finite(record.distanceToTarget);
}
