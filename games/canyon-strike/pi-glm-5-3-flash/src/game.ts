// Core game: flight model, combat, enemy AI, mission flow, camera.

import * as THREE from 'three';
import { World, terrainHeight, canyonCenterX, canyonHalfWidth } from './world';
import { Effects } from './effects';
import { Hud } from './hud';
import { InputManager } from './input';
import { AudioManager } from './audio';
import {
  buildPlayerJet,
  buildDrone,
  buildSamSite,
  buildAaTurret,
  buildMissileMesh,
  buildExtractionPad,
} from './models';
import { clamp, damp, lerp, makeRng, randRange, smoothstep } from './utils';

type EnemyKind = 'sam' | 'aa' | 'drone';

interface Enemy {
  id: number;
  kind: EnemyKind;
  obj: THREE.Group;
  hp: number;
  maxHp: number;
  alive: boolean;
  primary: boolean;
  scoreValue: number;
  radius: number;
  cooldown: number;
  shotsLeft: number;
  home: THREE.Vector3;
  patrolT: number;
  radar?: THREE.Object3D;
  launcher?: THREE.Object3D;
  missilesInFlight: number;
  diveT: number;
}

interface Bullet {
  obj: THREE.Mesh;
  vel: THREE.Vector3;
  prev: THREE.Vector3;
  life: number;
  friendly: boolean;
  dmg: number;
}

interface Missile {
  obj: THREE.Group;
  vel: THREE.Vector3;
  life: number;
  friendly: boolean;
  target: Enemy | null; // friendly homing target
  turnRate: number;
  speed: number;
  trailT: number;
  dmg: number;
  smokeT: number;
  beepT: number;
  ownerId: number;
}

interface Player {
  obj: THREE.Group;
  glow: THREE.Mesh[];
  speed: number;
  hp: number;
  maxHp: number;
  missiles: number;
  gunCooldown: number;
  missileCooldown: number;
  alive: boolean;
  smokeT: number;
  vel: THREE.Vector3;
}

type GameState = 'ready' | 'playing' | 'won' | 'lost';

const PLAYER_MAX_HP = 100;
const PLAYER_MISSILES = 24;
const MIN_SPEED = 70;
const MAX_SPEED = 250;
const CEILING = 760;
const EXTRACTION_Z = -4300;

