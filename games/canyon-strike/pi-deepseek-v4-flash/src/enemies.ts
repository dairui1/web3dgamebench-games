// Enemy forces: SAM/AA/radar/mortar ground units and canyon fighter patrols,
// plus enemy homing missiles and mortar fire.

import * as THREE from 'three';
import { clamp, damp, lerp, rand, smoothstep } from './math';
import { buildSamSite, buildAaGun, buildRadarTruck, buildMortar, buildEnemyFighter, makeGlowTexture } from './models';
import { makeMissileObject, makeMortarShellObject } from './effects';
import type { Target, AirState, EnemyMissile, MortarShell, GameAPI } from './types';

export class Enemies {
  targets: Target[] = [];
  enemyMissiles: EnemyMissile[] = [];
  shells: MortarShell[] = [];
  private api: GameAPI;
  private warningAcc = 0;
  private nameIdx: Record<string, number> = {};

  private nextName(kind: string): string {
    const n = (this.nameIdx[kind] ?? 0) + 1;
    this.nameIdx[kind] = n;
    if (kind === 'sam') return `SAM-${String(n).padStart(2, '0')}`;
    if (kind === 'aa') return `AAA-${String(n).padStart(2, '0')}`;
    if (kind === 'radar') return `RDR-${String(n).padStart(2, '0')}`;
    if (kind === 'mortar') return `MRT-${String(n).padStart(2, '0')}`;
    return `BANDIT-${String(n).padStart(2, '0')}`;
  }

  constructor(api: GameAPI) {
    this.api = api;
  }

  /** Place one ground unit of the given kind at a spline fraction. */
  spawnGround(kind: 'sam' | 'aa' | 'radar' | 'mortar', frac: number, primary: boolean): Target {
    const api = this.api;
    const s = api.canyon.sampleAt(frac * api.canyon.samples);
    const build =
      kind === 'sam' ? buildSamSite : kind === 'aa' ? buildAaGun : kind === 'radar' ? buildRadarTruck : buildMortar;
    const mesh = build();
    const terrainY = api.canyon.heightAt(s.x, s.z);
    const pos = new THREE.Vector3(s.x, terrainY + 0.5, s.z);
    mesh.position.copy(pos);
    mesh.rotation.y = rand(0, 6.28);
    api.scene.add(mesh);
    const hp = kind === 'sam' ? 120 : kind === 'aa' ? 80 : kind === 'radar' ? 60 : 80;
    const target: Target = {
      kind,
      name: this.nextName(kind),
      mesh,
      pos,
      hp,
      maxHp: hp,
      alive: true,
      primary,
      marker: primary ? this.buildMarker(0xffb43a, pos) : null,
      fireCd: rand(5, 10),
      losTimer: 0,
      moved: new THREE.Vector3(),
      prevPos: pos.clone(),
      turret: (mesh.userData.turret ?? (mesh.userData.launcher as THREE.Object3D | undefined)) as THREE.Object3D | undefined,
    };
    this.targets.push(target);
    return target;
  }

  /** Spawn a fighter at a spline fraction, patrolling forward. */
  spawnFighter(frac: number, offsetX: number, altBoost = 0): Target {
    const api = this.api;
    const s = api.canyon.sampleAt(frac * api.canyon.samples);
    const mesh = buildEnemyFighter();
    const terrainY = api.canyon.heightAt(s.x + offsetX, s.z);
    const pos = new THREE.Vector3(s.x + offsetX, terrainY + 210 + altBoost + rand(-40, 40), s.z);
    mesh.position.copy(pos);
    api.scene.add(mesh);
    const air: AirState = {
      wpt: frac * api.canyon.samples,
      mode: 'patrol',
      burstTimer: 0,
      gunAcc: 0,
      shootCd: rand(1, 3),
      missileCd: rand(4, 9),
      speed: rand(185, 215),
      yaw: s.yaw,
      pitch: 0,
      homeAlt: pos.y,
      dir: new THREE.Vector3(Math.sin(-s.yaw) * -1, 0, 0),
    };
    air.dir.set(forwardDir(s.yaw, 0).x, 0, forwardDir(s.yaw, 0).z);
    const target: Target = {
      kind: 'fighter',
      name: this.nextName('fighter'),
      mesh,
      pos,
      hp: 100,
      maxHp: 100,
      alive: true,
      primary: false,
      marker: null,
      fireCd: 0,
      losTimer: 0,
      moved: new THREE.Vector3(),
      prevPos: pos.clone(),
      air,
    };
    this.targets.push(target);
    return target;
  }

