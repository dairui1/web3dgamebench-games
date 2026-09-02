import * as THREE from 'three';
import { buildJet, buildRadarDish, buildSamSite, buildTurret } from './Models.ts';
import type { Damageable, Targetable, Team } from './types.ts';
import { clamp, damp, randRange } from './utils.ts';
import { heightAt, pathX } from './Terrain.ts';

export type EnemyKind = 'turret' | 'sam' | 'fighter';

export interface EnemyFireRequest {
  kind: 'bullet' | 'missile';
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  damage: number;
}

let enemyIdCounter = 0;

export abstract class EnemyBase implements Targetable {
  readonly team: Team = 'enemy';
  readonly id = enemyIdCounter++;
  abstract readonly kind: EnemyKind;
  abstract readonly displayName: string;
  readonly object: THREE.Group;
  radius: number;
  health: number;
  maxHealth: number;
  alive = true;
  scoreValue: number;

  protected fireCooldown: number;
  protected fireRequests: EnemyFireRequest[] = [];

  constructor(object: THREE.Group, radius: number, health: number, scoreValue: number) {
    this.object = object;
    this.radius = radius;
    this.health = health;
    this.maxHealth = health;
    this.scoreValue = scoreValue;
    this.fireCooldown = randRange(0.5, 2.5);
  }

  get position(): THREE.Vector3 {
    return this.object.position;
  }

  applyDamage(amount: number): void {
    if (!this.alive) return;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
  }

  abstract update(dt: number, playerPos: THREE.Vector3, playerAlive: boolean): void;

  drainFireRequests(): EnemyFireRequest[] {
    const r = this.fireRequests;
    this.fireRequests = [];
    return r;
  }
}

export class GroundTurret extends EnemyBase {
  readonly kind: EnemyKind = 'turret';
  readonly displayName = 'AA Turret';
  private head: THREE.Group;
  private detectionRange = 260;
  private fireRange = 220;

  constructor(position: THREE.Vector3) {
    const group = buildTurret();
    group.position.copy(position);
    super(group, 3.2, 30, 60);
    this.head = (group as any).userData.turretHead as THREE.Group;
  }

  update(dt: number, playerPos: THREE.Vector3, playerAlive: boolean): void {
    if (!this.alive) return;
    this.fireCooldown -= dt;
    if (!playerAlive) return;
    const toPlayer = playerPos.clone().sub(this.object.position);
    const dist = toPlayer.length();
    if (dist > this.detectionRange) return;

    const localDir = toPlayer.clone().normalize();
    const targetYaw = Math.atan2(localDir.x, localDir.z);
    const pitch = Math.atan2(localDir.y, Math.hypot(localDir.x, localDir.z));
    this.head.rotation.y = damp(this.head.rotation.y, targetYaw, 4, dt);
    this.head.rotation.x = damp(this.head.rotation.x, -pitch, 4, dt);

    if (dist < this.fireRange && this.fireCooldown <= 0) {
      this.fireCooldown = randRange(0.7, 1.3);
      const muzzle = this.object.position.clone();
      muzzle.y += 2.4;
      const dir = playerPos.clone().sub(muzzle).normalize();
      dir.x += randRange(-0.02, 0.02);
      dir.y += randRange(-0.02, 0.02);
      this.fireRequests.push({ kind: 'bullet', origin: muzzle, direction: dir, damage: 4 });
    }
  }
}

export class SamSite extends EnemyBase {
  readonly kind: EnemyKind = 'sam';
  readonly displayName = 'SAM Site';
  private head: THREE.Group;
  private dish: THREE.Mesh;
  private detectionRange = 420;
  private fireRange = 380;

  constructor(position: THREE.Vector3) {
    const group = buildSamSite();
    group.position.copy(position);
    const dish = buildRadarDish();
    dish.position.set(2.6, 2, 0);
    group.add(dish);
    super(group, 3.8, 70, 120);
    this.head = (group as any).userData.turretHead as THREE.Group;
    this.dish = dish;
    this.fireCooldown = randRange(2, 4);
  }

  update(dt: number, playerPos: THREE.Vector3, playerAlive: boolean): void {
    if (!this.alive) return;
    this.fireCooldown -= dt;
    this.dish.rotation.z += dt * 1.4;
    if (!playerAlive) return;
    const toPlayer = playerPos.clone().sub(this.object.position);
    const dist = toPlayer.length();
    if (dist > this.detectionRange) return;

    const localDir = toPlayer.clone().normalize();
    const targetYaw = Math.atan2(localDir.x, localDir.z);
    this.head.rotation.y = damp(this.head.rotation.y, targetYaw, 2.5, dt);

    if (dist < this.fireRange && this.fireCooldown <= 0) {
      this.fireCooldown = randRange(3.5, 5.5);
      const muzzle = this.object.position.clone();
      muzzle.y += 3;
      const dir = playerPos.clone().sub(muzzle).normalize();
      this.fireRequests.push({ kind: 'missile', origin: muzzle, direction: dir, damage: 22 });
    }
  }
}

