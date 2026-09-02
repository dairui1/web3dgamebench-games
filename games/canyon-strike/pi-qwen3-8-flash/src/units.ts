// Canyon Strike - low-poly meshes for units, turrets and base structures.
import * as THREE from 'three';
import { GB, COL } from './meshes';
import { hash2 } from './rng';

export type UnitKind = 'worker' | 'ranger' | 'gunner' | 'stalker' | 'bully' | 'spitter' | 'boss';
export type BuildKind = 'townhall' | 'outpost' | 'refinery' | 'lab' | 'comms' | 'fab' | 'turret' | 'wall';

export interface UnitVisual {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry | null;
  muzzleY: number;
  muzzleF: number;
  radius: number;
  height: number;
}

function human(
  g: GB,
  o: {
    h: number;
    bulk: number;
    torso: number;
    limb: number;
    head: number;
    lean?: number;
    hat?: number;
    hatType?: 'brim' | 'cap' | 'none';
    weapon?: 'rifle' | 'cannon' | 'tool' | 'none';
    legs?: number;
    hunch?: number;
  },
): void {
  const s = o.h / 1.8;
  const bw = 0.52 * s * o.bulk;
  const bd = 0.3 * s * o.bulk;
  const legH = 0.78 * s * (o.hunch === undefined ? 1 : 0.86);
  const legN = o.legs ?? 2;
  for (let i = 0; i < legN; i++) {
    const a = legN === 2 ? (i === 0 ? -1 : 1) : 0;
    const px = a * bw * 0.42 + (legN === 3 ? (i - 1) * bw * 0.4 : 0);
    g.box(px, legH / 2, 0, bw * 0.4, legH, bd * 0.9, o.limb, 0, i === 1 ? 0.08 : 0);
    g.box(px, 0.07, bd * 0.28, bw * 0.46, 0.14, bd * 1.5, COL.woodDk);
  }
  const torsoY = legH + 0.02;
  const torsoH = 0.72 * s;
  g.box(0, torsoY + torsoH / 2, (o.hunch ?? 0) * 0.1 * s, bw, torsoH, bd, o.torso, 0, o.hunch ?? 0);
  // shoulders + arms
  const shY = torsoY + torsoH * 0.86;
  for (const a of [-1, 1]) {
    g.box(a * (bw * 0.62), shY, 0, bw * 0.3, torsoH * 0.72, bd * 0.8, o.limb, 0, a * 0.16 + (o.hunch ?? 0) * 0.5);
    if (o.weapon === 'rifle') {
      g.box(a * (bw * 0.5), shY - torsoH * 0.28, bd * 1.1, bw * 0.22, bw * 0.22, bd * 0.9, o.limb);
    }
  }
  const headY = torsoY + torsoH + 0.13 * s;
  g.box(0, headY, (o.hunch ?? 0) * 0.12 * s, bw * 0.62, bw * 0.62, bw * 0.62, o.head);
  if (o.hatType === 'brim') {
    g.cyl(0, headY + bw * 0.3, 0, bw * 0.85, bw * 0.7, 0.07, 9, o.hat ?? COL.hat);
    g.cyl(0, headY + bw * 0.32, 0, bw * 0.44, bw * 0.4, 0.24, 8, o.hat ?? COL.hat);
  } else if (o.hatType === 'cap') {
    g.cyl(0, headY + bw * 0.28, 0, bw * 0.7, bw * 0.5, 0.2, 8, o.hat ?? COL.paintYellow);
    g.box(0, headY + bw * 0.3, bd * 0.55, bw * 0.8, 0.08, bd * 0.9, o.hat ?? COL.paintYellow);
  }
  if (o.weapon === 'rifle') {
    g.tube([bw * 0.2, shY - torsoH * 0.1, bd * 0.9], [bw * 0.2, shY - torsoH * 0.02, bd * 0.9 + 1.05 * s], 0.045 * s, 4, COL.metalDk);
    g.box(bw * 0.2, shY - torsoH * 0.16, bd * 0.6, bw * 0.2, bw * 0.3, bd * 0.7, COL.woodDk);
  } else if (o.weapon === 'cannon') {
    g.cyl(0, shY - torsoH * 0.05, bd * 0.8, 0.11 * s, 0.13 * s, 1.25 * s, 7, COL.metalDk, 1.5708, 'z');
    g.cyl(0, shY - torsoH * 0.05, bd * 0.8 + 1.2 * s, 0.16 * s, 0.16 * s, 0.2 * s, 7, COL.metal, 1.5708, 'z');
    g.box(-bw * 0.5, shY, 0, bw * 0.5, bw * 0.5, bd * 1.2, COL.tank);
  } else if (o.weapon === 'tool') {
    g.tube([-bw * 0.6, shY - torsoH * 0.1, bd * 0.4], [-bw * 0.6, legH - 0.1, bd * 1.4], 0.05, 4, COL.wood);
    g.box(-bw * 0.6, legH - 0.16, bd * 1.55, 0.22, 0.14, 0.34, COL.metal);
  }
}