  private buildMarker(color: number, pos: THREE.Vector3): THREE.Object3D {
    const api = this.api;
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.7, 0.14, 8, 26),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 })
    );
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: makeGlowTexture({ inner: '#ffd98a', outer: 'rgba(255,180,60,0.35)' }), transparent: true, depthWrite: false })
    );
    spr.scale.set(9, 9, 1);
    g.add(spr);
    g.position.copy(pos);
    g.position.y += 13;
    api.scene.add(g);
    g.userData.ring = ring;
    g.userData.phase = rand(0, 6.28);
    return g;
  }

  reset(): void {
    for (const t of this.targets) {
      this.api.scene.remove(t.mesh);
      if (t.marker) this.api.scene.remove(t.marker);
    }
    this.targets = [];
    for (const m of this.enemyMissiles) {
      if (m.obj) this.api.scene.remove(m.obj);
    }
    this.enemyMissiles = [];
    for (const sh of this.shells) {
      if (sh.obj) this.api.scene.remove(sh.obj);
    }
    this.shells = [];
    this.nameIdx = {};
  }

  /** Count of homing missiles currently inbound on the player. */
  incomingCount(): number {
    let n = 0;
    for (const m of this.enemyMissiles) {
      if (!m.dead && m.targetIsPlayer) n++;
    }
    return n;
  }

  update(dt: number, time: number): void {
    const api = this.api;
    const p = api.player.s;
    const canyon = api.canyon;
    const ppos = p.pos;

    if (!p.alive || api.isMissionOver()) {
      // keep patrols flying a bit, no aggression
      for (const t of this.targets) {
        if (t.kind === 'fighter' && t.alive && t.air) t.air.mode = 'patrol';
      }
    }

    for (const t of this.targets) {
      if (!t.alive) {
        this.animateMarker(t, dt, time);
        continue;
      }
      if (t.kind === 'fighter' && t.air) this.updateFighter(t, dt, time);
      else this.updateGround(t, dt, time);
    }

    // Enemy missiles
    for (let i = this.enemyMissiles.length - 1; i >= 0; i--) {
      const m = this.enemyMissiles[i];
      if (m.dead) {
        if (m.obj) api.scene.remove(m.obj);
        this.enemyMissiles.splice(i, 1);
        continue;
      }
      m.life -= dt;
      let targetPos: THREE.Vector3;
      if (m.targetIsPlayer) {
        targetPos = ppos;
      } else {
        targetPos = m.flarePos ? m.flarePos : m.pos.clone();
        // check flare alive
        let flareAlive = false;
        for (const f of api.flaresRef) {
          if (f.life > 0 && f.pos.distanceTo(m.flarePos ?? f.pos) < 90) {
            m.flarePos?.copy(f.pos);
            flareAlive = true;
            break;
          }
        }
        if (!flareAlive && m.flarePos) {
          // flare expired; the missile peters out
          m.dead = true;
          continue;
        }
      }
      const toT = targetPos.clone().sub(m.pos);
      const dist = toT.length();
      // alert the player once it's reasonably close / tracking
      if (m.targetIsPlayer && !m.alerted) {
        const speed = m.vel.length();
        if (dist < 1700 || (dist < 2600 && time % 1 < 0.1)) {
          m.alerted = true;
          api.audio.alert();
        }
        void speed;
      }
      if (dist < 5.5) {
        if (m.targetIsPlayer && p.alive) {
          this.hitPlayer(30, 'MISSILE');
          api.effects.explosion(ppos.clone(), true);
          api.audio.explode(true);
          api.addShake(0.85);
        } else {
          api.effects.explosion(m.pos, false);
          api.audio.explode(false);
        }
        m.dead = true;
        continue;
      }
      const desired = dist < 0.1 ? new THREE.Vector3(0, 0, 1) : toT.clone().normalize();
      const curSpeed = m.vel.length();
      m.vel.lerp(desired.multiplyScalar(curSpeed), clamp(1.9 * dt * 2.2, 0, 1));
      m.vel.setLength(Math.min(curSpeed + 520 * dt, 225));
      m.pos.addScaledVector(m.vel, dt);
      const ground = canyon.heightAt(m.pos.x, m.pos.z);
      if (m.pos.y < ground + 1) {
        api.effects.explosion(m.pos, false);
        api.audio.explode(false);
        api.addShake(0.25);
        m.dead = true;
        continue;
      }
      if (m.life <= 0) {
        api.effects.smoke.spawn(m.pos.clone(), 3, 0.8, { grow: 2 });
        m.dead = true;
        continue;
      }
      m.smokeAcc -= dt;
      if (m.smokeAcc <= 0) {
        m.smokeAcc = 0.08;
        api.effects.trailPuff(m.pos);
      }
      if (m.obj) {
        m.obj.position.copy(m.pos);
        m.obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), m.vel.clone().normalize());
      }
    }

    // Mortar shells
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      sh.life -= dt;
      sh.vel.y -= 9.81 * dt;
      sh.pos.addScaledVector(sh.vel, dt);
      if (sh.obj) sh.obj.position.copy(sh.pos);
      const distP = sh.pos.distanceTo(ppos);
      if (sh.pos.y < canyon.heightAt(sh.pos.x, sh.pos.z) + 1 || sh.life <= 0) {
        api.effects.explosion(sh.pos, false);
        api.audio.explode(false);
        api.addShake(0.3);
        if (distP < 17 && p.alive) {
          this.hitPlayer(22, 'MORTAR');
        }
        if (sh.obj) api.scene.remove(sh.obj);
        this.shells.splice(i, 1);
        continue;
      }
      if (distP < 260 && time % 0.5 < 0.25) {
        // telegraph warning handled by HUD reading shells
      }
    }

    this.warningAcc = Math.max(0, this.warningAcc - dt);
  }

  private updateGround(t: Target, dt: number, time: number): void {
    const api = this.api;
    const p = api.player.s;
    const ppos = p.pos;
    const dx = ppos.x - t.pos.x;
    const dy = (ppos.y - 60) - t.pos.y;
    const dz = ppos.z - t.pos.z;
    const distTo = Math.hypot(dx, dz);

    // Rotate turret toward player (yaw only)
    if (t.turret && t.kind !== 'radar') {
      // barrels point along local +Z; rotate so +Z faces the player
      const targetYaw = Math.atan2(dx, dz);
      const cur = t.turret.rotation.y;
      t.turret.rotation.y = cur + shortestAngle(cur, targetYaw) * Math.min(1, dt * 3);
    }
    if (t.turret && t.kind === 'radar') {
      (t.turret as THREE.Object3D).rotation.y += dt * 0.8;
    }

    if (!p.alive || api.isMissionOver()) return;
    t.fireCd -= dt;

    if (t.kind === 'sam') {
      if (t.fireCd <= 0 && distTo < 2800 && distTo > 120) {
        t.fireCd = rand(6.5, 9.5);
        if (api.canyon.hasLOS(t.pos.x, t.pos.y + 2.5, t.pos.z, ppos.x, ppos.y, ppos.z)) {
          this.launchEnemyMissile(t, new THREE.Vector3(ppos.x, ppos.y, ppos.z));
          api.audio.enemyMissileLaunch();
        }
      }
    } else if (t.kind === 'aa') {
      if (t.fireCd <= 0 && distTo < 1500) {
        t.fireCd = rand(2.2, 3.6);
        t.losTimer = 0.35;
      }
      if (t.losTimer > 0) {
        t.losTimer -= dt;
        // fire a short burst
        const burst = Math.floor(rand(1, 3));
        for (let b = 0; b < burst; b++) {
          const muzzle = t.pos.clone().add(new THREE.Vector3(rand(-0.6, 0.6), 1.4, rand(-0.6, 0.6)));
          const aim = ppos.clone().sub(muzzle).normalize();
          const spread = 0.028;
          const dir = aim.add(new THREE.Vector3(rand(-spread, spread) * distTo * 0.5, rand(-spread, spread) * distTo * 0.5, rand(-spread, spread) * distTo * 0.5)).normalize();
          this.fireTracer(muzzle, dir, 1500, 3.5, false);
        }
        api.effects.muzzle(t.pos.clone().add(new THREE.Vector3(0, 1.5, 0)));
      }
    } else if (t.kind === 'mortar') {
      if (t.fireCd <= 0 && distTo > 350 && distTo < 2800 && ppos.y < 900) {
        t.fireCd = rand(12, 18);
        this.launchMortar(t);
      }
    } else if (t.kind === 'radar') {
      void time;
    }
    void dy;
  }

  private launchEnemyMissile(t: Target, targetPos: THREE.Vector3): void {
    const api = this.api;
    const pos = t.pos.clone().add(new THREE.Vector3(0, 2, 0));
    const toT = targetPos.clone().sub(pos).normalize();
    const obj = makeMissileObject();
    obj.position.copy(pos);
    api.scene.add(obj);
    const m: EnemyMissile = {
      pos,
      vel: toT.multiplyScalar(150),
      targetIsPlayer: true,
      targetPos,
      flarePos: new THREE.Vector3(),
      life: 9,
      dead: false,
      alerted: false,
      smokeAcc: 0,
      obj,
    };
    this.enemyMissiles.push(m);
    api.addShake(0.08);
  }

  private launchMortar(t: Target): void {
    const api = this.api;
    const p = api.player.s;
    const target = p.pos.clone().addScaledVector(p.vel, 1.4);
    const muzzle = t.pos.clone().add(new THREE.Vector3(0, 1.6, 0));
    const delta = target.clone().sub(muzzle);
    const dist = Math.hypot(delta.x, delta.z);
    const T = clamp(Math.sqrt((8 * 70) / 9.81), 3, dist / 60);
    const vh = dist / T;
    const vy = (9.81 * T) / 2; // apex ≈ 70m
    delta.y = 0;
    const dir = delta.normalize();
    const vel = new THREE.Vector3(dir.x * vh, vy, dir.z * vh);
    const sh: MortarShell = {
      pos: muzzle,
      vel,
      life: 12,
      obj: makeMortarShellObject(),
      target: target.clone(),
    };
    sh.obj!.position.copy(muzzle);
    api.scene.add(sh.obj!);
    this.shells.push(sh);
    api.audio.enemyMissileLaunch();
  }

  private fireTracer(origin: THREE.Vector3, dir: THREE.Vector3, range: number, damage: number, _enemy: boolean): void {
    const api = this.api;
    const tracer = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 16),
      new THREE.MeshBasicMaterial({ color: 0xffc86a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    tracer.position.copy(origin);
    tracer.lookAt(origin.clone().add(dir));
    api.scene.add(tracer);
    api.tracerObjs.push({ obj: tracer, life: 0.14 });
    // damage check: closest approach to player, blocked by terrain
    const p = api.player.s;
    if (!p.alive) return;
    const rel = p.pos.clone().sub(origin);
    const along = rel.dot(dir);
    if (along > 0 && along < range) {
      // terrain occlusion check along the ray
      let blocked = false;
      const steps = Math.ceil(along / 26);
      const step = dir.clone().multiplyScalar(26);
      const probe = origin.clone();
      for (let i = 1; i <= steps; i++) {
        probe.add(step);
        if (probe.y < api.canyon.heightAt(probe.x, probe.z) + 0.5) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        const closest = origin.clone().addScaledVector(dir, along);
        const miss = closest.distanceTo(p.pos);
        if (miss < 4.4) {
          this.hitPlayer(damage, 'AA');
        }
      }
    }
    // terrain impact spark
    const hit = rayMarch(origin, dir, range, api.canyon.heightAt.bind(api.canyon));
    if (hit) api.effects.sparks(hit, 3);
  }

  private hitPlayer(dmg: number, cause: string): void {
    const api = this.api;
    const p = api.player.s;
    if (!p.alive) return;
    p.hp = Math.max(0, p.hp - dmg);
    p.stun = Math.max(p.stun, 0.6);
    api.addShake(0.35);
    api.audio.hit();
    api.hudFlash(cause);
  }

  private updateFighter(t: Target, dt: number, time: number): void {
    const api = this.api;
    const p = api.player.s;
    const air = t.air!;
    const canyon = api.canyon;
    const ppos = p.pos;
    const distTo = t.pos.distanceTo(ppos);

    // Choose mode
    let targetPos: THREE.Vector3;
    if (p.alive && !api.isMissionOver()) {
      if (distTo < 1500) {
        air.mode = 'engage';
        targetPos = ppos.clone();
      } else if (distTo < 2400 && time % 6 > 3) {
        air.mode = 'engage';
        targetPos = ppos.clone();
      } else {
        air.mode = 'patrol';
        const s = canyon.sampleAt(air.wpt);
        targetPos = new THREE.Vector3(s.x, air.homeAlt, s.z);
      }
    } else {
      air.mode = 'patrol';
      const s = canyon.sampleAt(air.wpt);
      targetPos = new THREE.Vector3(s.x, air.homeAlt, s.z);
    }

    if (air.mode === 'patrol') {
      // advance waypoint when close
      const d = t.pos.distanceTo(targetPos);
      if (d < 60) air.wpt += 30;
      // terrain height clearance for homeAlt
      const floor = canyon.heightAt(t.pos.x, t.pos.z);
      air.homeAlt = Math.max(air.homeAlt, floor + 140);
    } else {
      // keep from climbing over canyon walls too much... follow player
    }

    // Steering toward targetPos
    const dir = targetPos.clone().sub(t.pos);
    const len = dir.length() || 1;
    const desired = dir.clone().divideScalar(len);
    // terrain clearance: if too low, pitch up
    const floor = canyon.heightAt(t.pos.x, t.pos.z);
    if (t.pos.y < floor + 80) {
      desired.y = Math.max(desired.y, 0.35);
    }

    const desiredYaw = Math.atan2(-desired.x, -desired.z);
    const desiredPitch = Math.asin(clamp(desired.y, -1, 1));

    // limit turn
    const turn = dt * 1.1;
    air.yaw = air.yaw + shortestAngle(air.yaw, desiredYaw) * Math.min(1, turn * 3);
    air.pitch = damp(air.pitch, clamp(desiredPitch, -0.5, 0.5), 0.5, dt);

    const fwd = forwardDir(air.yaw, air.pitch);
    const speedMul = air.mode === 'engage' ? 1.18 : 1;
    air.speed = damp(air.speed, 215 * speedMul, 0.8, dt);
    const newPos = t.pos.clone().addScaledVector(fwd, air.speed * dt);
    // soft terrain clamp
    const f2 = canyon.heightAt(newPos.x, newPos.z);
    newPos.y = Math.max(newPos.y, f2 + 45);
    t.prevPos.copy(t.pos);
    t.pos.copy(newPos);

    const newFwd = newPos.copy(forwardDir(air.yaw, air.pitch));
    air.dir.copy(newFwd);

    // Orient mesh (bank toward turn)
    const yawRate = shortestAngle(air.yaw, desiredYaw) / Math.max(dt, 1e-4);
    const roll = clamp(-yawRate * 0.12, -0.75, 0.75);
    t.mesh.position.copy(t.pos);
    t.mesh.quaternion.setFromEuler(new THREE.Euler(air.pitch, air.yaw, roll, 'YXZ'));

    // ---- Combat ----
    if (p.alive && !api.isMissionOver() && air.mode === 'engage') {
      const toP = ppos.clone().sub(t.pos);
      const dotFwd = fwd.dot(toP.normalize());
      // Guns
      air.shootCd -= dt;
      if (air.burstTimer > 0) {
        air.burstTimer -= dt;
        air.gunAcc -= dt;
        if (air.gunAcc <= 0) {
          air.gunAcc = 0.11;
          this.fighterFire(t, fwd);
        }
        air.shootCd = 0.4;
      } else if (air.shootCd <= 0 && distTo < 950 && dotFwd > 0.9) {
        air.burstTimer = 1.0;
        air.shootCd = rand(3, 5);
      }
      // Missiles
      air.missileCd -= dt;
      if (air.missileCd <= 0 && distTo < 1100 && distTo > 150 && dotFwd > 0.55) {
        air.missileCd = rand(19, 26);
        const obj = makeMissileObject();
        const pos = t.pos.clone().addScaledVector(fwd, 4);
        obj.position.copy(pos);
        api.scene.add(obj);
        const toT = ppos.clone().sub(pos).normalize();
        this.enemyMissiles.push({
          pos,
          vel: new THREE.Vector3(toT.x * 150, toT.y * 150, toT.z * 150),
          targetIsPlayer: true,
          targetPos: ppos.clone(),
          flarePos: new THREE.Vector3(),
          life: 9,
          dead: false,
          alerted: false,
          smokeAcc: 0,
          obj,
        });
        api.audio.enemyMissileLaunch();
      }
    }

    // burners
    const bm = t.mesh.userData.burnerMat as THREE.MeshBasicMaterial | undefined;
    if (bm) bm.opacity = Math.min(1, bm.opacity + dt * 2);

    // homeAlt adjust to keep inside canyon roughly
    const sIdx = canyon.closestS(t.pos.x, t.pos.z);
    const spl = canyon.sampleAt(sIdx);
    const dC = Math.hypot(t.pos.x - spl.x, t.pos.z - spl.z);
    if (dC > 900) {
      // steer back toward canyon centerline
      air.wpt = sIdx;
      const sp = canyon.sampleAt(air.wpt + 40);
      targetPos = new THREE.Vector3(sp.x, air.homeAlt, sp.z);
      const backDir = targetPos.sub(t.pos).normalize();
      air.yaw = damp(air.yaw, Math.atan2(-backDir.x, -backDir.z), 1.2, dt);
    }
  }

  private fighterFire(t: Target, fwd: THREE.Vector3): void {
    const api = this.api;
    const p = api.player.s;
    const origin = t.pos.clone().addScaledVector(fwd, 6);
    const aim = p.pos.clone().sub(origin);
    const dist = aim.length();
    aim.normalize();
    const sp = (Math.random() - 0.5) * 0.035;
    aim.x += sp;
    aim.y += (Math.random() - 0.5) * 0.035;
    aim.z += (Math.random() - 0.5) * 0.035;
    aim.normalize();
    this.fireTracer(origin, aim, 1200, 2.5, false);
    api.effects.muzzle(origin);
    void dist;
  }

  private animateMarker(t: Target, dt: number, time: number): void {
    if (!t.marker) return;
    const g = t.marker;
    g.position.y = t.pos.y + 13 + Math.sin(time * 3) * 0.8;
    const ring = g.userData.ring as THREE.Object3D;
    ring.rotation.x = Math.PI / 2 + time * 0.8;
    (g.userData.phase as number) += dt;
    (g.children[1] as THREE.Sprite).material.opacity = 0.6 + Math.sin(time * 5) * 0.3;
  }

  /** Remove destroyed target from sim (keeps mesh for wreck). */
  killTarget(t: Target): void {
    t.alive = false;
    if (t.marker) {
      this.api.scene.remove(t.marker);
      t.marker = null;
    }
    if (t.kind === 'fighter') {
      this.api.scene.remove(t.mesh);
    } else {
      // leave a scorched wreck
      const wreck = new THREE.Mesh(
        new THREE.BoxGeometry(3.4, 0.9, 4.2),
        new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 1, metalness: 0 })
      );
      wreck.position.copy(t.pos);
      wreck.position.y += 0.5;
      wreck.rotation.y = rand(0, 6.28);
      this.api.scene.add(wreck);
      t.mesh.visible = false;
    }
  }

  /** Decoy logic for enemy missiles vs flares, called from game update. */
  decoyMissiles(): void {
    const api = this.api;
    const flares = api.flaresRef;
    if (flares.length === 0) return;
    for (const m of this.enemyMissiles) {
      if (m.dead || !m.targetIsPlayer) continue;
      for (const f of flares) {
        if (f.life <= 0) continue;
        const dx = f.pos.x - m.pos.x;
        const dy = f.pos.y - m.pos.y;
        const dz = f.pos.z - m.pos.z;
        if (dx * dx + dy * dy + dz * dz < 75 * 75) {
          if (Math.random() < 0.92) {
            m.targetIsPlayer = false;
            m.flarePos = f.pos.clone();
            m.vel.copy(m.flarePos.clone().sub(m.pos).normalize().multiplyScalar(m.vel.length() * 0.94));
            break;
          }
        }
      }
    }
  }
}

function forwardDir(yaw: number, pitch: number): THREE.Vector3 {
  const cp = Math.cos(pitch);
  return new THREE.Vector3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

function shortestAngle(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function rayMarch(origin: THREE.Vector3, dir: THREE.Vector3, range: number, heightAt: (x: number, z: number) => number): THREE.Vector3 | null {
  const steps = Math.ceil(range / 26);
  const p = origin.clone();
  for (let i = 0; i <= steps; i++) {
    if (p.y < heightAt(p.x, p.z) + 0.5) return p;
    p.addScaledVector(dir, 26);
  }
  return null;
}

export { smoothstep, lerp };