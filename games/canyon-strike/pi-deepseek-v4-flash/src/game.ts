// Game orchestrator: scene, loop, camera, combat plumbing, mission flow.

import * as THREE from 'three';
import { clamp, damp, lerp, rand } from './math';
import { Canyon, START_Z } from './canyon';
import { Input } from './input';
import { AudioFX } from './audio';
import { Effects } from './effects';
import { Enemies } from './enemies';
import { PlayerWeapons } from './weapons';
import { Player } from './player';
import { Mission, PRIMARY_QUOTA } from './mission';
import { HUD, type HUDSnapshot } from './hud';
import { UI } from './ui';
import type { Target, GameAPI, Flare } from './types';
import { buildPlayerPlane } from './models';

type Phase = 'menu' | 'playing' | 'paused' | 'cinematic-win' | 'cinematic-lose' | 'over';

const LOCK_TIME_NEEDED = 0.9;

export class Game implements GameAPI {
  // three core
  private renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private hudCanvas: HTMLCanvasElement;
  private hudCtx: CanvasRenderingContext2D;

  // subsystems
  canyon: Canyon;
  effects: Effects;
  audio = new AudioFX();
  private input: Input;
  private enemies: Enemies;
  private weapons: PlayerWeapons;
  player = new Player();
  private mission: Mission;
  private hud: HUD;
  private ui: UI;

  // player model
  private planeGroup: THREE.Group;
  private burnerMat: THREE.MeshBasicMaterial;
  private burnerMesh: THREE.Mesh;
  private pitchLight: THREE.PointLight;
  private shadowSpr: THREE.Sprite;

  // camera runtime
  private camPos = new THREE.Vector3(0, 160, START_Z + 90);
  private camLook = new THREE.Vector3(0, 80, START_Z);
  private camFov = 62;
  private shake = 0;

  // timing
  private lastTime = 0;
  private time = 0;

  phase: Phase = 'menu';
  tracerObjs: { obj: THREE.Object3D; life: number }[] = [];

  // targeting
  private targetIdx = 0;
  private manualTarget: Target | null = null;
  private lastBeepStep = -1;
  private lockBeeped = false;

  // damage smoke
  private smokeAcc = 0;

  // cinematic
  private cinemaT = 0;
  private loseReason = '';

  // stats
  private stats = { kills: 0, primaryKills: 0, timeSec: 0 };

  constructor(root: HTMLElement) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = 'game-canvas';
    root.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(62, w / h, 0.6, 24000);
    this.camera.position.copy(this.camPos);

    // HUD canvas
    this.hudCanvas = document.createElement('canvas');
    this.hudCanvas.className = 'hud-canvas';
    const ctx = this.hudCanvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.hudCtx = ctx;
    root.appendChild(this.hudCanvas);

