// Small deterministic math helpers: noise, easing, clamping, random.

export const TAU = Math.PI * 2;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Exponential damping toward target. k is the time constant in seconds. */
export function damp(cur: number, target: number, k: number, dt: number): number {
  return lerp(cur, target, 1 - Math.exp(-dt / k));
}

export function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export function randInt(a: number, b: number): number {
  return Math.floor(rand(a, b + 1));
}

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function hash2(ix: number, iz: number): number {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bilinear value noise, domain scaled by caller. Returns 0..1. */
export function noise2(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  const u = smooth(fx);
  const v = smooth(fz);
  const top = a + (b - a) * u;
  const bot = c + (d - c) * u;
  return top + (bot - top) * v;
}

/** Fractal brownian motion, 0..1-ish (sum of octaves, normalized). */
export function fbm(x: number, z: number, octaves = 4): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * freq, z * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.02;
  }
  return sum / norm;
}

export function bell(t: number): number {
  return Math.exp(-(t * t));
}

/** Reflect a vector across the given normal. */
export function reflectVector(ax: number, ay: number, az: number, nx: number, ny: number, nz: number): { x: number; y: number; z: number } {
  const d = ax * nx + ay * ny + az * nz;
  return { x: ax - 2 * d * nx, y: ay - 2 * d * ny, z: az - 2 * d * nz };
}