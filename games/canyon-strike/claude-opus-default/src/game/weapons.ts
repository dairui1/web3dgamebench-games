import * as THREE from 'three';
import type { Combatant, CombatContext, Faction } from './types';
import { clamp01 } from '../core/mathutil';

const BULLET_CAP = 360;
const MISSILE_CAP = 40;

interface Bullet {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  damage: number;
  faction: Faction;
  ownerId: number;
  active: boolean;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const DUST = new THREE.Color(0x9a8b76);
const SMOKE_TRAIL = new THREE.Color(0xbfb6ab);

/** Cannon rounds for every shooter in the mission. */
export class Bullets {
  private list: Bullet[] = [];
  private mesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private ctx: CombatContext;

  constructor(ctx: CombatContext) {
    this.ctx = ctx;
    const geo = new THREE.BoxGeometry(0.5, 0.5, 1);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, BULLET_CAP);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = BULLET_CAP;
    const colors = new Float32Array(BULLET_CAP * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    for (let i = 0; i < BULLET_CAP; i++) {
      this.list.push({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        damage: 0,
        faction: 'enemy',
        ownerId: -1,
        active: false,
      });
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    ctx.scene.add(this.mesh);
  }

  fire(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    speed: number,
    faction: Faction,
    damage: number,
    ownerId: number,
    spread = 0
  ): void {
    const b = this.list.find((x) => !x.active);
    if (!b) return;
    b.active = true;
    b.pos.copy(origin);
    b.vel
      .copy(dir)
      .normalize()
      .add(
        _v1.set(
          (Math.random() - 0.5) * spread,
          (Math.random() - 0.5) * spread,
          (Math.random() - 0.5) * spread
        )
      )
      .normalize()
      .multiplyScalar(speed);
    b.life = 1.5;
    b.damage = damage;
    b.faction = faction;
    b.ownerId = ownerId;
    this.ctx.effects.muzzleFlash(origin, dir);
  }

  reset(): void {
    for (let i = 0; i < this.list.length; i++) {
      this.list[i].active = false;
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    const { combatants, effects, audio, listener } = this.ctx;
    const colorAttr = this.mesh.instanceColor!;
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i];
      if (!b.active) continue;
      b.life -= dt;
      _v1.copy(b.vel).multiplyScalar(dt);
      const step = _v1.length();
      b.pos.add(_v1);

      let consumed = false;
      if (b.life <= 0) consumed = true;

      if (!consumed) {
        for (const c of combatants) {
          if (!c.alive || c.faction === b.faction || c.id === b.ownerId) continue;
          const r = c.radius + 2.5;
          if (b.pos.distanceToSquared(c.position) < r * r) {
            const killed = c.hp - b.damage <= 0;
            c.damage(b.damage, 'gun', b.pos);
            effects.spark(b.pos, _v2.copy(b.vel).normalize().negate(), 7, 26);
            this.ctx.notifyHit(c, b.faction === 'player', killed, 'gun');
            consumed = true;
            break;
          }
        }
      }

      if (!consumed && b.pos.y < this.ctx.terrainHeight(b.pos.x, b.pos.z)) {
        effects.spark(b.pos, _v2.set(0, 1, 0), 5, 16);
        effects.trail(b.pos, DUST, 1.8, 0.8, 0.4);
        consumed = true;
      }

      if (consumed) {
        b.active = false;
        this.dummy.scale.setScalar(0);
        this.dummy.position.copy(b.pos);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }

      this.dummy.position.copy(b.pos);
      _m1.lookAt(_v1.set(0, 0, 0), _v2.copy(b.vel).normalize(), _up);
      this.dummy.quaternion.setFromRotationMatrix(_m1);
      const len = Math.max(6, step * 1.6);
      this.dummy.scale.set(1, 1, len);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      const fade = clamp01(b.pos.distanceTo(listener) / 2600);
      if (b.faction === 'player') {
        colorAttr.setXYZ(i, 1.0, 0.95 - fade * 0.3, 0.55);
      } else {
        colorAttr.setXYZ(i, 1.0, 0.45, 0.2);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    colorAttr.needsUpdate = true;
  }
}

export interface MissileConfig {
  faction: Faction;
  damage: number;
  blastRadius: number;
  speed: number;
  maxSpeed: number;
  turnRate: number;
  life: number;
  ownerId: number;
  color: number;
}

interface Missile {
  obj: THREE.Group;
  vel: THREE.Vector3;
  speed: number;
  life: number;
  active: boolean;
  target: Combatant | null;
  decoy: THREE.Vector3 | null;
  cfg: MissileConfig;
  trailTimer: number;
  armTime: number;
}

function missileMesh(color: number): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: 0.5, metalness: 0.4 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 4.2, 8), bodyMat);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.1, 8), bodyMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 2.6;
  g.add(nose);
  const finMat = new THREE.MeshStandardMaterial({ color: 0x8a3a2a, roughness: 0.6 });
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.3, 1.1), finMat);
    f.position.z = -1.7;
    f.rotation.z = (i * Math.PI) / 2;
    f.position.x = Math.sin((i * Math.PI) / 2) * 0.5;
    f.position.y = Math.cos((i * Math.PI) / 2) * 0.5;
    g.add(f);
  }
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.42, 3.2, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  flame.rotation.x = -Math.PI / 2;
  flame.position.z = -3.4;
  g.add(flame);
  return g;
}

/** Guided missiles (player AAM/AGM, enemy AAM and SAM). */
export class Missiles {
  private list: Missile[] = [];
  private ctx: CombatContext;

