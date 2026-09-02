import * as THREE from 'three';
import type { Combatant, CombatContext, DamageSource, Faction, TargetKind } from './types';
import { makeId } from './types';
import { Bullets, Missiles } from './weapons';
import { buildEnemyJet, type JetModel, type StructureModel } from './models';
import { clamp, clamp01, damp, Rng } from '../core/mathutil';
import { heightAt, WORLD } from '../world/terrain';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);

function hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3, steps = 8): boolean {
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    const z = from.z + (to.z - from.z) * t;
    if (y < heightAt(x, z) + 4) return false;
  }
  return true;
}

export interface GroundTargetOptions {
  kind: TargetKind;
  label: string;
  hp: number;
  radius: number;
  isObjective: boolean;
  score: number;
}

/** Static installation: strike objective, SAM battery or AAA emplacement. */
export class GroundTarget implements Combatant {
  readonly id = makeId();
  readonly faction: Faction = 'enemy';
  readonly kind: TargetKind;
  readonly label: string;
  readonly isObjective: boolean;
  readonly radius: number;
  readonly score: number;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();

  hp: number;
  maxHp: number;
  alive = true;
  lockable = true;
  group: THREE.Group;

  private model: StructureModel;
  private ctx: CombatContext;
  private missiles: Missiles;
  private bullets: Bullets;
  private fireTimer: number;
  private burstLeft = 0;
  private burstTimer = 0;
  private rng: Rng;
  private losTimer = 0;
  private losOk = false;
  private wreckTilt = 0;

  constructor(
    ctx: CombatContext,
    model: StructureModel,
    position: THREE.Vector3,
    opts: GroundTargetOptions,
    bullets: Bullets,
    missiles: Missiles,
    seed = 1
  ) {
    this.ctx = ctx;
    this.model = model;
    this.group = model.group;
    this.kind = opts.kind;
    this.label = opts.label;
    this.isObjective = opts.isObjective;
    this.radius = opts.radius;
    this.score = opts.score;
    this.hp = this.maxHp = opts.hp;
    this.bullets = bullets;
    this.missiles = missiles;
    this.rng = new Rng(seed * 7919 + 13);
    this.fireTimer = this.rng.range(1.5, 5);
    this.position.copy(position);
    this.group.position.copy(position);
    ctx.scene.add(this.group);
  }

  damage(amount: number, _source: DamageSource, _from?: THREE.Vector3): void {
    if (!this.alive) return;
    this.hp -= amount;
    this.ctx.effects.spark(
      _v1.copy(this.position).add(
        _v2.set(
          (Math.random() - 0.5) * this.radius,
          this.radius * 0.5 + Math.random() * this.radius,
          (Math.random() - 0.5) * this.radius
        )
      ),
      _v3.set(0, 1, 0),
      6,
      22
    );
    if (this.hp <= 0) this.destroy();
  }