    // World
    this.canyon = new Canyon();
    this.canyon.build(this.scene);
    this.scene.fog = new THREE.FogExp2(0xc8b08c, 0.00016);
    this.scene.background = new THREE.Color(0x8fa6bd);
    this.scene.add(new THREE.HemisphereLight(0xbfd4e4, 0x4a3b2a, 0.85));
    const sun = new THREE.DirectionalLight(0xfff0d0, 1.7);
    sun.position.set(2400, 3200, -1600);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x8eb4d8, 0.35);
    fill.position.set(-2000, 800, 2600);
    this.scene.add(fill);

    // Player plane model
    const built = buildPlayerPlane();
    this.planeGroup = built.group;
    this.pitchLight = built.pitchLight;
    this.burnerMat = this.planeGroup.userData.burnerMat as THREE.MeshBasicMaterial;
    this.burnerMesh = this.planeGroup.userData.burner as THREE.Mesh;
    this.shadowSpr = this.planeGroup.userData.shadow as THREE.Sprite;
    this.scene.add(this.planeGroup);

    // Systems
    this.effects = new Effects(this.scene);
    this.enemies = new Enemies(this);
    this.weapons = new PlayerWeapons(this);
    this.mission = new Mission(this.enemies, this.canyon, this.audio, this.scene);
    this.hud = new HUD(this.hudCtx);
    this.ui = new UI(root, this.audio);

    this.input = new Input(this.renderer.domElement, root);
    this.input.setPauseHandler(() => {
      if (this.phase === 'playing') this.pause();
    });
    this.input.onMuteRequest = () => {
      this.audio.ensure();
      this.audio.setMuted(!this.audio.muted);
      this.ui.updateMuteLabel();
    };
    this.ui.onStart = () => {
      this.audio.ensure();
      this.audio.uiClick();
      this.startMission();
      this.ui.hideAll();
    };
    this.ui.onResume = () => {
      this.audio.ensure();
      this.audio.uiClick();
      this.resume();
    };
    this.ui.onRestart = () => {
      this.audio.ensure();
      this.audio.uiClick();
      this.startMission();
      this.ui.hideAll();
      this.ui.showHint('STRIKE 5 OF 7 SAM BATTERIES, THEN REACH EXTRACTION', 6000);
    };
    this.ui.onToggleMute = () => {
      this.audio.ensure();
      this.audio.setMuted(!this.audio.muted);
      this.ui.updateMuteLabel();
    };

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.phase === 'playing') this.pause();
    });

    this.onResize();
    this.ui.showStart();
    // Menu camera drift
    this.camPos.set(0, 260, START_Z + 220);
    this.camLook.set(0, 140, START_Z);

    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  // ---- GameAPI ----
  get targets(): Target[] {
    return this.enemies.targets;
  }
  get flaresRef(): Flare[] {
    return this.weapons.flares;
  }
  get cameraPos(): THREE.Vector3 {
    return this.camPos;
  }
  isMissionOver(): boolean {
    return this.phase === 'over' || this.phase === 'cinematic-lose' || this.phase === 'cinematic-win';
  }
  addShake(amount: number): void {
    this.shake = Math.min(2, this.shake + amount);
    this.hud.addShake(amount);
  }
  hudFlash(label: string): void {
    this.hud.flashDamage(label);
  }

  onTargetDamaged(t: Target, amount: number, byPlayer: boolean): void {
    if (!t.alive) return;
    t.hp -= amount;
    if (byPlayer) {
      this.audio.hitTarget();
    }
    if (t.hp <= 0) {
      this.onTargetKilled(t, byPlayer, byPlayer ? 'MISSILE' : 'SAM');
    }
  }

  onTargetKilled(t: Target, byPlayer: boolean, _cause: string): void {
    if (!t.alive) return;
    t.alive = false;
    const big = t.kind === 'sam' || t.kind === 'fighter';
    this.effects.explosion(t.pos.clone().add(new THREE.Vector3(0, t.kind === 'fighter' ? 8 : 2, 0)), big);
    this.audio.explode(big);
    this.addShake(big ? 0.7 : 0.35);
    if (byPlayer) {
      this.mission.onTargetKilled(t, true);
      this.stats.kills++;
      if (t.primary) this.stats.primaryKills++;
      this.ui.addKillFeed(
        `${t.name.toUpperCase()} DESTROYED${t.primary ? '  +500' : ''}`,
        t.primary ? '#ffd64a' : '#7ee07e'
      );
      // waves
      const sIdx = this.canyon.closestS(this.player.s.pos.x, this.player.s.pos.z);
      const warn = this.mission.spawnWaves(sIdx / this.canyon.samples);
      if (warn) this.ui.showBanner(warn, '#ff8a5a', 3);
      if (this.mission.phase === 'strike' && this.mission.primaryKilled >= PRIMARY_QUOTA) {
        // handled in mission.update next frame
      }
    }
    this.enemies.killTarget(t);
  }

  // ---- Mission lifecycle ----
  startMission(): void {
    // Reset world state
    this.phase = 'playing';
    this.time = 0;
    this.stats = { kills: 0, primaryKills: 0, timeSec: 0 };
    this.player = new Player();
    const s0 = this.canyon.sampleAt(2);
    this.player.s.yaw = s0.yaw;
    this.player.s.pos.set(s0.x, Math.max(s0.floor + 30, 120), s0.z);
    // forward at yaw θ is (-sinθ, -cosθ)
    this.player.s.vel.set(-80 * Math.sin(s0.yaw), 0, -80 * Math.cos(s0.yaw));
    this.weapons.reset();
    this.enemies.reset();
    this.effects.clear();
    for (const tr of this.tracerObjs) this.scene.remove(tr.obj);
    this.tracerObjs = [];
    this.mission = new Mission(this.enemies, this.canyon, this.audio, this.scene);
    this.mission.setupGroundForces();
    this.manualTarget = null;
    this.lockBeeped = false;
    this.lastBeepStep = -1;
    this.smokeAcc = 0;
    this.cinemaT = 0;
    this.shake = 0;
    this.hudCanvas.style.display = 'block';
    this.ui.showBanner('RED CANYON — DESTROY THE SAM BRIDGEHEAD', '#ffd64a', 5);
    this.audio.ensure();
  }

  pause(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    this.ui.showPause();
    this.input.resetEdges();
  }

  resume(): void {
    if (this.phase !== 'paused') return;
    this.phase = 'playing';
    this.ui.hideAll();
    this.lastTime = performance.now();
  }

  // ---- Loop ----
  private loop = (): void => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const dtRaw = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;
    switch (this.phase) {
      case 'playing':
        this.update(dtRaw);
        break;
      case 'paused':
      case 'menu':
        this.updateMenu(dtRaw);
        break;
      case 'cinematic-lose':
      case 'cinematic-win':
        this.updateCinematic(dtRaw);
        break;
      case 'over':
        break;
    }
    this.render();
  };

  private render(): void {
    this.camera.fov = this.camFov;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }

  private updateMenu(dt: number): void {
    this.time += dt;
    const t = this.time;
    const ang = t * 0.06;
    const r = 300;
    this.camPos.set(Math.cos(ang) * r, 190 + Math.sin(t * 0.15) * 22, START_Z + 40 + Math.sin(ang) * r * 0.5);
    this.camLook.set(0, 130, START_Z - 260);
    this.camera.up.set(0, 1, 0);
    this.cameraLookAt();
    this.camFov = damp(this.camFov, 58, 0.8, dt);
    this.canyon.update(dt, t);
    this.effects.update(dt);
  }

  private updateCinematic(dt: number): void {
    this.time += dt;
    this.cinemaT += dt;
    this.canyon.update(dt, this.time);
    this.effects.update(dt);
    if (this.phase === 'cinematic-win') {
      // gentle autopilot
      const p = this.player.s;
      p.yaw = damp(p.yaw, this.targetYawTo(this.mission.extractionPos), 1.2, dt);
      p.pitch = damp(p.pitch, 0.04, 1.2, dt);
      p.speed = damp(p.speed, 62, 1.6, dt);
      p.roll = damp(p.roll, 0, 2, dt);
      const fwd = this.player.getForward(new THREE.Vector3());
      p.pos.addScaledVector(fwd, p.speed * dt);
      const t = this.cinemaT;
      const ang = t * 0.7;
      const r = 70 + t * 6;
      this.camPos.set(this.mission.extractionPos.x + Math.cos(ang) * r, this.mission.extractionPos.y + 60 + t * 4, this.mission.extractionPos.z + Math.sin(ang) * r);
      this.camLook.lerp(p.pos.clone().addScaledVector(fwd, 30), 1 - Math.exp(-dt * 2));
      this.camera.up.set(0, 1, 0);
      this.cameraLookAt();
      this.planeGhostUpdate(dt);
      this.mission.updateBeacon(this.time, dt);
      if (this.cinemaT > 5.6) {
        this.phase = 'over';
        this.audio.touchdown();
        this.audio.missionComplete();
        this.ui.showEnd({ kills: this.stats.kills, primaryKills: this.stats.primaryKills, timeSec: this.stats.timeSec, result: 'win', reason: '' });
      }
    } else {
      // cinematic-lose: camera settles on the wreck
      const p = this.player.s;
      this.camPos.lerp(new THREE.Vector3(p.pos.x, p.pos.y + 25, p.pos.z + 55), 1 - Math.exp(-dt * 1.4));
      this.camLook.lerp(p.pos, 1 - Math.exp(-dt * 2));
      this.camera.up.set(0, 1, 0);
      this.cameraLookAt();
      if (this.cinemaT > 3.4) {
        this.phase = 'over';
        this.ui.showEnd({ kills: this.stats.kills, primaryKills: this.stats.primaryKills, timeSec: this.stats.timeSec, result: 'lose', reason: this.loseReason });
      }
    }
  }

  private cameraLookAt(): void {
    this.camera.position.copy(this.camPos);
    const g = this.canyon.heightAt(this.camera.position.x, this.camera.position.z);
    if (this.camera.position.y < g + 4) this.camera.position.y = g + 4;
    this.camera.lookAt(this.camLook);
  }

  // ---- Main update ----
  private update(dt: number): void {
    this.time += dt;
    this.stats.timeSec += dt;
    const p = this.player.s;
    const input = this.input.state;

    this.input.update(dt);
    this.enemies.decoyMissiles();

    // Player flight
    const crashed = this.player.update(dt, input, this.canyon.heightAt.bind(this.canyon));

    // Damage smoke
    if (p.alive && p.hp < 35) {
      this.smokeAcc += dt;
      if (this.smokeAcc > 0.09) {
        this.smokeAcc = 0;
        const back = this.player.getForward(new THREE.Vector3()).multiplyScalar(-4).add(new THREE.Vector3(0, 0.8, 0));
        this.effects.damageSmoke(p.pos.clone().add(back), p.vel);
      }
    }

    if (crashed) {
      this.playerDown('TERRAIN IMPACT — AIRCRAFT DESTROYED');
      return;
    }
    if (p.hp <= 0 && p.alive) {
      this.playerDown('AIRCRAFT DESTROYED IN COMBAT');
      return;
    }

    // Weapons
    this.weapons.update(dt, input.fireHeld, input.missilePressed, input.flarePressed);
    this.updateTargeting(dt);

    // Enemies
    this.enemies.update(dt, this.time);

    // Mission
    const sIdx = this.canyon.closestS(p.pos.x, p.pos.z);
    const prevPhase = this.mission.phase;
    const objective = this.mission.update(sIdx / this.canyon.samples);
    if (this.mission.phase !== prevPhase && this.mission.phase === 'extract') {
      this.ui.showBanner('STRIKE COMPLETE — HEAD FOR THE GREEN EXTRACTION ZONE', '#37e06a', 4.5);
    }
    this.mission.updateBeacon(this.time, dt);
    if (this.mission.phase === 'strike') {
      const warn = this.mission.spawnWaves(sIdx / this.canyon.samples);
      if (warn) this.ui.showBanner(warn, '#ff8a5a', 3.2);
    }
    // Extraction check
    if (this.mission.phase === 'extract' && p.alive) {
      const ex = this.mission.extractionPos;
      const dx = p.pos.x - ex.x;
      const dz = p.pos.z - ex.z;
      const hd = Math.hypot(dx, dz);
      const floor = this.canyon.heightAt(ex.x, ex.z);
      if (hd < 130 && p.pos.y < floor + 300 && p.pos.y > floor) {
        this.phase = 'cinematic-win';
        this.cinemaT = 0;
        this.ui.showBanner('EXTRACTION REACHED — RETURNING TO BASE', '#37e06a', 4);
      }
    }

    // Tracers
    for (let i = this.tracerObjs.length - 1; i >= 0; i--) {
      const tr = this.tracerObjs[i];
      tr.life -= dt;
      if (tr.life <= 0) {
        this.scene.remove(tr.obj);
        this.tracerObjs.splice(i, 1);
      }
    }

    // Visuals
    this.planeGhostUpdate(dt);
    this.updateCamera(dt);
    this.canyon.update(dt, this.time);
    this.effects.update(dt);
    this.audio.engine(input.throttle, p.speed / 340, p.hp < 35);

    // HUD
    this.drawHUD(objective);
  }

  private playerDown(reason: string): void {
    const p = this.player.s;
    this.loseReason = reason;
    this.phase = 'cinematic-lose';
    this.cinemaT = 0;
    this.planeGroup.visible = false;
    this.effects.explosion(p.pos.clone(), true);
    this.audio.explode(true);
    this.addShake(1.6);
    this.hud.flashDamage('AIRCRAFT DESTROYED');
    this.audio.missionFail();
    this.input.resetEdges();
  }

  private planeGhostUpdate(dt: number): void {
    const p = this.player.s;
    if (!p.alive) {
      this.pitchLight.intensity = 0;
      return;
    }
    this.planeGroup.visible = true;
    this.planeGroup.position.copy(p.pos);
    this.planeGroup.quaternion.setFromEuler(new THREE.Euler(p.pitch, p.yaw, p.roll, 'YXZ'));
    const throttle = this.input.state.autoThrottle ? 0.58 : this.input.state.throttle;
    const burn = 0.4 + throttle * 0.9;
    this.burnerMat.opacity = burn;
    this.burnerMesh.scale.z = 1 + throttle * 1.6;
    this.pitchLight.intensity = 6 + throttle * 14;
    const ground = this.canyon.heightAt(p.pos.x, p.pos.z);
    const agl = Math.max(0, p.pos.y - ground);
    const sh = this.shadowSpr;
    sh.position.y = Math.max(-2.4, -agl);
    (sh.material as THREE.SpriteMaterial).opacity = clamp(0.34 * (1 - agl / 260), 0.06, 0.34);
    void dt;
  }

  private updateCamera(dt: number): void {
    const p = this.player.s;
    const fwd = this.player.getForward(new THREE.Vector3());
    const speedNorm = clamp(p.speed / 340, 0, 1);
    const back = lerp(15, 27, speedNorm);
    const up = lerp(5, 9.6, speedNorm);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(p.pitch, p.yaw, p.roll, 'YXZ')));
    const desired = p.pos.clone().addScaledVector(fwd, -back).addScaledVector(right, p.roll * 1.6).add(new THREE.Vector3(0, up, 0));
    const k = 1 - Math.exp(-dt * (6 + speedNorm * 5));
    this.camPos.lerp(desired, k);
    // look ahead
    const lookTarget = p.pos.clone().addScaledVector(fwd, 55).addScaledVector(p.vel, 0.35);
    lookTarget.y = Math.max(lookTarget.y, this.canyon.heightAt(lookTarget.x, lookTarget.z) + 30);
    const kl = 1 - Math.exp(-dt * 9);
    this.camLook.lerp(lookTarget, kl);
    // FOV & shake
    this.camFov = damp(this.camFov, 62 + speedNorm * 13, 0.5, dt);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    if (this.shake > 0.01) {
      this.camPos.x += rand(-1, 1) * this.shake * 1.4;
      this.camPos.y += rand(-1, 1) * this.shake * 1.4;
      this.camPos.z += rand(-1, 1) * this.shake * 1.4;
    }
    // camera micro-roll with the plane for feel
    const tilt = Math.sin(-p.roll * 0.18);
    this.camera.up.set(tilt, 1, 0).normalize();
    this.cameraLookAt();
  }

  /** Auto-lock or manual-cycle targeting. */
  private updateTargeting(dt: number): void {
    void dt;
    const p = this.player.s;
    const fwd = this.player.getForward(new THREE.Vector3());
    const alive = this.enemies.targets.filter((t) => t.alive);

    if (this.input.state.targetPressed) {
      if (alive.length > 0) {
        const cur = this.manualTarget ? alive.findIndex((t) => t === this.manualTarget) : -1;
        this.manualTarget = alive[(cur + 1) % alive.length];
      }
      this.input.state.targetPressed = false;
    }

    let lock: Target | null = this.manualTarget && this.manualTarget.alive ? this.manualTarget : null;
    if (!lock) {
      // auto-lock nearest in front
      let best: Target | null = null;
      let bestScore = 0.4;
      for (const t of alive) {
        if (t.kind === 'fighter' && p.pos.distanceTo(t.pos) > 3800) continue;
        if (t.kind !== 'fighter' && p.pos.distanceTo(t.pos) > 3400) continue;
        const to = t.pos.clone().sub(p.pos).normalize();
        const dot = fwd.dot(to);
        if (dot < 0.55) continue;
        const angScore = (dot - 0.55) / 0.45;
        const distScore = 1 - clamp((t.pos.distanceTo(p.pos) - 120) / 3400, 0, 1);
        const score = angScore * 0.5 + distScore * 0.5;
        if (score > bestScore) {
          bestScore = score;
          best = t;
        }
      }
      lock = best;
      this.manualTarget = null;
    }

    if (lock && (!p.target || p.target.mesh !== lock.mesh)) {
      p.lockTime = 0;
    }
    if (lock) {
      p.lockTime += dt * 1.15;
      p.lockTime = Math.min(p.lockTime, 1.1);
    } else if (p.target) {
      p.lockTime = Math.max(0, p.lockTime - dt * 2.5);
    }

    if (lock) {
      const dist = p.pos.distanceTo(lock.pos);
      p.target = {
        kind: lock.kind,
        dist,
        name: lock.name,
        mesh: lock.mesh,
        pos: lock.pos,
        hp: lock.hp,
        maxHp: lock.maxHp,
        alive: lock.alive,
        primary: lock.primary,
      };
      // lock beeps
      const step = Math.min(Math.floor(p.lockTime / 0.35), 2);
      if (step !== this.lastBeepStep && p.lockTime < LOCK_TIME_NEEDED) {
        this.lastBeepStep = step;
        this.audio.lock();
      }
      if (p.lockTime >= LOCK_TIME_NEEDED && !this.lockBeeped) {
        this.lockBeeped = true;
        this.audio.locked();
      }
    } else {
      p.target = null;
      this.lastBeepStep = -1;
      this.lockBeeped = false;
    }
  }

  private targetYawTo(target: THREE.Vector3): number {
    const p = this.player.s.pos;
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    return Math.atan2(-dx, -dz);
  }

  private drawHUD(objective: string): void {
    const p = this.player.s;
    const ground = this.canyon.heightAt(p.pos.x, p.pos.z);
    const lock = p.target && p.target.alive
      ? {
          name: this.targetName(p.target),
          dist: p.target.dist,
          hp: p.target.hp,
          maxHp: p.target.maxHp,
          primary: p.target.primary,
          kind: p.target.kind,
          pos: p.target.pos,
        }
      : undefined;
    const snap: HUDSnapshot = {
      time: this.time,
      camera: this.camera,
      playerPos: p.pos,
      playerYaw: p.yaw,
      speed: p.speed,
      altAGL: Math.max(0, p.pos.y - ground),
      hp: p.hp,
      maxHp: p.maxHp,
      missiles: p.missiles,
      flares: p.flares,
      gunHeat: p.gunHeat,
      throttle: this.input.state.throttle,
      autoThrottle: this.input.state.autoThrottle,
      phase: this.mission.phase === 'extract' ? 'extract' : 'strike',
      objective,
      lock,
      lockTime: p.lockTime,
      targets: this.enemies.targets.map((t) => ({
        kind: t.kind,
        pos: t.pos,
        alive: t.alive,
        primary: t.primary,
        name: t.name,
      })),
      enemyMissiles: this.enemies.enemyMissiles.filter((m) => !m.dead).map((m) => m.pos),
      shells: this.enemies.shells.map((s) => ({ pos: s.pos, vel: s.vel })),
      extraction: this.mission.phase === 'extract' ? this.mission.extractionPos : undefined,
      terrainClearance: Math.max(0, p.pos.y - ground),
      destroyedCount: this.stats.primaryKills,
      quotaTotal: PRIMARY_QUOTA,
    };
    this.hud.draw(snap);
  }

  private targetName(t: { kind: string; name: string }): string {
    return t.name;
  }

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hudCanvas.width = Math.floor(w * Math.min(window.devicePixelRatio, 2));
    this.hudCanvas.height = Math.floor(h * Math.min(window.devicePixelRatio, 2));
    this.hudCanvas.style.width = `${w}px`;
    this.hudCanvas.style.height = `${h}px`;
    this.hud.resize(w, h, Math.min(window.devicePixelRatio, 2));
  };
}