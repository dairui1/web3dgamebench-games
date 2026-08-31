import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { SEED, PALETTE, FLIGHT, PLAY, SCORE, GATE, EXTRACT, CAMERA, LIGHTNING } from '../config';
import { RNG } from '../core/rng';
import { clamp, damp } from '../core/mathutil';
import { Course, NearestInfo } from './course';
import { World } from './world';
import { Craft } from './craft';
import { ParticleSystem } from './fx';
import { RelayGate, ExtractionRing, ChargeCell, Mine, Spinner } from './entities';
import { Hud } from './hud';
import { Input } from './input';
import { AudioEngine } from './audio';

export type Phase = 'ready' | 'playing' | 'paused' | 'won' | 'lost';

const FINISH_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uHit: { value: 0 },
    uBoost: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uHit;
    uniform float uBoost;
    varying vec2 vUv;
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    void main() {
      vec2 dir = vUv - 0.5;
      float d = length(dir);
      float ca = 0.0012 + uHit * 0.011 + uBoost * 0.0035;
      float r = texture2D(tDiffuse, vUv + dir * ca).r;
      vec4 base = texture2D(tDiffuse, vUv);
      float b = texture2D(tDiffuse, vUv - dir * ca).b;
      vec3 col = vec3(r, base.g, b);
      col *= 1.0 - smoothstep(0.42, 0.98, d) * (0.4 + uHit * 0.35);
      col += (hash(vUv * vec2(1231.0, 913.0) + fract(uTime) * 7.0) - 0.5) * 0.032;
      gl_FragColor = vec4(col, base.a);
    }`,
};

const TRAIL_COLOR = new THREE.Color(PALETTE.cyan);
const AMBER_COLOR = new THREE.Color(PALETTE.amber);
const RED_COLOR = new THREE.Color(PALETTE.red);
const WHITE_COLOR = new THREE.Color(0xeaf6ff);

export class Game {
  phase: Phase = 'ready';
  score = 0;
  charge = PLAY.startCharge;
  relaysRestored = 0;
  restartCount = 0;
  elapsed = 0;
  cellCount = 0;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private finishPass: ShaderPass;
  private course = new Course();
  private world: World;
  private craft = new Craft();
  private fx = new ParticleSystem(900);
  private hud: Hud;
  private input: Input;
  private audio = new AudioEngine();

  private gates: RelayGate[] = [];
  private cells: ChargeCell[] = [];
  private mines: Mine[] = [];
  private spinners: Spinner[] = [];
  private extract: ExtractionRing;

  private runRng = new RNG(SEED);
  private time = 0;
  private lastTime = performance.now();
  private trailAcc = 0;
  private objectiveTimer = 0;

  private prevCraftPos = new THREE.Vector3();
  private nearestCache: NearestInfo = {
    sample: { pos: new THREE.Vector3(), tangent: new THREE.Vector3(0, 0, -1), t: 0 },
    distSq: 0,
    lateral: 0,
    lateralDir: new THREE.Vector3(),
  };

  private shake = 0;
  private hitPulse = 0;
  private invuln = 0;
  private surgeCd = 0;
  private offCourse = false;
  private offCourseWarned = false;
  private lowChargeWarned = false;
  private endTimer = -1;
  private endReason = '';
  private orbitAngle = 0;
  private lostSplash = false;

  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camFov = CAMERA.fovBase;

  private tmpV1 = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpV3 = new THREE.Vector3();
  private benchTarget = new THREE.Vector3();
  private objectiveText = '';

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.domElement.id = 'game-canvas';
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (this.phase === 'playing') this.pause();
    });

    this.scene.fog = new THREE.Fog(PALETTE.fog, 140, 950);
    this.camera = new THREE.PerspectiveCamera(CAMERA.fovBase, 1, 0.1, 5200);

    /* ---------------- world & entities ---------------- */
    const layoutRng = new RNG(SEED);
    this.world = new World(this.scene, this.course, layoutRng, this.runRng);

    const startHeading = this.headingFromTangent(this.course.tangentAt(0));
    this.craft.reset(this.course.pointAt(0), startHeading);
    this.scene.add(this.craft.group);
    this.scene.add(this.fx.points);

    for (let i = 0; i < this.course.gateT.length; i++) {
      const t = this.course.gateT[i];
      const gate = new RelayGate(i, this.course.pointAt(t), this.course.tangentAt(t));
      this.gates.push(gate);
      this.scene.add(gate.group);
    }
    this.gates[0].setActive();

    const endPos = this.course.pointAt(1);
    const endTan = this.course.tangentAt(1);
    this.extract = new ExtractionRing(endPos, endTan);
    this.scene.add(this.extract.group);

    this.placeCells(layoutRng);
    this.placeHazards(layoutRng);

    /* ---------------- UI ---------------- */
    this.hud = new Hud({
      onStart: () => this.startRun(),
      onResume: () => this.resume(),
      onRestart: () => this.restart(),
    });
    this.hud.setRelays(0);
    this.hud.setScore(0);
    this.hud.setCharge(this.charge, false);

    this.input = new Input(this.hud.getTouchLayer(), {
      onConfirm: () => this.onConfirm(),
      onPause: () => this.togglePause(),
      onMute: () => this.toggleMute(),
    });
    this.input.onJoyStart = (x, y) => this.hud.showJoy(x, y);
    this.input.onJoyMove = (dx, dy) => this.hud.moveJoy(dx, dy);
    this.input.onJoyEnd = () => this.hud.hideJoy();
    this.input.onBoostVisual = (v) => this.hud.setBoostVisual(v);

    /* ---------------- post-processing ---------------- */
    const rt = new THREE.WebGLRenderTarget(1, 1, {
      samples: 4,
      type: THREE.HalfFloatType,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.62, 0.42, 0.8);
    this.composer.addPass(bloom);
    this.finishPass = new ShaderPass(FINISH_SHADER);
    this.composer.addPass(this.finishPass);
    this.composer.addPass(new OutputPass());

    /* ---------------- events ---------------- */
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();

    // snap camera behind craft for the title scene
    this.camera.up.set(0, 1, 0);
    const tan0 = this.course.tangentAt(0);
    this.camPos.copy(this.course.pointAt(0)).addScaledVector(tan0, -CAMERA.dist).add(new THREE.Vector3(0, CAMERA.height + 2, 0));
    this.camera.position.copy(this.camPos);

    this.updateBench();
    this.renderer.setAnimationLoop(this.loop);
  }

  /* ================================================================ */
  /* setup helpers                                                     */
  /* ================================================================ */

  private headingFromTangent(tan: THREE.Vector3): number {
    return Math.atan2(-tan.x, -tan.z);
  }

  private placeCells(rng: RNG): void {
    // clusters strung along the corridor: most ride the racing line, some sit
    // off-path as optional risk/reward detours
    const clusters = [0.05, 0.1, 0.155, 0.28, 0.345, 0.41, 0.55, 0.61, 0.7, 0.82, 0.885, 0.94];
    for (const base of clusters) {
      const n = rng.int(3, 4);
      const onLine = rng.next() < 0.6;
      const latBase = onLine ? rng.range(-3.5, 3.5) : rng.sign() * rng.range(7, 16);
      for (let i = 0; i < n; i++) {
        const t = base + i * 0.0045;
        if (this.course.gateT.some((g) => Math.abs(t - g) < 0.014)) continue;
        const lateral = latBase + Math.sin(i * 1.7) * 3.5;
        const up = Math.sin(i * 1.1) * 3;
        const pos = this.course.nearPoint(clamp(t, 0.005, 0.985), lateral, up);
        this.cells.push(new ChargeCell(pos));
        this.scene.add(this.cells[this.cells.length - 1].group);
      }
    }
  }

  private placeHazards(rng: RNG): void {
    const segments: ReadonlyArray<readonly [number, number, number]> = [
      [0.035, 0.185, 4],
      [0.225, 0.465, 6],
      [0.505, 0.745, 8],
      [0.795, 0.965, 8],
    ];
    for (const [a, b, n] of segments) {
      for (let i = 0; i < n; i++) {
        const t = clamp(a + ((b - a) * (i + 0.5)) / n + rng.range(-0.012, 0.012), 0.01, 0.98);
        const anchor = this.course.nearPoint(t, 0, 0);
        const perp = this.course.lateralAt(t);
        const mine = new Mine(
          anchor,
          perp,
          rng.range(9, 21),
          rng.range(0.5, 1.15),
          rng.range(0, Math.PI * 2),
          rng.range(2, 5),
        );
        this.mines.push(mine);
        this.scene.add(mine.group);
      }
    }

    const spinnerTs = [0.3, 0.42, 0.58, 0.66, 0.84, 0.92];
    for (const t of spinnerTs) {
      const pos = this.course.nearPoint(t, rng.sign() * rng.range(13, 18), 0);
      const tan = this.course.tangentAt(t);
      const spinner = new Spinner(pos, tan, rng.sign() * rng.range(1.2, 2.1));
      this.spinners.push(spinner);
      this.scene.add(spinner.group);
    }
  }

  /* ================================================================ */
  /* state machine                                                     */
  /* ================================================================ */

  private isCoarsePointer(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  }

  private startRun(): void {
    if (this.phase === 'playing') return;
    this.audio.unlock();
    this.audio.ui();
    this.beginRun();
  }

  private restart(): void {
    if (this.phase === 'playing') return;
    this.restartCount++;
    this.audio.ui();
    this.beginRun();
  }

  private beginRun(): void {
    this.score = 0;
    this.charge = PLAY.startCharge;
    this.relaysRestored = 0;
    this.elapsed = 0;
    this.cellCount = 0;
    this.invuln = 0;
    this.surgeCd = 0;
    this.shake = 0;
    this.hitPulse = 0;
    this.offCourse = false;
    this.offCourseWarned = false;
    this.lowChargeWarned = false;
    this.endTimer = -1;
    this.lostSplash = false;
    this.trailAcc = 0;

    this.runRng = new RNG(SEED);
    this.world.setRunRng(this.runRng);

    for (const g of this.gates) g.setReset();
    this.gates[0].setActive();
    this.extract.reset();
    for (const c of this.cells) c.reset();
    this.fx.clear();

    const startPos = this.course.pointAt(0);
    this.craft.reset(startPos, this.headingFromTangent(this.course.tangentAt(0)));
    this.prevCraftPos.copy(this.craft.pos);

    // snap camera behind the craft
    this.craft.forward(this.tmpV1);
    this.camPos.copy(this.craft.pos).addScaledVector(this.tmpV1, -CAMERA.dist).add(this.tmpV2.set(0, CAMERA.height, 0));
    this.camera.position.copy(this.camPos);
    this.camLook.copy(this.craft.pos).addScaledVector(this.tmpV1, CAMERA.lookAhead);
    this.camFov = CAMERA.fovBase;
    this.orbitAngle = Math.atan2(this.tmpV1.x, this.tmpV1.z);

    this.hud.hideOverlay();
    this.hud.setHudVisible(true);
    this.hud.setRelays(0);
    this.hud.setScore(0);
    this.hud.setCharge(this.charge, false);
    this.hud.setSpeed(FLIGHT.baseSpeed);
    this.hud.setTouchVisible(this.isCoarsePointer());
    this.hud.setHint(
      this.isCoarsePointer()
        ? 'DRAG LEFT SIDE TO STEER · HOLD RIGHT SIDE TO BOOST'
        : '<b>W A S D</b> steer · <b>SHIFT</b> boost',
    );
    window.setTimeout(() => this.hud.fadeHint(), 5200);

    this.audio.startEngine();
    this.phase = 'playing';
    this.updateBench();
  }

  private pause(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    this.audio.stopEngine();
    this.hud.showOverlay('paused');
    this.updateBench();
  }

  private resume(): void {
    if (this.phase !== 'paused') return;
    this.audio.unlock();
    this.audio.startEngine();
    this.phase = 'playing';
    this.hud.hideOverlay();
    this.lastTime = performance.now();
    this.updateBench();
  }

  togglePause(): void {
    if (this.phase === 'playing') this.pause();
    else if (this.phase === 'paused') this.resume();
  }

  private onConfirm(): void {
    switch (this.phase) {
      case 'ready':
        this.startRun();
        break;
      case 'paused':
        this.resume();
        break;
      case 'won':
      case 'lost':
        if (this.endTimer < 0) this.restart();
        break;
      default:
        break;
    }
  }

  private toggleMute(): void {
    const muted = this.audio.toggleMute();
    this.hud.toast(muted ? 'AUDIO MUTED' : 'AUDIO ON', 'info');
  }

  private onVisibility = (): void => {
    if (document.hidden && this.phase === 'playing') this.pause();
  };

  private resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, w < 520 ? 1.5 : 1.8);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  /* ================================================================ */
  /* main loop                                                         */
  /* ================================================================ */

  private loop = (): void => {
    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    dt = clamp(dt, 0, 0.05);

    if (this.phase === 'paused') {
      this.render();
      return;
    }

    this.time += dt;
    switch (this.phase) {
      case 'ready':
        this.idleUpdate(dt);
        break;
      case 'playing':
        this.playUpdate(dt);
        break;
      case 'won':
      case 'lost':
        this.endUpdate(dt);
        break;
    }
    this.updateBench();
    this.render();
  };

  private render(): void {
    this.finishPass.uniforms.uTime.value = this.time;
    this.finishPass.uniforms.uHit.value = this.hitPulse;
    this.finishPass.uniforms.uBoost.value = this.phase === 'playing' ? this.craft.boostAmount : 0;
    this.composer.render();
  }

  /* ================================================================ */
  /* phases                                                            */
  /* ================================================================ */

  /** Title screen: slow flyby down the corridor while the craft idles at the gate. */
  private idleUpdate(dt: number): void {
    const t = 0.01 + ((this.time * 0.0045) % 0.12);
    const pos = this.course.pointAt(t, this.tmpV1);
    const tan = this.course.tangentAt(clamp(t + 0.03, 0, 1), this.tmpV2);
    const lat = this.course.lateralAt(t, this.tmpV3);
    this.camera.position.copy(pos).addScaledVector(lat, 30).addScaledVector(tan, -14);
    this.camera.position.y += 11;
    const ahead = this.course.pointAt(clamp(t + 0.045, 0, 1), new THREE.Vector3());
    this.camera.lookAt(ahead.x, ahead.y + 4, ahead.z);
    this.camFov = damp(this.camFov, 56, 2, dt);
    this.camera.fov = this.camFov;
    this.camera.updateProjectionMatrix();

    // idle craft hover at the start gate
    const start = this.course.pointAt(0);
    this.craft.group.position.copy(start);
    this.craft.group.position.y += Math.sin(this.time * 1.1) * 0.7;
    this.craft.group.rotation.set(Math.sin(this.time * 0.7) * 0.04, this.headingFromTangent(this.course.tangentAt(0)) + Math.sin(this.time * 0.3) * 0.3, Math.sin(this.time * 0.9) * 0.05, 'YXZ');

    for (const g of this.gates) g.update(dt, this.time);
    this.extract.update(dt, this.time);
    for (const c of this.cells) c.update(this.time);
    for (const m of this.mines) m.update(dt, this.time);
    for (const s of this.spinners) s.update(dt, this.time);
    this.world.update(dt, this.time, this.camera.position, this.craft.group.position);
    this.fx.update(dt);
  }

  private playUpdate(dt: number): void {
    this.elapsed += dt;
    const steer = this.input.steer();
    const boost = this.input.boost();

    this.prevCraftPos.copy(this.craft.pos);
    this.craft.update(dt, { x: steer.x, y: steer.y, boost }, this.time);

    /* ---- charge drain ---- */
    this.nearestCache = this.course.nearest(this.craft.pos, this.nearestCache);
    const pathDist = Math.sqrt(this.nearestCache.distSq);
    this.offCourse = pathDist > PLAY.offCourseDist;
    let drain = PLAY.drain * (boost && !this.craft.falling ? PLAY.boostDrainMult : 1);
    if (this.offCourse) {
      drain += PLAY.offCourseDrain;
      if (!this.offCourseWarned) {
        this.hud.toast('OFF COURSE — FOLLOW THE BEACONS', 'bad');
        this.offCourseWarned = true;
      }
    } else if (pathDist < PLAY.offCourseRearm) {
      this.offCourseWarned = false;
    }
    this.charge -= drain * dt;

    /* ---- floor & ceiling ---- */
    this.surgeCd -= dt;
    if (this.craft.pos.y < FLIGHT.floorY) {
      this.craft.pos.y = FLIGHT.floorY;
      this.craft.pitch = Math.max(this.craft.pitch, 0.2);
      if (this.surgeCd <= 0) {
        this.applyHit(PLAY.surgeCharge, 'STORM SURGE — CLIMB');
        this.surgeCd = PLAY.surgeCooldown;
        this.fx.burst(this.tmpV1.copy(this.craft.pos).setY(FLIGHT.floorY - 2), 16, 9, 0.7, 3, WHITE_COLOR);
        this.audio.surge();
      }
    }
    if (this.craft.pos.y > FLIGHT.ceilY) {
      this.craft.pos.y = FLIGHT.ceilY;
      this.craft.pitch = Math.min(this.craft.pitch, -0.12);
    }

    /* ---- charge cells ---- */
    for (const cell of this.cells) {
      if (cell.collected) continue;
      cell.update(this.time);
      const d = cell.attract(this.craft.pos, dt);
      if (d < PLAY.cellPickupRadius) {
        cell.collect();
        this.cellCount++;
        this.score += SCORE.cell;
        this.charge = Math.min(100, this.charge + PLAY.cellCharge);
        this.fx.burst(cell.group.position, 22, 10, 0.6, 2.6, AMBER_COLOR);
        this.audio.pickup();
        if (this.charge > 40) this.lowChargeWarned = false;
      }
    }

    /* ---- relay gates ---- */
    for (const gate of this.gates) {
      gate.update(dt, this.time);
      if (gate.state !== 'active') continue;
      const res = gate.checkCross(this.prevCraftPos, this.craft.pos, GATE.restoreRadius, 9);
      if (res === 'through') {
        this.restoreGate(gate.index);
      } else if (res === 'near') {
        this.hud.toast('MISSED THE RING — FLY THROUGH IT', 'bad');
      }
    }

    /* ---- extraction ring ---- */
    this.extract.update(dt, this.time);
    if (this.extract.active && !this.extract.crossed) {
      const res = this.extract.checkCross(this.prevCraftPos, this.craft.pos, EXTRACT.restoreRadius, 10);
      if (res === 'through') {
        this.win();
        return;
      }
    }

    /* ---- hazards ---- */
    this.invuln -= dt;
    const craftR = 2.0;
    for (const mine of this.mines) {
      mine.update(dt, this.time);
      if (this.invuln > 0) continue;
      if (mine.group.position.distanceToSquared(this.craft.pos) < (mine.radius + craftR) ** 2) {
        const push = this.tmpV1.subVectors(this.craft.pos, mine.group.position).normalize();
        this.craft.knock(push, 5);
        this.impactFeedback('MINE STRIKE', PLAY.hitCharge, mine.group.position, RED_COLOR);
      }
    }
    for (const spinner of this.spinners) {
      spinner.update(dt, this.time);
      if (this.invuln > 0) continue;
      if (spinner.hits(this.craft.pos)) {
        const push = this.tmpV1.subVectors(this.craft.pos, spinner.group.position).setY(4).normalize();
        this.craft.knock(push, 6);
        this.impactFeedback('CUTTER BLADE', PLAY.hitCharge, this.craft.pos, RED_COLOR);
      }
    }

    /* ---- lightning ---- */
    const strike = this.world.update(dt, this.time, this.camera.position, this.craft.pos);
    if (strike) {
      this.audio.thunder();
      const dxz = Math.hypot(this.craft.pos.x - strike.pos.x, this.craft.pos.z - strike.pos.z);
      if (dxz < LIGHTNING.damageRadius && this.craft.pos.y < LIGHTNING.maxHeight && this.invuln <= 0) {
        this.impactFeedback('ARC STRIKE', PLAY.lightningCharge, this.craft.pos, WHITE_COLOR);
      }
    }

    /* ---- engine trail ---- */
    this.craft.group.updateMatrixWorld();
    this.trailAcc += dt * (20 + this.craft.boostAmount * 30);
    while (this.trailAcc >= 1) {
      this.trailAcc -= 1;
      const side = this.trailAcc % 2 < 1 ? -1 : 1;
      this.tmpV1.set(side * 0.62, -0.08, 3.1).applyMatrix4(this.craft.group.matrixWorld);
      this.craft.forward(this.tmpV2);
      this.fx.spawn(
        this.tmpV1.x, this.tmpV1.y, this.tmpV1.z,
        -this.tmpV2.x * this.craft.speed * 0.25 + (Math.random() - 0.5) * 2,
        -this.tmpV2.y * this.craft.speed * 0.25 + (Math.random() - 0.5) * 2,
        -this.tmpV2.z * this.craft.speed * 0.25 + (Math.random() - 0.5) * 2,
        0.42 + Math.random() * 0.2,
        0.85 + this.craft.boostAmount * 0.7,
        TRAIL_COLOR,
        { drag: 1.2, grow: 1.2 },
      );
    }
    this.fx.update(dt);

    /* ---- fail state ---- */
    if (this.charge <= 0) {
      this.lose('CHARGE DEPLETED — THE CELL WENT DARK OVER THE CLOUD SEA');
      return;
    }

    /* ---- camera & feedback ---- */
    this.updateChaseCamera(dt);
    this.audio.setEngine(this.craft.speed, this.craft.boostAmount, true);

    /* ---- HUD ---- */
    this.objectiveTimer -= dt;
    if (this.objectiveTimer <= 0) {
      this.objectiveTimer = 0.2;
      this.refreshObjective();
    }
    this.hud.setCharge(this.charge, this.charge < 30);
    this.hud.setScore(this.score);
    this.hud.setSpeed(this.craft.speed);
    const dangerBase = this.charge < 30 ? (1 - this.charge / 30) * (0.55 + 0.3 * Math.sin(this.time * 6)) : 0;
    this.hud.setDanger(Math.min(1, dangerBase + this.hitPulse * 0.5));
    this.hud.setSpeedlines(this.craft.boostAmount * 0.55);
    if (this.charge < 30 && !this.lowChargeWarned) {
      this.lowChargeWarned = true;
      this.hud.toast('CHARGE LOW — FIND CELLS', 'bad');
      this.audio.warn();
    }
  }

  private endUpdate(dt: number): void {
    if (this.endTimer > 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) {
        if (this.phase === 'won') {
          const timeBonus = Math.max(0, SCORE.timePar - Math.floor(this.elapsed)) * SCORE.timeBonusRate;
          this.hud.showOverlay('won', {
            score: Math.round(this.score),
            cellCount: this.cellCount,
            elapsed: this.elapsed,
            timeBonus,
          });
        } else {
          this.hud.showOverlay('lost', {
            reason: this.endReason,
            score: Math.round(this.score),
            relays: this.relaysRestored,
          });
        }
      }
    }

    if (this.phase === 'won') {
      // glide to a stop while the camera orbits
      this.craft.speed = damp(this.craft.speed, 0, 0.7, dt);
      this.craft.forward(this.tmpV1);
      this.craft.pos.addScaledVector(this.tmpV1, this.craft.speed * dt);
      this.craft.group.position.copy(this.craft.pos);
      this.craft.group.rotation.set(
        this.craft.pitch * 0.5,
        this.craft.heading,
        Math.sin(this.time * 0.8) * 0.06,
        'YXZ',
      );
      this.orbitAngle += dt * 0.45;
      const r = 26;
      this.camera.position.set(
        this.craft.pos.x + Math.cos(this.orbitAngle) * r,
        this.craft.pos.y + 7 + Math.sin(this.time * 0.25) * 2,
        this.craft.pos.z + Math.sin(this.orbitAngle) * r,
      );
      this.camera.lookAt(this.craft.pos);
      this.camFov = damp(this.camFov, 55, 1.5, dt);
      this.camera.fov = this.camFov;
      this.camera.updateProjectionMatrix();
    } else {
      // defeat: the craft tumbles into the clouds
      if (!this.craft.group.visible || this.craft.falling) {
        this.craft.update(dt, { x: 0, y: 0, boost: false }, this.time);
        if (!this.lostSplash && this.craft.pos.y < 7) {
          this.lostSplash = true;
          this.fx.burst(this.tmpV1.copy(this.craft.pos).setY(6), 60, 14, 1.2, 5, new THREE.Color(0x7b95a2), { grav: -2 });
          this.craft.hide();
          this.shake = Math.max(this.shake, 0.8);
        }
        this.camPos.y = damp(this.camPos.y, this.camPos.y + 2, 0.4, dt);
        this.camera.position.copy(this.camPos);
        this.camera.lookAt(this.craft.pos);
      }
    }

    for (const g of this.gates) g.update(dt, this.time);
    this.extract.update(dt, this.time);
    for (const c of this.cells) c.update(this.time);
    for (const m of this.mines) m.update(dt, this.time);
    for (const s of this.spinners) s.update(dt, this.time);
    this.world.update(dt, this.time, this.camera.position, this.craft.pos);
    this.fx.update(dt);

    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.hitPulse = Math.max(0, this.hitPulse - dt * 2.5);
    this.hud.setDanger(this.hitPulse * 0.5);
  }

  /* ================================================================ */
  /* events                                                            */
  /* ================================================================ */

  private applyHit(amount: number, label: string): void {
    this.charge -= amount;
    this.shake = Math.min(1.2, this.shake + 0.7);
    this.hitPulse = 1;
    this.hud.hitFlash();
    this.hud.toast(label, 'bad');
    this.audio.hit();
  }

  private impactFeedback(label: string, amount: number, at: THREE.Vector3, color: THREE.Color): void {
    this.invuln = PLAY.invulnTime;
    this.applyHit(amount, label);
    this.fx.burst(at, 26, 12, 0.7, 3, color);
  }

  private restoreGate(index: number): void {
    const gate = this.gates[index];
    gate.setRestored();
    this.relaysRestored = index + 1;
    this.score += SCORE.relay;
    this.charge = Math.min(100, this.charge + PLAY.relayCharge);
    this.fx.burst(gate.center, 55, 14, 1.0, 2.6, index === 2 ? TRAIL_COLOR : AMBER_COLOR, { grav: -1 });
    this.shake = Math.max(this.shake, 0.45);
    this.hud.setRelays(this.relaysRestored);
    this.audio.relay();

    if (this.relaysRestored === 3) {
      this.extract.activate();
      this.hud.toast('ALL RELAYS ONLINE — EXTRACTION RING ACTIVE', 'good');
    } else {
      this.gates[index + 1].setActive();
      this.hud.toast(`RELAY ${index + 1} RESTORED  +${SCORE.relay}`, 'good');
    }
    this.refreshObjective();
  }

  private win(): void {
    this.extract.crossed = true;
    const timeBonus = Math.max(0, SCORE.timePar - Math.floor(this.elapsed)) * SCORE.timeBonusRate;
    this.score += SCORE.finish + timeBonus;
    this.phase = 'won';
    this.endTimer = 1.6;
    this.audio.win();
    this.audio.stopEngine();
    this.fx.burst(this.craft.pos, 55, 16, 1.1, 2.4, TRAIL_COLOR, { grav: -1 });
    this.fx.burst(this.craft.pos, 25, 9, 1.3, 3.0, WHITE_COLOR, { grav: -1 });
    this.hud.toast('EXTRACTION COMPLETE', 'good');
    this.hud.setTouchVisible(false);
    this.hud.setDanger(0);
    this.hud.setSpeedlines(0);
    this.orbitAngle = this.craft.heading + Math.PI;
    this.updateBench();
  }

  private lose(reason: string): void {
    this.phase = 'lost';
    this.endReason = reason;
    this.endTimer = 1.9;
    this.craft.startFalling();
    this.fx.burst(this.craft.pos, 32, 11, 0.9, 2.6, AMBER_COLOR);
    this.fx.burst(this.craft.pos, 18, 8, 1.1, 3.2, RED_COLOR);
    this.shake = 1.1;
    this.hitPulse = 1;
    this.audio.lose();
    this.audio.stopEngine();
    this.hud.setTouchVisible(false);
    this.updateBench();
  }

  /* ================================================================ */
  /* camera                                                            */
  /* ================================================================ */

  private updateChaseCamera(dt: number): void {
    const fwd = this.craft.forward(this.tmpV1);
    // camera follows heading fully, pitch only partially
    const back = this.tmpV2.set(-fwd.x, 0, -fwd.z).normalize();
    back.y = -this.craft.pitch * 0.45;
    back.normalize();
    const desired = this.tmpV3.copy(this.craft.pos).addScaledVector(back, CAMERA.dist);
    desired.y += CAMERA.height + this.craft.pitch * 1.5;

    const lam = CAMERA.posLerp;
    this.camPos.x = damp(this.camPos.x, desired.x, lam, dt);
    this.camPos.y = damp(this.camPos.y, desired.y, lam, dt);
    this.camPos.z = damp(this.camPos.z, desired.z, lam, dt);

    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * this.shake * 1.5;
    this.camera.position.set(
      this.camPos.x + (Math.random() - 0.5) * sh,
      this.camPos.y + (Math.random() - 0.5) * sh,
      this.camPos.z + (Math.random() - 0.5) * sh,
    );

    const lookTarget = this.tmpV3.copy(this.craft.pos).addScaledVector(fwd, CAMERA.lookAhead);
    lookTarget.y += 1.2;
    this.camLook.lerp(lookTarget, 1 - Math.exp(-9 * dt));

    // roll the horizon with the bank
    const right = this.tmpV2.set(-fwd.z, 0, fwd.x).normalize();
    this.camera.up.set(0, 1, 0).addScaledVector(right, this.craft.bank * 0.42).normalize();
    this.camera.lookAt(this.camLook);

    const speedN = (this.craft.speed - FLIGHT.baseSpeed) / (FLIGHT.boostSpeed - FLIGHT.baseSpeed);
    this.camFov = damp(this.camFov, CAMERA.fovBase + clamp(speedN, 0, 1) * (CAMERA.fovBoost - CAMERA.fovBase), 4, dt);
    this.camera.fov = this.camFov;
    this.camera.updateProjectionMatrix();
  }

  /* ================================================================ */
  /* objective & benchmark                                             */
  /* ================================================================ */

  private refreshObjective(): void {
    if (this.relaysRestored < 3) {
      const gate = this.gates[this.relaysRestored];
      this.benchTarget.copy(gate.center);
      const d = Math.round(this.craft.pos.distanceTo(gate.center));
      this.objectiveText = `RESTORE RELAY ${this.relaysRestored + 1} · ${d}m`;
    } else {
      this.benchTarget.copy(this.extract.center);
      const d = Math.round(this.craft.pos.distanceTo(this.extract.center));
      this.objectiveText = `CROSS THE EXTRACTION RING · ${d}m`;
    }
    this.hud.setObjective(this.objectiveText);
  }

  private fin(v: number): number {
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
  }

  private updateBench(): void {
    (window as unknown as { __WEB3DGAMEBENCH__: unknown }).__WEB3DGAMEBENCH__ = {
      phase: this.phase,
      score: Math.round(this.score),
      player: {
        x: this.fin(this.craft.pos.x),
        y: this.fin(this.craft.pos.y),
        z: this.fin(this.craft.pos.z),
      },
      relaysRestored: this.relaysRestored,
      charge: Math.round(Math.max(0, this.charge) * 10) / 10,
      seed: SEED,
      restartCount: this.restartCount,
      speed: Math.round(this.craft.speed * 10) / 10,
      heading: Math.round(this.craft.heading * 1000) / 1000,
      pitch: Math.round(this.craft.pitch * 1000) / 1000,
      elapsed: Math.round(this.elapsed * 10) / 10,
      objective: this.objectiveText,
      target: {
        x: this.fin(this.benchTarget.x),
        y: this.fin(this.benchTarget.y),
        z: this.fin(this.benchTarget.z),
      },
      offCourse: this.offCourse,
      cellsCollected: this.cellCount,
      muted: this.audio.muted,
    };
  }
}