const V1 = new THREE.Vector3();
const V2 = new THREE.Vector3();
const V3 = new THREE.Vector3();
const Q1 = new THREE.Quaternion();

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private world: World;
  private fx: Effects;
  private hud: Hud;
  private input: InputManager;
  readonly audio = new AudioManager();

  private player!: Player;
  private enemies: Enemy[] = [];
  private bullets: Bullet[] = [];
  private missiles: Missile[] = [];
  private nextId = 1;

  private bulletGeo = new THREE.BoxGeometry(0.2, 0.2, 3.4);
  private bulletMatFriendly = new THREE.MeshBasicMaterial({ color: 0xffe08a });
  private bulletMatEnemy = new THREE.MeshBasicMaterial({ color: 0xff7a5c });

  private lockTarget: Enemy | null = null;
  private lockProgress = 0;
  private lockBeepT = 0;

  private extractionPad: THREE.Group | null = null;
  private extractionActive = false;
  private extractionMarkerId = -7;

  private state: GameState = 'ready';
  private paused = false;
  private score = 0;
  private kills = 0;
  private missionTime = 0;
  private shake = 0;
  private boundsWarnT = 0;
  private droneWavesSpawned = new Set<number>();
  private lastTime = performance.now();
  private rafId = 0;
  private rng = makeRng(20240607);

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.domElement.id = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      62,
      container.clientWidth / container.clientHeight,
      0.5,
      9000,
    );
    this.camera.position.set(0, 200, 2700);

    this.world = new World(this.scene);
    this.fx = new Effects(this.scene);
    this.hud = new Hud(container);
    this.input = new InputManager(container);

    this.spawnPlayer();
    this.setupMission();

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('keydown', this.onPauseKey);
    this.hud.onStart(() => this.beginMission());

    this.hud.showStart();

    this.lastTime = performance.now();
    this.loop();
  }

  // --- setup ---------------------------------------------------------------

  private spawnPlayer(): void {
    const model = buildPlayerJet();
    this.scene.add(model.group);
    const startY = terrainHeight(0, 2500) + 150;
    model.group.position.set(0, startY, 2500);
    this.player = {
      obj: model.group,
      glow: model.glow,
      speed: MIN_SPEED + 80,
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      missiles: PLAYER_MISSILES,
      gunCooldown: 0,
      missileCooldown: 0,
      alive: true,
      smokeT: 0,
      vel: new THREE.Vector3(0, 0, -MIN_SPEED - 80),
    };
  }

  private placeGroundSite(
    kind: EnemyKind,
    z: number,
    side: number,
    offset: number,
  ): void {
    const cx = canyonCenterX(z);
    const x = cx + side * offset;
    const y = terrainHeight(x, z);
    const site = kind === 'sam' ? buildSamSite() : buildAaTurret();
    site.group.position.set(x, y - 0.4, z);
    this.scene.add(site.group);
    const hp = kind === 'sam' ? 60 : 45;
    const enemy: Enemy = {
      id: this.nextId++,
      kind,
      obj: site.group,
      hp,
      maxHp: hp,
      alive: true,
      primary: kind === 'sam',
      scoreValue: kind === 'sam' ? 300 : 200,
      radius: 7,
      cooldown: randRange(this.rng, 2, 6),
      shotsLeft: kind === 'aa' ? 5 : 3,
      home: new THREE.Vector3(x, y, z),
      patrolT: 0,
      radar: site.radar,
      launcher: site.launcher,
      missilesInFlight: 0,
      diveT: 0,
    };
    this.enemies.push(enemy);
    this.hud.addMarker(enemy.id, enemy.primary);
  }

  private spawnDrone(z: number, side: number): void {
    const cx = canyonCenterX(z);
    const x = cx + side * randRange(this.rng, 60, 200);
    const y = terrainHeight(x, z) + randRange(this.rng, 80, 190);
    const model = buildDrone();
    model.group.position.set(x, y, z);
    this.scene.add(model.group);
    const hp = 30;
    const enemy: Enemy = {
      id: this.nextId++,
      kind: 'drone',
      obj: model.group,
      hp,
      maxHp: hp,
      alive: true,
      primary: false,
      scoreValue: 150,
      radius: 4.5,
      cooldown: randRange(this.rng, 0.5, 2),
      shotsLeft: 3,
      home: new THREE.Vector3(x, y, z),
      patrolT: randRange(this.rng, 0, Math.PI * 2),
      missilesInFlight: 0,
      diveT: 0,
    };
    this.enemies.push(enemy);
    this.hud.addMarker(enemy.id, false);
  }

  private setupMission(): void {
    // Primary SAM sites along the canyon.
    const samZ = [1500, 850, 100, -650, -1550, -2450];
    samZ.forEach((z, i) => {
      this.placeGroundSite('sam', z, i % 2 === 0 ? 1 : -1, randRange(this.rng, 45, 150));
    });
    // Optional AA turrets.
    const aaZ = [1250, 450, -350, -1150, -2050, -2850];
    aaZ.forEach((z, i) => {
      this.placeGroundSite('aa', z, i % 2 === 0 ? -1 : 1, randRange(this.rng, 60, 170));
    });
    // Starting patrol drones.
    for (let i = 0; i < 3; i++) this.spawnDrone(1000 + i * 350, i % 2 === 0 ? 1 : -1);
  }

  private spawnExtraction(): void {
    if (this.extractionPad) return;
    const cx = canyonCenterX(EXTRACTION_Z);
    const pad = buildExtractionPad();
    pad.position.set(cx, terrainHeight(cx, EXTRACTION_Z) - 0.5, EXTRACTION_Z);
    this.scene.add(pad);
    this.extractionPad = pad;
    this.hud.addMarker(this.extractionMarkerId, true);
  }

  private beginMission(): void {
    this.audio.unlock();
    this.input.consumeMissilePress(); // clear queued input from menu keys
    if (this.state === 'ready') {
      this.state = 'playing';
      this.hud.hideOverlay();
      this.hud.showMessage('MISSION START', 'Destroy all 6 SAM sites', 3.2);
      return;
    }
    // Restart from win/loss screen: full reset of dynamic state.
    this.resetMission();
    this.state = 'playing';
    this.hud.hideOverlay();
    this.hud.showMessage('MISSION START', 'Destroy all 6 SAM sites', 3.2);
  }

  private resetMission(): void {
    // Remove previous player craft if restarting.
    if (this.player && this.player.obj.parent) this.scene.remove(this.player.obj);
    // Remove enemies, bullets, missiles, markers.
    for (const e of this.enemies) this.scene.remove(e.obj);
    this.enemies = [];
    for (const b of this.bullets) this.scene.remove(b.obj);
    this.bullets = [];
    for (const m of this.missiles) this.scene.remove(m.obj);
    this.missiles = [];
    this.hud.clearMarkers();
    this.fx.reset();
    if (this.extractionPad) {
      this.scene.remove(this.extractionPad);
      this.extractionPad = null;
    }
    this.extractionActive = false;
    this.nextId = 1;
    this.rng = makeRng(20240607);
    this.droneWavesSpawned.clear();

    this.spawnPlayer();
    this.setupMission();

    this.score = 0;
    this.kills = 0;
    this.missionTime = 0;
    this.shake = 0;
    this.lockTarget = null;
    this.lockProgress = 0;
    this.input.state.throttle = 0.65;
    this.hud.setScore(0);
    this.hud.setHealth(PLAYER_MAX_HP, PLAYER_MAX_HP);
    this.hud.setMissiles(PLAYER_MISSILES);
    this.hud.setObjective('Destroy all SAM sites');
    this.hud.setTargetsLeft('SAM 0/6');
    this.hud.setLock('none', null, 0);
    this.hud.setMissileWarning(false);
    this.hud.setTerrainWarning(false);
  }

  // --- loop ------------------------------------------------------------------

  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop);
    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    dt = Math.min(dt, 0.05);

    if (this.state === 'playing' && !this.paused) {
      this.update(dt);
    } else if (this.state === 'won' || this.state === 'lost') {
      // Keep effects + camera alive for the end scene.
      this.fx.update(dt);
      this.updateCamera(dt, true);
    } else if (this.state === 'ready') {
      // Slow cinematic drift on the start screen.
      this.fx.update(dt);
      this.cinematicCamera(dt);
    }
    this.hud.update(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private cinematicCamera(dt: number): void {
    this.missionTime += dt;
    const t = this.missionTime * 0.08;
    const p = this.player.obj.position;
    this.camera.position.set(
      p.x + Math.sin(t) * 60,
      p.y + 14 + Math.sin(t * 0.7) * 6,
      p.z + 46 + Math.cos(t) * 22,
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(p.x, p.y + 2, p.z - 40);
  }

  private update(dt: number): void {
    this.missionTime += dt;
    this.input.update(dt);

    this.updatePlayer(dt);
    this.updateLock(dt);
    this.updateWeapons(dt);
    this.updateEnemies(dt);
    this.updateBullets(dt);
    this.updateMissiles(dt);
    this.fx.update(dt);
    this.updateCamera(dt, false);
    this.updateMissionFlow(dt);
    this.updateHud(dt);

    this.audio.updateEngine(
      this.input.state.throttle,
      this.player.alive && this.state === 'playing',
    );
  }

  // --- player flight ----------------------------------------------------------

  private updatePlayer(dt: number): void {
    const p = this.player;
    if (!p.alive) return;
    const s = this.input.state;

    // Rotation: pitch around local X, roll around local Z, yaw from rudder + bank.
    p.obj.rotateX(1.25 * s.pitch * dt);
    p.obj.rotateZ(-2.4 * s.roll * dt);
    p.obj.rotateY(-0.55 * s.yaw * dt);

    // Bank-induced turn + gentle auto-level.
    V1.set(1, 0, 0).applyQuaternion(p.obj.quaternion); // right wing vector
    p.obj.rotateY(-V1.y * 1.15 * dt);
    if (Math.abs(s.roll) < 0.08) {
      p.obj.rotateZ(clamp(V1.y, -1, 1) * 0.9 * dt);
    }

    // Speed.
    const targetSpeed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * s.throttle;
    p.speed = lerp(p.speed, targetSpeed, damp(0.9, dt));

    // Move.
    V1.set(0, 0, -1).applyQuaternion(p.obj.quaternion);
    p.vel.copy(V1).multiplyScalar(p.speed);
    p.obj.position.addScaledVector(p.vel, dt);

    // Keep inside mission bounds.
    const pos = p.obj.position;
    const maxX = 1950;
    const minXZ = -4700;
    const maxZ = 3900;
    const cx = canyonCenterX(pos.z);
    const hw = canyonHalfWidth(pos.z);
    let outOfBounds = false;
    if (pos.x < -maxX) {
      pos.x = -maxX;
      outOfBounds = true;
    }
    if (pos.x > maxX) {
      pos.x = maxX;
      outOfBounds = true;
    }
    if (pos.z < minXZ) {
      pos.z = minXZ;
      outOfBounds = true;
    }
    if (pos.z > maxZ) {
      pos.z = maxZ;
      outOfBounds = true;
    }
    if (Math.abs(pos.x - cx) > hw + 240) outOfBounds = true;
    if (outOfBounds) {
      this.boundsWarnT += dt;
      if (this.boundsWarnT > 0.1 && this.boundsWarnT % 1 < dt) {
        this.hud.showMessage('LEAVING MISSION AREA', 'Turn back', 1);
      }
      // Gentle push back toward the canyon.
      V2.set(cx - pos.x, 0, 0).normalize();
      p.obj.quaternion.premultiply(
        Q1.setFromAxisAngle(V3.set(0, 1, 0), (V2.x > 0 ? -1 : 1) * 0.02 * dt),
      );
    } else {
      this.boundsWarnT = 0;
    }

    // Altitude ceiling.
    if (pos.y > CEILING) {
      pos.y = CEILING;
      p.obj.rotateX(-0.4 * dt);
    }

    // Terrain collision.
    const ground = terrainHeight(pos.x, pos.z);
    if (pos.y < ground + 2.6) {
      pos.y = ground + 2.6;
      this.damagePlayer(999, 'terrain');
      return;
    }

    // Engine glow with throttle.
    const glowT = 0.5 + s.throttle * 0.9;
    for (const g of p.glow) {
      (g.material as THREE.MeshBasicMaterial).color.setRGB(
        0.35 * glowT,
        0.75 * glowT,
        1.0 * glowT,
      );
    }

    // Damage smoke.
    if (p.hp < 40 && p.alive) {
      p.smokeT -= dt;
      if (p.smokeT <= 0) {
        p.smokeT = p.hp < 20 ? 0.06 : 0.14;
        V2.set(0, 0.4, 4.4).applyQuaternion(p.obj.quaternion).add(pos);
        this.fx.trail(V2, 1.1, p.hp < 20);
      }
    }
  }

  // --- targeting / weapons ------------------------------------------------------

  private forwardVec(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.player.obj.quaternion);
  }

  private updateLock(dt: number): void {
    const p = this.player;
    if (!p.alive) {
      this.hud.setLock('none', null, 0);
      return;
    }
    const fwd = this.forwardVec(V1);
    const pos = p.obj.position;
    let best: Enemy | null = null;
    let bestScore = Infinity;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      V2.copy(e.obj.position).sub(pos);
      const dist = V2.length();
      if (dist > 1400 || dist < 20) continue;
      V2.normalize();
      const dot = V2.dot(fwd);
      const angle = Math.acos(clamp(dot, -1, 1));
      if (angle > 0.26) continue; // ~15 degrees
      const score = angle * 100 + (e.primary ? 0 : 40);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best && best === this.lockTarget) {
      const wasLocked = this.lockProgress >= 1;
      this.lockProgress = Math.min(1, this.lockProgress + dt / 0.8);
      if (this.lockProgress >= 1) {
        if (!wasLocked) {
          this.audio.lockAcquired();
          this.lockBeepT = 0.3;
        } else {
          this.lockBeepT -= dt;
          if (this.lockBeepT <= 0) {
            this.audio.lockTone();
            this.lockBeepT = 0.3;
          }
        }
      }
    } else {
      if (best) this.lockProgress = 0;
      this.lockTarget = best;
    }
  }

  private updateWeapons(dt: number): void {
    const p = this.player;
    if (!p.alive) return;
    const s = this.input.state;
    p.gunCooldown -= dt;
    p.missileCooldown -= dt;

    // Gun.
    if (s.fireGun && p.gunCooldown <= 0) {
      p.gunCooldown = 0.1;
      const fwd = this.forwardVec(V1);
      const spawn = V2.copy(fwd).multiplyScalar(7).add(p.obj.position);
      spawn.y -= 0.6;
      this.spawnBullet(spawn, fwd, p.speed + 430, true, 10, 1.7);
      this.audio.gun();
      this.shake = Math.max(this.shake, 0.06);
    }

    // Missile.
    if (this.input.consumeMissilePress() && p.missileCooldown <= 0) {
      if (p.missiles > 0) {
        p.missiles -= 1;
        p.missileCooldown = 0.7;
        const fwd = this.forwardVec(V1);
        const spawn = V2.copy(fwd).multiplyScalar(3).add(p.obj.position);
        spawn.y -= 1.4;
        const locked = this.lockTarget !== null && this.lockProgress >= 1;
        this.spawnMissile(spawn, fwd, 130, 330, locked ? this.lockTarget : null, true, 2.4, 60);
        this.audio.missileLaunch();
      } else {
        this.hud.showMessage('MISSILES EMPTY', 'Use your gun', 1.4);
      }
    }
  }

  private spawnBullet(
    pos: THREE.Vector3,
    dir: THREE.Vector3,
    speed: number,
    friendly: boolean,
    dmg: number,
    life: number,
  ): void {
    const obj = new THREE.Mesh(
      this.bulletGeo,
      friendly ? this.bulletMatFriendly : this.bulletMatEnemy,
    );
    obj.position.copy(pos);
    this.scene.add(obj);
    this.bullets.push({
      obj,
      vel: dir.clone().normalize().multiplyScalar(speed),
      prev: pos.clone(),
      life,
      friendly,
      dmg,
    });
  }

  private spawnMissile(
    pos: THREE.Vector3,
    dir: THREE.Vector3,
    speed: number,
    maxSpeed: number,
    target: Enemy | null,
    friendly: boolean,
    turnRate: number,
    dmg: number,
    ownerId = 0,
  ): void {
    const obj = buildMissileMesh(friendly ? 0xdfe5ea : 0xd0654a);
    obj.position.copy(pos);
    obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir.clone().normalize());
    this.scene.add(obj);
    this.missiles.push({
      obj,
      vel: dir.clone().normalize().multiplyScalar(speed),
      life: friendly ? 7 : 8,
      friendly,
      target,
      turnRate,
      speed: maxSpeed,
      trailT: 0,
      dmg,
      smokeT: 0,
      beepT: 0,
      ownerId,
    });
  }

  // --- enemies ----------------------------------------------------------------

  private updateEnemies(dt: number): void {
    const p = this.player;
    const ppos = p.obj.position;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dist = e.obj.position.distanceTo(ppos);

      if (e.kind === 'sam') {
        if (e.radar) e.radar.rotation.y += dt * 1.4;
        e.cooldown -= dt;
        if (dist < 1700 && e.cooldown <= 0 && e.missilesInFlight < 2 && p.alive) {
          e.cooldown = randRange(this.rng, 4.5, 7);
          e.missilesInFlight += 1;
          const origin = V2.copy(e.obj.position);
          origin.y += 4;
          const dir = V3.copy(ppos).sub(origin).normalize();
          this.spawnMissile(
            origin.clone(),
            dir,
            70,
            175,
            null,
            false,
            1.5,
            26,
            e.id,
          );
          this.audio.missileLaunch();
        }
        if (e.launcher && dist < 1700) e.launcher.lookAt(ppos);
      } else if (e.kind === 'aa') {
        if (e.launcher && dist < 1250 && p.alive) e.launcher.lookAt(ppos);
        e.cooldown -= dt;
        if (dist < 1250 && p.alive) {
          if (e.cooldown <= 0) {
            // Fire one shot of a burst with lead prediction.
            const origin = V2.copy(e.obj.position);
            origin.y += 2.5;
            const bulletSpeed = 320;
            const tof = dist / bulletSpeed;
            const predicted = V3.copy(ppos).addScaledVector(p.vel, tof * 0.85);
            const dir = predicted.sub(origin).normalize();
            dir.x += randRange(this.rng, -0.025, 0.025);
            dir.y += randRange(this.rng, -0.02, 0.02);
            dir.z += randRange(this.rng, -0.025, 0.025);
            this.spawnBullet(origin, dir, bulletSpeed, false, 6, 4.5);
            this.audio.gun();
            e.shotsLeft -= 1;
            if (e.shotsLeft > 0) {
              e.cooldown = 0.13;
            } else {
              e.shotsLeft = 5;
              e.cooldown = randRange(this.rng, 2.2, 3.4);
            }
          }
        }
      } else {
        // Drone.
        this.updateDrone(e, dt, dist);
      }
    }
  }

  private updateDrone(e: Enemy, dt: number, dist: number): void {
    const p = this.player;
    const ppos = p.obj.position;
    const pos = e.obj.position;
    e.patrolT += dt;

    let desired: THREE.Vector3;
    let speed: number;
    const chasing = dist < 1500 && p.alive;
    if (chasing) {
      const tof = dist / 150;
      desired = V1.copy(ppos).addScaledVector(p.vel, tof).sub(pos).normalize();
      speed = 135;
    } else {
      const r = 140;
      V1.set(
        e.home.x + Math.cos(e.patrolT * 0.35) * r,
        e.home.y + Math.sin(e.patrolT * 0.7) * 22,
        e.home.z + Math.sin(e.patrolT * 0.35) * r,
      );
      desired = V1.sub(pos).normalize();
      speed = 70;
    }

    // Steer toward desired direction with limited turn rate.
    V2.set(0, 0, -1).applyQuaternion(e.obj.quaternion);
    const angle = V2.angleTo(desired);
    if (angle > 0.001) {
      V3.crossVectors(V2, desired).normalize();
      const step = Math.min(angle, (chasing ? 1.6 : 0.8) * dt);
      Q1.setFromAxisAngle(V3, step);
      e.obj.quaternion.premultiply(Q1);
    }
    pos.addScaledVector(V2, speed * dt);

    // Terrain avoidance.
    const ground = terrainHeight(pos.x, pos.z) + 14;
    if (pos.y < ground) pos.y = ground;
    if (pos.y > CEILING - 60) pos.y = CEILING - 60;

    // Gun bursts.
    e.cooldown -= dt;
    if (chasing && dist < 620 && e.cooldown <= 0) {
      const aim = V1.copy(ppos).sub(pos).normalize();
      const facing = V2.set(0, 0, -1).applyQuaternion(e.obj.quaternion);
      if (facing.dot(aim) > 0.94) {
        const origin = pos.clone().addScaledVector(facing, 5);
        aim.x += randRange(this.rng, -0.03, 0.03);
        aim.y += randRange(this.rng, -0.03, 0.03);
        aim.z += randRange(this.rng, -0.03, 0.03);
        this.spawnBullet(origin, aim, 380, false, 5, 2.2);
        e.shotsLeft -= 1;
        if (e.shotsLeft > 0) {
          e.cooldown = 0.15;
        } else {
          e.shotsLeft = 3;
          e.cooldown = randRange(this.rng, 1.2, 2.2);
        }
      }
    }

    // Ram collision with the player.
    if (dist < 8 && p.alive) {
      this.damageEnemy(e, 999, pos);
      this.damagePlayer(16, 'collision');
    }
  }

  // --- projectiles ----------------------------------------------------------------

  /** Distance from point C to segment AB, squared (inline math, no allocs). */
  private segDistSq(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const acx = c.x - a.x;
    const acy = c.y - a.y;
    const acz = c.z - a.z;
    const len2 = abx * abx + aby * aby + abz * abz;
    let t = len2 > 0 ? (acx * abx + acy * aby + acz * abz) / len2 : 0;
    t = clamp(t, 0, 1);
    const dx = acx - abx * t;
    const dy = acy - aby * t;
    const dz = acz - abz * t;
    return dx * dx + dy * dy + dz * dz;
  }

  private updateBullets(dt: number): void {
    const ppos = this.player.obj.position;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      b.prev.copy(b.obj.position);
      b.obj.position.addScaledVector(b.vel, dt);
      const bp = b.obj.position;
      let dead = b.life <= 0;

      if (!dead && bp.y < terrainHeight(bp.x, bp.z)) {
        this.fx.sparks(bp, 2);
        dead = true;
      }

      if (!dead && b.friendly) {
        for (const e of this.enemies) {
          if (!e.alive) continue;
          const r = e.radius;
          if (this.segDistSq(b.prev, bp, e.obj.position) < (r + 1.5) * (r + 1.5)) {
            this.damageEnemy(e, b.dmg, bp);
            dead = true;
            break;
          }
        }
      } else if (!dead && !b.friendly && this.player.alive) {
        if (this.segDistSq(b.prev, bp, ppos) < 4.5 * 4.5) {
          this.damagePlayer(b.dmg, 'gunfire');
          this.fx.sparks(bp, 3);
          dead = true;
        }
      }

      if (dead) {
        this.scene.remove(b.obj);
        this.bullets.splice(i, 1);
      }
    }
  }

  private updateMissiles(dt: number): void {
    const ppos = this.player.obj.position;
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.life -= dt;
      let dead = m.life <= 0;
      const pos = m.obj.position;

      if (!dead) {
        // Steer.
        if (m.friendly && m.target && !m.target.alive) m.target = null;
        const targetPos = m.friendly
          ? m.target
            ? m.target.obj.position
            : null
          : this.player.alive
            ? ppos
            : null;
        if (targetPos) {
          const desired = V1.copy(targetPos).sub(pos).normalize();
          const current = V2.copy(m.vel).normalize();
          const angle = current.angleTo(desired);
          if (angle > 0.001) {
            V3.crossVectors(current, desired).normalize();
            Q1.setFromAxisAngle(V3, Math.min(angle, m.turnRate * dt));
            current.applyQuaternion(Q1);
          }
          // Accelerate to max speed.
          const speed = Math.min(m.speed, m.vel.length() + 120 * dt);
          m.vel.copy(current).multiplyScalar(speed);
          // Point the mesh along velocity.
          m.obj.quaternion.setFromUnitVectors(V3.set(0, 0, -1), current);
        }
        pos.addScaledVector(m.vel, dt);

        // Terrain impact.
        if (pos.y < terrainHeight(pos.x, pos.z) + 1) {
          this.fx.explosion(pos, false);
          this.audio.explosion(false);
          dead = true;
        }
      }

      // Proximity detonation.
      if (!dead) {
        if (m.friendly) {
          for (const e of this.enemies) {
            if (!e.alive) continue;
            const r = e.radius + 7;
            if (pos.distanceToSquared(e.obj.position) < r * r) {
              this.damageEnemy(e, m.dmg, pos);
              this.fx.explosion(pos, false);
              this.audio.explosion(false);
              dead = true;
              break;
            }
          }
        } else if (this.player.alive) {
          const r = 7.5;
          if (pos.distanceToSquared(ppos) < r * r) {
            this.damagePlayer(m.dmg, 'missile');
            this.fx.explosion(pos, true);
            this.audio.explosion(true);
            this.shake = Math.max(this.shake, 0.8);
            dead = true;
          } else if (pos.distanceTo(ppos) < 320) {
            m.beepT -= dt;
            if (m.beepT <= 0) {
              m.beepT = 0.45;
              this.audio.warningBeep();
            }
          }
        }
      }

      // Smoke trail.
      m.trailT -= dt;
      if (!dead && m.trailT <= 0) {
        m.trailT = 0.035;
        this.fx.trail(pos, 0.55, false);
      }

      if (dead) {
        if (!m.friendly) {
          // Notify the owning SAM site.
          const owner = this.enemies.find(
            (e) => e.id === m.ownerId && e.kind === 'sam',
          );
          if (owner && owner.missilesInFlight > 0) owner.missilesInFlight -= 1;
          this.hud.setMissileWarning(false);
        }
        this.scene.remove(m.obj);
        this.missiles.splice(i, 1);
      }
    }
  }

  // --- damage ------------------------------------------------------------------

  private damageEnemy(e: Enemy, dmg: number, at: THREE.Vector3): void {
    if (!e.alive) return;
    e.hp -= dmg;
    this.fx.sparks(at, 4);
    if (dmg < 999) {
      this.audio.hit();
      this.hud.showHitMarker();
    }
    if (e.hp <= 0) {
      e.alive = false;
      this.fx.explosion(e.obj.position, e.kind !== 'drone');
      this.audio.explosion(e.kind !== 'drone');
      this.scene.remove(e.obj);
      this.hud.removeMarker(e.id);
      this.kills += 1;
      this.score += e.scoreValue;
      this.hud.setScore(this.score);
      if (e.kind === 'sam') {
        const left = this.enemies.filter((x) => x.kind === 'sam' && x.alive).length;
        if (left > 0) {
          this.hud.showMessage('SAM SITE DESTROYED', `${left} remaining`, 2);
        }
      } else if (e.kind === 'drone') {
        this.hud.showMessage('BANDIT DOWN', '', 1.2);
      } else {
        this.hud.showMessage('AA GUN DESTROYED', '', 1.2);
      }
      if (this.lockTarget === e) {
        this.lockTarget = null;
        this.lockProgress = 0;
        this.hud.setLock('none', null, 0);
      }
    }
  }

  private damagePlayer(dmg: number, source: string): void {
    const p = this.player;
    if (!p.alive) return;
    if (dmg >= 999) {
      this.killPlayer(source);
      return;
    }
    p.hp -= dmg;
    this.hud.setHealth(p.hp, p.maxHp);
    this.hud.flashDamage(clamp(dmg / 30, 0.15, 0.8));
    this.shake = Math.max(this.shake, clamp(dmg / 25, 0.1, 0.7));
    if (source === 'missile' || source === 'terrain') this.audio.damageAlarm();
    else this.audio.hit();
    if (p.hp <= 0) this.killPlayer(source);
  }

  private killPlayer(_source: string): void {
    const p = this.player;
    if (!p.alive) return;
    p.alive = false;
    p.hp = 0;
    this.hud.setHealth(0, p.maxHp);
    this.fx.explosion(p.obj.position, true);
    this.audio.explosion(true);
    this.audio.updateEngine(0, false);
    p.obj.visible = false;
    this.shake = 1.2;
    this.finishMission(false);
  }

  // --- mission flow ---------------------------------------------------------------

  private updateMissionFlow(dt: number): void {
    const p = this.player;
    const samsLeft = this.enemies.filter((e) => e.kind === 'sam' && e.alive).length;
    this.hud.setTargetsLeft(`SAM ${6 - samsLeft}/6`);

    // Spawn drone reinforcement waves as the player advances.
    const z = p.obj.position.z;
    if (z < 200 && !this.droneWavesSpawned.has(1)) {
      this.droneWavesSpawned.add(1);
      for (let i = 0; i < 3; i++) this.spawnDrone(-100 - i * 300, i % 2 === 0 ? -1 : 1);
      this.hud.showMessage('INBOUND BANDITS', 'Watch your six', 2.4);
    }
    if (z < -1800 && !this.droneWavesSpawned.has(2)) {
      this.droneWavesSpawned.add(2);
      for (let i = 0; i < 3; i++) this.spawnDrone(-2100 - i * 300, i % 2 === 0 ? 1 : -1);
      this.hud.showMessage('INBOUND BANDITS', 'Final stretch', 2.4);
    }

    if (samsLeft === 0 && !this.extractionActive) {
      this.extractionActive = true;
      this.spawnExtraction();
      this.hud.setObjective('Reach the extraction zone', true);
      this.hud.showMessage(
        'ALL SAM SITES DESTROYED',
        'Proceed to the extraction zone',
        4,
      );
    }

    // Missile warning: any hostile missile near the player.
    let warned = false;
    for (const m of this.missiles) {
      if (!m.friendly && m.obj.position.distanceTo(p.obj.position) < 600) {
        warned = true;
        break;
      }
    }
    this.hud.setMissileWarning(warned && p.alive);

    if (p.alive) {
      // Terrain proximity warning.
      const pos = p.obj.position;
      const ground = terrainHeight(pos.x, pos.z);
      const fwd = this.forwardVec(V1);
      const low = pos.y - ground < 55 && fwd.y < 0.05;
      this.hud.setTerrainWarning(low);

      // Extraction.
      if (this.extractionActive && this.extractionPad) {
        const ep = this.extractionPad.position;
        const dx = pos.x - ep.x;
        const dz = pos.z - ep.z;
        const dy = pos.y - ep.y;
        if (dx * dx + dz * dz < 80 * 80 && dy > -5 && dy < 130) {
          this.score += 1500 + Math.max(0, Math.round(2500 - this.missionTime * 12));
          this.finishMission(true);
        }
      }
    }
  }

  private finishMission(win: boolean): void {
    if (this.state !== 'playing') return;
    this.state = win ? 'won' : 'lost';
    this.hud.setMissileWarning(false);
    this.hud.setTerrainWarning(false);
    this.audio.updateEngine(0, false);
    if (win) this.audio.fanfareWin();
    else this.audio.fanfareLose();
    window.setTimeout(() => {
      this.hud.showEnd(win, this.score, this.kills, this.missionTime);
    }, win ? 1200 : 1600);
  }

  // --- camera & hud -----------------------------------------------------------------

  private updateCamera(dt: number, endScene: boolean): void {
    const p = this.player;
    const pos = p.obj.position;
    const offset = V1.set(0, 4.6, 15.5).applyQuaternion(p.obj.quaternion);
    const desired = V2.copy(pos).add(offset);
    const follow = endScene ? 1.2 : 6.5;
    this.camera.position.lerp(desired, damp(follow, dt));

    // Shake.
    if (this.shake > 0.001) {
      this.shake *= Math.exp(-4.5 * dt);
      this.camera.position.x += randRange(this.rng, -1, 1) * this.shake;
      this.camera.position.y += randRange(this.rng, -1, 1) * this.shake;
    }

    // Camera up partially banks with the plane.
    const planeUp = V3.set(0, 1, 0).applyQuaternion(p.obj.quaternion);
    this.camera.up.lerp(planeUp, endScene ? damp(1.5, dt) : damp(3.2, dt)).normalize();

    const fwd = this.forwardVec(V1);
    V2.copy(pos).addScaledVector(fwd, 34).addScaledVector(planeUp, 2.2);
    this.camera.lookAt(V2);

    // FOV kick with speed.
    const targetFov = 60 + smoothstep(70, 250, p.speed) * 14;
    this.camera.fov = lerp(this.camera.fov, targetFov, damp(3, dt));
    this.camera.updateProjectionMatrix();
  }

  private updateHud(dt: number): void {
    const p = this.player;
    this.hud.setFlight(p.speed, p.obj.position.y);

    // Lock box.
    if (this.lockTarget && this.lockTarget.alive) {
      const v = V2.copy(this.lockTarget.obj.position).project(this.camera);
      if (v.z < 1) {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        const sx = (v.x * 0.5 + 0.5) * w;
        const sy = (-v.y * 0.5 + 0.5) * h;
        this.hud.setLock(
          this.lockProgress >= 1 ? 'locked' : 'locking',
          new THREE.Vector2(sx, sy),
          this.lockProgress,
        );
      } else {
        this.hud.setLock('none', null, 0);
      }
    } else {
      this.hud.setLock('none', null, 0);
    }

    // Markers.
    const items = this.enemies.map((e) => ({
      id: e.id,
      pos: e.obj.position,
      alive: e.alive,
      primary: e.primary,
    }));
    if (this.extractionActive && this.extractionPad) {
      items.push({
        id: this.extractionMarkerId,
        pos: V1.copy(this.extractionPad.position).add(V2.set(0, 30, 0)).clone(),
        alive: true,
        primary: true,
      });
    }
    this.hud.updateMarkers(this.camera, items);
  }

  // --- plumbing -----------------------------------------------------------------------

  private onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private onVisibility = (): void => {
    if (document.hidden && this.state === 'playing') this.setPaused(true);
  };

  private onPauseKey = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if ((k === 'p' || k === 'escape') && this.state === 'playing') {
      this.setPaused(!this.paused);
    }
  };

  private setPaused(p: boolean): void {
    this.paused = p;
    this.hud.setPaused(p);
    this.audio.updateEngine(0, !p);
    if (!p) this.lastTime = performance.now();
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('keydown', this.onPauseKey);
    this.input.dispose();
    this.renderer.dispose();
  }
}
