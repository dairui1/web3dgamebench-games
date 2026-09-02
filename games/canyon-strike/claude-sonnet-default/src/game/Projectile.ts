import * as THREE from 'three';
import { buildBullet, buildMissile } from './Models.ts';
import type { Damageable, Team } from './types.ts';
import { clamp } from './utils.ts';

export interface Bullet {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  team: Team;
  damage: number;
  life: number;
  age: number;
}

export interface Missile {
  group: THREE.Group;
  velocity: THREE.Vector3;
  team: Team;
  damage: number;
  life: number;
  age: number;
  target: Damageable | null;
  speed: number;
  turnRate: number;
  trail: THREE.Points;
  trailPositions: Float32Array;
  trailHead: number;
  armDelay: number;
}

export type ExplosionCb = (pos: THREE.Vector3, scale: number) => void;
export type HitCb = (target: Damageable, damage: number, isPlayer: boolean) => void;

export class ProjectileManager {
  private scene: THREE.Scene;
  bullets: Bullet[] = [];
  missiles: Missile[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  spawnBullet(origin: THREE.Vector3, direction: THREE.Vector3, team: Team, damage: number, speed = 320) {
    const mesh = buildBullet(team === 'player' ? 0xfff08a : 0xff5252);
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.bullets.push({
      mesh,
      velocity: direction.clone().normalize().multiplyScalar(speed),
      team,
      damage,
      life: 3.5,
      age: 0,
    });
  }

  spawnMissile(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    team: Team,
    damage: number,
    target: Damageable | null,
  ) {
    const group = buildMissile(team === 'player' ? 0xe8e8e8 : 0xc9c9c9);
    group.position.copy(origin);
    group.lookAt(origin.clone().add(direction));
    this.scene.add(group);

    const trailCount = 24;
    const trailPositions = new Float32Array(trailCount * 3);
    for (let i = 0; i < trailCount; i++) {
      trailPositions[i * 3] = origin.x;
      trailPositions[i * 3 + 1] = origin.y;
      trailPositions[i * 3 + 2] = origin.z;
    }
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    const trailMat = new THREE.PointsMaterial({
      color: 0xdddddd,
      size: 1.1,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const trail = new THREE.Points(trailGeo, trailMat);
    this.scene.add(trail);

    this.missiles.push({
      group,
      velocity: direction.clone().normalize().multiplyScalar(90),
      team,
      damage,
      life: 9,
      age: 0,
      target,
      speed: 190,
      turnRate: team === 'player' ? 2.6 : 1.5,
      trail,
      trailPositions,
      trailHead: 0,
      armDelay: 0.25,
    });
  }

  update(
    dt: number,
    heightAt: (x: number, z: number) => number,
    targets: Damageable[],
    onExplosion: ExplosionCb,
    onHit: HitCb,
    playerPos: THREE.Vector3,
    isPlayerAlive: boolean,
  ) {
    // Bullets
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.age += dt;
      b.mesh.position.addScaledVector(b.velocity, dt);

      let dead = b.age > b.life;
      if (!dead && b.mesh.position.y <= heightAt(b.mesh.position.x, b.mesh.position.z)) {
        onExplosion(b.mesh.position, 0.3);
        dead = true;
      }
      if (!dead) {
        for (const t of targets) {
          if (!t.alive || t.team === b.team) continue;
          if (t.object.position.distanceTo(b.mesh.position) < t.radius) {
            onHit(t, b.damage, b.team === 'enemy');
            onExplosion(b.mesh.position, 0.35);
            dead = true;
            break;
          }
        }
      }
      if (!dead && b.team === 'enemy' && isPlayerAlive) {
        if (playerPos.distanceTo(b.mesh.position) < 2.2) {
          dead = true;
        }
      }
      if (dead) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        (b.mesh.material as THREE.Material).dispose();
        this.bullets.splice(i, 1);
      }
    }

    // Missiles
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.age += dt;
      m.speed = Math.min(m.speed + dt * 60, 320);

      if (m.target && m.target.alive && m.age > m.armDelay) {
        const toTarget = m.target.object.position.clone().sub(m.group.position);
        const dist = toTarget.length();
        toTarget.normalize();
        const dir = m.velocity.clone().normalize();
        const newDir = dir.lerp(toTarget, clamp(m.turnRate * dt, 0, 1)).normalize();
        m.velocity.copy(newDir.multiplyScalar(m.speed));
        if (dist < 6) {
          onHit(m.target, m.damage, m.team === 'enemy');
          onExplosion(m.group.position, 1.1);
          this.removeMissile(i);
          continue;
        }
      } else {
        m.velocity.setLength(m.speed);
      }

      m.group.position.addScaledVector(m.velocity, dt);
      if (m.velocity.lengthSq() > 0.01) {
        const look = m.group.position.clone().add(m.velocity);
        m.group.lookAt(look);
      }

      // update trail ring buffer
      m.trailHead = (m.trailHead + 1) % (m.trailPositions.length / 3);
      m.trailPositions[m.trailHead * 3] = m.group.position.x;
      m.trailPositions[m.trailHead * 3 + 1] = m.group.position.y;
      m.trailPositions[m.trailHead * 3 + 2] = m.group.position.z;
      (m.trail.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;

      let dead = m.age > m.life;
      if (!dead && m.group.position.y <= heightAt(m.group.position.x, m.group.position.z)) {
        onExplosion(m.group.position, 1.1);
        dead = true;
      }
      if (!dead && m.team === 'enemy' && isPlayerAlive && !m.target) {
        if (playerPos.distanceTo(m.group.position) < 3) {
          onExplosion(m.group.position, 1.1);
          dead = true;
        }
      }
      if (!dead) {
        for (const t of targets) {
          if (!t.alive || t.team === m.team) continue;
          if (t.object.position.distanceTo(m.group.position) < Math.max(t.radius, 4)) {
            onHit(t, m.damage, m.team === 'enemy');
            onExplosion(m.group.position, 1.1);
            dead = true;
            break;
          }
        }
      }
      if (dead) this.removeMissile(i);
    }
  }

  private removeMissile(i: number) {
    const m = this.missiles[i];
    this.scene.remove(m.group);
    this.scene.remove(m.trail);
    m.trail.geometry.dispose();
    (m.trail.material as THREE.Material).dispose();
    this.missiles.splice(i, 1);
  }

  clear() {
    for (const b of this.bullets) {
      this.scene.remove(b.mesh);
    }
    this.bullets = [];
    for (const m of this.missiles) {
      this.scene.remove(m.group);
      this.scene.remove(m.trail);
    }
    this.missiles = [];
  }
}