  private destroy(): void {
    this.hp = 0;
    this.alive = false;
    this.lockable = false;
    const p = _v1.copy(this.position).setY(this.position.y + this.radius * 0.4);
    this.ctx.effects.explosion(p, 1.4 + this.radius / 22);
    this.ctx.effects.debris(p, 22, 1.4);
    this.ctx.audio.explosion(p.distanceTo(this.ctx.listener), 1.5);
    this.wreckTilt = this.rng.range(-0.16, 0.16);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const mat = o.material as THREE.Material & { color?: THREE.Color; emissive?: THREE.Color };
        if (mat.color) mat.color.multiplyScalar(0.28);
        if (mat.emissive) mat.emissive.setHex(0x000000);
      }
    });
  }

  update(dt: number, player: Combatant): void {
    if (!this.alive) {
      this.group.rotation.z = damp(this.group.rotation.z, this.wreckTilt, 2, dt);
      this.group.position.y = damp(this.group.position.y, this.position.y - 1.5, 1.5, dt);
      this.ctx.effects.fireColumn(this.position, dt, clamp(this.radius / 16, 0.5, 1.6));
      return;
    }

    if (this.model.spinner) this.model.spinner.rotation.y += dt * 1.1;

    const toPlayer = _v1.copy(player.position).sub(this.position);
    const dist = toPlayer.length();

    if (this.kind === 'sam' || this.kind === 'aaa') {
      const range = this.kind === 'sam' ? 1900 : 780;
      const engaged = player.alive && dist < range && player.position.y > this.position.y + 12;

      if (this.model.turret && engaged) {
        const yaw = Math.atan2(toPlayer.x, toPlayer.z);
        this.model.turret.rotation.y = damp(this.model.turret.rotation.y, yaw + Math.PI, 3, dt);
      }

      this.losTimer -= dt;
      if (this.losTimer <= 0) {
        this.losTimer = 0.35;
        this.losOk = engaged && hasLineOfSight(_v2.copy(this.position).setY(this.position.y + 8), player.position);
      }

      this.fireTimer -= dt;
      if (engaged && this.losOk && this.fireTimer <= 0) {
        if (this.kind === 'sam') {
          this.fireTimer = this.rng.range(8.5, 13);
          const origin = _v2.copy(this.position).setY(this.position.y + 9);
          const dir = _v3.copy(player.position).sub(origin).normalize();
          dir.y = Math.max(dir.y, 0.45);
          dir.normalize();
          this.missiles.launch(origin, dir, new THREE.Vector3(), player, {
            faction: 'enemy',
            damage: 26,
            blastRadius: 24,
            speed: 240,
            maxSpeed: 640,
            turnRate: 1.75,
            life: 11,
            ownerId: this.id,
            color: 0xffb066,
          });
          this.ctx.notifyIncoming(dist);
        } else {
          this.fireTimer = this.rng.range(2.1, 3.6);
          this.burstLeft = 5;
        }
      }

      if (this.burstLeft > 0) {
        this.burstTimer -= dt;
        if (this.burstTimer <= 0) {
          this.burstTimer = 0.09;
          this.burstLeft--;
          const origin = _v2.copy(this.position).setY(this.position.y + 4);
          const t = dist / 620;
          const aim = _v3.copy(player.position).addScaledVector(player.velocity, t);
          const dir = aim.sub(origin).normalize();
          this.bullets.fire(origin, dir, 620, 'enemy', 3, this.id, 0.055);
          this.ctx.audio.gunShot();
        }
      }
    }
  }

  dispose(): void {
    this.ctx.scene.remove(this.group);
    disposeTree(this.group);
  }
}

/** Frees geometries and materials so restarts do not leak GPU memory. */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
  });
}

type AiState = 'engage' | 'evade' | 'extend' | 'patrol';

/** Enemy interceptor with a simple pursuit / evade AI. */
export class EnemyFighter implements Combatant {
  readonly id = makeId();
  readonly faction: Faction = 'enemy';
  readonly kind: TargetKind = 'fighter';
  readonly label: string;
  readonly isObjective = false;
  readonly radius = 9;
  readonly score = 250;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();

  hp = 70;
  maxHp = 70;
  alive = true;
  lockable = true;
  quaternion = new THREE.Quaternion();
  speed = 240;
  model: JetModel;
  group: THREE.Group;

  private ctx: CombatContext;
  private bullets: Bullets;
  private missiles: Missiles;
  private state: AiState = 'patrol';
  private stateTimer = 0;
  private gunTimer = 0;
  private missileTimer = 6;
  private rng: Rng;
  private skill: number;
  private smokeTimer = 0;
  private bank = 0;

