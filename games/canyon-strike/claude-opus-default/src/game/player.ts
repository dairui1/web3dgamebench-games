import * as THREE from 'three';
import { buildPlayerJet, type JetModel } from './models';
import type { Combatant, CombatContext, DamageSource, Flare } from './types';
import { makeId } from './types';
import { Bullets, Missiles } from './weapons';
import { clamp, clamp01, damp, smoothstep } from '../core/mathutil';
import { WORLD, heightAt } from '../world/terrain';
import type { Input } from '../core/input';

export const FLIGHT = {
  minSpeed: 105,
  maxSpeed: 430,
  burnerSpeed: 545,
  pitchRate: 1.45,
  rollRate: 3.0,
  yawRate: 0.5,
  gravity: 26,
  gunRate: 1 / 14,
  gunSpeed: 1150,
  gunDamage: 8,
  missileCooldown: 0.5,
  lockRange: 2900,
  lockCone: Math.cos(24 * (Math.PI / 180)),
};

export interface LockState {
  target: Combatant | null;
  progress: number;
  locked: boolean;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const VAPOUR = new THREE.Color(0xf2f6ff);

export class Player implements Combatant {
  readonly id = makeId();
  readonly kind = 'player' as const;
  readonly faction = 'player' as const;
  readonly label = 'TALON 1';
  readonly isObjective = false;
  readonly radius = 8;

  obj: THREE.Group;
  model: JetModel;
  position = new THREE.Vector3();
  velocity = new THREE.Vector3();
  quaternion = new THREE.Quaternion();

  hp = 120;
  maxHp = 120;
  alive = true;
  lockable = true;

  speed = 240;
  throttle = 0.72;
  burner = 0;
  missileAmmo = 20;
  maxMissiles = 20;
  gunAmmo = 900;
  maxGunAmmo = 900;
  flareAmmo = 8;
  maxFlares = 8;
  gunHeat = 0;
  overheated = false;
  shotsFired = 0;

  lock: LockState = { target: null, progress: 0, locked: false };
  manualTarget: Combatant | null = null;
  gunConverge = 0;

  /** Read by the HUD. */
  gLoad = 1;
  stalling = false;
  groundWarning = false;
  lastDamageTime = -99;
  crashed = false;
  crashReason = '';

  private rates = new THREE.Vector3();
  private gunTimer = 0;
  private missileTimer = 0;
  private hardpointIndex = 0;
  private gunPortIndex = 0;
  private smokeTimer = 0;
  private contrailTimer = 0;
  private lockTone = 0;
  private flareTimer = 0;
  private ctx: CombatContext;
  private bullets: Bullets;
  private missiles: Missiles;
  private flares: Flare[];

  constructor(ctx: CombatContext, bullets: Bullets, missiles: Missiles, flares: Flare[]) {
    this.ctx = ctx;
    this.bullets = bullets;
    this.missiles = missiles;
    this.flares = flares;
    this.model = buildPlayerJet();
    this.obj = this.model.group;
    ctx.scene.add(this.obj);
  }

  spawn(position: THREE.Vector3, heading: number): void {
    this.position.copy(position);
    this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.velocity.set(0, 0, 0);
    this.speed = 260;
    this.throttle = 0.75;
    this.hp = this.maxHp;
    this.alive = true;
    this.crashed = false;
    this.crashReason = '';
    this.missileAmmo = this.maxMissiles;
    this.gunAmmo = this.maxGunAmmo;
    this.flareAmmo = this.maxFlares;
    this.gunHeat = 0;
    this.overheated = false;
    this.lock = { target: null, progress: 0, locked: false };
    this.manualTarget = null;
    this.obj.position.copy(this.position);
    this.obj.quaternion.copy(this.quaternion);
    this.obj.visible = true;
  }

  get forward(): THREE.Vector3 {
    return _v1.set(0, 0, -1).applyQuaternion(this.quaternion).clone();
  }

  get speedNorm(): number {
    return clamp01((this.speed - FLIGHT.minSpeed) / (FLIGHT.burnerSpeed - FLIGHT.minSpeed));
  }

  get altitude(): number {
    return this.position.y - heightAt(this.position.x, this.position.z);
  }

  damage(amount: number, source: DamageSource, _from?: THREE.Vector3): void {
    if (!this.alive) return;
    this.hp -= amount;
    this.lastDamageTime = performance.now() / 1000;
    this.ctx.shake(clamp(amount * 0.05, 0.15, 1.4));
    this.ctx.audio.playerHit();
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.crashed = true;
      this.crashReason = source === 'crash' ? 'IMPACT WITH TERRAIN' : 'AIRCRAFT DESTROYED';
      this.ctx.effects.explosion(this.position, 2.4);
      this.ctx.effects.debris(this.position, 26, 1.6);
      this.ctx.audio.explosion(0, 1.6);
      this.obj.visible = false;
    }
  }

