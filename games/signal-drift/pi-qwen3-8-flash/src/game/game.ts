import * as THREE from 'three';
import { Course } from './course';
import { FIELD, PALETTE, SEED, TUNING } from './config';
import { World } from './world';
import { FieldEntities, type RelayGate } from './entities';
import { CameraRig, Craft } from './craft';
import { Particles } from './particles';
import { InputManager, type Command } from './input';
import { Hud, type HudSnapshot, type Phase } from './hud';
import { AudioKit } from './audio';
import { PostFX } from './grade';
import { createInspection, sanitise } from './inspect';
import { Rng, clamp, damp, makeSoftSprite } from './util';

const CRAFT_RADIUS = 4.2;

interface RunState {
  charge: number;
  score: number;
  relays: number;
  impacts: number;
  cells: number;
  elapsed: number;
  progress: number;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private course: Course;
  private world: World;
  private entities: FieldEntities;
  private craft: Craft;
  private rig: CameraRig;
  private particles: Particles;
  private hud: Hud;
  private input: InputManager;
  private audio = new AudioKit();
  private postfx: PostFX;
  private inspect = createInspection();
  private rng = new Rng(SEED ^ 0x5f3a);

  private phase: Phase = 'ready';
  private run: RunState = { charge: TUNING.charge.start, score: 0, relays: 0, impacts: 0, cells: 0, elapsed: 0, progress: 0 };
  private restartCount = 0;
  private best = 0;

  private pos = new THREE.Vector3();
  private prevPos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private displayQuat = new THREE.Quaternion();
  private bankQuat = new THREE.Quaternion();
  private speed = TUNING.flight.cruiseSpeed;
  private ctrlYaw = 0;
  private ctrlPitch = 0;
  private ctrlRoll = 0;
  private turnRate = 0;
  private iframe = 0;
  private damageFlash = 0;
  private victory = 0;
  private timeScale = 1;
  private routeT = 0;
  private crossCooldown = 0;
  private shearState: 'none' | 'top' | 'bottom' = 'none';
  private danger = 0;
  private messageTimer = 0;

  private lastFrame = 0;
  private rafId = 0;
  private fps = 60;
  private qualitySamples: number[] = [];
  private qualityTimer = 0;
  private quality: 'high' | 'medium' | 'low' = 'high';
  private renderScale = 1;
  private targetPixelRatio = 1;
  private width = 1;
  private height = 1;
  private disposed = false;

  private measureA = { along: 0, radial: 0 };
  private measureB = { along: 0, radial: 0 };
  private tmp1 = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private tmp3 = new THREE.Vector3();
  private tmpPublish = new THREE.Vector3();
  private tmpColor = new THREE.Color();

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.setClearColor(new THREE.Color(PALETTE.skyHigh), 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', 'Signal Drift playfield');

    this.scene.fog = new THREE.FogExp2(FOG_COLOR_HEX, 0.00225);

    this.course = new Course(SEED);
    this.world = new World(this.course);
    this.entities = new FieldEntities(this.course);
    this.craft = new Craft();
    this.particles = new Particles({ count: 1400, texture: makeSoftSprite(96, 2.4) });
    this.rig = new CameraRig(1);

    this.scene.add(this.world.group, this.entities.group, this.craft.group, this.particles.points);

    this.hud = new Hud(container);
    this.input = new InputManager({
      steerZones: this.hud.playSurface,
      boost: this.hud.boostButton,
      brake: this.hud.brakeButton,
      stick: this.hud.stick,
    });
    this.postfx = new PostFX(this.renderer, this.scene, this.rig.camera);

    this.input.attach(this.hud.playSurface, this.handleCommand);
    this.bindHudActions();
    this.resetRun(true);
    this.handleResize();
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('orientationchange', this.handleOrientation);
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost, false);

    this.hud.setMuted(this.audio.muted);
    this.setPhase('ready');
    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  /* ---------------------------------------------------------------- */
  /* setup + lifecycle                                                 */
  /* ---------------------------------------------------------------- */

