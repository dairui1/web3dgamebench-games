/** Deterministic PRNG so the relay field is identical for every run. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, maxExclusive: number): number {
    return Math.floor(this.range(min, maxExclusive));
  }

  /** Uniform float in [-amount, amount]. */
  spread(amount: number): number {
    return (this.next() * 2 - 1) * amount;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length)];
  }
}

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Frame-rate independent smoothing factor for exponential approach. */
export const approach = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