  constructor(
    ctx: CombatContext,
    bullets: Bullets,
    missiles: Missiles,
    label: string,
    skill: number,
    seed: number
  ) {
    this.ctx = ctx;
    this.bullets = bullets;
    this.missiles = missiles;
    this.label = label;
    this.skill = skill;
    this.rng = new Rng(seed * 104729 + 7);
    this.model = buildEnemyJet();
    this.group = this.model.group;
    ctx.scene.add(this.group);
    this.hp = this.maxHp = 70 + skill * 25;
    this.missileTimer = this.rng.range(4, 9);
  }

  spawn(position: THREE.Vector3, heading: number): void {
    this.position.copy(position);
    this.quaternion.setFromAxisAngle(_up, heading);
    this.speed = 260;
    this.alive = true;
    this.hp = this.maxHp;
    this.group.visible = true;
    this.group.position.copy(position);
    this.group.quaternion.copy(this.quaternion);
    this.state = 'engage';
    this.stateTimer = 2;
  }

  damage(amount: number, _source: DamageSource, _from?: THREE.Vector3): void {
    if (!this.alive) return;
    this.hp -= amount;
    this.ctx.effects.spark(this.position, _v3.set(0, 1, 0), 5, 20);
    if (this.hp < this.maxHp * 0.45 && this.state !== 'evade' && this.rng.next() < 0.6) {
      this.state = 'evade';
      this.stateTimer = this.rng.range(3, 5.5);
    }
    if (this.hp <= 0) {
      this.alive = false;
      this.lockable = false;
      this.ctx.effects.explosion(this.position, 1.7);
      this.ctx.effects.debris(this.position, 18, 1.3);
      this.ctx.audio.explosion(this.position.distanceTo(this.ctx.listener), 1.2);
      this.group.visible = false;
    }
  }

  private desiredDirection(player: Combatant, dt: number): THREE.Vector3 {
    const toPlayer = _v1.copy(player.position).sub(this.position);
    const dist = toPlayer.length();
    const dir = new THREE.Vector3();

    this.stateTimer -= dt;
    if (this.stateTimer <= 0) {
      if (this.state === 'evade' || this.state === 'extend') {
        this.state = 'engage';
        this.stateTimer = this.rng.range(6, 11);
      } else if (dist < 220) {
        this.state = 'extend';
        this.stateTimer = this.rng.range(2.5, 4);
      } else {
        this.state = 'engage';
        this.stateTimer = this.rng.range(5, 9);
      }
    }

    if (!player.alive) {
      this.state = 'patrol';
    }

    if (this.state === 'engage') {
      const t = clamp(dist / Math.max(120, this.speed), 0, 3.5);
      dir.copy(player.position).addScaledVector(player.velocity, t * 0.7).sub(this.position).normalize();
    } else if (this.state === 'extend') {
      dir.copy(this.position).sub(player.position).normalize();
      dir.y += 0.25;
      dir.normalize();
    } else if (this.state === 'evade') {
      dir.copy(this.position).sub(player.position).normalize();
      const t = performance.now() * 0.001;
      dir.x += Math.sin(t * 1.7 + this.id) * 0.7;
      dir.y += Math.sin(t * 1.1 + this.id) * 0.45 + 0.15;
      dir.z += Math.cos(t * 1.3 + this.id) * 0.7;
      dir.normalize();
    } else {
      // Patrol along the canyon.
      dir.set(Math.sin(this.position.z * 0.001), 0.02, 1).normalize();
    }

    // Terrain avoidance.
    const ahead = _v2.copy(this.position).addScaledVector(dir, Math.max(220, this.speed * 1.4));
    const groundAhead = heightAt(ahead.x, ahead.z);
    const clearance = ahead.y - groundAhead;
    if (clearance < 140) {
      dir.y += clamp01((140 - clearance) / 140) * 1.6;
      dir.normalize();
    }
    if (this.position.y > WORLD.ceiling) dir.y -= 0.5;
    return dir.normalize();
  }

