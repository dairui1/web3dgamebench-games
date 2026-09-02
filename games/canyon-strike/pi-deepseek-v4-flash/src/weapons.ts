// Player weapons: gatling gun (hitscan tracers) and heat-seeking missiles,
// plus countermeasure flares that decoy enemy missiles.

import * as THREE from 'three';
import { clamp } from './math';
import type { PlayerMissile, Flare, GameAPI, Target, EnemyMissile } from './types';
import { makeTracerObject, makeMissileObject } from './effects';

const GUN_RATE = 0.105; // seconds between shots
const GUN_RANGE = 950;
const GUN_DAMAGE = 6.5;
const MISSILE_SPEED = 265;
const MISSILE_TURN = 2.5;
const MISSILE_LIFE = 9;
const FLARE_LIFE = 5;

export class PlayerWeapons {
  missiles: PlayerMissile[] = [];
  flares: Flare[] = [];
  private gunTimer = 0;
  private flashTimer = 0;
  private flareCd = 0;

  constructor(private api: GameAPI) {}

  reset(): void {
    for (const m of this.missiles) {
      const obj = m.userData?.obj;
      if (obj && typeof obj === 'object' && 'position' in (obj as THREE.Object3D)) {
        this.api.scene.remove(obj as THREE.Object3D);
      }
    }
    this.missiles = [];
    for (const f of this.flares) this.api.scene.remove(f.obj);
    this.flares = [];
    this.gunTimer = 0;
    this.flareCd = 0;
  }