function claws(g: GB, y: number, z: number, c: number, n = 3): void {
  for (let i = 0; i < n; i++) {
    const a = ((i - (n - 1) / 2) / n) * 1.2;
    g.cyl(Math.sin(a) * 0.22, y, z + 0.1, 0.07, 0.02, 0.42, 4, c, 0, 'z');
    const gg = g;
    gg.box(Math.sin(a) * 0.22, y - 0.2, z + 0.28, 0.09, 0.1, 0.34, c, a * 0.4, 1.1);
  }
}

/** Build the geometry for one unit archetype. */
export function unitVisual(kind: UnitKind): UnitVisual {
  const g = new GB();
  const gl = new GB();
  let muzzleY = 1.2;
  let muzzleF = 0.5;
  let radius = 0.5;
  let height = 1.8;
  switch (kind) {
    case 'worker':
      human(g, { h: 1.75, bulk: 1.05, torso: COL.pants, limb: COL.pants, head: COL.skin, hatType: 'cap', hat: COL.paintYellow, weapon: 'tool' });
      g.box(0, 1.15, -0.32, 0.42, 0.5, 0.26, COL.wood); // pack
      muzzleY = 1.25;
      muzzleF = 0.4;
      break;
    case 'ranger':
      human(g, { h: 1.82, bulk: 0.92, torso: COL.jacket, limb: 0x3d4a30, head: COL.skin, hatType: 'brim', hat: 0x6b5b3c, weapon: 'rifle' });
      g.box(0, 1.2, -0.3, 0.34, 0.44, 0.2, COL.clothDk);
      muzzleY = 1.34;
      muzzleF = 1.15;
      break;
    case 'gunner':
      human(g, { h: 1.86, bulk: 1.35, torso: COL.tank, limb: 0x4a5340, head: COL.skin, hatType: 'cap', hat: COL.metalDk, weapon: 'cannon' });
      g.box(0, 1.45, -0.36, 0.7, 0.55, 0.3, COL.metalDk); // ammo drum
      muzzleY = 1.42;
      muzzleF = 1.5;
      break;
    case 'stalker': {
      human(g, { h: 1.95, bulk: 0.8, torso: COL.enemyA, limb: 0x40282e, head: 0xb9a79a, hunch: 0.5, legs: 2 });
      // elongated arms and claws
      g.box(-0.55, 1.1, 0.28, 0.16, 1.05, 0.16, COL.enemyA, 0, 0.5);
      g.box(0.55, 1.1, 0.28, 0.16, 1.05, 0.16, COL.enemyA, 0, 0.5);
      claws(g, 0.62, 0.9, 0xd8cfc2, 3);
      g.box(0, 1.66, 0.34, 0.3, 0.12, 0.2, 0x2a1c20); // jaw
      for (const sx of [-1, 1]) gl.box(sx * 0.11, 1.72, 0.42, 0.09, 0.06, 0.05, 0xff6a3c);
      muzzleY = 1.5;
      muzzleF = 0.6;
      radius = 0.55;
      break;
    }
    case 'bully': {
      human(g, { h: 2.3, bulk: 1.9, torso: COL.enemyB, limb: 0x3a2a2e, head: 0x9d8d84, hunch: 0.25 });
      g.box(0, 1.95, 0, 1.5, 0.35, 0.9, 0x5a4a44); // slab shoulders
      g.box(0.75, 1.25, 0.3, 0.3, 1.3, 0.3, COL.enemyB, 0, -0.2);
      g.box(-0.75, 1.25, 0.3, 0.3, 1.3, 0.3, COL.enemyB, 0, 0.2);
      for (let i = 0; i < 4; i++) g.box(-0.4 + i * 0.26, 2.16, 0.1, 0.16, 0.4, 0.16, COL.metalDk, hash2(i, 3) * 0.6);
      for (const sx of [-1, 1]) gl.box(sx * 0.2, 1.92, 0.42, 0.14, 0.08, 0.06, 0xffd166);
      muzzleY = 1.9;
      muzzleF = 0.9;
      radius = 0.85;
      height = 2.3;
      break;
    }
    case 'spitter': {
      human(g, { h: 1.9, bulk: 1.0, torso: 0x46573c, limb: 0x36432c, head: 0xa8b58f, hunch: 0.7 });
      g.cyl(0, 1.35, -0.42, 0.42, 0.3, 0.85, 7, 0x6f8a4a); // bile sac
      for (let i = 0; i < 5; i++) gl.cyl(Math.cos(i) * 0.3, 1.5, -0.42 + Math.sin(i) * 0.25, 0.07, 0.05, 0.16, 5, COL.enemyGlow);
      g.box(0, 1.5, 0.36, 0.26, 0.2, 0.24, 0x2f3a26);
      muzzleY = 1.55;
      muzzleF = 0.7;
      break;
    }
    case 'boss': {
      human(g, { h: 3.4, bulk: 2.3, torso: COL.boss, limb: 0x2a1616, head: 0x8f7b72, hunch: 0.15 });
      g.box(0, 2.9, 0, 2.3, 0.5, 1.25, 0x4a2a2a);
      g.cyl(0, 3.35, 0, 0.9, 0.6, 0.5, 8, COL.metalDk);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU;
        g.tube([Math.cos(a) * 0.7, 3.4, Math.sin(a) * 0.7], [Math.cos(a) * 1.05, 4.1 + hash2(i, 2) * 0.5, Math.sin(a) * 1.05], 0.07, 4, COL.rust);
      }
      g.box(1.35, 1.9, 0.2, 0.4, 1.7, 0.4, COL.boss, 0, -0.3);
      g.box(-1.35, 1.9, 0.2, 0.4, 1.7, 0.4, COL.boss, 0, 0.3);
      claws(g, 1.0, 1.0, 0xe0d6c6, 4);
      for (const sx of [-1, 1]) gl.box(sx * 0.28, 2.72, 0.62, 0.2, 0.1, 0.08, 0xff3b1f);
      gl.box(0, 2.35, 0.66, 0.7, 0.12, 0.1, 0xff5a2a);
      muzzleY = 2.7;
      muzzleF = 1.3;
      radius = 1.3;
      height = 3.6;
      break;
    }
    default:
      break;
  }
  return {
    body: g.geom(),
    glow: gl.pos.length ? gl.geom() : null,
    muzzleY,
    muzzleF,
    radius,
    height,
  };
}

