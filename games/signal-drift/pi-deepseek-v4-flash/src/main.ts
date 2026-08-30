import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { World, RELAY_Z, EXTRACTION_Z } from './world';
import { Craft } from './craft';
import { Particles } from './particles';
import { Input } from './input';
import { Hud } from './hud';
import { AudioEngine } from './audio';
import { COURSE_SEED } from './rng';

/* ---------------- tuning constants ---------------- */
const CHARGE_MAX = 100;
const BASE_SPEED = 62;
const BOOST_SPEED = 99;
const DRAIN = 4.0;
const BOOST_DRAIN = 5.4;
const MAX_VX = 30;
const MAX_VY = 20;
const BOUND_X = 34;
const BOUND_Y_MIN = -17;
const BOUND_Y_MAX = 26;
const ORB_R = 3.4;
const ORB_CHARGE = 12;
const HIT_R = 3.0;
const HIT_DAMAGE = 24;
const ARCH_R = 9;

type Phase = 'ready' | 'playing' | 'paused' | 'won' | 'lost';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.1, 4500);
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private world: World;
  private craft = new Craft();
  private particles: Particles;
  private input: Input;
  private hud: Hud;
  private audio = new AudioEngine();
  private clockT = 0;
  private cosT = 0;
  private simT = 0;
  private raf = 0;
  private last = performance.now();
  private muted = false;

  // run state
  private phase: Phase = 'ready';
  private score = 0;
  private charge = CHARGE_MAX;
  private relaysRestored = 0;
  private restartCount = 0;
  private runTime = 0;
  private distance = 0;
  private vx = 0;
  private vy = 0;
  private speed = BASE_SPEED;
  private invuln = 0;
  private shake = 0;
  private fovKick = 0;
  private islandCd = 0;
  private shipPos = new THREE.Vector3(0, 2, 44);
  private camPos = new THREE.Vector3(0, 5.6, 53.6);
  private lightningFresh = false;

  // inspector contract
  private api = {
    phase: 'ready' as Phase,
    score: 0,
    player: { x: 0, y: 0, z: 0 },
    relaysRestored: 0,
    charge: CHARGE_MAX,
    seed: COURSE_SEED,
    restartCount: 0,
    nearestCharge: null as { x: number; y: number; z: number; d: number } | null,
  };

  constructor() {
    const app = document.getElementById('app') as HTMLDivElement;
    const w = window.innerWidth;
    const h = window.innerHeight;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    renderer.setSize(w, h);
    renderer.setPixelRatio(this.pickPixelRatio());
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    const canvas = renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    app.appendChild(canvas);
    this.renderer = renderer;

    this.camera.aspect = w / h;

    // lights
    const hemi = new THREE.HemisphereLight(0x8fb5ff, 0x16202f, 1.05);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffd9a0, 1.6);
    dir.position.set(60, 95, -160);
    this.scene.add(dir);
    const amb = new THREE.AmbientLight(0x22405e, 0.55);
    this.scene.add(amb);
    this.amb = amb;
    this.dir = dir;

    // fog
    this.scene.fog = new THREE.FogExp2(0x0a1224, 0.00175);

    // composer + bloom
    const small = Math.min(w, h) < 600;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      small ? 0.5 : 0.72,
      small ? 0.42 : 0.5,
      small ? 0.68 : 0.62
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    // world & craft
    this.world = new World(COURSE_SEED);
    this.world.init(this.scene);
    this.world.ensureChunks(0);
    this.scene.add(this.craft.group);
    this.particles = new Particles(this.scene, 760);

    // HUD + input
    this.hud = new Hud({
      onStart: () => this.startRun(),
      onResume: () => this.resume(),
      onPause: () => this.pause(),
      onRestart: () => this.restart(),
      onMute: () => this.toggleMute(),
    });
    this.input = new Input({
      onStart: () => this.startRun(),
      onTogglePause: () => {
        if (this.phase === 'playing') this.pause();
        else if (this.phase === 'paused') this.resume();
      },
      onRestart: () => {
        if (this.phase !== 'ready') this.restart();
      },
      onMute: () => this.toggleMute(),
    });
    this.input.attach(app, this.hud.root);

    this.hud.setMuteIcon(false);
    this.hud.showOverlay('ready');

    // window listeners
    window.addEventListener('resize', this.onResize);
    window.addEventListener('visibilitychange', this.onVisibility);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.pauseHard();
    });

    // inspector contract
    (window as unknown as { __AETHERPLAY__: unknown }).__AETHERPLAY__ = this.api;
  }

  private amb!: THREE.AmbientLight;
  private dir!: THREE.DirectionalLight;

  private pickPixelRatio(): number {
    const dpr = window.devicePixelRatio || 1;
    const small = Math.min(window.innerWidth, window.innerHeight) < 640;
    if (small) return Math.min(dpr, 1.6);
    return Math.min(dpr, 2);
  }

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(this.pickPixelRatio());
    this.composer.setSize(w, h);
  };

  private onVisibility = (): void => {
    if (document.hidden && this.phase === 'playing') this.pause();
  };

  private pauseHard(): void {
    this.pause();
  }

  /* ---------------- flow ---------------- */
  private startRun(): void {
    this.audio.start();
    this.resetRun();
    this.phase = 'playing';
    this.hud.showOverlay(null);
    this.hud.setObjective('Relay 1 of 3 — follow the beacon', false);
    this.hud.setPips(0);
  }

  private restart(): void {
    this.audio.start();
    this.resetRun();
    this.phase = 'playing';
    this.hud.showOverlay(null);
    this.hud.setObjective('Relay 1 of 3 — follow the beacon', false);
    this.hud.setPips(0);
    this.audio.click();
  }

  private resetRun(): void {
    this.restartCount++;
    this.score = 0;
    this.charge = CHARGE_MAX;
    this.relaysRestored = 0;
    this.runTime = 0;
    this.distance = 0;
    this.vx = 0;
    this.vy = 0;
    this.speed = BASE_SPEED;
    this.invuln = 1.4;
    this.shake = 0;
    this.fovKick = 0;
    this.simT = 0;
    this.shipPos.set(0, 2, 44);
    this.camPos.set(0, 5.6, 53.6);
    this.world.reset();
    this.world.ensureChunks(0);
    this.particles.clear();
    this.lightningFresh = false;
    this.syncApi();
  }

  private pause(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    this.syncApi();
    this.hud.showOverlay('pause');
    this.input.releaseAll();
    this.audio.setEngine(0, 0);
  }

  private resume(): void {
    if (this.phase !== 'paused') return;
    this.phase = 'playing';
    this.syncApi();
    this.hud.showOverlay(null);
    this.audio.start();
  }

  private toggleMute(): void {
    this.muted = !this.muted;
    this.audio.setMuted(this.muted);
    this.hud.setMuteIcon(this.muted);
  }

  private win(): void {
    this.phase = 'won';
    this.score += 2500;
    this.syncApi();
    this.audio.win();
    this.hud.setWonStats(this.score, this.runTime, this.charge);
    this.hud.showOverlay('won');
    this.hud.waypointHide();
    this.particles.burst(this.shipPos.x, this.shipPos.y, this.shipPos.z, 90, 0xffd9a0, 26, 1.6, { up: 6 });
    this.shake = 0.5;
  }

  private lose(reason: string): void {
    this.phase = 'lost';
    this.syncApi();
    this.audio.lose();
    this.hud.setLostStats(reason, this.score, this.relaysRestored, this.runTime);
    this.hud.showOverlay('lost');
    this.hud.waypointHide();
    this.particles.burst(this.shipPos.x, this.shipPos.y, this.shipPos.z, 80, 0xff5544, 18, 1.5, { up: 4 });
    this.shake = 0.9;
  }

  /* ---------------- main loop ---------------- */
  start(): void {
    this.last = performance.now();
    const loop = (): void => {
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.clockT += dt;
      this.cosT = this.clockT;
      this.update(dt);
      this.renderFrame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  private update(dt: number): void {
    this.input.frame();
    this.input.startArmed = this.phase === 'ready';
    this.world.ensureChunks(this.shipPos.z);

    const busy = this.phase !== 'ready';
    const playing = this.phase === 'playing';

    // cosmetic world always animates; hazards use sim time (frozen unless playing)
    this.world.update(dt, this.simT, this.cosT, this.shipPos);

    // ambient weather light
    const flash = this.world.strikeFlash;
    this.dir.intensity = 1.5 + flash * 0.9;
    this.amb.intensity = 0.5 + flash * 0.5;

    if (this.lightningFresh !== (flash > 0.05)) {
      this.lightningFresh = flash > 0.05;
      if (this.lightningFresh) this.audio.lightning();
    }

    if (playing) {
      this.simulate(dt);
    } else if (this.phase === 'ready') {
      // idle hover behind the start pad
      this.shipPos.y = 2 + Math.sin(this.cosT * 1.1) * 0.5;
      this.shipPos.x = Math.sin(this.cosT * 0.4) * 0.8;
      this.craft.update(dt, this.cosT, {
        roll: 0,
        pitch: 0.08,
        yaw: 0,
        speedFrac: 0.12,
        boost: false,
        invulnFlash: false,
      });
    } else {
      // paused / terminal: keep pose
      this.craft.update(dt, this.cosT, {
        roll: clamp(-this.vx * 0.04, -0.6, 0.6),
        pitch: clamp(-this.vy * 0.018, -0.3, 0.3),
        yaw: clamp(-this.vx * 0.016, -0.5, 0.5),
        speedFrac: 0,
        boost: false,
        invulnFlash: this.invuln > 0,
      });
    }

    this.particles.update(dt);
    this.audio.setEngine(playing ? this.speed / BOOST_SPEED : 0, playing && this.input.boost ? 1 : 0);

    // camera
    this.updateCamera(dt, playing);

    // inspector
    this.syncApi();
    const api = this.api;
    if (playing) {
      let best: { x: number; y: number; z: number; d: number } | null = null;
      for (const o of this.world.orbs) {
        if (o.taken) continue;
        const dz = o.z - this.shipPos.z;
        if (dz > -6 || dz < -260) continue;
        const d = Math.hypot(o.x - this.shipPos.x, o.y - this.shipPos.y, dz);
        if (d < 200 && (!best || d < best.d)) {
          best = { x: o.x, y: o.y, z: o.z, d };
        }
      }
      api.nearestCharge = best;
    }
  }

  /** Mirror current run state into the public inspector object. */
  private syncApi(): void {
    const api = this.api;
    api.phase = this.phase;
    api.score = this.score;
    api.player.x = this.shipPos.x;
    api.player.y = this.shipPos.y;
    api.player.z = this.shipPos.z;
    api.relaysRestored = this.relaysRestored;
    api.charge = this.charge;
    api.restartCount = this.restartCount;
  }

  private simulate(dt: number): void {
    this.simT += dt;
    this.runTime += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.islandCd = Math.max(0, this.islandCd - dt);
    this.shake *= Math.exp(-dt * 3.6);
    this.fovKick *= Math.exp(-dt * 3);

    const boost = this.input.boost;

    // steering
    const ax = this.input.lx * MAX_VX;
    const ay = this.input.ly * MAX_VY;
    const k = 1 - Math.exp(-dt * 3.4);
    this.vx += (ax - this.vx) * k;
    this.vy += (ay - this.vy) * k;
    this.shipPos.x += this.vx * dt;
    this.shipPos.y += this.vy * dt;

    // speed
    const target = boost ? BOOST_SPEED : BASE_SPEED;
    this.speed += (target - this.speed) * (1 - Math.exp(-dt * 2.3));
    this.shipPos.z -= this.speed * dt;

    // bounds
    if (this.shipPos.x < -BOUND_X) {
      this.shipPos.x = -BOUND_X;
      this.vx = Math.max(0, this.vx);
    } else if (this.shipPos.x > BOUND_X) {
      this.shipPos.x = BOUND_X;
      this.vx = Math.min(0, this.vx);
    }
    if (this.shipPos.y < BOUND_Y_MIN) {
      this.shipPos.y = BOUND_Y_MIN;
      this.vy = Math.max(0, this.vy);
    } else if (this.shipPos.y > BOUND_Y_MAX) {
      this.shipPos.y = BOUND_Y_MAX;
      this.vy = Math.min(0, this.vy);
    }

    // islands: gentle push-out collision
    if (this.islandCd <= 0) {
      for (const isl of this.world.islands) {
        const dz = this.shipPos.z - isl.z;
        if (dz > 34 || dz < -34) continue;
        const dx = this.shipPos.x - isl.x;
        const dy = this.shipPos.y - isl.y;
        const rad = Math.hypot(dx, dz);
        const rMax = isl.r + 1.2;
        if (rad < rMax && Math.abs(dy) < isl.h * 0.9 + 1.0) {
          const nx = rad > 0.001 ? dx / rad : (Math.random() - 0.5);
          const nz = rad > 0.001 ? dz / rad : (Math.random() - 0.5);
          const push = rMax - rad;
          this.shipPos.x += nx * push;
          this.shipPos.z += nz * push;
          this.vx -= nx * 22;
          this.vy += dy > 0 ? 6 : -6;
          this.charge -= 2.2;
          this.islandCd = 0.7;
          this.shake = Math.max(this.shake, 0.3);
          this.hud.flashColor('white', 0.3);
          this.particles.burst(this.shipPos.x, this.shipPos.y, this.shipPos.z, 10, 0x8f9fb0, 8, 0.6);
          break;
        }
      }
    }

    // distance / score / charge
    this.distance += this.speed * dt;
    this.score += this.speed * dt * 0.1;
    this.charge -= (DRAIN + (boost ? BOOST_DRAIN : 0)) * dt;
    if (this.charge <= 0) {
      this.charge = 0;
      this.lose('The craft ran out of charge in the storm.');
      return;
    }
    if (this.charge < 22) this.audio.lowCharge();

    // thrust particles
    this.particles.spawn(
      this.shipPos.x, this.shipPos.y, this.shipPos.z + 2.2,
      (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, 14 + Math.random() * 16,
      0.5,
      boost ? 0xffc857 : 0x5ee8ff,
      { size: 0.9 }
    );
    if (boost) {
      this.particles.spawn(
        this.shipPos.x, this.shipPos.y, this.shipPos.z + 2.2,
        (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, 30 + Math.random() * 20,
        0.55,
        0xff8844,
        { size: 1.5 }
      );
    }

    // orbs
    for (let i = this.world.orbs.length - 1; i >= 0; i--) {
      const o = this.world.orbs[i];
      if (o.taken) continue;
      const dx = this.shipPos.x - o.mesh.position.x;
      const dy = this.shipPos.y - o.mesh.position.y;
      const dz = this.shipPos.z - o.mesh.position.z;
      if (dx * dx + dy * dy + dz * dz < ORB_R * ORB_R) {
        o.taken = true;
        o.mesh.visible = false;
        this.charge = Math.min(CHARGE_MAX, this.charge + ORB_CHARGE);
        this.score += 50;
        this.audio.pickup();
        const sp = this.toScreen(o.mesh.position);
        this.hud.toast(`+${ORB_CHARGE} ⚡`, sp.x, sp.y);
        this.particles.burst(o.mesh.position.x, o.mesh.position.y, o.mesh.position.z, 9, 0x4fe8dd, 7, 0.7);
      }
    }

    // signal arches
    for (const a of this.world.arches) {
      if (a.used) continue;
      const dz = this.shipPos.z - a.z;
      if (Math.abs(dz) > 6) continue;
      const d2 = (this.shipPos.x - a.x) * (this.shipPos.x - a.x) + (this.shipPos.y - a.y) * (this.shipPos.y - a.y);
      if (d2 < ARCH_R * ARCH_R) {
        a.used = true;
        this.charge = Math.min(CHARGE_MAX, this.charge + 2);
        this.score += 25;
        this.audio.arch();
        this.particles.burst(a.x, a.y, a.z, 14, 0x9ff5ff, 10, 0.8);
      }
    }

    // relays
    if (this.relaysRestored < 3) {
      const gate = this.world.relays[this.relaysRestored];
      const gx = gate.x, gy = gate.y, gz = gate.z;
      const dx = this.shipPos.x - gx;
      const dy = this.shipPos.y - gy;
      const dz = this.shipPos.z - gz;
      if (dx * dx + dy * dy + dz * dz < 14 * 14 && Math.abs(dz) < 90) {
        gate.startRestore();
        this.relaysRestored++;
        this.score += 1000;
        this.charge = Math.min(CHARGE_MAX, this.charge + 30);
        this.fovKick = 7;
        this.shake = Math.max(this.shake, 0.35);
        this.audio.relay();
        this.audio.restoreHum();
        const sp = this.toScreen(new THREE.Vector3(gx, gy, gz));
        this.hud.toast(`RELAY ${this.relaysRestored}/3 +1000`, sp.x, sp.y - 40, 'gold', true);
        this.particles.burst(gx, gy, gz, 70, this.relaysRestored === 3 ? 0x4fd8ff : 0x4fe8dd, 20, 1.4, { up: 3 });
        if (this.relaysRestored < 3) {
          this.world.activeRelay = this.relaysRestored;
          this.hud.setObjective(`Relay ${this.relaysRestored + 1} of 3 — follow the beacon`, false);
          this.hud.toast('RELAY ONLINE — NEXT TARGET LOCKED', window.innerWidth / 2, window.innerHeight * 0.32, 'teal', false);
        } else {
          this.world.activeRelay = 3;
          this.world.extraction.setActive(true);
          this.hud.setObjective('All relays online — cross the extraction ring', true);
          this.hud.toast('EXTRACTION RING OPEN', window.innerWidth / 2, window.innerHeight * 0.32, 'gold', true);
        }
        this.hud.setPips(this.relaysRestored);
      }
    }

    // extraction
    if (this.relaysRestored >= 3) {
      const ex = this.world.extraction;
      const dx = this.shipPos.x - ex.x;
      const dy = this.shipPos.y - ex.y;
      const dz = this.shipPos.z - ex.z;
      if (dx * dx + dy * dy + dz * dz < 12 * 12) {
        this.win();
        return;
      }
    }

    // hazard collisions
    if (this.invuln <= 0) {
      for (const m of this.world.mines) {
        if (m.gone) continue;
        const p = m.group.position;
        const dx = this.shipPos.x - p.x;
        const dy = this.shipPos.y - p.y;
        const dz = this.shipPos.z - p.z;
        if (dx * dx + dy * dy + dz * dz < 3.0 * 3.0) {
          this.hitHazard(m.x, m.y, m.z, 'mine');
          m.gone = true;
          m.group.visible = false;
          break;
        }
      }
      for (const d of this.world.drones) {
        if (d.gone) continue;
        const p = d.group.position;
        const dx = this.shipPos.x - p.x;
        const dy = this.shipPos.y - p.y;
        const dz = this.shipPos.z - p.z;
        if (dx * dx + dy * dy + dz * dz < 3.4 * 3.4) {
          this.hitHazard(p.x, p.y, p.z, 'drone');
          d.gone = true;
          d.group.visible = false;
          break;
        }
      }
    }

    // HUD
    this.hud.setScore(this.score);
    this.hud.setSpeed(this.speed, boost);
    this.hud.setCharge(this.charge, CHARGE_MAX);
    this.hud.setVignette(this.charge < 22, boost);
    if (this.relaysRestored >= 3) {
      this.hud.setObjective('All relays online — cross the extraction ring', this.charge < 22);
    } else {
      this.hud.setObjective(`Relay ${this.relaysRestored + 1} of 3 — follow the beacon`, this.charge < 22);
    }

    // waypoint
    this.updateWaypoint();

    // craft pose
    const speedFrac = (this.speed - BASE_SPEED) / (BOOST_SPEED - BASE_SPEED);
    const roll = clamp(-this.vx * 0.045 - this.input.lx * 0.12, -0.75, 0.75) ;
    const pitch = clamp(-this.vy * 0.022 + 0.1, -0.45, 0.45);
    const yaw = clamp(-this.vx * 0.02, -0.5, 0.5);
    this.craft.update(dt, this.cosT, {
      roll,
      pitch,
      yaw,
      speedFrac,
      boost,
      invulnFlash: this.invuln > 0,
    });
  }

  private hitHazard(x: number, y: number, z: number, kind: 'mine' | 'drone'): void {
    this.charge -= HIT_DAMAGE;
    this.invuln = 1.6;
    this.shake = 0.65;
    this.fovKick = 5;
    this.hud.flashColor('red', 1);
    const sp = this.toScreen(new THREE.Vector3(x, y, z));
    this.hud.toast(`-${HIT_DAMAGE} ⚡`, sp.x, sp.y - 20, 'gold');
    this.audio.hit();
    this.particles.burst(x, y, z, 40, kind === 'mine' ? 0xff3355 : 0xff4433, 16, 1.0, { up: 2 });
    if (this.charge <= 0) {
      this.charge = 0;
      this.lose(kind === 'mine' ? 'The storm mines tore the hull apart.' : 'A storm sentinel rammed you. Signal lost.');
    }
  }

  private updateWaypoint(): void {
    let tx: number, ty: number, tz: number;
    let gold = false;
    if (this.relaysRestored < 3) {
      const g = this.world.relays[this.relaysRestored];
      tx = g.x; ty = g.y; tz = g.z;
    } else {
      tx = this.world.extraction.x; ty = this.world.extraction.y; tz = this.world.extraction.z;
      gold = true;
    }
    const v = new THREE.Vector3(tx, ty, tz).project(this.camera);
    const behind = v.z > 1;
    if (behind) {
      v.x = -v.x;
      v.y = -v.y;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    let sx = (v.x * 0.5 + 0.5) * w;
    let sy = (-v.y * 0.5 + 0.5) * h;
    const m = 46;
    const dx = sx - w / 2;
    const dy = sy - h / 2;
    const dist = Math.hypot(this.shipPos.x - tx, this.shipPos.y - ty, this.shipPos.z - tz);
    if (!behind && Math.abs(dx) < 26 && Math.abs(dy) < 26) {
      this.hud.waypointHide();
      return;
    }
    const cx = clamp(sx, m, w - m);
    const cy = clamp(sy, m, h - m);
    const angle = (Math.atan2(cy - h / 2, cx - w / 2) * 180) / Math.PI + 90;
    this.hud.waypointShow(cx, cy, angle, dist, gold);
  }

  private updateCamera(dt: number, playing: boolean): void {
    const speedFrac = playing ? clamp((this.speed - BASE_SPEED) / (BOOST_SPEED - BASE_SPEED), 0, 1) : 0.05;
    let tx = this.shipPos.x - this.vx * 0.55;
    let ty = this.shipPos.y + 3.7;
    let tz = this.shipPos.z + 9.6;
    if (!playing && this.phase === 'ready') {
      tx += Math.sin(this.cosT * 0.25) * 1.4;
    }
    tx += (Math.random() - 0.5) * this.shake * 1.4;
    ty += (Math.random() - 0.5) * this.shake * 1.1;
    tz += (Math.random() - 0.5) * this.shake * 1.4;
    const k = 1 - Math.exp(-dt * 5.2);
    this.camPos.x += (tx - this.camPos.x) * k;
    this.camPos.y += (ty - this.camPos.y) * k;
    this.camPos.z += (tz - this.camPos.z) * k;
    this.camera.position.copy(this.camPos);
    const look = new THREE.Vector3(
      this.shipPos.x + this.vx * 0.6,
      this.shipPos.y + 1.35 + this.vy * 0.3,
      this.shipPos.z - 13 - speedFrac * 9
    );
    this.camera.lookAt(look);

    const fovTarget = 60 + speedFrac * 20 + this.fovKick + Math.random() * this.shake * 1.4;
    if (Math.abs(fovTarget - this.camera.fov) > 0.05) {
      this.camera.fov += (fovTarget - this.camera.fov) * Math.min(1, dt * 6);
      this.camera.updateProjectionMatrix();
    }
  }

  private toScreen(v: THREE.Vector3): { x: number; y: number } {
    const p = v.clone().project(this.camera);
    return {
      x: (p.x * 0.5 + 0.5) * window.innerWidth,
      y: (-p.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  private renderFrame(): void {
    this.composer.render();
  }
}

// boot
try {
  const game = new Game();
  game.start();
} catch (err) {
  console.error(err);
  const root = document.getElementById('app');
  if (root) {
    root.innerHTML = `<div style="font-family:system-ui;padding:2rem;color:#f6f5ef">
      <h2>Signal Drift could not start</h2>
      <p style="color:#9fd4ff">WebGL appears to be unavailable in this browser.</p></div>`;
  }
}