  update(dt: number, fireHeld: boolean, missilePressed: boolean, flarePressed: boolean): void {
    const p = this.api.player.s;
    const scene = this.api.scene;
    const canyon = this.api.canyon;
    const fx = this.api.effects;
    const audio = this.api.audio;
    const api = this.api;

    // ---- Gun ----
    const heat = p.gunHeat;
    this.gunTimer -= dt;
    this.flashTimer -= dt;
    if (fireHeld && heat < 0.96 && p.alive) {
      if (this.gunTimer <= 0) {
        this.gunTimer = GUN_RATE;
        this.fireGun();
        p.gunHeat = clamp(heat + 0.0115, 0, 1);
      }
    } else {
      p.gunHeat = clamp(heat - dt * 0.16, 0, 1);
    }
    if (heat >= 0.96 && fireHeld && this.gunTimer <= -0.5) {
      audio.gunOverheat();
      this.gunTimer = 1.4;
    }

    // ---- Missiles ----
    if (missilePressed && p.alive && p.missiles > 0) {
      const tgt = (p.target && p.target.alive ? p.target : null) as Target | null;
      if (tgt && p.lockTime >= 0.9) {
        const launchPos = p.pos.clone().addScaledVector(this.api.player.getForward(new THREE.Vector3()), 3).add(new THREE.Vector3(0, 1, 0));
        const toT = tgt.pos.clone().sub(launchPos).normalize();
        const miss: PlayerMissile = {
          pos: launchPos,
          vel: toT.multiplyScalar(MISSILE_SPEED * 0.7).add(this.api.player.s.vel.clone().multiplyScalar(0.3)),
          target: tgt,
          life: MISSILE_LIFE,
          dead: false,
          smokeAcc: 0,
        };
        this.missiles.push(miss);
        p.missiles--;
        audio.missileLaunch();
        const obj = makeMissileObject();
        moveObjectTo(obj, miss.pos, miss.vel);
        scene.add(obj);
        miss.userData = { obj };
        api.addShake(0.12);
      }
    }

    // ---- Flares ----
    this.flareCd -= dt;
    if (flarePressed && p.alive && p.flares > 0 && this.flareCd <= 0) {
      this.flareCd = 1.6;
      p.flares--;
      const fwd = this.api.player.getForward(new THREE.Vector3());
      const pos = p.pos.clone().addScaledVector(fwd, -6).add(new THREE.Vector3(0, -1, 0));
      const vel = fwd.clone().multiplyScalar(-55).add(this.api.player.s.vel.clone().multiplyScalar(0.55)).add(new THREE.Vector3(randSign() * 6, randSign() * 4, randSign() * 6));
      const spr = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: fx.fire.mat.map,
          color: 0xff7c30,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      spr.scale.set(3, 3, 1);
      spr.position.copy(pos);
      scene.add(spr);
      const flare: Flare = { obj: spr, pos: pos.clone(), vel, life: FLARE_LIFE, bright: 1 };
      this.flares.push(flare);
      audio.flare();
      fx.flarePuff(pos);
    }

    // ---- Update player missiles ----
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      if (m.dead) {
        this.removeMissileObj(m);
        this.missiles.splice(i, 1);
        continue;
      }
      m.life -= dt;
      // Homing
      if (m.target && m.target.alive) {
        // aim slightly above ground units so the missile doesn't eat dirt first
        const isGround = m.target.kind !== 'fighter';
        const aim = m.target.pos.clone();
        if (isGround) aim.y += 4;
        const toT = aim.sub(m.pos);
        const dist = toT.length();
        const desired = dist < 0.1 ? new THREE.Vector3(0, 0, -1) : toT.clone().normalize();
        const curSpeed = m.vel.length();
        const turnLimit = MISSILE_TURN * dt;
        m.vel.lerp(desired.multiplyScalar(curSpeed), clamp(turnLimit * 2.4, 0, 1));
        m.vel.setLength(Math.min(curSpeed + 900 * dt, MISSILE_SPEED));
        if (dist < 8.5) {
          this.detonate(m, i);
          continue;
        }
      } else {
        // target lost — fly straight
        m.vel.setLength(MISSILE_SPEED);
        if (m.life < MISSILE_LIFE - 1.2) {
          // give up into a glide
          m.vel.y -= 6 * dt;
        }
      }
      m.pos.addScaledVector(m.vel, dt);
      // Terrain impact
      const ground = canyon.heightAt(m.pos.x, m.pos.z);
      if (m.pos.y < ground + 1) {
        fx.sparks(m.pos, 6);
        fx.smoke.spawn(m.pos.clone(), 4, 0.8, { grow: 2 });
        m.dead = true;
        this.removeMissileObj(m);
        this.missiles.splice(i, 1);
        continue;
      }
      if (m.life <= 0) {
        m.dead = true;
        this.removeMissileObj(m);
        this.missiles.splice(i, 1);
        continue;
      }
      // Trail + orient
      m.smokeAcc -= dt;
      if (m.smokeAcc <= 0) {
        m.smokeAcc = 0.07;
        fx.trailPuff(m.pos);
      }
      const obj = m.userData?.obj as THREE.Object3D | undefined;
      if (obj) {
        obj.position.copy(m.pos);
        obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), m.vel.clone().normalize());
      }
    }

    // ---- Update flares ----
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      f.life -= dt;
      f.pos.addScaledVector(f.vel, dt);
      f.vel.multiplyScalar(Math.exp(-dt * 1.4));
      f.obj.position.copy(f.pos);
      const t = 1 - f.life / FLARE_LIFE;
      const o = (f.life > FLARE_LIFE - 1.2 ? 1 : 0.55) * clamp(1 - t * 1.1, 0, 1);
      (f.obj as THREE.Sprite).material.opacity = o;
      f.obj.scale.setScalar(1.2 + t * 1.6);
      if (f.life <= 0) {
        scene.remove(f.obj);
        this.flares.splice(i, 1);
      }
    }

    this.flashTimer = Math.max(this.flashTimer, 0);
  }

  /** Returns list of active flare positions for enemy-missile decoying. */
  flarePositions(): { x: number; y: number; z: number }[] {
    return this.flares.map((f) => ({ x: f.pos.x, y: f.pos.y, z: f.pos.z }));
  }

  private fireGun(): void {
    const p = this.api.player.s;
    const fwd = this.api.player.getForward(new THREE.Vector3());
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quatFromYPR(p.pitch, p.yaw, 0));
    up.applyQuaternion(quatFromYPR(p.pitch, p.yaw, 0));
    const muzzle = p.pos.clone().addScaledVector(fwd, 5.4).addScaledVector(right, 0.62).addScaledVector(up, 0.15);
    this.api.effects.muzzle(muzzle);

    // Visual tracer
    const obj = makeTracerObject();
    obj.position.copy(muzzle);
    const dir = fwd.clone();
    // spread
    dir.x += (Math.random() - 0.5) * 0.012;
    dir.y += (Math.random() - 0.5) * 0.012;
    dir.z += (Math.random() - 0.5) * 0.012;
    dir.normalize();
    obj.lookAt(muzzle.clone().add(dir));
    this.api.scene.add(obj);
    this.api.tracerObjs.push({ obj, life: 0.12 });

    // Hitscan
    const nearest = this.hitscan(muzzle, dir, GUN_RANGE);
    if (nearest) {
      const { t, point } = nearest;
      if (t) this.api.onTargetDamaged(t, GUN_DAMAGE, true);
      this.api.effects.sparks(point, 5);
      this.api.audio.gunImpact();
    } else {
      // Terrain impact check
      const end = muzzle.clone().addScaledVector(dir, GUN_RANGE);
      const hit = rayMarchTerrain(muzzle, dir, GUN_RANGE, this.api.canyon.heightAt.bind(this.api.canyon));
      if (hit) {
        this.api.effects.sparks(hit, 4);
        this.api.audio.gunImpact();
        // dust puff
        this.api.effects.smoke.spawn(hit.clone().add(new THREE.Vector3(0, 1.5, 0)), 2.2, 0.8, { grow: 1.6 });
      }
      void end;
    }
    this.api.audio.gun();
    this.api.addShake(0.03);
  }

  private hitscan(origin: THREE.Vector3, dir: THREE.Vector3, range: number): { t: Target | null; point: THREE.Vector3 } | null {
    // Terrain first (closest along ray)
    const terrainHit = rayMarchTerrain(origin, dir, range, this.api.canyon.heightAt.bind(this.api.canyon));
    const maxDist = terrainHit ? terrainHit.distanceTo(origin) : range;
    let best: { t: Target; point: THREE.Vector3; dist: number } | null = null;
    for (const t of this.api.targets) {
      if (!t.alive) continue;
      const rel = t.pos.clone().sub(origin);
      const along = rel.dot(dir);
      if (along < 0 || along > maxDist + 4) continue;
      const closest = origin.clone().addScaledVector(dir, along);
      const radius = t.kind === 'fighter' ? 6 : t.kind === 'sam' ? 5 : 4.2;
      const dist = closest.distanceTo(t.pos);
      if (dist < radius) {
        if (!best || along < best.dist) best = { t, point: t.pos.clone(), dist: along };
      }
    }
    if (best) return { t: best.t, point: best.point };
    return null;
  }

  private detonate(m: PlayerMissile, idx: number): void {
    const fx = this.api.effects;
    const audio = this.api.audio;
    const tgt = m.target;
    m.dead = true;
    fx.explosion(m.pos, !!(tgt && tgt.kind === 'fighter'));
    audio.explode(!!(tgt && tgt.kind === 'fighter'));
    this.api.addShake(0.4);
    if (tgt && tgt.alive && m.target === tgt) {
      this.api.onTargetDamaged(tgt, 130, true);
    }
    void idx;
  }

  private removeMissileObj(m: PlayerMissile): void {
    const obj = m.userData?.obj as THREE.Object3D | undefined;
    if (obj) this.api.scene.remove(obj);
  }
}

