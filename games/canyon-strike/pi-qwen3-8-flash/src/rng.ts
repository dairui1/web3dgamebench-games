// Small deterministic math / noise helpers shared by every system.

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};
export const TAU = Math.PI * 2;
export const deg = (r: number): number => (r * 180) / Math.PI;
export const rad = (d: number): number => (d * Math.PI) / 180;

/** Unsigned 32 bit mixing. */
function mix32(n: number): number {
  n = Math.imul(n ^ (n >>> 15), 2246822507);
  n = Math.imul(n ^ (n >>> 13), 3266489909);
  return (n ^ (n >>> 16)) >>> 0;
}

/** Deterministic hash of an integer lattice point, 0..1. */
export function hash2(x: number, y: number): number {
  return mix32(Math.imul(x | 0, 1613) + Math.imul(y | 0, 3529) + 95748) / 4294967296;
}

export function hash1(x: number): number {
  return mix32(Math.imul(x | 0, 2246822519) + 1741) / 4294967296;
}

/** Smooth value noise on the integer lattice, 0..1. */
export function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** Fractal sum of value noise, normalised to 0..1. */
export function fbm(x: number, y: number, oct = 3): number {
  let s = 0;
  let a = 0.5;
  let n = 0;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f);
    n += a;
    a *= 0.5;
    f *= 2.07;
  }
  return s / n;
}

/** Tearable pseudo random generator (mulberry32). */
export class Rand {
  private s: number;
  constructor(seed: number) {
    this.s = (seed >>> 0) || 1;
  }
  u(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  r(a: number, b: number): number {
    return a + this.u() * (b - a);
  }
  i(a: number, b: number): number {
    return Math.floor(this.r(a, b + 1 - 1e-9));
  }
  pick<T>(arr: T[]): T {
    return arr[Math.min(arr.length - 1, Math.floor(this.u() * arr.length))];
  }
}

/** Shortest signed angular difference. */
export function angDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function approach(cur: number, target: number, rate: number): number {
  const d = target - cur;
  if (Math.abs(d) <= rate) return target;
  return cur + Math.sign(d) * rate;
}

/** Shade a packed hex colour by a multiplier. */
export function shade(c: number, m: number): number {
  const r = clamp(((c >> 16) & 255) * m, 0, 255) | 0;
  const g = clamp(((c >> 8) & 255) * m, 0, 255) | 0;
  const b = clamp((c & 255) * m, 0, 255) | 0;
  return (r << 16) | (g << 8) | b;
}

/** Mix two packed hex colours. */
export function mixc(a: number, b: number, t: number): number {
  const r = Math.round(lerp((a >> 16) & 255, (b >> 16) & 255, t));
  const g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, t));
  const bl = Math.round(lerp(a & 255, b & 255, t));
  return (r << 16) | (g << 8) | bl;
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

/** Format game clock as HH:MM within a 24h day. */
export function fmtClock(hour: number): string {
  let h = hour % 24;
  if (h < 0) h += 24;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}