  constructor(ctx: CombatContext) {
    this.ctx = ctx;
    for (let i = 0; i < MISSILE_CAP; i++) {
      const obj = missileMesh(0x9fd8ff);
      obj.visible = false;
      ctx.scene.add(obj);
      this.list.push({
        obj,
        vel: new THREE.Vector3(),
        speed: 0,
        life: 0,
        active: false,
        target: null,
        decoy: null,
        cfg: {
          faction: 'player',
          damage: 0,
          blastRadius: 0,
          speed: 0,
          maxSpeed: 0,
          turnRate: 0,
          life: 0,
          ownerId: -1,
          color: 0xffffff,
        },
        trailTimer: 0,
        armTime: 0,
      });
    }
  }

  countTracking(target: Combatant): number {
    let n = 0;
    for (const m of this.list) if (m.active && m.target === target) n++;
    return n;
  }

  launch(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    inherited: THREE.Vector3,
    target: Combatant | null,
    cfg: MissileConfig
  ): boolean {
    const m = this.list.find((x) => !x.active);
    if (!m) return false;
    m.active = true;
    m.cfg = cfg;
    m.target = target;
    m.decoy = null;
    m.life = cfg.life;
    m.speed = cfg.speed;
    m.armTime = 0.22;
    m.trailTimer = 0;
    m.obj.visible = true;
    m.obj.position.copy(origin);
    _m1.lookAt(_v1.set(0, 0, 0), _v2.copy(dir).normalize().negate(), _up);
    m.obj.quaternion.setFromRotationMatrix(_m1);
    m.vel.copy(dir).normalize().multiplyScalar(cfg.speed).add(inherited);
    m.speed = m.vel.length();
    this.ctx.audio.missileLaunch();
    return true;
  }

  update(dt: number): void {
    const { effects, audio, listener, combatants, flares } = this.ctx;
    for (const m of this.list) {
      if (!m.active) continue;
      m.life -= dt;
      m.armTime -= dt;

      // Flare seduction for missiles chasing the player.
      if (m.target && m.target.kind === 'player' && !m.decoy) {
        for (const f of flares) {
          if (f.life <= 0) continue;
          const d = m.obj.position.distanceTo(f.position);
          if (d < 190 && Math.random() < 0.9) {
            m.decoy = f.position;
            break;
          }
        }
      }

      const aimPoint = _v1;
      let hasAim = false;
      if (m.decoy) {
        aimPoint.copy(m.decoy);
        hasAim = true;
      } else if (m.target && m.target.alive) {
        const range = m.obj.position.distanceTo(m.target.position);
        const tGo = range / Math.max(60, m.speed);
        aimPoint.copy(m.target.position).addScaledVector(m.target.velocity, tGo * 0.85);
        hasAim = true;
      }

      if (hasAim) {
        _m1.lookAt(aimPoint, m.obj.position, _up);
        _q1.setFromRotationMatrix(_m1);
        m.obj.quaternion.rotateTowards(_q1, m.cfg.turnRate * dt);
      }

      m.speed = Math.min(m.cfg.maxSpeed, m.speed + 420 * dt);
      const fwd = _v2.set(0, 0, 1).applyQuaternion(m.obj.quaternion);
      m.vel.copy(fwd).multiplyScalar(m.speed);
      m.obj.position.addScaledVector(m.vel, dt);

      m.trailTimer -= dt;
      if (m.trailTimer <= 0) {
        m.trailTimer = 0.02;
        effects.trail(m.obj.position, SMOKE_TRAIL, 1.5, 1.5, 0.5);
        effects.burnerGlow(m.obj.position, fwd, 0.8);
      }

      let detonate = false;
      let hitTarget: Combatant | null = null;

      if (m.armTime <= 0) {
        for (const c of combatants) {
          if (!c.alive || c.faction === m.cfg.faction || c.id === m.cfg.ownerId) continue;
          const r = c.radius + 9;
          if (m.obj.position.distanceToSquared(c.position) < r * r) {
            detonate = true;
            hitTarget = c;
            break;
          }
        }
      }

      if (!detonate && m.obj.position.y < this.ctx.terrainHeight(m.obj.position.x, m.obj.position.z)) {
        detonate = true;
      }
      if (!detonate && m.life <= 0) detonate = true;

      if (detonate) {
        const p = m.obj.position;
        const scale = m.cfg.blastRadius / 22;
        effects.explosion(p, scale * 1.1);
        effects.debris(p, 8, scale);
        audio.explosion(p.distanceTo(listener), scale);
        // Splash damage.
        for (const c of combatants) {
          if (!c.alive || c.faction === m.cfg.faction) continue;
          const d = c.position.distanceTo(p) - c.radius;
          if (d < m.cfg.blastRadius) {
            const falloff = c === hitTarget ? 1 : clamp01(1 - d / m.cfg.blastRadius);
            const dmg = m.cfg.damage * (0.45 + 0.55 * falloff);
            const killed = c.hp - dmg <= 0;
            c.damage(dmg, 'missile', p);
            this.ctx.notifyHit(c, m.cfg.faction === 'player', killed, 'missile');
          }
        }
        m.active = false;
        m.obj.visible = false;
        m.target = null;
        m.decoy = null;
      }
    }
  }

  /** Closest active enemy missile tracking the player, for the warning system. */
  threatToPlayer(playerPos: THREE.Vector3): { dist: number; pos: THREE.Vector3 } | null {
    let best: { dist: number; pos: THREE.Vector3 } | null = null;
    for (const m of this.list) {
      if (!m.active || m.cfg.faction !== 'enemy') continue;
      if (!m.target || m.target.kind !== 'player' || m.decoy) continue;
      const d = m.obj.position.distanceTo(playerPos);
      if (!best || d < best.dist) best = { dist: d, pos: m.obj.position };
    }
    return best;
  }

  reset(): void {
    for (const m of this.list) {
      m.active = false;
      m.obj.visible = false;
      m.target = null;
    }
  }
}
