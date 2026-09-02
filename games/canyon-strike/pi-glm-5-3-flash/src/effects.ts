// Pooled particle effects: explosions, smoke puffs, sparks.
// All effects live in one scene group and recycle from fixed pools.

import * as THREE from 'three';
import { randRange, makeRng } from './utils';

interface Puff {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  growth: number;
  active: boolean;
  baseOpacity: number;
}

interface Explosion {
  group: THREE.Group;
  flash: THREE.Mesh;
  life: number;
  maxLife: number;
  scale: number;
  active: boolean;
}

export class Effects {
  readonly group = new THREE.Group();
  private puffs: Puff[] = [];
  private explosions: Explosion[] = [];
  private rng = makeRng(4242);
  private puffGeo = new THREE.SphereGeometry(1, 6, 5);
  private puffMatBase = new THREE.MeshBasicMaterial({
    color: 0x2e2e30,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  private flashMat = new THREE.MeshBasicMaterial({
    color: 0xffd9a0,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    // Pre-create pools.
    for (let i = 0; i < 220; i++) {
      // Each puff gets its own material so opacity fades independently.
      const mesh = new THREE.Mesh(this.puffGeo, this.puffMatBase.clone());
      mesh.visible = false;
      this.group.add(mesh);
      this.puffs.push({
        mesh,
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        growth: 1,
        active: false,
        baseOpacity: 0.6,
      });
    }
    for (let i = 0; i < 14; i++) {
      const group = new THREE.Group();
      const flash = new THREE.Mesh(this.puffGeo, this.flashMat.clone());
      group.add(flash);
      group.visible = false;
      this.group.add(group);
      this.explosions.push({
        group,
        flash,
        life: 0,
        maxLife: 1,
        scale: 1,
        active: false,
      });
    }
  }

  private takePuff(): Puff | null {
    for (const p of this.puffs) if (!p.active) return p;
    return null;
  }

  spawnPuff(
    pos: THREE.Vector3,
    scale: number,
    color: 'smoke' | 'fire' | 'spark',
    vel?: THREE.Vector3,
    life = 1.2,
    growth = 1.6,
  ): void {
    const p = this.takePuff();
    if (!p) return;
    p.active = true;
    p.mesh.visible = true;
    p.mesh.position.copy(pos);
    p.mesh.scale.setScalar(scale);
    const m = p.mesh.material as THREE.MeshBasicMaterial;
    if (color === 'smoke') {
      m.color.setHex(0x2e2e30);
      p.baseOpacity = 0.55;
    } else if (color === 'fire') {
      m.color.setHex(0xffb257);
      p.baseOpacity = 0.85;
    } else {
      m.color.setHex(0xffd9a0);
      p.baseOpacity = 0.95;
    }
    p.vel.copy(vel ?? new THREE.Vector3(0, 0, 0));
    p.life = life;
    p.maxLife = life;
    p.growth = growth;
  }

  explosion(pos: THREE.Vector3, big = false): void {
    const e = this.explosions.find((x) => !x.active);
    if (e) {
      e.active = true;
      e.group.visible = true;
      e.group.position.copy(pos);
      e.life = big ? 0.9 : 0.6;
      e.maxLife = e.life;
      e.scale = big ? 16 : 8;
      e.flash.scale.setScalar(e.scale * 0.25);
      (e.flash.material as THREE.MeshBasicMaterial).opacity = 0.95;
    }
    // Fire + smoke debris.
    const n = big ? 10 : 5;
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(
        randRange(this.rng, -1, 1),
        randRange(this.rng, 0.1, 1.2),
        randRange(this.rng, -1, 1),
      ).normalize().multiplyScalar(randRange(this.rng, 8, 26));
      this.spawnPuff(
        pos,
        randRange(this.rng, big ? 2.4 : 1.2, big ? 5 : 2.6),
        'fire',
        v,
        randRange(this.rng, 0.5, 0.9),
        2.2,
      );
      this.spawnPuff(
        pos,
        randRange(this.rng, big ? 3 : 1.6, big ? 6 : 3),
        'smoke',
        v.multiplyScalar(0.4).add(new THREE.Vector3(0, 4, 0)),
        randRange(this.rng, 1.4, 2.4),
        2.6,
      );
    }
  }

  sparks(pos: THREE.Vector3, n = 3): void {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(
        randRange(this.rng, -1, 1),
        randRange(this.rng, -0.4, 1),
        randRange(this.rng, -1, 1),
      ).multiplyScalar(randRange(this.rng, 10, 22));
      this.spawnPuff(pos, randRange(this.rng, 0.3, 0.7), 'spark', v, 0.35, 1.2);
    }
  }

  /** Engine smoke trail for damaged player / missiles. */
  trail(pos: THREE.Vector3, scale = 0.8, fire = false): void {
    this.spawnPuff(
      pos,
      scale,
      fire ? 'fire' : 'smoke',
      new THREE.Vector3(randRange(this.rng, -1, 1), randRange(this.rng, 0, 2), randRange(this.rng, -1, 1)),
      fire ? 0.5 : 1.1,
      2.4,
    );
  }

  update(dt: number): void {
    for (const e of this.explosions) {
      if (!e.active) continue;
      e.life -= dt;
      if (e.life <= 0) {
        e.active = false;
        e.group.visible = false;
        continue;
      }
      const t = 1 - e.life / e.maxLife;
      e.flash.scale.setScalar(e.scale * (0.25 + t * 1.1));
      (e.flash.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - t);
    }
    for (const p of this.puffs) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - 1.4 * dt);
      p.vel.y += 1.5 * dt;
      const t = p.life / p.maxLife;
      p.mesh.scale.addScalar(p.growth * dt);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.baseOpacity * t;
    }
  }

  reset(): void {
    for (const p of this.puffs) {
      p.active = false;
      p.mesh.visible = false;
    }
    for (const e of this.explosions) {
      e.active = false;
      e.group.visible = false;
    }
  }
}
