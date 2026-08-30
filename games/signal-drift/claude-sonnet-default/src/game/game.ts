import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { buildCourse, type Course } from './course';
import { buildEnvironment, type Environment } from './environment';
import { buildCraft, type Craft } from './craft';
import { InputController } from './input';
import { Hud } from './hud';
import { AudioEngine } from './audio';
import { ParticleSystem } from './particles';
import type { AetherPlayState, Phase } from './types';

const SEED = 94721;
const MAX_CHARGE = 100;
const BASE_SPEED = 25;
const SPEED_RAMP = 9;
const BOOST_ADD = 15;
const SPEED_SMOOTH = 3.2;
const STEER_ACCEL = 46;
const STEER_DAMPING = 3.4;
const MAX_BANK = 0.62;
const MAX_PITCH_VISUAL = 0.3;
const LIFE_DRAIN = 2.2;
const BOOST_DRAIN = 3.0;
const STORM_DRAIN = 12;
const ORB_CHARGE = 12;
const HIT_DAMAGE = 24;
const INVULN_TIME = 1.3;
const PLAYER_RADIUS = 1.3;
const ORB_RADIUS = 2.0;
const CHECK_WINDOW = 0.03;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function expSmooth(dt: number, rate: number): number {
  return 1 - Math.exp(-rate * dt);
}

export class Game {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;

  private course: Course;
  private environment: Environment;
  private craft: Craft;
  private input: InputController;
  private hud: Hud;
  private audio = new AudioEngine();
  private particles: ParticleSystem;

  private phase: Phase = 'ready';
  private t = 0;
  private u = 0;
  private v = 0;
  private uVel = 0;
  private vVel = 0;
  private speed = BASE_SPEED;
  private charge = MAX_CHARGE;
  private relaysRestored = 0;
  private score = 0;
  private restartCount = 0;
  private invulnTimer = 0;
  private elapsed = 0;
  private bankCurrent = 0;
  private pitchCurrent = 0;
  private crossedGateWarned = new Set<number>();
  private cameraPos = new THREE.Vector3();
  private cameraLook = new THREE.Vector3();
  private shakeTime = 0;
  private shakeMag = 0;
  private baseFov = 62;
  private muted = false;

  private lastTime = performance.now();
  private rafId = 0;
  private disposed = false;

  constructor(private container: HTMLElement) {
    this.course = buildCourse(SEED);

    this.camera = new THREE.PerspectiveCamera(this.baseFov, 1, 0.1, 2200);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.container.appendChild(this.renderer.domElement);

    this.scene.fog = new THREE.FogExp2(0x0c1626, 0.0032);

    const hemi = new THREE.HemisphereLight(0x9db7d9, 0x1a2233, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d9, 1.4);
    sun.position.set(120, 220, 80);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x3ea6ff, 0.5);
    rim.position.set(-140, 60, -100);
    this.scene.add(rim);

    this.environment = buildEnvironment(this.scene, this.course, SEED);

    this.craft = buildCraft();
    this.scene.add(this.craft.group);

