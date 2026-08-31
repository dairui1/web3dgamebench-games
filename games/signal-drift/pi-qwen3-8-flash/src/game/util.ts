import * as THREE from 'three';

/** Deterministic PRNG (mulberry32) so every run of the field is identical. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private gen: () => number;

  constructor(seed: number) {
    this.gen = mulberry32(seed);
  }

  float(min = 0, max = 1): number {
    return min + (max - min) * this.gen();
  }

  /** Inclusive integer range. */
  int(min: number, max: number): number {
    return Math.min(max, Math.floor(this.float(min, max + 0.999999)));
  }

  sign(): number {
    return this.gen() < 0.5 ? -1 : 1;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(this.gen() * items.length))];
  }

  /** Random unit vector on a sphere. */
  direction(out = new THREE.Vector3()): THREE.Vector3 {
    const u = this.gen() * 2 - 1;
    const theta = this.gen() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - u * u));
    return out.set(r * Math.cos(theta), u, r * Math.sin(theta));
  }
}

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Frame-rate independent exponential approach. */
export const damp = (a: number, b: number, lambda: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Shortest signed angle delta. */
export const angleDelta = (from: number, to: number): number => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** Squared distance from point p to segment ab. */
export const distanceToSegmentSq = (
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  closest?: THREE.Vector3,
): number => {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const apz = p.z - a.z;
  const denom = abx * abx + aby * aby + abz * abz;
  let t = denom > 1e-6 ? (apx * abx + apy * aby + apz * abz) / denom : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = a.x + abx * t;
  const cy = a.y + aby * t;
  const cz = a.z + abz * t;
  if (closest) closest.set(cx, cy, cz);
  const dx = p.x - cx;
  const dy = p.y - cy;
  const dz = p.z - cz;
  return dx * dx + dy * dy + dz * dz;
};

/* ------------------------------------------------------------------ */
/* Procedural textures (generated in-page, nothing fetched)            */
/* ------------------------------------------------------------------ */

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return { canvas, ctx };
}

/** Tileable value noise lattice. */
function lattice(size: number, rng: Rng): Float32Array {
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i += 1) out[i] = rng.float(0, 1);
  return out;
}

function sampleLattice(grid: Float32Array, size: number, x: number, y: number): number {
  const fx = x * size;
  const fy = y * size;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const m = (v: number) => ((v % size) + size) % size;
  const x0 = m(ix);
  const x1 = m(ix + 1);
  const y0 = m(iy) * size;
  const y1 = m(iy + 1) * size;
  const a = grid[y0 + x0];
  const b = grid[y0 + x1];
  const c = grid[y1 + x0];
  const d = grid[y1 + x1];
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}

/**
 * Tileable fBm cloud field. Stored in a single channel texture so it can be
 * scrolled cheaply across the enormous cloud deck.
 */
export function makeCloudTexture(size = 512, octaves = 5, seed = 7): THREE.Texture {
  const { canvas, ctx } = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  const rng = new Rng(seed);
  const grids: { grid: Float32Array; size: number }[] = [];
  for (let o = 0; o < octaves; o += 1) {
    const gs = 4 << o;
    grids.push({ grid: lattice(gs, rng), size: gs });
  }
  let min = Infinity;
  let max = -Infinity;
  const raw = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      let sum = 0;
      let amp = 1;
      let norm = 0;
      for (let o = 0; o < octaves; o += 1) {
        const g = grids[o];
        sum += sampleLattice(g.grid, g.size, u, v) * amp;
        norm += amp;
        amp *= 0.52;
      }
      const val = sum / norm;
      raw[y * size + x] = val;
      if (val < min) min = val;
      if (val > max) max = val;
    }
  }
  const span = Math.max(1e-4, max - min);
  for (let i = 0; i < raw.length; i += 1) {
    let d = (raw[i] - min) / span;
    // Stretch into billowy cloud densities.
    d = Math.pow(clamp(d, 0, 1), 1.35);
    const v = Math.round(clamp(d * 255, 0, 255));
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = Math.round(clamp(d * 255 * 1.06, 0, 255));
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  return tex;
}

/** Soft round sprite used by every particle system. */
export function makeSoftSprite(size = 128, hardness = 2.4): THREE.Texture {
  const { canvas, ctx } = makeCanvas(size);
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (let i = 0; i <= 12; i += 1) {
    const t = i / 12;
    const a = Math.pow(1 - t, hardness);
    grad.addColorStop(t, `rgba(255,255,255,${a.toFixed(4)})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** Ring / donut sprite for shockwaves. */
export function makeRingSprite(size = 256): THREE.Texture {
  const { canvas, ctx } = makeCanvas(size);
  const c = size / 2;
  const grad = ctx.createRadialGradient(c, c, c * 0.55, c, c, c);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.28)');
  grad.addColorStop(0.78, 'rgba(255,255,255,1)');
  grad.addColorStop(0.92, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** Stencilled plate label for the relay gates. */
export function makeLabelTexture(lines: string[], accent: string, width = 512, height = 128): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(4,10,14,0.92)';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 6;
  ctx.globalAlpha = 0.7;
  ctx.strokeRect(3, 3, width - 6, height - 6);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    const size = i === 0 ? 54 : 30;
    ctx.font = `700 ${size}px ui-monospace, "SFMono-Regular", Menlo, monospace`;
    ctx.fillStyle = i === 0 ? accent : 'rgba(226,246,255,0.85)';
    ctx.fillText(line, width / 2, height / 2 + (i === 0 ? -height * 0.12 : height * 0.26));
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** Build a THREE.PerspectiveCamera sized for the viewport. */
export function makeCamera(aspect: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(62, aspect, 0.6, 4200);
  return cam;
}
