import * as THREE from 'three';
import { AudioEngine } from './core/audio';
import { Input } from './core/input';
import { approach, clamp, lerp, Rng } from './core/rng';
import { Craft } from './entities/craft';
import { ParticleSystem, SpeedStreaks } from './fx/particles';
import { PostFX } from './fx/post';
import { Hud, Phase } from './ui/hud';
import { Course } from './world/course';
import { ChargeField, HazardField, RelayGate } from './world/entities';
import { Environment } from './world/environment';
import { Track } from './world/track';

export const SEED = 94721;

const MAX_CHARGE = 100;
const CRUISE_SPEED = 56;
const BOOST_SPEED = 94;
const BRAKE_SPEED = 32;
const MAX_LATERAL = 30;
const MAX_VERTICAL = 23;
const HIT_COST = 14;
const SCRAPE_COST = 15;
const MOTE_CHARGE = 8;
const RELAY_CHARGE = 24;
const INVULN = 1.5;

interface Telemetry {
  phase: Phase;
  score: number;
  player: { x: number; y: number; z: number };
  relaysRestored: number;
  charge: number;
  seed: number;
  restartCount: number;
  speed: number;
  objective: string;
  elapsed: number;
  lap: number;
  distanceToTarget: number;
  /** Craft offset from the corridor centre line, in corridor space. */
  lateral: number;
  vertical: number;
  hits: number;
  motes: number;
  fps: number;
}

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly course: Course;
  private readonly track: Track;
  private readonly environment: Environment;
  private readonly craft: Craft;
  private readonly particles: ParticleSystem;
  private readonly streaks: SpeedStreaks;
  private readonly charges: ChargeField;
  private readonly hazards: HazardField;
  private readonly gates: RelayGate[] = [];
  private readonly extraction: RelayGate;
  private readonly post: PostFX;
  private readonly hud: Hud;
  private readonly input: Input;
  private readonly audio = new AudioEngine();
  private readonly rng = new Rng(SEED);

  // --- run state ---
  private phase: Phase = 'ready';
  private distance = 0;
  private prevDistance = 0;
  private lateral = 0;
  private vertical = 0;
  private latVel = 0;
  private vertVel = 0;
  private speed = CRUISE_SPEED;
  private charge = MAX_CHARGE;
  private score = 0;
  private relaysRestored = 0;
  private restartCount = 0;
  private elapsed = 0;
  private worldTime = 0;
  private invuln = 0;
  private wallHeat = 0;
  private trauma = 0;
  private lap = 0;
  private hits = 0;
  private motes = 0;
  private combo = 0;
  private comboTimer = 0;
  private endTimer = 0;
  private endReason = '';
  private alarmTimer = 0;
  private lastFrame = 0;
  private frameAvg = 16;
  private slowFrames = 0;
  private quality = 3;
  private qualityCooldown = 1.5;
  private qualityPinned = false;
  private running = false;
  private pausedByVisibility = false;
  private readonly startDistance: number;

  // --- scratch ---
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly camTarget = new THREE.Vector3();
  private readonly backward = new THREE.Vector3();
  private readonly trailColor = new THREE.Color(0x58d8ff);
  private readonly boostTrailColor = new THREE.Color(0xa8f0ff);
  private emitAccumulator = 0;
  private readonly flashColor = new THREE.Color(0x6ff5ff);
  private flash = 0;
  private damageFx = 0;
  private camLat = 0;
  private camVert = 0;
  private camRoll = 0;
  private fovBase = 66;

  private readonly telemetry: Telemetry = {
    phase: 'ready',
    score: 0,
    player: { x: 0, y: 0, z: 0 },
    relaysRestored: 0,
    charge: MAX_CHARGE,
    seed: SEED,
    restartCount: 0,
    speed: 0,
    objective: '',
    elapsed: 0,
    lap: 0,
    distanceToTarget: 0,
    lateral: 0,
    vertical: 0,
    hits: 0,
    motes: 0,
    fps: 0,
  };

  constructor(private readonly container: HTMLElement) {
    // Optional graphics override, e.g. ?q=high on a machine the auto-scaler
    // would otherwise under-estimate.
    const q = new URLSearchParams(window.location.search).get('q');
    if (q === 'high' || q === 'low') {
      this.qualityPinned = true;
      this.quality = q === 'high' ? 3 : 0;
    }

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(this.targetPixelRatio());
    this.renderer.setSize(container.clientWidth, container.clientHeight, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene.fog = new THREE.FogExp2(0x22384c, 0.0022);

    this.camera = new THREE.PerspectiveCamera(
      this.fovBase,
      Math.max(0.35, container.clientWidth / Math.max(1, container.clientHeight)),
      0.5,
      6000,
    );
    // Soft fill riding the camera so the craft never silhouettes into mush
    // when it crosses a blazing relay gate.
    const fill = new THREE.PointLight(0xbcd8ff, 26, 55, 2);
    fill.position.set(0, 1.5, 1);
    this.camera.add(fill);
    this.scene.add(this.camera);

    this.course = new Course(this.rng);
    this.startDistance = 0;

    const gateDistances = [0.14, 0.44, 0.73].map((t) => this.course.wrap(t * this.course.length));
    const extractionDistance = this.course.wrap(0.885 * this.course.length);
    const avoid = [...gateDistances, extractionDistance, this.startDistance];
    // Apertures sit off the centre line so each relay has to be flown to.
    const gateOffsets: Array<[number, number]> = [
      [this.course.radiusX * 0.3, this.course.radiusY * 0.28],
      [-this.course.radiusX * 0.52, -this.course.radiusY * 0.34],
      [this.course.radiusX * 0.48, -this.course.radiusY * 0.42],
    ];

    this.environment = new Environment(this.rng);
    this.scene.add(this.environment.group);
    this.scene.environment = this.environment.buildEnvironment(this.renderer);
    this.scene.environmentIntensity = 0.45;

    this.track = new Track(this.course, this.rng);
    this.scene.add(this.track.group);

    gateDistances.forEach((d, i) => {
      const gate = new RelayGate(this.course, d, i, gateOffsets[i][0], gateOffsets[i][1]);
      this.gates.push(gate);
      this.scene.add(gate.group);
    });
    this.extraction = new RelayGate(this.course, extractionDistance, 3, 0, 0, true);
    this.scene.add(this.extraction.group);

    this.charges = new ChargeField(this.course, this.rng, avoid);
    this.scene.add(this.charges.mesh);

    this.hazards = new HazardField(this.course, this.rng, avoid);
    this.scene.add(this.hazards.drifters, this.hazards.cores, this.hazards.sweepers);

    this.craft = new Craft();
    this.scene.add(this.craft.root);

    this.particles = new ParticleSystem(1000);
    this.scene.add(this.particles.points);

    this.streaks = new SpeedStreaks(this.rng);
    this.scene.add(this.streaks.lines);

    this.post = new PostFX(
      this.renderer,
      this.scene,
      this.camera,
      Math.max(1, container.clientWidth),
      Math.max(1, container.clientHeight),
    );

    if (this.qualityPinned && this.quality === 0) {
      this.post.setBloomEnabled(false);
      this.post.setBypass(true);
    }

    this.hud = new Hud(container);
    this.input = new Input(this.renderer.domElement);

    this.hud.onStart = () => this.beginRun();
    this.hud.onRestart = () => this.beginRun();
    this.hud.onResume = () => this.resume();
    this.hud.onToggleMute = () => this.toggleMute();

    this.input.onFirstGesture = () => this.audio.start();
    this.input.onStickMove = (ox, oy, kx, ky, active) => {
      if (active && this.input.usingTouch) this.hud.setStick(ox, oy, kx, ky, true);
      else this.hud.setStick(0, 0, 0, 0, false);
    };
    this.input.onAction = (action) => {
      switch (action) {
        case 'start':
          if (this.phase === 'ready') this.beginRun();
          else if (this.phase === 'won' || this.phase === 'lost') this.beginRun();
          else if (this.phase === 'paused') this.resume();
          break;
        case 'restart':
          if (this.phase !== 'ready') this.beginRun();
          break;
        case 'pause':
          if (this.phase === 'playing') this.pause(false);
          else if (this.phase === 'paused') this.resume();
          break;
        case 'mute':
          this.toggleMute();
          break;
      }
    };
    this.input.bindBoostButton(this.hud.boostButton);
    this.input.bindBrakeButton(this.hud.brakeButton);
    this.input.onTouchDetected = () => this.hud.setTouchVisible(true);
    this.hud.setTouchVisible(this.input.usingTouch);

    // Tapping the field on the title / result screens also starts a run.
    this.renderer.domElement.addEventListener('pointerdown', () => {
      this.audio.start();
      if (this.phase === 'ready' || this.phase === 'won' || this.phase === 'lost') {
        this.beginRun();
      } else if (this.phase === 'paused' && !this.pausedByVisibility) {
        this.resume();
      }
    });

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.resetRun(false);
    this.hud.showTitle();
    this.hud.setHudVisible(false);
    this.onResize();
    this.publish();
  }

  // ---------------------------------------------------------------- lifecycle

  startLoop(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  private targetPixelRatio(): number {
    const dpr = window.devicePixelRatio || 1;
    const caps = [0.75, 1, 1.35, 1.9];
    return Math.min(dpr, caps[clamp(this.quality, 0, 3)]);
  }

  private onResize = (): void => {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const aspect = w / h;
    this.camera.aspect = aspect;

    // Keep a roughly constant horizontal field of view so portrait phones
    // still show the corridor walls without a fisheye.
    const hFov = THREE.MathUtils.degToRad(100);
    const vFov = 2 * Math.atan(Math.tan(hFov / 2) / aspect);
    this.fovBase = clamp(THREE.MathUtils.radToDeg(vFov), 58, 82);
    this.camera.fov = this.fovBase;
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(this.targetPixelRatio());
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.particles.setViewportScale(h);
    this.input?.refreshTouchCapability();
  };

  private onVisibility = (): void => {
    if (document.hidden) {
      if (this.phase === 'playing') {
        this.pausedByVisibility = true;
        this.pause(true);
      }
      this.audio.suspend();
    } else {
      this.audio.resume();
      this.lastFrame = performance.now();
    }
  };

  private toggleMute(): void {
    this.audio.start();
    this.audio.setMuted(!this.audio.muted);
    this.hud.setMuteLabel(this.audio.muted);
    this.audio.ui();
  }

  private pause(byVisibility: boolean): void {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    this.pausedByVisibility = byVisibility;
    this.input.releaseAll();
    this.hud.showPaused();
    this.audio.setDrive(0, 0, false);
    this.publish();
  }

  private resume(): void {
    if (this.phase !== 'paused') return;
    this.phase = 'playing';
    this.pausedByVisibility = false;
    this.hud.hideOverlay();
    this.lastFrame = performance.now();
    this.audio.resume();
    this.publish();
  }

  private resetRun(counts: boolean): void {
    if (counts) this.restartCount++;
    this.distance = this.startDistance;
    this.prevDistance = this.startDistance;
    this.lateral = 0;
    this.vertical = 0;
    this.latVel = 0;
    this.vertVel = 0;
    this.speed = CRUISE_SPEED;
    this.charge = MAX_CHARGE;
    this.score = 0;
    this.relaysRestored = 0;
    this.elapsed = 0;
    this.invuln = 0;
    this.wallHeat = 0;
    this.trauma = 0;
    this.lap = 0;
    this.hits = 0;
    this.motes = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.endTimer = 0;
    this.endReason = '';
    this.damageFx = 0;
    this.flash = 0;
    this.camLat = 0;
    this.camVert = 0;
    this.camRoll = 0;
    this.craft.root.visible = true;

    this.charges.reset();
    this.hazards.reset();
    this.particles.clear();
    this.gates.forEach((g, i) => g.setState(i === 0 ? 'active' : 'locked'));
    this.extraction.setState('locked');
    this.placeCraft();
    this.updateCamera(0, true);
  }

  private beginRun(): void {
    const wasFirst = this.phase === 'ready' && this.restartCount === 0 && this.elapsed === 0;
    this.audio.start();
    this.resetRun(!wasFirst);
    this.phase = 'playing';
    this.hud.hideOverlay();
    this.hud.setHudVisible(true);
    this.hud.toast('Relay 01 — go', false, 1.6);
    this.lastFrame = performance.now();
    this.audio.ui();
    this.publish();
  }

  private finish(won: boolean, reason: string): void {
    if (this.phase !== 'playing') return;
    this.phase = won ? 'won' : 'lost';
    this.endReason = reason;
    this.endTimer = 1.15;
    this.flash = won ? 0.7 : 0.45;
    this.flashColor.setHex(won ? 0x9fffe8 : 0xff6a52);
    this.trauma = won ? 0.45 : 1;
    if (won) {
      this.score += Math.round(this.charge * 15 + Math.max(0, 9000 - this.elapsed * 60));
      this.audio.win();
      this.craft.flashHit();
      this.tmpA.copy(this.craft.root.position);
      this.particles.burst(this.tmpA, new THREE.Color(0x9fffe8), 90, 26, 1.2, 1.5);
    } else {
      this.audio.lose();
      this.tmpA.copy(this.craft.root.position);
      this.particles.burst(this.tmpA, new THREE.Color(0xff7a3c), 120, 30, 1.4, 1.6);
      this.particles.burst(this.tmpA, new THREE.Color(0xffe6a0), 40, 14, 1.0, 1.1);
      this.craft.root.visible = false;
    }
    this.audio.setDrive(0, 0, false);
    this.publish();
  }

  // ------------------------------------------------------------------- update

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    let raw = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (!Number.isFinite(raw) || raw <= 0) raw = 0.016;
    // Simulation runs on a clamped step so a stall never teleports the craft.
    const dt = clamp(raw, 0, 0.05);

    this.frameAvg = lerp(this.frameAvg, Math.min(raw, 0.5) * 1000, 0.08);
    this.adaptQuality(dt);

    this.input.sample();
    this.worldTime += dt;

    if (this.phase === 'playing') {
      this.simulate(dt);
    } else if (this.phase === 'ready') {
      this.idleCamera(dt);
    } else if (this.phase === 'won' || this.phase === 'lost') {
      this.coast(dt);
    }

    if (this.phase !== 'paused') {
      this.charges.update(dt, this.worldTime);
      this.hazards.update(this.worldTime);
      for (const gate of this.gates) gate.update(dt, this.worldTime);
      this.extraction.update(dt, this.worldTime);
      this.particles.update(dt);
      this.track.update(this.worldTime, this.distance, this.wallHeat);
      this.environment.update(dt, this.worldTime, this.camera.position);
      this.hud.tick(dt);
    }

    this.flash = Math.max(0, this.flash - dt * 3.6);
    this.damageFx = Math.max(0, this.damageFx - dt * 1.6);
    this.post.update(this.worldTime, {
      damage: Math.min(1, this.damageFx + this.wallHeat * 0.5 + this.lowChargeFactor() * 0.35),
      flash: this.flash,
      flashColor: this.flashColor,
      speed: clamp((this.speed - CRUISE_SPEED * 0.6) / (BOOST_SPEED - CRUISE_SPEED * 0.6), 0, 1),
    });

    this.post.render();
    this.publish();
  };

  private lowChargeFactor(): number {
    return this.charge < 30 ? (30 - this.charge) / 30 : 0;
  }

  /**
   * Drops render quality when the device cannot keep up: first resolution,
   * then bloom, then the whole post stack. Never steps back up, so the frame
   * rate cannot oscillate.
   */
  private adaptQuality(dt: number): void {
    if (this.qualityPinned) return;
    if (this.qualityCooldown > 0) {
      this.qualityCooldown -= dt;
      return;
    }
    if (this.quality <= 0) return;
    if (this.frameAvg > 33) {
      this.slowFrames++;
      if (this.slowFrames > 24) {
        this.quality--;
        this.slowFrames = 0;
        this.qualityCooldown = 1.2;
        const w = Math.max(1, this.container.clientWidth);
        const h = Math.max(1, this.container.clientHeight);
        this.renderer.setPixelRatio(this.targetPixelRatio());
        this.renderer.setSize(w, h, false);
        this.post.setSize(w, h);
        if (this.quality <= 1) this.post.setBloomEnabled(false);
        if (this.quality <= 0) this.post.setBypass(true);
      }
    } else {
      this.slowFrames = Math.max(0, this.slowFrames - 1);
    }
  }

  private simulate(dt: number): void {
    this.elapsed += dt;

    // ---- throttle -------------------------------------------------------
    const boosting = this.input.boost && this.charge > 1;
    const braking = this.input.brake;
    const targetSpeed = boosting ? BOOST_SPEED : braking ? BRAKE_SPEED : CRUISE_SPEED;
    this.speed = lerp(this.speed, targetSpeed, approach(boosting ? 2.2 : 1.6, dt));

    // ---- steering -------------------------------------------------------
    const steerTarget = this.input.steer * MAX_LATERAL;
    const climbTarget = this.input.climb * MAX_VERTICAL;
    this.latVel = lerp(this.latVel, steerTarget, approach(5.5, dt));
    this.vertVel = lerp(this.vertVel, climbTarget, approach(5.0, dt));
    this.lateral += this.latVel * dt;
    this.vertical += this.vertVel * dt;

    this.prevDistance = this.distance;
    const travelled = this.speed * dt;
    this.distance = this.course.wrap(this.distance + travelled);
    if (this.prevDistance > this.distance + this.course.length * 0.5) this.lap++;

    // ---- corridor walls -------------------------------------------------
    const overlap = this.course.wallOverlap(this.lateral, this.vertical);
    if (overlap > 0) {
      const k = 1 / (1 + overlap);
      this.lateral *= k;
      this.vertical *= k;
      this.latVel *= 0.72;
      this.vertVel *= 0.72;
      this.speed = Math.max(BRAKE_SPEED, this.speed - 55 * dt);
      this.wallHeat = Math.min(1, this.wallHeat + dt * 3.5);
      this.trauma = Math.min(1, this.trauma + dt * 1.6);
      this.applyDamage(SCRAPE_COST * dt, false);
      if (Math.random() < 1 - Math.exp(-26 * dt)) {
        this.course.toWorld(this.distance, this.lateral, this.vertical, this.tmpA);
        this.tmpB.set(
          (Math.random() - 0.5) * 12,
          (Math.random() - 0.5) * 12,
          (Math.random() - 0.5) * 12,
        );
        this.particles.spawn(this.tmpA, this.tmpB, new THREE.Color(0xffb347), 0.5, 0.4, 2.4);
      }
      if (Math.random() < 1 - Math.exp(-5 * dt)) this.audio.scrape(0.4);
      this.hud.toast('Hull scrape', true, 0.7);
    } else {
      this.wallHeat = Math.max(0, this.wallHeat - dt * 1.8);
    }

    // ---- charge ---------------------------------------------------------
    const drain = 2.4 + this.relaysRestored * 0.4 + (boosting ? 3.4 : 0) - (braking ? 0.8 : 0);
    this.charge -= drain * dt;
    this.score += travelled * 0.6;

    if (this.invuln > 0) this.invuln -= dt;
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    this.collectMotes(travelled);
    this.checkHazards(travelled);
    this.checkGates();

    // ---- warnings -------------------------------------------------------
    if (this.charge < 25) {
      this.alarmTimer -= dt;
      if (this.alarmTimer <= 0) {
        this.alarmTimer = this.charge < 12 ? 0.55 : 1.1;
        this.audio.alarm();
        this.hud.toast('Charge critical', true, 0.9);
      }
    }

    if (this.charge <= 0) {
      this.charge = 0;
      this.finish(false, 'The cells ran dry and the craft went silent over the cloud deck.');
      return;
    }

    this.placeCraft();
    this.emitThrusters(dt, boosting);
    this.streaks.update(
      this.course,
      this.distance,
      travelled,
      clamp((this.speed - BRAKE_SPEED) / (BOOST_SPEED - BRAKE_SPEED), 0, 1),
    );
    this.craft.update(
      dt,
      this.worldTime,
      this.input.steer,
      this.input.climb,
      clamp((this.speed - BRAKE_SPEED) / (BOOST_SPEED - BRAKE_SPEED), 0, 1),
      Math.max(this.wallHeat, this.lowChargeFactor()),
    );
    this.updateCamera(dt, false);

    this.audio.setDrive(
      boosting ? 1 : braking ? 0.25 : 0.6,
      clamp((this.speed - BRAKE_SPEED) / (BOOST_SPEED - BRAKE_SPEED), 0, 1),
      true,
    );

    this.hud.update({
      charge: this.charge,
      relaysRestored: this.relaysRestored,
      objective: this.objectiveText(),
      score: this.score,
      speed01: clamp((this.speed - BRAKE_SPEED) / (BOOST_SPEED - BRAKE_SPEED), 0, 1),
      danger: Math.max(this.wallHeat * 0.6, this.lowChargeFactor(), this.damageFx),
    });
  }

  private coast(dt: number): void {
    this.speed = lerp(this.speed, this.phase === 'won' ? 26 : 0, approach(1.4, dt));
    const travelled = this.speed * dt;
    this.prevDistance = this.distance;
    this.distance = this.course.wrap(this.distance + travelled);
    if (this.craft.root.visible) {
      this.placeCraft();
      this.craft.update(dt, this.worldTime, 0, 0, 0.2, 0);
      this.emitThrusters(dt, false);
    }
    this.streaks.update(this.course, this.distance, travelled, 0.15);
    this.updateCamera(dt, false);
    if (this.endTimer > 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) {
        this.hud.setHudVisible(false);
        this.hud.showResult(this.phase === 'won', {
          score: this.score,
          relaysRestored: this.relaysRestored,
          time: this.elapsed,
          charge: this.charge,
          reason: this.endReason,
        });
      }
    }
  }

  private idleCamera(dt: number): void {
    this.placeCraft();
    this.craft.update(dt, this.worldTime, Math.sin(this.worldTime * 0.6) * 0.35, 0, 0.35, 0);
    this.emitThrusters(dt, false);
    const t = this.worldTime * 0.28;
    this.course.toWorld(
      this.distance - 17 + Math.sin(t * 0.8) * 4,
      Math.sin(t) * 15,
      6 + Math.cos(t * 0.7) * 4,
      this.tmpA,
    );
    this.camera.position.lerp(this.tmpA, approach(2.2, dt));
    this.course.toWorld(this.distance + 8, 0, 0, this.camTarget);
    const f = this.course.frameAt(this.distance);
    this.camera.up.copy(f.up);
    this.camera.lookAt(this.camTarget);
    this.camera.fov = lerp(this.camera.fov, this.fovBase, approach(3, dt));
    this.camera.updateProjectionMatrix();
    this.streaks.update(this.course, this.distance, 0.6, 0.08);
  }

  private placeCraft(): void {
    const f = this.course.frameAt(this.distance);
    this.craft.root.position
      .copy(f.pos)
      .addScaledVector(f.right, this.lateral)
      .addScaledVector(f.up, this.vertical);
    this.course.orientationFromFrame(f, this.craft.root.quaternion);
  }

  /** Time-based emission so the trail looks identical at any frame rate. */
  private emitThrusters(dt: number, boosting: boolean): void {
    const rate = boosting ? 190 : 130;
    this.emitAccumulator += rate * dt;
    const budget = Math.min(24, Math.floor(this.emitAccumulator));
    this.emitAccumulator -= budget;
    if (budget <= 0) return;

    const color = boosting ? this.boostTrailColor : this.trailColor;
    // getWorldDirection reports the local +Z axis, which is the craft's tail.
    this.craft.root.getWorldDirection(this.backward);
    const perNozzle = Math.max(1, Math.round(budget / this.craft.nozzleCount));
    for (let n = 0; n < this.craft.nozzleCount; n++) {
      this.craft.nozzleWorld(n, this.tmpA);
      for (let i = 0; i < perNozzle; i++) {
        this.tmpB
          .set((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6)
          .addScaledVector(this.backward, this.speed * 0.22);
        this.particles.spawn(
          this.tmpA,
          this.tmpB,
          color,
          boosting ? 0.85 : 0.6,
          0.28 + Math.random() * 0.22,
          2.2,
        );
      }
    }
  }

  private collectMotes(travelled: number): void {
    for (const item of this.charges.items) {
      if (!item.active) continue;
      const rel = this.course.delta(item.distance, this.distance);
      if (Math.abs(rel) > travelled + 4) continue;
      const bob = Math.sin(this.worldTime * 1.6 + item.phase) * 1.4;
      const dLat = this.lateral - item.lateral;
      const dVert = this.vertical - (item.vertical + bob);
      if (Math.hypot(dLat, dVert) > 4.2) continue;

      item.active = false;
      item.respawn = 26;
      this.motes++;
      this.combo = Math.min(6, this.combo + 1);
      this.comboTimer = 3.2;
      this.charge = Math.min(MAX_CHARGE, this.charge + MOTE_CHARGE);
      this.score += 30 * this.combo;
      this.audio.pickup(this.combo);
      this.course.toWorld(item.distance, item.lateral, item.vertical + bob, this.tmpA);
      this.particles.burst(this.tmpA, new THREE.Color(0x6cffe0), 16, 9, 0.6, 0.55);
      if (this.combo >= 3 && this.combo % 3 === 0) {
        this.hud.toast(`Charge chain x${this.combo}`, false, 1.1);
      }
    }
  }

  private checkHazards(travelled: number): void {
    for (const h of this.hazards.hazards) {
      const rel = this.course.delta(h.distance, this.distance);
      const reach = travelled + 6 + h.radius;
      if (Math.abs(rel) > reach) {
        h.nearMissArmed = true;
        continue;
      }
      const sep = this.hazards.separation(h, this.lateral, this.vertical);
      const along = Math.abs(rel);
      const contact = sep < 2.2 && along < 2.6 + travelled * 0.5;
      if (contact && this.invuln <= 0) {
        this.hits++;
        this.invuln = INVULN;
        this.trauma = 1;
        this.damageFx = 1;
        this.speed = Math.max(BRAKE_SPEED, this.speed * 0.55);
        this.latVel *= -0.35;
        this.vertVel *= -0.35;
        this.applyDamage(HIT_COST, true);
        this.craft.flashHit();
        this.audio.impact();
        this.hud.toast('Impact — charge lost', true, 1.2);
        this.course.toWorld(this.distance, this.lateral, this.vertical, this.tmpA);
        this.particles.burst(this.tmpA, new THREE.Color(0xff9a4a), 44, 22, 1.0, 0.8);
        this.particles.burst(this.tmpA, new THREE.Color(0xfff0c0), 14, 10, 0.7, 0.5);
        h.nearMissArmed = false;
      } else if (h.nearMissArmed && sep < 5.5 && along < 3) {
        h.nearMissArmed = false;
        this.score += 45;
        this.hud.toast('Close pass +45', false, 0.8);
      }
    }
  }

  private applyDamage(amount: number, big: boolean): void {
    this.charge -= amount;
    if (big) {
      this.combo = 0;
      this.comboTimer = 0;
    }
  }

  private checkGates(): void {
    const target = this.relaysRestored < 3 ? this.gates[this.relaysRestored] : this.extraction;
    const gates: RelayGate[] = [...this.gates, this.extraction];
    for (const gate of gates) {
      const before = this.course.delta(gate.distance, this.prevDistance);
      const after = this.course.delta(gate.distance, this.distance);
      if (!(before < 0 && after >= 0)) continue;
      const radial = Math.hypot(
        this.lateral - gate.offsetLateral,
        this.vertical - gate.offsetVertical,
      );
      const inside = radial < gate.aperture - 1.4;
      if (gate !== target) continue;

      if (!inside) {
        this.hud.toast('Missed the aperture — loop around', true, 1.8);
        this.trauma = Math.max(this.trauma, 0.3);
        continue;
      }

      if (gate === this.extraction) {
        this.finish(
          true,
          'All three relays are singing again and the courier is clear of the field.',
        );
        return;
      }

      gate.setState('restored');
      this.relaysRestored++;
      this.score += 750;
      this.charge = Math.min(MAX_CHARGE, this.charge + RELAY_CHARGE);
      this.flash = 0.5;
      this.flashColor.setHex(0x8ffff0);
      this.trauma = Math.max(this.trauma, 0.35);
      this.audio.relay(this.relaysRestored);
      this.particles.burst(gate.group.position, new THREE.Color(0x7cffe4), 70, 30, 1.1, 1.2);
      if (this.relaysRestored < 3) {
        this.gates[this.relaysRestored].setState('active');
        this.hud.toast(`Relay 0${this.relaysRestored} online`, false, 1.8);
      } else {
        this.extraction.setState('active');
        this.hud.toast('Field restored — run the extraction ring', false, 2.4);
      }
    }
  }

  private get target(): RelayGate {
    return this.relaysRestored < 3 ? this.gates[this.relaysRestored] : this.extraction;
  }

  private objectiveText(): string {
    const target = this.target;
    const ahead = Math.round(this.course.wrap(target.distance - this.distance));
    const name = this.relaysRestored < 3 ? `Relay 0${this.relaysRestored + 1}` : 'Extraction ring';
    let hint = '';
    if (this.phase === 'playing' && ahead < 220) {
      const dx = target.offsetLateral - this.lateral;
      const dy = target.offsetVertical - this.vertical;
      const slack = target.aperture - 4;
      const parts: string[] = [];
      if (dx > slack) parts.push('right');
      else if (dx < -slack) parts.push('left');
      if (dy > slack * 0.7) parts.push('up');
      else if (dy < -slack * 0.7) parts.push('down');
      hint = parts.length ? ` · line up ${parts.join('-')}` : ' · aligned';
    }
    return `${name} · ${ahead} m${hint}`;
  }

  private updateCamera(dt: number, snap: boolean): void {
    const k = snap ? 1 : approach(7.5, dt);
    this.camLat = lerp(this.camLat, this.lateral, k);
    this.camVert = lerp(this.camVert, this.vertical, k);

    const speed01 = clamp((this.speed - BRAKE_SPEED) / (BOOST_SPEED - BRAKE_SPEED), 0, 1);
    const back = 10.5 + speed01 * 4;
    this.course.toWorld(
      this.distance - back,
      this.camLat * 0.9,
      this.camVert * 0.9 + 2.9,
      this.tmpA,
    );

    if (snap) this.camera.position.copy(this.tmpA);
    else this.camera.position.lerp(this.tmpA, approach(14, dt));

    this.course.toWorld(this.distance + 26, this.lateral * 0.72, this.vertical * 0.72, this.camTarget);

    const f = this.course.frameAt(this.distance);
    this.camRoll = lerp(this.camRoll, -this.input.steer * 0.16 - this.latVel / MAX_LATERAL * 0.06, snap ? 1 : approach(5, dt));
    this.camera.up.copy(f.up).applyAxisAngle(f.tangent, this.camRoll);
    this.camera.lookAt(this.camTarget);

    // Trauma shake, applied in camera space so it reads at any orientation.
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const shake = this.trauma * this.trauma;
    if (shake > 0.0005) {
      const amp = shake * 1.5;
      this.camera.position.addScaledVector(
        this.tmpB.set(
          (Math.random() - 0.5) * amp,
          (Math.random() - 0.5) * amp,
          (Math.random() - 0.5) * amp,
        ),
        1,
      );
      this.camera.rotateZ((Math.random() - 0.5) * shake * 0.06);
    }

    const targetFov = this.fovBase + speed01 * 9 + this.wallHeat * 3;
    this.camera.fov = lerp(this.camera.fov, targetFov, snap ? 1 : approach(4, dt));
    this.camera.updateProjectionMatrix();
  }

  private publish(): void {
    const t = this.telemetry;
    const p = this.craft.root.position;
    t.phase = this.phase;
    t.score = Math.round(this.score);
    t.player.x = Number.isFinite(p.x) ? +p.x.toFixed(3) : 0;
    t.player.y = Number.isFinite(p.y) ? +p.y.toFixed(3) : 0;
    t.player.z = Number.isFinite(p.z) ? +p.z.toFixed(3) : 0;
    t.relaysRestored = this.relaysRestored;
    t.charge = +Math.max(0, this.charge).toFixed(2);
    t.seed = SEED;
    t.restartCount = this.restartCount;
    t.speed = +this.speed.toFixed(2);
    t.objective = this.objectiveText();
    t.elapsed = +this.elapsed.toFixed(2);
    t.lap = this.lap;
    t.distanceToTarget = Math.round(this.course.wrap(this.target.distance - this.distance));
    t.lateral = +this.lateral.toFixed(2);
    t.vertical = +this.vertical.toFixed(2);
    t.hits = this.hits;
    t.motes = this.motes;
    t.fps = Math.round(1000 / Math.max(1, this.frameAvg));
    (window as unknown as { __AETHERPLAY__: Telemetry }).__AETHERPLAY__ = t;
  }
}