export class EnemyFighter extends EnemyBase {
  readonly kind: EnemyKind = 'fighter';
  readonly displayName = 'Bandit';
  velocity: THREE.Vector3;
  private speed = 70;
  private engageRadius = 520;
  private orbitPhase = Math.random() * Math.PI * 2;
  private gunCooldown = randRange(1, 2);
  private missileCooldown = randRange(3, 6);
  private homeCenter: THREE.Vector3;

  constructor(position: THREE.Vector3) {
    const group = buildJet(0xb03a3a, 0xffd23d);
    group.scale.setScalar(0.95);
    group.position.copy(position);
    super(group, 4, 55, 150);
    this.velocity = new THREE.Vector3(0, 0, -this.speed);
    this.homeCenter = position.clone();
  }

  update(dt: number, playerPos: THREE.Vector3, playerAlive: boolean): void {
    if (!this.alive) return;
    this.gunCooldown -= dt;
    this.missileCooldown -= dt;
    this.orbitPhase += dt * 0.4;

    const toPlayer = playerPos.clone().sub(this.object.position);
    const dist = toPlayer.length();

    let desiredDir: THREE.Vector3;
    if (playerAlive && dist < this.engageRadius) {
      const idealDist = 190;
      const distError = dist - idealDist;
      const chase = toPlayer.clone().normalize();
      const orbitOffset = new THREE.Vector3(Math.cos(this.orbitPhase), 0.15, Math.sin(this.orbitPhase)).normalize();
      const blend = clamp(distError / idealDist, -1, 1);
      desiredDir = chase.multiplyScalar(clamp(0.4 + blend * 0.6, -1, 1)).add(orbitOffset.multiplyScalar(0.5)).normalize();

      if (dist < 260 && this.gunCooldown <= 0) {
        const facing = this.forwardVec().dot(chase);
        if (facing > 0.85) {
          this.gunCooldown = randRange(0.9, 1.6);
          const muzzle = this.object.position.clone().addScaledVector(this.forwardVec(), 4);
          this.fireRequests.push({ kind: 'bullet', origin: muzzle, direction: chase.clone(), damage: 5 });
        }
      }
      if (dist > 150 && dist < 480 && this.missileCooldown <= 0) {
        const facing = this.forwardVec().dot(chase);
        if (facing > 0.7) {
          this.missileCooldown = randRange(4, 7);
          const muzzle = this.object.position.clone().addScaledVector(this.forwardVec(), 3);
          this.fireRequests.push({ kind: 'missile', origin: muzzle, direction: chase.clone(), damage: 16 });
        }
      }
    } else {
      const toHome = this.homeCenter.clone().sub(this.object.position);
      const patrol = new THREE.Vector3(Math.cos(this.orbitPhase) * 60, 0, Math.sin(this.orbitPhase) * 60).add(
        this.homeCenter,
      );
      desiredDir = patrol.sub(this.object.position).normalize();
      if (toHome.length() > 400) desiredDir = toHome.normalize();
    }

    const currentDir = this.velocity.clone().normalize();
    const newDir = currentDir.lerp(desiredDir, clamp(1.1 * dt, 0, 1)).normalize();
    this.velocity.copy(newDir.multiplyScalar(this.speed));
    this.object.position.addScaledVector(this.velocity, dt);

    const groundH = heightAt(this.object.position.x, this.object.position.z);
    if (this.object.position.y < groundH + 30) {
      this.object.position.y = groundH + 30;
      this.velocity.y = Math.max(this.velocity.y, 5);
    }

    if (this.velocity.lengthSq() > 0.01) {
      const lookTarget = this.object.position.clone().add(this.velocity);
      const m = new THREE.Matrix4().lookAt(this.object.position, lookTarget, new THREE.Vector3(0, 1, 0));
      const targetQuat = new THREE.Quaternion().setFromRotationMatrix(m);
      this.object.quaternion.slerp(targetQuat, clamp(4 * dt, 0, 1));
    }
  }

  private forwardVec(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.object.quaternion);
  }
}

export function spawnGroundEnemiesAlongCanyon(
  count: number,
  zStart: number,
  zEnd: number,
  kindPicker: (i: number) => EnemyKind,
): EnemyBase[] {
  const list: EnemyBase[] = [];
  for (let i = 0; i < count; i++) {
    const z = zStart + (zEnd - zStart) * ((i + 0.5) / count) + randRange(-60, 60);
    const side = Math.random() < 0.5 ? -1 : 1;
    const lateral = randRange(20, 75) * side;
    const x = pathX(z) + lateral;
    const y = heightAt(x, z);
    const pos = new THREE.Vector3(x, y, z);
    const kind = kindPicker(i);
    list.push(kind === 'sam' ? new SamSite(pos) : new GroundTurret(pos));
  }
  return list;
}