  private bindHudActions(): void {
    const on = (el: Element | null, fn: () => void) => {
      if (!(el instanceof HTMLElement)) return;
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      });
    };
    on(this.hud.root.querySelector('[data-action="begin"]'), () => this.begin());
    on(this.hud.root.querySelector('[data-action="resume"]'), () => this.togglePause());
    on(this.hud.root.querySelector('[data-action="pause"]'), () => this.togglePause());
    on(this.hud.root.querySelector('#sd-screen-won [data-action="restart"]'), () => this.restart());
    on(this.hud.root.querySelector('#sd-screen-lost [data-action="restart"]'), () => this.restart());
    on(this.hud.root.querySelector('#sd-screen-paused [data-action="restart"]'), () => this.restart());
    on(this.hud.muteButton, () => this.toggleMute());
  }

  private handleCommand = (cmd: Command): void => {
    switch (cmd) {
      case 'begin':
        if (this.phase === 'ready') this.begin();
        else if (this.phase === 'won' || this.phase === 'lost') this.restart();
        break;
      case 'pause':
        if (this.phase === 'playing' || this.phase === 'paused') this.togglePause();
        break;
      case 'restart':
        if (this.phase !== 'ready') this.restart();
        break;
      case 'mute':
        this.toggleMute();
        break;
      default:
        break;
    }
  };

  private begin(): void {
    this.audio.unlock();
    this.audio.uiClick();
    this.setPhase('playing');
    this.hud.flash('TETHER ONLINE', 'good');
  }

  private togglePause(): void {
    if (this.phase === 'playing') {
      this.setPhase('paused');
      this.audio.suspend();
    } else if (this.phase === 'paused') {
      this.setPhase('playing');
      this.audio.resume();
    }
  }

  private toggleMute(): void {
    this.audio.unlock();
    this.audio.setMuted(!this.audio.muted);
    this.hud.setMuted(this.audio.muted);
    if (!this.audio.muted) this.audio.uiClick();
  }

  private restart(): void {
    this.restartCount += 1;
    this.audio.unlock();
    this.resetRun(false);
    this.setPhase('playing');
    this.audio.resume();
    this.hud.flash('REBOOTING COURIER HULL', 'info');
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.hud.showPhase(phase);
    this.input.clear();
    this.inspect.phase = phase;
    this.inspect.restartCount = this.restartCount;
  }

  private resetRun(initial: boolean): void {
    this.run = {
      charge: TUNING.charge.start,
      score: 0,
      relays: 0,
      impacts: 0,
      cells: 0,
      elapsed: 0,
      progress: 0,
    };
    this.entities.reset();
    this.entities.gates[0].setState('active');
    this.particles.reset();
    this.rng = new Rng(SEED ^ 0x5f3a);

    this.pos.copy(this.course.spawn.pos);
    this.prevPos.copy(this.pos);
    this.quat.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(this.course.spawn.side, this.course.spawn.up, this.course.spawn.tangent.clone().negate()),
    );
    this.displayQuat.copy(this.quat);
    this.vel.copy(this.course.spawn.tangent).multiplyScalar(TUNING.flight.cruiseSpeed);
    this.speed = TUNING.flight.cruiseSpeed;
    this.routeT = 0.012;
    this.ctrlYaw = 0;
    this.ctrlPitch = 0;
    this.ctrlRoll = 0;
    this.iframe = initial ? 0 : 1.2;
    this.damageFlash = 0;
    this.victory = 0;
    this.timeScale = 1;
    this.crossCooldown = 0;
    this.craft.setDamageTint(0);
    this.craft.group.position.copy(this.pos);
    this.craft.group.quaternion.copy(this.quat);
    this.craft.group.updateMatrixWorld(true);
    this.rig.reset(this.pos, this.quat);
    if (initial) this.frameCinematic(0, 0);
    this.inspect.relaysRestored = 0;
    this.inspect.score = 0;
    this.inspect.restartCount = this.restartCount;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('orientationchange', this.handleOrientation);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.renderer.dispose();
  }

  /* ---------------------------------------------------------------- */
  /* main loop                                                         */
  /* ---------------------------------------------------------------- */

  private frame = (): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.frame);
    const now = performance.now();
    let raw = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (!Number.isFinite(raw) || raw <= 0) raw = 1 / 60;
    raw = Math.min(0.05, raw);
    this.fps = damp(this.fps, 1 / raw, 1.5, raw);
    this.adaptQuality(raw);

    const time = now / 1000;
    const active = this.phase === 'playing';
    const dt = active ? raw * this.timeScale : this.phase === 'paused' ? 0 : raw * (this.phase === 'ready' ? 1 : 0.45);

    if (active) this.step(dt);
    else if (this.phase === 'ready') this.frameCinematic(dt, time);
    else if (this.phase !== 'paused') this.ambientStep(dt, time);

    if (dt > 0) {
      this.entities.update(dt, time, this.rig.camera.position, this.pos);
      this.particles.update(dt);
    }

    this.world.update({
      dt: Math.max(dt, 0.0001),
      time,
      craftPos: this.pos,
      craftVel: this.vel,
      cameraPos: this.rig.camera.position,
      speed: this.speed,
      targetPos: this.currentTarget()?.group.position ?? null,
      relayProgress: this.routeT,
      charging: clamp(this.damageFlash, 0, 1),
    });

    this.render(dt, time);
    this.publish(dt);
  };

  /** One simulated gameplay step. */
  private step(dt: number): void {
    const t = performance.now() / 1000;
    this.run.elapsed += dt * 1000;
    this.iframe = Math.max(0, this.iframe - dt);
    this.crossCooldown = Math.max(0, this.crossCooldown - dt);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.2);
    this.messageTimer = Math.max(0, this.messageTimer - dt);

    const axis = this.input.sample(dt);

    // --- control smoothing -------------------------------------------------
    const resp = TUNING.flight.controlResponse;
    this.ctrlYaw = damp(this.ctrlYaw, axis.yaw, resp, dt);
    this.ctrlPitch = damp(this.ctrlPitch, axis.pitch, resp, dt);
    this.ctrlRoll = damp(this.ctrlRoll, axis.roll, resp * 1.2, dt);

    const f = TUNING.flight;
    const yaw = -this.ctrlYaw * f.yawRate * dt;
    const pitch = this.ctrlPitch * f.pitchRate * dt;
    const roll = -this.ctrlRoll * f.rollRate * dt;
    this.tmp1.set(pitch, yaw, roll);
    this.stepEuler.set(this.tmp1.x, this.tmp1.y, this.tmp1.z, 'XYZ');
    // Local-space increment: pitch, yaw and roll as one small euler.
    this.quat.multiply(this.bankQuat.setFromEuler(this.stepEuler)).normalize();
    this.quat.normalize();

    const forward = this.tmp2.set(0, 0, -1).applyQuaternion(this.quat);

    // --- speed -------------------------------------------------------------
    let desired = f.cruiseSpeed;
    if (axis.brake) desired = f.minSpeed;
    if (axis.boost) desired = f.boostSpeed;
    desired = clamp(desired, f.minSpeed, f.boostSpeed);
    const lambda = desired > this.speed ? (axis.boost ? 1.55 : 0.95) : 1.9;
    this.speed = damp(this.speed, desired, lambda, dt);

    // --- velocity with drift ------------------------------------------------
    this.tmp3.copy(forward).multiplyScalar(this.speed);
    this.vel.x = damp(this.vel.x, this.tmp3.x, f.grip, dt);
    this.vel.y = damp(this.vel.y, this.tmp3.y, f.grip, dt);
    this.vel.z = damp(this.vel.z, this.tmp3.z, f.grip, dt);

    // Storm gusts from nearby cells.
    const gust = this.entities.stormForce(this.pos, this.tmp1);
    this.danger = damp(this.danger, clamp(gust * 1.35, 0, 1), 4, dt);
    if (gust > 0) {
      this.vel.addScaledVector(this.tmp1, f.gust * gust * dt);
      this.run.charge -= gust * dt * 1.1;
    }

    this.prevPos.copy(this.pos);
    this.pos.addScaledVector(this.vel, dt);
    const actualSpeed = this.vel.length();

    // --- corridor tether ----------------------------------------------------
    this.routeT = this.nearestT(this.pos, this.routeT);
    this.run.progress = Math.max(this.run.progress, this.routeT);
    const anchor = this.course.curve.getPointAt(clamp(this.routeT, 0, 1), this.tmp1);
    const lateral = this.pos.distanceTo(anchor);
    if (lateral > 120) {
      const pull = clamp((lateral - 120) / 120, 0, 1);
      this.tmp2.copy(anchor).sub(this.pos).normalize();
      this.vel.addScaledVector(this.tmp2, pull * 34 * dt);
      if (pull > 0.55) this.run.charge -= pull * dt * 4.5;
      if (this.messageTimer <= 0 && pull > 0.3) {
        this.say('OFF TETHER — RETURN TO SIGNAL', 'bad');
      }
    }

    // --- altitude bands -----------------------------------------------------
    this.shearState = 'none';
    if (this.pos.y > FIELD.ceiling) {
      this.shearState = 'top';
      this.vel.y -= (this.pos.y - FIELD.ceiling) * 2.4 * dt * 6;
      this.pos.y = Math.min(this.pos.y, FIELD.ceiling + 26);
      this.run.charge -= TUNING.charge.shear * dt;
      this.rig.addShake(dt * 3.2);
    } else if (this.pos.y < FIELD.floor) {
      this.shearState = 'bottom';
      this.vel.y += (FIELD.floor - this.pos.y) * 2.4 * dt * 6;
      this.pos.y = Math.max(this.pos.y, FIELD.floor - 24);
      this.run.charge -= TUNING.charge.shear * dt;
      this.rig.addShake(dt * 3.2);
    }

    // --- hazards ------------------------------------------------------------
    const hit = this.entities.resolveHit(this.pos, CRAFT_RADIUS);
    if (hit && this.iframe <= 0) this.impact(hit.point, hit.kind);

    // --- pickups ------------------------------------------------------------
    const got = this.entities.collectCells(this.pos);
    if (got > 0) {
      this.run.charge = Math.min(TUNING.charge.max, this.run.charge + got * TUNING.charge.cell);
      this.run.score += got * TUNING.score.cell;
      this.run.cells += got;
      this.audio.pickup(this.run.cells);
      this.tmpColor.setHex(PALETTE.cyan);
      this.particles.burst(this.pos, 8 + got * 5, 12, this.tmpColor, 2.6, 0.55, this.vel.clone().multiplyScalar(0.05));
      this.rig.addShake(0.05);
    }

    // --- gates --------------------------------------------------------------
    this.checkGates();

    // --- charge + score -----------------------------------------------------
    const boostDraw = this.input.axis.boost ? TUNING.charge.boostDrain : 0;
    this.run.charge -= (TUNING.charge.drain + boostDraw) * dt;
    this.run.score += actualSpeed * dt * 0.55;

    if (this.run.charge <= 0) {
      this.run.charge = 0;
      this.fail();
      return;
    }
    this.run.charge = Math.min(this.run.charge, TUNING.charge.max);

    // --- craft presentation -------------------------------------------------
    const targetBank = -this.ctrlYaw * f.bankFactor + this.ctrlRoll * 0.35;
    this.bankAngle = damp(this.bankAngle, targetBank, 6, dt);
    this.tmp1.set(0, 0, 1).applyQuaternion(this.quat);
    this.bankQuat.setFromAxisAngle(this.tmp1, this.bankAngle);
    this.displayQuat.copy(this.quat).multiply(this.bankQuat);
    this.craft.group.position.copy(this.pos);
    this.craft.group.quaternion.copy(this.displayQuat);

    const throttle01 = clamp((this.speed - f.minSpeed) / (f.boostSpeed - f.minSpeed), 0, 1);
    this.craft.update(dt, t, throttle01, this.input.axis.boost, this.speed);
    this.craft.setDamageTint(this.damageFlash);
    this.turnRate = damp(this.turnRate, this.ctrlYaw * f.yawRate, 6, dt);
    this.rig.update(dt, this.pos, this.displayQuat, this.speed, this.turnRate, this.input.axis.boost, t);

    if (this.input.axis.boost) {
      this.tmpColor.setHex(PALETTE.cyan);
      this.particles.spawn(
        this.pos.x + this.rng.float(-2, 2),
        this.pos.y + this.rng.float(-2, 2),
        this.pos.z + this.rng.float(-2, 2),
        -this.vel.x * 0.35,
        -this.vel.y * 0.35,
        -this.vel.z * 0.35,
        this.tmpColor,
        1.8,
        0.32,
        2.4,
      );
    }

    if (this.run.charge < TUNING.charge.critical && this.warnTimer <= 0) {
      this.warnTimer = 1.6;
      this.audio.warn();
    }
    this.warnTimer = Math.max(0, this.warnTimer - dt);

    this.audio.setFlight(
      throttle01,
      this.input.axis.boost,
      true,
      Math.max(this.danger, this.run.charge < TUNING.charge.critical ? 0.6 : 0),
    );
  }

  private bankAngle = 0;
  private stepEuler = new THREE.Euler();
  private warnTimer = 0;

  /** Camera + ambience while waiting on the ready screen. */
  private frameCinematic(dt: number, time: number): void {
    const spawn = this.course.spawn;
    const focus = this.tmp1.copy(spawn.pos).addScaledVector(spawn.tangent, -30);
    const radius = 33;
    const angle = time * 0.12;
    const cam = this.rig.camera;
    cam.position.set(
      focus.x + Math.cos(angle) * radius,
      focus.y + 7 + Math.sin(angle * 0.7) * 4,
      focus.z + Math.sin(angle) * radius,
    );
    cam.up.set(0, 1, 0);
    cam.lookAt(this.tmp2.copy(spawn.pos));
    cam.fov = damp(cam.fov, 52, 2, dt);
    cam.updateProjectionMatrix();

    // Idle hover - keep the physics quaternion synced so launch is seamless.
    const bob = Math.sin(time * 1.1) * 0.4;
    this.pos.set(spawn.pos.x, spawn.pos.y + bob, spawn.pos.z);
    this.craft.group.position.copy(this.pos);
    this.idleEuler.set(
      Math.sin(time * 0.55) * 0.05,
      angle * 0.9 + Math.sin(time * 0.4) * 0.2,
      Math.cos(time * 0.5) * 0.06,
      'YXZ',
    );
    this.quat.setFromEuler(this.idleEuler);
    this.displayQuat.copy(this.quat);
    this.craft.group.quaternion.copy(this.quat);
    this.craft.update(dt, time, 0.4, false, 12);
    this.vel.set(0, 0, 0);
    this.speed = 12;
  }

  private idleEuler = new THREE.Euler();

  private ambientStep(dt: number, time: number): void {
    // Slow drift on the end screens so the field keeps breathing.
    this.timeScale = this.phase === 'won' ? 0.32 : this.timeScale;
    this.damageFlash = Math.max(0, this.damageFlash - dt);
    if (this.phase === 'lost') {
      this.vel.multiplyScalar(Math.max(0, 1 - dt * 0.7));
      this.vel.y -= 12 * dt;
      this.pos.addScaledVector(this.vel, dt);
      this.pos.y = Math.max(FIELD.floor - 200, this.pos.y + 0);
      this.speed = this.vel.length();
      this.craft.group.position.copy(this.pos);
      this.craft.update(dt, time, 0.12, false, this.speed);
      this.rig.update(dt, this.pos, this.displayQuat, this.speed * 0.4, this.turnRate, false, time);
    } else if (this.phase === 'won') {
      this.victory = Math.min(1, this.victory + dt * 0.6);
      const spin = dt * 0.6;
      this.quat.multiply(this.bankQuat.setFromAxisAngle(this.tmp1.set(0, 1, 0).applyQuaternion(this.quat).normalize(), spin));
      this.craft.group.quaternion.copy(this.quat);
      this.craft.group.position.copy(this.pos);
      this.craft.update(dt, time, 0.7, false, this.speed);
      this.rig.update(dt, this.pos, this.quat, this.speed * 0.3, 0, false, time);
      if (this.rng.float(0, 1) < dt * 22) {
        this.tmpColor.setHSL(0.09 + this.rng.float(0, 0.12), 1, 0.65);
        this.particles.burst(
          this.tmp2.copy(this.pos).add(this.tmp3.set(this.rng.float(-16, 16), this.rng.float(-14, 14), this.rng.float(-16, 16))),
          6,
          16,
          this.tmpColor,
          2.6,
          1.1,
        );
      }
    }
  }

  private nearestT(p: THREE.Vector3, hint: number): number {
    let best = hint;
    let bestD = Infinity;
    const window = 0.05;
    const steps = 26;
    for (let i = 0; i <= steps; i += 1) {
      const t = clamp(hint - window + (window * 2 * i) / steps, 0, 1);
      const d = this.course.curve.getPointAt(t, this.tmp1).distanceToSquared(p);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  private currentTarget(): RelayGate | null {
    if (this.run.relays < this.entities.gates.length) return this.entities.gates[this.run.relays];
    return this.entities.extraction;
  }

  private checkGates(): void {
    const gates: RelayGate[] = [...this.entities.gates, this.entities.extraction];
    for (const gate of gates) {
      gate.measure(this.prevPos, this.measureA);
      gate.measure(this.pos, this.measureB);
      const crossed = this.measureA.along * this.measureB.along <= 0 && Math.abs(this.measureA.along) > 0.05;
      if (!crossed) continue;
      if (Math.abs(this.measureA.along - this.measureB.along) > 90) continue;
      const radial = this.measureB.radial;
      if (radial > gate.radius + 4) continue;

      if (gate.state === 'restored') continue;

      if (gate.state === 'locked') {
        // Locked tether: the membrane throws you back onto the route.
        this.pos.copy(this.prevPos);
        const normal = this.tmp1.set(0, 0, 1).applyQuaternion(gate.group.quaternion);
        const into = this.vel.dot(normal);
        this.vel.addScaledVector(normal, -2 * into * 0.75);
        this.vel.multiplyScalar(0.55);
        this.speed = Math.max(TUNING.flight.minSpeed, this.speed * 0.5);
        this.run.charge -= 6;
        this.rig.addShake(1.5);
        this.damageFlash = Math.max(this.damageFlash, 0.7);
        this.tmpColor.setHex(PALETTE.magenta);
        this.particles.burst(this.pos, 22, 18, this.tmpColor, 3, 0.6);
        this.audio.zap();
        const wanted = this.currentTarget();
        const label = wanted === this.entities.extraction ? 'EXTRACTION' : `RELAY 0${(wanted?.index ?? 0) + 1}`;
        this.say(`SEALED TETHER — ${label} FIRST`, 'bad');
        this.iframe = Math.max(this.iframe, 0.4);
        continue;
      }

      // Active gate.
      if (this.crossCooldown > 0) continue;
      this.crossCooldown = 0.6;
      if (radial <= gate.aperture) {
        if (gate === this.entities.extraction) this.succeed();
        else this.restoreRelay(gate);
      } else {
        this.say('MISSED THE MOUTH — LINE IT UP', 'bad');
        this.rig.addShake(0.35);
      }
    }
  }

  private restoreRelay(gate: RelayGate): void {
    gate.setState('restored');
    gate.flare();
    this.run.relays += 1;
    this.run.score += TUNING.score.relay;
    this.run.charge = Math.min(TUNING.charge.max, this.run.charge + TUNING.charge.relayBonus);
    this.iframe = Math.max(this.iframe, 0.6);
    this.rig.addShake(1.1);
    this.damageFlash = 0.35;
    this.tmpColor.setHex(PALETTE.amber);
    this.particles.burst(gate.group.position, 70, 34, this.tmpColor, 3.6, 1.5);
    this.audio.relayRestored(this.run.relays);

    const next = this.currentTarget();
    if (next) {
      next.setState('active');
      if (next === this.entities.extraction) {
        next.setBeam(1);
        this.audio.unlockExtraction();
        this.say('EXTRACTION RING LIVE', 'good');
      } else {
        this.say(`RELAY 0${gate.index + 1} RESTORED`, 'good');
      }
    } else {
      this.say('ALL RELAYS RESTORED', 'good');
    }
    this.inspect.relaysRestored = this.run.relays;
  }

  private succeed(): void {
    const gate = this.entities.extraction;
    gate.setState('restored');
    gate.flare();
    gate.setBeam(1);
    const timeBonus = Math.max(0, Math.round(TUNING.score.timeBonus * (TUNING.score.parSeconds - this.run.elapsed / 1000)));
    this.run.score += TUNING.score.extraction + timeBonus + Math.round(this.run.charge) * TUNING.score.chargeBonus;
    if (this.run.impacts === 0) this.run.score += TUNING.score.cleanRun;
    this.best = Math.max(this.best, this.run.score);
    this.timeScale = 0.35;
    this.setPhase('won');
    this.audio.win();
    this.rig.addShake(1.4);
    this.tmpColor.setHex(PALETTE.amber);
    this.particles.burst(gate.group.position, 160, 48, this.tmpColor, 4.2, 1.9);
    this.hud.flash('SIGNAL RESTORED — CONTRACT CLOSED', 'good');
  }

  private fail(): void {
    this.best = Math.max(this.best, this.run.score);
    this.setPhase('lost');
    this.audio.lose();
    this.audio.setFlight(0, false, false, 0);
    this.rig.addShake(1.8);
    this.damageFlash = 1;
    this.tmpColor.setHex(PALETTE.magenta);
    this.particles.burst(this.pos, 90, 26, this.tmpColor, 3.4, 1.6, this.vel.clone().multiplyScalar(0.2));
    this.hud.flash('CHARGE DEPLETED — HULL GOING DARK', 'bad');
  }

  private impact(point: THREE.Vector3, kind: 'sweeper' | 'drifter' | 'arc'): void {
    this.run.impacts += 1;
    this.run.charge -= TUNING.charge.impact;
    this.run.score = Math.max(0, this.run.score - TUNING.score.impactPenalty);
    this.iframe = TUNING.flight.iframes;
    this.damageFlash = 1;
    this.rig.addShake(kind === 'arc' ? 1.5 : 1.9);
    this.tmp1.copy(this.pos).sub(point);
    const len = this.tmp1.length() || 1;
    this.tmp1.divideScalar(len);
    this.vel.addScaledVector(this.tmp1, TUNING.flight.knockback);
    this.vel.clampLength(0, TUNING.flight.boostSpeed * 1.15);
    this.speed = Math.max(TUNING.flight.minSpeed, this.speed * 0.62);
    this.craft.flashShield(0.9, kind === 'arc' ? PALETTE.ice : PALETTE.magenta);
    this.tmpColor.setHex(kind === 'arc' ? PALETTE.ice : PALETTE.magenta);
    this.particles.burst(point, 34, 26, this.tmpColor, 3, 0.7, this.vel.clone().multiplyScalar(0.12));
    if (kind === 'arc') this.audio.zap();
    else this.audio.impact();
    this.say(kind === 'arc' ? 'DISCHARGE HIT' : kind === 'drifter' ? 'STORM CELL STRIKE' : 'SWEEPER ARM', 'bad');
  }

  private say(message: string, tone: 'good' | 'bad' | 'info'): void {
    this.hud.flash(message, tone);
    this.inspect.message = message;
    this.messageTimer = 1.4;
  }

  /* ---------------------------------------------------------------- */
  /* rendering, hud publishing, resize                                 */
  /* ---------------------------------------------------------------- */

  private render(dt: number, time: number): void {
    void dt;
    const speed01 = clamp((this.speed - TUNING.flight.minSpeed) / (TUNING.flight.boostSpeed - TUNING.flight.minSpeed), 0, 1);
    this.postfx.update({
      time,
      damage: this.damageFlash * (this.phase === 'lost' ? 0.8 : 1),
      speed01: speed01 * (this.input.axis.boost ? 1 : 0.75),
      danger: this.danger,
      lowCharge: clamp(1 - this.run.charge / TUNING.charge.critical, 0, 1) * (this.phase === 'playing' ? 1 : 0),
      victory: this.victory,
    });
    this.postfx.render();
  }

  private publish(dt: number): void {
    const gate = this.currentTarget();
    const cam = this.rig.camera;
    const distance = gate ? this.pos.distanceTo(gate.group.position) : 0;
    const throttle01 = clamp((this.speed - TUNING.flight.minSpeed) / (TUNING.flight.boostSpeed - TUNING.flight.minSpeed), 0, 1);

    const snapshot: HudSnapshot = {
      phase: this.phase,
      charge: this.run.charge,
      chargeMax: TUNING.charge.max,
      relays: this.run.relays,
      objective: this.objectiveLabel(),
      distance,
      score: this.run.score,
      speed: this.speed,
      maxSpeed: TUNING.flight.boostSpeed,
      throttle01,
      boosting: this.input.axis.boost,
      elapsedMs: this.run.elapsed,
      impacts: this.run.impacts,
      cellsLeft: TUNING.cells.count - this.run.cells,
      danger: this.danger,
      lowCharge: this.run.charge < TUNING.charge.critical,
      shear: this.phase === 'playing' ? this.shearState : 'none',
      fps: this.fps,
      best: this.best,
      message: this.inspect.message,
    };
    this.hud.update(snapshot, dt);
    this.updateReticle(gate, cam, snapshot);

    const i = this.inspect;
    i.phase = this.phase;
    i.score = Math.round(this.run.score);
    i.player.x = this.pos.x;
    i.player.y = this.pos.y;
    i.player.z = this.pos.z;
    i.relaysRestored = this.run.relays;
    i.charge = this.run.charge;
    i.seed = SEED;
    i.restartCount = this.restartCount;
    i.speed = this.speed;
    i.throttle = throttle01;
    const heading = this.craft.getForward(this.tmpPublish);
    i.heading.x = heading.x;
    i.heading.y = heading.y;
    i.heading.z = heading.z;
    i.velocity.x = this.vel.x;
    i.velocity.y = this.vel.y;
    i.velocity.z = this.vel.z;
    i.objective = snapshot.objective;
    i.distanceToTarget = distance;
    if (gate) {
      i.target = i.target ?? { x: 0, y: 0, z: 0 };
      i.target.x = gate.group.position.x;
      i.target.y = gate.group.position.y;
      i.target.z = gate.group.position.z;
    } else {
      i.target = null;
    }
    i.impacts = this.run.impacts;
    i.cellsRemaining = TUNING.cells.count - this.run.cells;
    i.elapsedMs = Math.round(this.run.elapsed);
    i.fps = Math.round(this.fps);
    i.quality = this.quality;
    i.controls = this.input.touchMode ? 'touch' : 'keyboard';
    i.message = this.messageTimer > 0 ? this.inspect.message : '';
    i.hull = clamp(this.run.charge / TUNING.charge.max, 0, 1);
    sanitise(i);
  }

  private objectiveLabel(): string {
    if (this.phase === 'ready') return 'STAND BY';
    if (this.phase === 'won') return 'SIGNAL RESTORED';
    if (this.phase === 'lost') return 'COURIER LOST';
    if (this.run.relays < 3) return `RESTORE RELAY 0${this.run.relays + 1}`;
    return 'RUN THE EXTRACTION RING';
  }

  private updateReticle(gate: RelayGate | null, cam: THREE.PerspectiveCamera, snapshot: HudSnapshot): void {
    if (!gate || this.phase === 'ready') {
      this.hud.setReticle(-999, -999, false, '', null);
      return;
    }
    const v = this.tmp1.copy(gate.group.position).project(cam);
    const behind = v.z > 1;
    let x = (v.x * 0.5 + 0.5) * this.width;
    let y = (-v.y * 0.5 + 0.5) * this.height;
    const margin = this.width < 700 ? 46 : 70;
    const inside = !behind && x > margin && x < this.width - margin && y > margin && y < this.height - margin;
    if (!inside) {
      const cx = this.width / 2;
      const cy = this.height / 2;
      const dx = (behind ? -v.x : v.x) * 1.2;
      const dy = (behind ? -v.y : v.y) * 1.2;
      const scaleX = Math.abs(dx) > 1e-4 ? (this.width / 2 - margin) / Math.abs(dx) : Infinity;
      const scaleY = Math.abs(dy) > 1e-4 ? (this.height / 2 - margin) / Math.abs(dy) : Infinity;
      const s = Math.min(scaleX, scaleY);
      x = cx + dx * s;
      y = cy + dy * s;
    }
    const short = gate === this.entities.extraction ? 'EXTRACT' : `RELAY 0${gate.index + 1}`;
    this.hud.setReticle(x, y, inside, `${short} · ${Math.round(snapshot.distance)}m`, null);
  }

  private handleOrientation = (): void => {
    window.setTimeout(this.handleResize, 120);
  };

  private handleResize = (): void => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.width = w;
    this.height = h;
    const dpr = window.devicePixelRatio || 1;
    this.targetPixelRatio = clamp(dpr, 1, w * h > 1_600_000 ? 1.6 : 2);
    const pr = this.targetPixelRatio * this.renderScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, true);
    this.rig.resize(w / h, w, h);
    this.postfx.setSize(w, h, pr);
    this.world.setPixelRatio(pr);
    this.craft.setPixelRatio(pr);
    this.particles.setPixelRatio(pr);
    this.input.recheckMode();
    this.hud.setTouchMode(this.input.touchMode);
  };

  private handleVisibility = (): void => {
    if (document.hidden && this.phase === 'playing') {
      this.setPhase('paused');
      this.audio.suspend();
    }
  };

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.phase === 'playing') this.setPhase('paused');
    this.hud.flash('GPU CONTEXT LOST — PRESS P TO RESUME', 'bad');
  };

  private adaptQuality(raw: number): void {
    this.qualityTimer += raw;
    this.qualitySamples.push(raw);
    if (this.qualityTimer < 1.4) return;
    const avg = this.qualitySamples.reduce((a, b) => a + b, 0) / this.qualitySamples.length;
    const fps = 1 / Math.max(1e-4, avg);
    this.qualitySamples = [];
    this.qualityTimer = 0;
    if (fps < 42 && this.renderScale > 0.62) {
      this.renderScale = Math.max(0.6, this.renderScale - 0.18);
      if (this.renderScale <= 0.68) this.setQuality('low');
      else this.setQuality('medium');
      this.handleResize();
    } else if (fps > 57 && this.renderScale < 1) {
      this.renderScale = Math.min(1, this.renderScale + 0.08);
      if (this.renderScale > 0.94) this.setQuality('high');
      this.handleResize();
    }
  }

  private setQuality(level: 'high' | 'medium' | 'low'): void {
    if (this.quality === level) return;
    this.quality = level;
    this.postfx.setQuality(level);
  }
}

const FOG_COLOR_HEX = 0x16242e;

export function createGame(container: HTMLElement): Game {
  return new Game(container);
}
