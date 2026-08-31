import * as THREE from 'three';

/** Procedural canvas textures — no external assets. */

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

let puffTex: THREE.Texture | null = null;
/** Soft radial cloud/particle puff (white, tintable). */
export function getPuffTexture(): THREE.Texture {
  if (puffTex) return puffTex;
  const [c, ctx] = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.42)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  puffTex = toTexture(c);
  return puffTex;
}

let glowTex: THREE.Texture | null = null;
/** Hard-ish core glow for engine / pickups. */
export function getGlowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const [c, ctx] = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.28, 'rgba(255,255,255,0.65)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowTex = toTexture(c);
  return glowTex;
}

let streakTex: THREE.Texture | null = null;
/** Vertical soft streak for beacon columns. */
export function getStreakTexture(): THREE.Texture {
  if (streakTex) return streakTex;
  const [c, ctx] = makeCanvas(64, 256);
  const gx = ctx.createLinearGradient(0, 0, 64, 0);
  gx.addColorStop(0, 'rgba(255,255,255,0)');
  gx.addColorStop(0.5, 'rgba(255,255,255,0.8)');
  gx.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gx;
  ctx.fillRect(0, 0, 64, 256);
  const gy = ctx.createLinearGradient(0, 0, 0, 256);
  gy.addColorStop(0, 'rgba(0,0,0,1)');
  gy.addColorStop(0.25, 'rgba(0,0,0,0)');
  gy.addColorStop(0.8, 'rgba(0,0,0,0)');
  gy.addColorStop(1, 'rgba(0,0,0,0.9)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = gy;
  ctx.fillRect(0, 0, 64, 256);
  streakTex = toTexture(c);
  return streakTex;
}

const labelCache = new Map<string, THREE.Texture>();

/** Crisp text label on transparent background. */
export function getLabelTexture(text: string, color = '#bfefff', sub?: string): THREE.Texture {
  const key = `${text}|${color}|${sub ?? ''}`;
  const cached = labelCache.get(key);
  if (cached) return cached;

  const W = 512;
  const H = sub ? 224 : 160;
  const [c, ctx] = makeCanvas(W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 26;
  ctx.fillStyle = color;
  ctx.font = '700 72px system-ui, sans-serif';
  ctx.fillText(text, W / 2, sub ? 78 : 80);
  ctx.shadowBlur = 0;
  if (sub) {
    ctx.fillStyle = 'rgba(235,250,255,0.85)';
    ctx.font = '600 40px system-ui, sans-serif';
    ctx.fillText(sub, W / 2, 164);
  }
  const tex = toTexture(c);
  labelCache.set(key, tex);
  return tex;
}

/** Floating world-space label. */
export function makeLabel(
  text: string,
  color: string,
  widthWorld: number,
  sub?: string,
): THREE.Sprite {
  const tex = getLabelTexture(text, color, sub);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const sprite = new THREE.Sprite(mat);
  const aspect = sub ? 512 / 224 : 512 / 160;
  sprite.scale.set(widthWorld, widthWorld / aspect, 1);
  sprite.renderOrder = 5;
  return sprite;
}