  update(dt: number, input: Input, enemies: Combatant[]): void {
    if (!this.alive) return;

    // --- throttle ---------------------------------------------------------
    if (input.throttleAbsolute !== null && Math.abs(input.throttleAxis) < 0.01) {
      this.throttle = damp(this.throttle, input.throttleAbsolute, 8, dt);
    } else {
      this.throttle = clamp01(this.throttle + input.throttleAxis * dt * 0.62);
    }
    const burnerTarget = smoothstep(0.86, 1, this.throttle);
    this.burner = damp(this.burner, burnerTarget, 4, dt);
    const targetSpeed =
      FLIGHT.minSpeed +
      (FLIGHT.maxSpeed - FLIGHT.minSpeed) * this.throttle +
      (FLIGHT.burnerSpeed - FLIGHT.maxSpeed) * burnerTarget;

    // --- control authority ------------------------------------------------
    const authority = clamp(this.speed / 190, 0.35, 1.2);
    const damaged = this.hp < 35 ? 0.82 : 1;
    this.stalling = this.speed < FLIGHT.minSpeed + 22;

    const pitchTarget = input.pitch * FLIGHT.pitchRate * authority * damaged;
    const rollTarget = input.roll * FLIGHT.rollRate * clamp(authority, 0.4, 1.1) * damaged;
    // Positive = nose right; converted to a local-Y rate below.
    let yawRight = input.yaw * FLIGHT.yawRate * authority;

    // Auto-coordination: a little rudder into the turn.
    const bank = Math.asin(clamp(_v2.set(1, 0, 0).applyQuaternion(this.quaternion).y, -1, 1));
    yawRight += -Math.sin(bank) * Math.abs(input.pitch) * 0.26;

    this.rates.x = damp(this.rates.x, pitchTarget, 7, dt);
    this.rates.y = damp(this.rates.y, -yawRight, 6, dt);
    this.rates.z = damp(this.rates.z, -rollTarget, 9, dt);

    // Gentle levelling assist when the stick is centred.
    if (Math.abs(input.roll) < 0.04 && Math.abs(bank) > 0.09) {
      this.rates.z -= Math.sin(bank) * 0.55;
    }

    _q1.setFromEuler(new THREE.Euler(this.rates.x * dt, this.rates.y * dt, this.rates.z * dt, 'XYZ'));
    this.quaternion.multiply(_q1).normalize();

    // --- gravity turn -----------------------------------------------------
    const fwd = _v1.set(0, 0, -1).applyQuaternion(this.quaternion);
    const down = _v2.set(0, -1, 0);
    const perp = _v3.copy(down).addScaledVector(fwd, -down.dot(fwd));
    const mag = perp.length();
    if (mag > 1e-4) {
      perp.divideScalar(mag);
      const axis = new THREE.Vector3().crossVectors(fwd, perp).normalize();
      const ang = (FLIGHT.gravity * mag) / Math.max(90, this.speed);
      _q1.setFromAxisAngle(axis, ang * dt);
      this.quaternion.premultiply(_q1).normalize();
    }

    // --- speed ------------------------------------------------------------
    const climb = fwd.y;
    const accel = targetSpeed > this.speed ? 0.85 : 1.25;
    this.speed = damp(this.speed, targetSpeed, accel, dt);
    this.speed -= climb * 78 * dt;
    this.speed = clamp(this.speed, 72, FLIGHT.burnerSpeed + 30);

    this.velocity.copy(fwd).multiplyScalar(this.speed);
    this.position.addScaledVector(this.velocity, dt);

    this.gLoad = damp(this.gLoad, 1 + Math.abs(this.rates.x) * this.speed * 0.016, 5, dt);

    this.obj.position.copy(this.position);
    this.obj.quaternion.copy(this.quaternion);

    // --- visuals ----------------------------------------------------------
    const flameScale = 0.35 + this.throttle * 0.8 + this.burner * 1.5;
    for (const b of this.model.burners) {
      b.scale.set(
        0.8 + this.burner * 0.5,
        flameScale * (0.9 + Math.random() * 0.25),
        0.8 + this.burner * 0.5
      );
      const mat = b.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.35 + this.throttle * 0.35 + this.burner * 0.3;
      mat.color.setHex(this.burner > 0.4 ? 0xffb066 : 0x74c8ff);
    }

    const severity = 1 - this.hp / this.maxHp;
    if (severity > 0.45) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.05 - severity * 0.03;
        _v2.copy(this.position).addScaledVector(fwd, -6);
        this.ctx.effects.damageSmoke(_v2, this.velocity, severity);
      }
    }

    // Wingtip vapour during hard manoeuvres.
    const load = Math.abs(this.rates.x) + Math.abs(this.rates.z) * 0.2;
    if (load > 0.8 && this.speed > 170) {
      this.contrailTimer -= dt;
      if (this.contrailTimer <= 0) {
        this.contrailTimer = 0.028;
        for (const s of [1, -1]) {
          _v2.set(s * 7.8, -0.15, -2.2).applyQuaternion(this.quaternion).add(this.position);
          this.ctx.effects.trail(_v2, VAPOUR, 1.3, 0.8, 0.3);
        }
      }
    }

    // --- ground / bounds --------------------------------------------------
    this.checkTerrain(dt);

    // --- targeting & weapons ---------------------------------------------
    this.updateLock(dt, enemies);
    this.updateWeapons(dt, input);
    this.updateFlares(dt);
  }

  private checkTerrain(dt: number): void {
    const ground = heightAt(this.position.x, this.position.z);
    const agl = this.position.y - ground;
    // Look ahead for the pull-up warning.
    _v2.copy(this.position).addScaledVector(this.velocity, 1.1);
    const aheadGround = heightAt(_v2.x, _v2.z);
    const aheadAgl = _v2.y - aheadGround;
    this.groundWarning = agl < 90 || aheadAgl < 60;

    if (agl < 5) {
      if (this.position.y < WORLD.waterLevel + 2) this.ctx.effects.waterSplash(this.position);
      this.hp = 0;
      this.alive = false;
      this.crashed = true;
      this.crashReason = 'IMPACT WITH TERRAIN';
      this.ctx.effects.explosion(this.position, 2.8);
      this.ctx.effects.debris(this.position, 30, 1.8);
      this.ctx.audio.explosion(0, 1.8);
      this.ctx.shake(2.4);
      this.obj.visible = false;
      return;
    }
    if (this.groundWarning && agl < 60) {
      this.lockTone -= dt;
      if (this.lockTone <= 0) {
        this.lockTone = 0.35;
        this.ctx.audio.warn();
      }
    }
  }

  private scoreTarget(c: Combatant, fwd: THREE.Vector3): number {
    _v2.copy(c.position).sub(this.position);
    const dist = _v2.length();
    if (dist > FLIGHT.lockRange) return -1;
    _v2.divideScalar(dist);
    const dot = _v2.dot(fwd);
    if (dot < FLIGHT.lockCone) return -1;
    let s = dot * 2 - dist / FLIGHT.lockRange;
    if (c.isObjective) s += 0.5;
    else if (c.kind === 'fighter') s += 0.35;
    return s;
  }

  cycleTarget(enemies: Combatant[]): void {
    const fwd = _v1.set(0, 0, -1).applyQuaternion(this.quaternion);
    const valid = enemies.filter((c) => c.alive && c.lockable && this.scoreTarget(c, fwd) > -1);
    if (!valid.length) {
      this.manualTarget = null;
      return;
    }
    valid.sort((a, b) => this.scoreTarget(b, fwd) - this.scoreTarget(a, fwd));
    const idx = this.manualTarget ? valid.indexOf(this.manualTarget) : -1;
    this.manualTarget = valid[(idx + 1) % valid.length];
    this.lock.progress = 0;
    this.lock.locked = false;
    this.ctx.audio.ui(true);
  }

  private updateLock(dt: number, enemies: Combatant[]): void {
    const fwd = _v1.set(0, 0, -1).applyQuaternion(this.quaternion);
    let target = this.manualTarget;
    if (target && (!target.alive || !target.lockable || this.scoreTarget(target, fwd) < -0.5)) {
      target = null;
      this.manualTarget = null;
    }
    if (!target) {
      let best: Combatant | null = null;
      let bestScore = -1;
      for (const c of enemies) {
        if (!c.alive || !c.lockable) continue;
        const s = this.scoreTarget(c, fwd);
        if (s > bestScore) {
          bestScore = s;
          best = c;
        }
      }
      target = best;
    }

    if (target !== this.lock.target) {
      this.lock.target = target;
      this.lock.progress = 0;
      this.lock.locked = false;
    }

    if (!target) {
      this.lock.progress = 0;
      this.lock.locked = false;
      return;
    }

    const lockTime = target.kind === 'fighter' ? 1.25 : 0.9;
    const dist = this.position.distanceTo(target.position);
    const closeBonus = dist < 900 ? 1.5 : 1;
    this.lock.progress = clamp01(this.lock.progress + (dt / lockTime) * closeBonus);
    if (this.lock.progress >= 1 && !this.lock.locked) {
      this.lock.locked = true;
      this.ctx.audio.lockAcquired();
    } else if (!this.lock.locked) {
      this.lockTone -= dt;
      if (this.lockTone <= 0) {
        this.lockTone = 0.16;
        this.ctx.audio.lockSearch();
      }
    }
  }

  /** Predicted intercept point for the gun pipper. */
  leadPoint(target: Combatant): THREE.Vector3 {
    const rel = _v2.copy(target.position).sub(this.position);
    const t = rel.length() / FLIGHT.gunSpeed;
    return new THREE.Vector3().copy(target.position).addScaledVector(target.velocity, t);
  }

  private updateWeapons(dt: number, input: Input): void {
    this.gunTimer -= dt;
    this.missileTimer -= dt;

    this.gunHeat = clamp01(this.gunHeat - dt * 0.3);
    if (this.overheated && this.gunHeat < 0.3) this.overheated = false;

    if (input.gun && this.gunTimer <= 0 && this.gunAmmo > 0 && !this.overheated) {
      this.gunTimer = FLIGHT.gunRate;
      this.gunAmmo -= 2;
      this.shotsFired++;
      this.gunHeat = clamp01(this.gunHeat + 0.018);
      if (this.gunHeat >= 1) this.overheated = true;

      const port = this.model.gunPorts[this.gunPortIndex % this.model.gunPorts.length];
      this.gunPortIndex++;
      const origin = port.clone().applyQuaternion(this.quaternion).add(this.position);
      const dir = _v1.set(0, 0, -1).applyQuaternion(this.quaternion).clone();

      // Mild convergence assist toward the tracked target.
      const t = this.lock.target;
      if (t && t.alive) {
        const lead = this.leadPoint(t);
        const toLead = lead.sub(origin).normalize();
        if (toLead.dot(dir) > 0.985) dir.lerp(toLead, 0.55).normalize();
      }
      this.bullets.fire(origin, dir, FLIGHT.gunSpeed, 'player', FLIGHT.gunDamage, this.id, 0.012);
      this.ctx.audio.gunShot();
      this.ctx.shake(0.05);
    }

    if (input.consume('missile')) this.fireMissile();
    if (input.consume('flare')) this.dropFlare();
  }

  fireMissile(): void {
    if (this.missileTimer > 0 || this.missileAmmo <= 0 || !this.alive) return;
    this.missileTimer = FLIGHT.missileCooldown;
    this.missileAmmo--;
    const hp = this.model.hardpoints[this.hardpointIndex % this.model.hardpoints.length];
    this.hardpointIndex++;
    const origin = hp.clone().applyQuaternion(this.quaternion).add(this.position);
    const dir = _v1.set(0, 0, -1).applyQuaternion(this.quaternion).clone();
    const target = this.lock.locked ? this.lock.target : null;
    this.missiles.launch(origin, dir, this.velocity.clone().multiplyScalar(0.55), target, {
      faction: 'player',
      damage: 112,
      blastRadius: 30,
      speed: 320,
      maxSpeed: 780,
      turnRate: 2.5,
      life: 8,
      ownerId: this.id,
      color: 0x9fd8ff,
    });
    if (target) {
      this.lock.progress = 0;
      this.lock.locked = false;
    }
  }

  dropFlare(): void {
    if (this.flareAmmo <= 0 || this.flareTimer > 0 || !this.alive) return;
    this.flareAmmo--;
    this.flareTimer = 0.4;
    for (let i = 0; i < 3; i++) {
      const f = this.flares.find((x) => x.life <= 0);
      if (!f) break;
      f.life = 3.4;
      f.position
        .copy(this.position)
        .addScaledVector(this.velocity, -0.05)
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 14,
            -Math.random() * 6,
            (Math.random() - 0.5) * 14
          )
        );
    }
    this.ctx.audio.flare();
  }

  private updateFlares(dt: number): void {
    this.flareTimer -= dt;
    for (const f of this.flares) {
      if (f.life <= 0) continue;
      f.life -= dt;
      f.position.y -= 26 * dt;
      this.ctx.effects.flareBurn(f.position);
    }
  }
}