/** Reusable tracer registry lives on the Game; we push to api.tracerObjs. */

export function quatFromYPR(pitch: number, yaw: number, roll: number): THREE.Quaternion {
  const e = new THREE.Euler(pitch, yaw, roll, 'YXZ');
  return new THREE.Quaternion().setFromEuler(e);
}

export function rayMarchTerrain(origin: THREE.Vector3, dir: THREE.Vector3, range: number, heightAt: (x: number, z: number) => number): THREE.Vector3 | null {
  const steps = Math.ceil(range / 26);
  const p = origin.clone();
  for (let i = 0; i <= steps; i++) {
    const h = heightAt(p.x, p.z);
    if (p.y < h + 0.5) {
      return p;
    }
    p.addScaledVector(dir, 26);
  }
  return null;
}

function moveObjectTo(obj: THREE.Object3D, pos: THREE.Vector3, vel: THREE.Vector3): void {
  obj.position.copy(pos);
  obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), vel.clone().normalize());
}

function randSign(): number {
  return Math.random() < 0.5 ? -1 : 1;
}

/** Used by enemies to decoy passing missiles. */
export function tryDecoy(m: { targetIsPlayer: boolean }, flares: { x: number; y: number; z: number }[], missPos: THREE.Vector3, missVel: THREE.Vector3, outTargetPos: THREE.Vector3): boolean {
  if (!m.targetIsPlayer) return false;
  for (const f of flares) {
    const dx = f.x - missPos.x;
    const dy = f.y - missPos.y;
    const dz = f.z - missPos.z;
    if (dx * dx + dy * dy + dz * dz < 70 * 70) {
      outTargetPos.set(f.x, f.y, f.z);
      missVel.copy(outTargetPos.sub(missPos).normalize().multiplyScalar(missVel.length() * 0.92));
      return true;
    }
  }
  return false;
}

export type { EnemyMissile };