    this.particles = new ParticleSystem(600);
    this.scene.add(this.particles.points);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.4, 0.86);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.hud = new Hud(this.container);
    this.hud.onStart = () => this.start();
    this.hud.onRestart = () => this.restart();
    this.hud.onToggleMute = () => this.toggleMute();
    this.hud.setObjective('Restore Relay 1');
    this.hud.setRelays(0);
    this.hud.setCharge(this.charge, MAX_CHARGE);
    this.hud.setScore(0);

    this.input = new InputController(this.container);
    this.audio.primeOnGesture();

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('keydown', this.onKeyDown);

    this.onResize();
    this.placeCraftAtStart();
    this.publishState();
    this.rafId = requestAnimationFrame(this.loop);
  }

  private placeCraftAtStart(): void {
    const frame = this.course.getFrame(0);
    this.craft.group.position.copy(frame.position);
    this.cameraPos.copy(frame.position).addScaledVector(frame.tangent, -7).addScaledVector(frame.up, 2.6);
    this.camera.position.copy(this.cameraPos);
    this.cameraLook.copy(frame.position).addScaledVector(frame.tangent, 8);
    this.camera.lookAt(this.cameraLook);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Enter' && this.phase === 'ready') this.start();
    if (e.code === 'KeyR') this.restart();
  };

  private onVisibility = () => {
    if (document.hidden) {
      if (this.phase === 'playing') this.phase = 'paused';
      this.hud.showPause(true);
    } else {
      if (this.phase === 'paused') this.phase = 'playing';
      this.hud.showPause(false);
      this.lastTime = performance.now();
    }
  };

  private onResize = () => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
  };

  private toggleMute(): void {
    this.muted = !this.muted;
    this.audio.setMuted(this.muted);
    this.hud.setMuteLabel(this.muted);
  }

  private start(): void {
    if (this.phase !== 'ready' && this.phase !== 'won' && this.phase !== 'lost') return;
    this.phase = 'playing';
    this.hud.showStart(false);
    this.hud.hideEnd();
  }

  private restart(): void {
    this.restartCount += 1;
    this.t = 0;
    this.u = 0;
    this.v = 0;
    this.uVel = 0;
    this.vVel = 0;
    this.speed = BASE_SPEED;
    this.charge = MAX_CHARGE;
    this.relaysRestored = 0;
    this.score = 0;
    this.invulnTimer = 0;
    this.elapsed = 0;
    this.bankCurrent = 0;
    this.pitchCurrent = 0;
    this.crossedGateWarned.clear();
    this.shakeTime = 0;

    for (const orb of this.course.orbs) orb.collected = false;
    for (const gv of this.environment.gateVisuals) {
      gv.ringMat.emissiveIntensity = 0.15;
      gv.ringMat.color.set(0x777d88);
      gv.glow.intensity = 0;
    }
    this.environment.extractionVisual.ringMat.emissiveIntensity = 0.15;
    this.environment.extractionVisual.glow.intensity = 0;

    this.placeCraftAtStart();
    this.hud.setCharge(this.charge, MAX_CHARGE);
    this.hud.setRelays(0);
    this.hud.setScore(0);
    this.hud.setObjective('Restore Relay 1');
    this.hud.hideEnd();
    this.hud.showStart(false);
    this.phase = 'playing';
  }

  private triggerShake(mag: number, duration: number): void {
    this.shakeMag = mag;
    this.shakeTime = duration;
  }

  private loop = (now: number) => {
    if (this.disposed) return;
    const dtRaw = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const dt = Math.min(dtRaw, 1 / 20);

    if (this.phase === 'playing') this.update(dt);
    this.particles.update(dt);
    this.updateCamera(dt);
    this.environment.update(this.elapsed, this.craft.group.position);

    this.composer.render();
    this.publishState();
    this.rafId = requestAnimationFrame(this.loop);
  };

  private update(dt: number): void {
    this.elapsed += dt;
    this.input.update();

    const speedFrac = THREE.MathUtils.clamp((this.speed - BASE_SPEED) / (BOOST_ADD + SPEED_RAMP), 0, 1);
    const targetSpeed = BASE_SPEED + this.t * SPEED_RAMP + (this.input.state.boost ? BOOST_ADD : 0);
    this.speed = lerp(this.speed, targetSpeed, expSmooth(dt, SPEED_SMOOTH));

    if (this.t < 1) {
      this.t = Math.min(1, this.t + (this.speed / this.course.length) * dt);
    }

    this.uVel += this.input.state.x * STEER_ACCEL * dt;
    this.vVel += this.input.state.y * STEER_ACCEL * dt;
    const damp = Math.max(0, 1 - STEER_DAMPING * dt);
    this.uVel *= damp;
    this.vVel *= damp;
    this.u += this.uVel * dt;
    this.v += this.vVel * dt;

    const radial = Math.hypot(this.u, this.v);
    let inStorm = false;
    if (radial > this.course.corridorRadius) {
      const over = radial - this.course.corridorRadius;
      const pull = over * 3.2;
      const nx = this.u / radial;
      const ny = this.v / radial;
      this.uVel -= nx * pull * dt;
      this.vVel -= ny * pull * dt;
      inStorm = true;
    }
    const radial2 = Math.hypot(this.u, this.v);
    if (radial2 > this.course.softRadius) {
      const scale = this.course.softRadius / radial2;
      this.u *= scale;
      this.v *= scale;
      this.uVel *= 0.3;
      this.vVel *= 0.3;
    }

    const frame = this.course.getFrame(this.t);
    const playerPos = frame.position
      .clone()
      .addScaledVector(frame.right, this.u)
      .addScaledVector(frame.up, this.v);
    this.craft.group.position.copy(playerPos);

    const lookMatrix = new THREE.Matrix4().lookAt(
      playerPos,
      playerPos.clone().add(frame.tangent),
      frame.up,
    );
    this.craft.group.quaternion.setFromRotationMatrix(lookMatrix);
    const targetBank = -this.input.state.x * MAX_BANK;
    const targetPitch = this.input.state.y * MAX_PITCH_VISUAL;
    this.bankCurrent = lerp(this.bankCurrent, targetBank, expSmooth(dt, 6));
    this.pitchCurrent = lerp(this.pitchCurrent, targetPitch, expSmooth(dt, 6));
    this.craft.group.rotateZ(this.bankCurrent);
    this.craft.group.rotateX(this.pitchCurrent);

    const flameScale = 0.7 + speedFrac * 0.8 + (this.input.state.boost ? 0.5 : 0);
    this.craft.leftFlame.scale.set(1, flameScale, 1);
    this.craft.rightFlame.scale.set(1, flameScale, 1);
    this.craft.engineLight.intensity = 1.1 + speedFrac * 1.4 + (this.input.state.boost ? 1.2 : 0);

    if (Math.random() < 0.9) {
      const enginePos = playerPos.clone().addScaledVector(frame.tangent, -1.6);
      this.particles.emit(enginePos, new THREE.Color(0x4fd8ff), {
        count: 1,
        speed: 2,
        life: 0.4,
        size: 4.5,
        spread: 0.6,
      });
    }

    this.invulnTimer = Math.max(0, this.invulnTimer - dt);

    let drain = LIFE_DRAIN;
    if (this.input.state.boost) drain += BOOST_DRAIN;
    if (inStorm) drain += STORM_DRAIN;
    this.charge = Math.max(0, this.charge - drain * dt);

    this.checkOrbs(playerPos);
    this.checkHazards(playerPos, frame);
    this.checkGates(playerPos);
    this.updateGateVisuals();

    this.score = this.relaysRestored * 1000 + Math.round(this.charge * 4) + Math.round(this.t * 800);

    this.hud.setCharge(this.charge, MAX_CHARGE);
    this.hud.setScore(this.score);
    this.updateObjectiveText();

    if (this.charge <= 0) {
      this.lose();
    }
  }

  private checkOrbs(playerPos: THREE.Vector3): void {
    for (const orb of this.course.orbs) {
      if (orb.collected) continue;
      if (Math.abs(orb.t - this.t) > CHECK_WINDOW) continue;
      const frame = this.course.getFrame(orb.t);
      const pos = frame.position.clone().addScaledVector(frame.right, orb.u).addScaledVector(frame.up, orb.v);
      if (pos.distanceTo(playerPos) < ORB_RADIUS) {
        orb.collected = true;
        this.charge = Math.min(MAX_CHARGE, this.charge + ORB_CHARGE);
        this.score += 40;
        this.audio.orb();
        this.particles.emit(pos, new THREE.Color(0x7fffe0), { count: 14, speed: 6, life: 0.5, size: 5, spread: 1 });
      }
    }
  }

  private checkHazards(playerPos: THREE.Vector3, _frame: unknown): void {
    if (this.invulnTimer > 0) return;
    for (let i = 0; i < this.course.hazards.length; i++) {
      const h = this.course.hazards[i];
      if (Math.abs(h.t - this.t) > CHECK_WINDOW * 1.4) continue;
      const mesh = this.environment.hazardVisuals[i].mesh;
      const dist = mesh.position.distanceTo(playerPos);
      if (dist < PLAYER_RADIUS + h.radius) {
        this.charge = Math.max(0, this.charge - HIT_DAMAGE);
        this.invulnTimer = INVULN_TIME;
        this.audio.impact();
        this.triggerShake(0.5, 0.4);
        this.hud.toast('IMPACT!');
        const away = playerPos.clone().sub(mesh.position).normalize();
        this.uVel += away.x * 14;
        this.vVel += away.y * 14;
        this.particles.emit(playerPos, new THREE.Color(0xff5060), {
          count: 22,
          speed: 9,
          life: 0.5,
          size: 6,
          spread: 1,
        });
        break;
      }
    }
  }

  private checkGates(playerPos: THREE.Vector3): void {
    for (let i = 0; i < this.course.gates.length; i++) {
      const gate = this.course.gates[i];
      if (Math.abs(gate.t - this.t) > CHECK_WINDOW) continue;
      if (i < this.relaysRestored) continue;
      if (i > this.relaysRestored) {
        if (!this.crossedGateWarned.has(i) && Math.abs(gate.t - this.t) < CHECK_WINDOW * 0.6) {
          this.crossedGateWarned.add(i);
          this.hud.toast(`RELAY ${i + 1} OFFLINE — RESTORE IN ORDER`);
        }
        continue;
      }
      // this is the next expected gate
      const gv = this.environment.gateVisuals[i];
      const dist = playerPos.distanceTo(gv.group.position);
      if (dist < gate.radius) {
        this.relaysRestored += 1;
        this.audio.relay();
        this.hud.toast(`RELAY ${i + 1} RESTORED`);
        gv.ringMat.color.set(0x38ff9e);
        gv.ringMat.emissiveIntensity = 2.2;
        gv.glow.intensity = 6;
        this.triggerShake(0.15, 0.3);
        this.particles.emit(gv.group.position, new THREE.Color(0x38ff9e), {
          count: 40,
          speed: 10,
          life: 0.8,
          size: 7,
          spread: 1,
        });
        if (this.relaysRestored === 3) {
          this.environment.extractionVisual.ringMat.color.set(0xffc94d);
          this.environment.extractionVisual.ringMat.emissiveIntensity = 2.4;
          this.environment.extractionVisual.glow.intensity = 8;
        }
      }
    }

    if (this.relaysRestored === 3) {
      const ext = this.course.extraction;
      if (Math.abs(ext.t - this.t) < CHECK_WINDOW) {
        const dist = playerPos.distanceTo(this.environment.extractionVisual.group.position);
        if (dist < ext.radius) {
          this.win();
        }
      }
    }
  }

  private updateGateVisuals(): void {
    const pulse = 0.55 + Math.sin(this.elapsed * 3.2) * 0.45;
    for (let i = 0; i < this.environment.gateVisuals.length; i++) {
      const gv = this.environment.gateVisuals[i];
      if (i < this.relaysRestored) continue; // already restored, stays steady green
      if (i === this.relaysRestored) {
        gv.ringMat.color.set(0x2ad8ff);
        gv.ringMat.emissiveIntensity = 0.6 + pulse * 1.8;
        gv.glow.intensity = 1.5 + pulse * 2.5;
      } else {
        gv.ringMat.color.set(0x777d88);
        gv.ringMat.emissiveIntensity = 0.12;
        gv.glow.intensity = 0;
      }
    }
    if (this.relaysRestored === 3) {
      const ext = this.environment.extractionVisual;
      ext.ringMat.emissiveIntensity = 1.4 + pulse * 1.6;
      ext.glow.intensity = 4 + pulse * 4;
    }
  }

  private updateObjectiveText(): void {
    if (this.relaysRestored < 3) {
      this.hud.setObjective(`Restore Relay ${this.relaysRestored + 1}`);
    } else {
      this.hud.setObjective('Proceed to the Extraction Ring');
    }
    this.hud.setRelays(this.relaysRestored);
  }

  private win(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'won';
    this.audio.win();
    this.hud.showEnd(true, this.score, this.relaysRestored);
    this.particles.emit(this.craft.group.position, new THREE.Color(0xffe08a), {
      count: 60,
      speed: 12,
      life: 1.1,
      size: 8,
      spread: 1,
    });
  }

  private lose(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'lost';
    this.audio.lose();
    this.triggerShake(0.4, 0.6);
    this.hud.showEnd(false, this.score, this.relaysRestored);
  }

  private updateCamera(dt: number): void {
    const frame = this.course.getFrame(this.t);
    const behind = 8.5 + (this.speed - BASE_SPEED) * 0.05;
    const desired = this.craft.group.position
      .clone()
      .addScaledVector(frame.tangent, -behind)
      .addScaledVector(frame.up, 2.8)
      .addScaledVector(frame.right, this.u * 0.15);
    const smoothing = this.phase === 'playing' ? expSmooth(dt, 4.5) : expSmooth(dt, 6);
    this.cameraPos.lerp(desired, smoothing);

    const lookTarget = this.craft.group.position.clone().addScaledVector(frame.tangent, 10);
    this.cameraLook.lerp(lookTarget, expSmooth(dt, 5));

    let shakeOffset = new THREE.Vector3();
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      const f = this.shakeTime * this.shakeMag;
      shakeOffset = new THREE.Vector3(
        (Math.random() * 2 - 1) * f,
        (Math.random() * 2 - 1) * f,
        (Math.random() * 2 - 1) * f,
      );
    }

    this.camera.position.copy(this.cameraPos).add(shakeOffset);
    this.camera.lookAt(this.cameraLook);

    const speedFrac = THREE.MathUtils.clamp((this.speed - BASE_SPEED) / (BOOST_ADD + SPEED_RAMP), 0, 1);
    const targetFov = this.baseFov + speedFrac * 9;
    this.camera.fov = lerp(this.camera.fov, targetFov, expSmooth(dt, 3));
    this.camera.updateProjectionMatrix();
  }

  private publishState(): void {
    const p = this.craft.group.position;
    const state: AetherPlayState = {
      phase: this.phase,
      score: Math.round(this.score),
      player: { x: p.x, y: p.y, z: p.z },
      relaysRestored: this.relaysRestored,
      charge: Math.round(this.charge * 100) / 100,
      seed: SEED,
      restartCount: this.restartCount,
      progress: Math.round(this.t * 1000) / 1000,
      speed: Math.round(this.speed * 100) / 100,
    };
    (window as unknown as { __AETHERPLAY__: AetherPlayState }).__AETHERPLAY__ = state;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('keydown', this.onKeyDown);
    this.input.dispose();
    this.renderer.dispose();
  }
}
