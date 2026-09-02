// Visual effects: explosions, debris, smoke, tracers, sparks, flares.

import * as THREE from 'three';
import { makeGlowTexture, makeDustTexture } from './models';
import { rand, clamp } from './math';

const MAX_SPRITES = 700;

interface PoolItem {
  spr: THREE.Sprite;
  mat: THREE.SpriteMaterial | null;
  life: number;
  maxLife: number;
  baseOpacity: number;
  grow: number;
  baseScale: number;
  vel: THREE.Vector3;
  drag: number;
}

class SpritePool {
  tex: THREE.Texture;
  mat: THREE.SpriteMaterial;
  items: PoolItem[] = [];
  scene: THREE.Scene;

  constructor(scene: THREE.Scene, opts: { color?: number; tex?: THREE.Texture; additive?: boolean; opacity?: number }) {
    this.scene = scene;
    this.tex = opts.tex ?? makeGlowTexture();
    this.mat = new THREE.SpriteMaterial({
      map: this.tex,
      color: opts.color ?? 0xffffff,
      transparent: true,
      depthWrite: false,
      opacity: opts.opacity ?? 1,
      blending: opts.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    for (let i = 0; i < MAX_SPRITES; i++) {
      const spr = new THREE.Sprite(this.mat);
      spr.visible = false;
      this.items.push({ spr, mat: null, life: 0, maxLife: 1, baseOpacity: 1, grow: 0, baseScale: 1, vel: new THREE.Vector3(), drag: 0 });
      scene.add(spr);
    }
  }

  spawn(pos: THREE.Vector3, scale: number, life: number, opts?: { grow?: number; vel?: THREE.Vector3; drag?: number; color?: number; opacity?: number; minScale?: number }): void {
    let it: PoolItem | null = null;
    for (const item of this.items) {
      if (item.life <= 0) {
        it = item;
        break;
      }
    }
    if (!it) {
      // pool full — recycle the longest-lived one (rare)
      it = this.items[0];
      for (const item of this.items) if (item.life < it.life) it = item;
    }
    if (!it.mat) {
      it.mat = this.mat.clone();
    }
    it.spr.material = it.mat;
    it.spr.position.copy(pos);
    it.spr.scale.set(scale, scale, 1);
    it.baseScale = scale;
    it.life = it.maxLife = life;
    it.baseOpacity = opts?.opacity ?? 1;
    it.grow = (opts?.grow ?? 1.4) / life;
    it.vel.copy(opts?.vel ?? new THREE.Vector3());
    it.drag = opts?.drag ?? 1;
    it.spr.visible = true;
    if (opts?.color !== undefined) it.mat.color.setHex(opts.color);
  }

  update(dt: number): void {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      const t = clamp(1 - it.life / it.maxLife, 0, 1);
      it.spr.position.addScaledVector(it.vel, dt);
      it.vel.multiplyScalar(Math.exp(-dt * it.drag));
      const s = it.baseScale * (1 + it.grow * it.maxLife * t);
      it.spr.scale.set(s, s, 1);
      if (it.mat) it.mat.opacity = (1 - t) * it.baseOpacity;
      if (it.life <= 0) it.spr.visible = false;
    }
  }
}

export class Effects {
  private scene: THREE.Scene;
  fire: SpritePool;
  smoke: SpritePool;
  glow: SpritePool;
  trail: SpritePool;
  spark: SpritePool;
  private debris: { obj: THREE.Object3D; vel: THREE.Vector3; life: number; rot: THREE.Vector3 }[] = [];
  private debrisGeo = new THREE.TetrahedronGeometry(0.9);
  private debrisMats = [new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.8 }), new THREE.MeshStandardMaterial({ color: 0xb0432f, roughness: 0.7 })];
  private light: THREE.PointLight | null = null;
  near: THREE.Vector3 = new THREE.Vector3(); // nearest active explosion (for feedback)

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.fire = new SpritePool(scene, { color: 0xffc453, additive: true });
    this.smoke = new SpritePool(scene, { color: 0x8a8a92, additive: false, opacity: 0.55, tex: makeDustTexture() });
    this.glow = new SpritePool(scene, { color: 0xffffff, additive: true });
    this.trail = new SpritePool(scene, { color: 0xcccccc, additive: false, opacity: 0.4, tex: makeDustTexture() });
    this.spark = new SpritePool(scene, { color: 0xffddaa, additive: true });
  }

  explosion(pos: THREE.Vector3, big: boolean): void {
    const p = pos;
    this.near.copy(p);
    this.fire.spawn(p, big ? 10 : 5, big ? 0.65 : 0.45, { grow: big ? 3.4 : 2.2 });
    this.glow.spawn(p, big ? 18 : 10, 0.3, { grow: 2 });
    this.glow.spawn(p, big ? 40 : 20, 0.16, { grow: 1, color: 0xffe9b0 });
    this.fire.spawn(p.clone().add(this.randVec(14)), 6, 0.5, { grow: 2.6, color: 0xff6a2a });
    this.fire.spawn(p.clone().add(this.randVec(10)), 4, 0.4, { grow: 3, color: 0xff8c3c });
    const nSmoke = big ? 7 : 4;
    for (let i = 0; i < nSmoke; i++) {
      const sp = p.clone().add(this.randVec(15));
      const sv = this.randVec(big ? 22 : 13);
      sv.y += 8;
      this.smoke.spawn(sp, rand(6, 13), rand(1.6, 2.6), { grow: 2.2, vel: sv, drag: 0.5 });
    }
    // Debris
    const n = big ? 14 : 7;
    for (let i = 0; i < n; i++) {
      const obj = new THREE.Mesh(this.debrisGeo, this.debrisMats[i % 2]);
      obj.position.copy(p).add(this.randVec(3));
      obj.scale.setScalar(rand(0.5, 1.8));
      const vel = this.randVec(big ? 60 : 30);
      vel.y += rand(10, 30);
      this.debris.push({ obj, vel, life: rand(1.4, 2.6), rot: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)) });
      this.scene.add(obj);
    }
    // Flash light
    if (!this.light) {
      this.light = new THREE.PointLight(0xffa050, 0, 260, 1.8);
      this.scene.add(this.light);
    }
    this.light.position.copy(p);
    this.light.intensity = big ? 5 : 2.5;
  }

  sparks(pos: THREE.Vector3, count: number): void {
    for (let i = 0; i < count; i++) {
      const sp = pos.clone().add(this.randVec(1.2));
      this.spark.spawn(sp, rand(0.8, 1.6), rand(0.12, 0.25), { vel: this.randVec(16), drag: 3 });
    }
  }

  trailPuff(pos: THREE.Vector3): void {
    this.trail.spawn(pos, rand(1.6, 2.6), rand(0.5, 1.0), { grow: 1.8 });
  }

  flarePuff(pos: THREE.Vector3): void {
    this.fire.spawn(pos, 1.2, 0.25, { grow: 1.5, color: 0xff7030 });
    this.smoke.spawn(pos, 2.5, 1.0, { grow: 1.6 });
  }

  damageSmoke(pos: THREE.Vector3, vel: THREE.Vector3): void {
    this.smoke.spawn(pos, rand(2.2, 3.6), rand(0.9, 1.5), { grow: 2, vel: vel.clone().multiplyScalar(0.4), drag: 1.2 });
    this.fire.spawn(pos, rand(1, 1.8), 0.22, { grow: 1.6, color: 0xff8a3c, opacity: 0.8 });
  }

  /** Muzzle flash soft pulse */
  muzzle(pos: THREE.Vector3): void {
    this.glow.spawn(pos, 3.2, 0.09, { grow: 1, color: 0xffe0a0, opacity: 0.9 });
  }

  update(dt: number): void {
    this.fire.update(dt);
    this.smoke.update(dt);
    this.glow.update(dt);
    this.trail.update(dt);
    this.spark.update(dt);
    if (this.light) this.light.intensity = Math.max(0, this.light.intensity - dt * 18);
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.obj.position.addScaledVector(d.vel, dt);
      d.vel.y -= 22 * dt;
      d.obj.rotation.x += d.rot.x * dt;
      d.obj.rotation.y += d.rot.y * dt;
      if (d.life <= 0) {
        this.scene.remove(d.obj);
        this.debris.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const d of this.debris) this.scene.remove(d.obj);
    this.debris = [];
    for (const pool of [this.fire, this.smoke, this.glow, this.trail, this.spark]) {
      for (const it of pool.items) {
        it.life = 0;
        it.spr.visible = false;
      }
    }
  }

  private randVec(mag: number): THREE.Vector3 {
    return new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(mag);
  }
}

export function makeTracerObject(): THREE.Mesh {
  const geo = new THREE.BoxGeometry(0.09, 0.09, 14);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  return new THREE.Mesh(geo, mat);
}

export function makeMissileObject(): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.1, 7), new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.4 }));
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 7), new THREE.MeshStandardMaterial({ color: 0xb0432f, roughness: 0.5 }));
  nose.rotation.x = Math.PI / 2;
  nose.position.z = -0.68;
  g.add(nose);
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.55, 6),
    new THREE.MeshBasicMaterial({ color: 0x9fdcff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 })
  );
  flame.rotation.x = -Math.PI / 2;
  flame.position.z = 0.72;
  g.add(flame);
  return g;
}

export function makeMortarShellObject(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 7, 5),
    new THREE.MeshStandardMaterial({ color: 0x2f2a24, roughness: 0.8 })
  );
}