  update(dt: number, player: Combatant): void {
    if (!this.alive) return;

    const desired = this.desiredDirection(player, dt);

    // Steer: rotate toward the desired direction with a limited rate, then
    // bank into the turn for readability.
    _m1.lookAt(_v3.set(0, 0, 0), _v1.copy(desired), _up);
    _q1.setFromRotationMatrix(_m1);
    const turn = (1.15 + this.skill * 0.35) * dt;
    this.quaternion.rotateTowards(_q1, turn);

    const fwd = _v1.set(0, 0, -1).applyQuaternion(this.quaternion);
    const targetSpeed = this.state === 'evade' || this.state === 'extend' ? 400 : 300 + this.skill * 40;
    this.speed = damp(this.speed, targetSpeed, 0.8, dt);
    this.speed -= fwd.y * 40 * dt;
    this.speed = clamp(this.speed, 130, 460);
    this.velocity.copy(fwd).multiplyScalar(this.speed);
    this.position.addScaledVector(this.velocity, dt);

    // Bank visually into the turn.
    const right = _v3.set(1, 0, 0).applyQuaternion(this.quaternion);
    const lateral = desired.dot(right);
    this.bank = damp(this.bank, clamp(-lateral * 2.2, -1.15, 1.15), 4, dt);
    _q1.setFromAxisAngle(_v3.set(0, 0, 1), this.bank);
    this.group.quaternion.copy(this.quaternion).multiply(_q1);
    this.group.position.copy(this.position);

    const ground = heightAt(this.position.x, this.position.z);
    if (this.position.y < ground + 6) {
      this.ctx.effects.explosion(this.position, 1.6);
      this.ctx.audio.explosion(this.position.distanceTo(this.ctx.listener), 1.2);
      this.alive = false;
      this.lockable = false;
      this.group.visible = false;
      return;
    }

    for (const b of this.model.burners) {
      b.scale.setScalar(0.7 + Math.random() * 0.4);
    }
    if (this.hp < this.maxHp * 0.4) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.08;
        this.ctx.effects.damageSmoke(this.position, this.velocity, 1 - this.hp / this.maxHp);
      }
    }

    this.updateWeapons(dt, player, fwd);
  }

  private updateWeapons(dt: number, player: Combatant, fwd: THREE.Vector3): void {
    if (!player.alive) return;
    this.gunTimer -= dt;
    this.missileTimer -= dt;

    const toPlayer = _v2.copy(player.position).sub(this.position);
    const dist = toPlayer.length();
    const aim = toPlayer.clone().normalize();
    const dot = aim.dot(fwd);

    if (this.state === 'engage' && dist < 780 && dot > 0.985 && this.gunTimer <= 0) {
      this.gunTimer = 0.11;
      const port = this.model.gunPorts[0].clone().applyQuaternion(this.quaternion).add(this.position);
      const t = dist / 700;
      const lead = _v3.copy(player.position).addScaledVector(player.velocity, t).sub(port).normalize();
      this.bullets.fire(port, lead, 700, 'enemy', 3, this.id, 0.05 - this.skill * 0.012);
    }

    if (
      this.state === 'engage' &&
      dist > 320 &&
      dist < 1900 &&
      dot > 0.9 &&
      this.missileTimer <= 0 &&
      this.missiles.countTracking(player) < 3
    ) {
      this.missileTimer = this.rng.range(9, 15) - this.skill * 2;
      const origin = this.model.hardpoints[0].clone().applyQuaternion(this.quaternion).add(this.position);
      this.missiles.launch(origin, fwd.clone(), this.velocity.clone().multiplyScalar(0.4), player, {
        faction: 'enemy',
        damage: 24,
        blastRadius: 22,
        speed: 300,
        maxSpeed: 700,
        turnRate: 1.9 + this.skill * 0.2,
        life: 9,
        ownerId: this.id,
        color: 0xffb066,
      });
      this.ctx.notifyIncoming(dist);
    }
  }

  dispose(): void {
    this.ctx.scene.remove(this.group);
    disposeTree(this.group);
  }
}