const TAU = Math.PI * 2;

/** Structures: solid body + emissive glow layer, plus turret head when relevant. */
export interface BuildVisual {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  head: THREE.BufferGeometry | null;
  headGlow: THREE.BufferGeometry | null;
  radius: number;
  height: number;
  muzzle: [number, number, number];
}

export function buildVisual(kind: BuildKind): BuildVisual {
  const g = new GB();
  const gl = new GB();
  let head: GB | null = null;
  let headGlow: GB | null = null;
  let radius = 8;
  let height = 8;
  let muzzle: [number, number, number] = [0, 4, 0];
  switch (kind) {
    case 'townhall': {
      g.box(0, 3.2, 0, 18, 6.4, 12, COL.paintWhite);
      g.box(0, 7.4, 0, 19.4, 1, 13.4, COL.concreteDk);
      g.box(-4.5, 10, 0, 4.6, 6, 4.6, COL.paintWhite);
      g.roof(-4.5, 13, 0, 5.6, 2.4, 5.6, COL.paintRed);
      g.cyl(-4.5, 11.6, 0, 1.5, 1.5, 0.5, 10, COL.concreteDk, 0, 'z');
      gl.cyl(-4.5, 11.6, 0, 1.2, 1.2, 0.6, 10, 0xf3e6b0, 0, 'z');
      g.box(0, 2.2, 6.4, 12, 3.4, 0.5, COL.glass);
      gl.box(0, 2.4, 6.6, 11, 2.6, 0.4, COL.glassLit);
      g.box(0, 0.4, 8.2, 9, 0.8, 3.4, COL.concreteDk);
      for (let i = -2; i <= 2; i++) g.box(i * 2.2, 2.4, 9.4, 0.7, 4, 0.7, COL.paintWhite);
      g.roof(0, 4.4, 9.4, 12, 1.6, 4, COL.paintGreen);
      g.box(6.5, 8.6, 0, 7, 2.4, 6, COL.concreteDk);
      gl.box(6.5, 8.6, 3.1, 5.6, 1.2, 0.3, 0xffd98a);
      g.box(0, 1.2, -6.6, 8, 2.4, 1, COL.metalDk); // generator block
      radius = 11;
      height = 14;
      muzzle[1] = 6;
      break;
    }
    case 'outpost': {
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 2; j++) {
          const px = -6 + i * 6;
          const pz = -5 + j * 7;
          g.box(px, 1.5, pz, 5.2, 0.18, 3.2, 0x2a3a52, 0, -0.42);
          g.box(px, 0.6, pz + 1.2, 0.2, 1.4, 0.2, COL.metalDk);
          g.box(px, 0.5, pz - 1.2, 0.2, 1.2, 0.2, COL.metalDk);
        }
      }
      g.box(7, 1.6, 0, 5, 3.2, 4.4, COL.concreteDk);
      gl.box(7, 1.8, 2.3, 2.4, 1.2, 0.3, COL.glassLit);
      g.box(7, 3.9, 0, 5.4, 0.5, 4.8, COL.paintWhite);
      g.box(-2, 1.1, 7, 4, 2.2, 3, COL.rust);
      g.tube([9, 3.6, 0], [9, 9, 0], 0.12, 4, COL.metalDk);
      gl.box(9, 9.2, 0, 0.4, 0.4, 0.4, 0x66e0ff);
      radius = 9;
      height = 9;
      break;
    }
    case 'refinery': {
      g.box(0, 3, 0, 14, 6, 9, COL.concreteDk);
      g.box(0, 6.3, 0, 15, 0.8, 10, COL.metal);
      g.cyl(-5, 6.7, -3, 2.6, 2.6, 7, 12, COL.paintWhite);
      g.cyl(-5, 13.7, -3, 2.6, 0.6, 1.6, 12, COL.rust);
      g.cyl(4.5, 6.7, 3.5, 2.1, 2.1, 5.5, 12, COL.paintWhite);
      g.cyl(4.5, 12.2, 3.5, 2.1, 0.5, 1.3, 12, COL.rust);
      g.tube([-5, 15.3, -3], [-5, 20, -3], 0.5, 7, COL.metalDk);
      g.tube([-5, 10, 0], [4.5, 10, 3.5], 0.4, 6, COL.rust);
      g.tube([0, 6, 4.6], [7, 6, 4.6], 0.35, 6, COL.metal);
      for (let i = 0; i < 5; i++) g.box(-6 + i * 3, 3, 4.7, 2, 3.4, 0.4, COL.glass);
      gl.box(-6, 3.4, 4.9, 1.6, 2, 0.3, COL.glassLit);
      gl.box(0, 3.4, 4.9, 1.6, 2, 0.3, COL.glassLit);
      gl.box(6, 3.4, 4.9, 1.6, 2, 0.3, COL.glassLit);
      g.box(8, 0.6, -5, 6, 1.2, 6, COL.concrete); // intake basin
      radius = 10;
      height = 20;
      muzzle[1] = 7;
      break;
    }
    case 'lab': {
      g.box(0, 1.6, 0, 13, 3.2, 10, COL.concreteDk);
      g.box(0, 3.6, 0, 14, 1, 11, COL.concrete);
      g.cyl(0, 4.1, -1, 4.2, 3.4, 3.4, 10, COL.paintWhite);
      gl.box(0, 4.6, 2.5, 6, 1.2, 0.4, 0x8fd8e8);
      for (let i = -1; i <= 1; i++) {
        g.tube([i * 4, 7.5, -1], [i * 4 + 2, 12, -1], 0.1, 4, COL.metalDk);
      }
      g.cyl(0, 8.2, -1, 3.2, 3.2, 0.3, 12, COL.metal, 0, 'y');
      gl.cyl(0, 8.6, -1, 0.5, 0.5, 1.2, 6, 0x7be0ff);
      g.box(6, 5.4, 4, 3, 3, 3, COL.metalDk);
      radius = 8;
      height = 12;
      break;
    }
    case 'comms': {
      g.box(0, 1.2, 0, 6, 2.4, 5, COL.concreteDk);
      gl.box(0, 1.4, 2.6, 3.4, 1.1, 0.3, COL.glassLit);
      for (let i = 0; i < 3; i++) {
        const px = -7 + i * 7;
        const pz = -4 + (i % 2) * 7;
        const rot = i * 0.4 - 0.4;
        g.tube([px, 0, pz], [px, 6.5, pz], 0.28, 5, COL.metalDk);
        const tilt = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.5, 0, rot));
        tilt.multiply(new THREE.Matrix4().makeTranslation(px, 6.8, pz));
        const dish = new GB();
        dish.cyl(0, 0, 0, 2.4, 2.4, 0.35, 10, COL.paintWhite, 0, 'y');
        dish.cyl(0, 0.3, 0, 2.2, 0.4, 1.1, 10, 0xc8ccc6, 0, 'y');
        dish.box(0, 1.5, 0, 0.2, 1.4, 0.2, COL.metalDk);
        dish.transform(tilt);
        g.merge(dish);
        const beacon = new GB();
        beacon.cyl(0, 2.2, 0, 0.16, 0.16, 0.32, 6, 0xff5f4a);
        beacon.transform(tilt);
        gl.merge(beacon);
      }
      g.box(0, 9, 0, 0.5, 12, 0.5, COL.metalDk);
      radius = 9;
      height = 20;
      break;
    }
    case 'fab': {
      g.box(0, 3, 0, 15, 6, 11, COL.metalDk);
      g.box(0, 6.4, 0, 16, 1, 12, COL.rust);
      for (let i = -1; i <= 1; i++) {
        g.box(i * 4.6, 2.6, 5.6, 3.6, 5.2, 0.4, 0x5b5f66);
        for (let r = 0; r < 4; r++) g.box(i * 4.6, 0.9 + r * 1.2, 5.8, 3.6, 0.16, 0.2, COL.metal);
      }
      g.box(-6.5, 8.6, -3, 1.6, 4, 1.6, COL.rust);
      g.tube([5, 6.9, 0], [11, 10.5, 0], 0.35, 5, COL.metalDk);
      gl.box(0, 5.4, 5.9, 12, 0.5, 0.3, 0xffa24a);
      radius = 9;
      height = 11;
      break;
    }
    case 'turret': {
      g.cyl(0, 0, 0, 2.4, 2.6, 0.7, 10, COL.concreteDk);
      g.cyl(0, 0.7, 0, 1.1, 1.3, 1.6, 8, COL.metalDk);
      head = new GB();
      headGlow = new GB();
      head.box(0, 0, 0, 1.7, 1.1, 1.9, COL.metal);
      head.cyl(0, 0.15, 1.5, 0.19, 0.23, 1.8, 7, COL.metalDk, 1.5708, 'z');
      head.box(0, 0.75, -0.4, 1.9, 0.5, 1.4, COL.metalDk);
      headGlow.box(0, 0.2, -1.0, 0.5, 0.3, 0.2, 0x74f0ff);
      muzzle = [0, 1.9, 2.6];
      radius = 3;
      height = 3.4;
      break;
    }
    case 'wall': {
      g.box(0, 1, 0, 6, 2, 1.2, COL.concreteDk);
      g.box(0, 2.2, 0, 6.4, 0.4, 1.6, COL.concrete);
      radius = 3;
      height = 2.4;
      break;
    }
    default:
      break;
  }
  return { body: g.geom(), glow: gl.geom(), head: head ? head.geom() : null, headGlow: headGlow ? headGlow.geom() : null, radius, height, muzzle };
}

/** A simple flat ring used for selection / rally / capture radius. */
export function ringGeo(r: number, w = 0.35, color = 0xffffff, segs = 48): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * TAU;
    const a1 = ((i + 1) / segs) * TAU;
    const ri = r - w;
    pos.push(Math.cos(a0) * ri, 0, Math.sin(a0) * ri, Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a1) * r, 0, Math.sin(a1) * r);
    pos.push(Math.cos(a0) * ri, 0, Math.sin(a0) * ri, Math.cos(a1) * r, 0, Math.sin(a1) * r, Math.cos(a1) * ri, 0, Math.sin(a1) * ri);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Filled translucent disc for AoE indicators (napalm, capture radius). */
export function discGeo(r: number, segs = 40): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * TAU;
    const a1 = ((i + 1) / segs) * TAU;
    pos.push(0, 0, 0, Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a1) * r, 0, Math.sin(a1) * r);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
