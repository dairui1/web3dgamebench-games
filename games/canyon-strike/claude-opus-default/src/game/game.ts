import * as THREE from 'three';
import { AudioBus } from '../core/audio';
import { Input } from '../core/input';
import { clamp, clamp01, damp, formatTime, Rng } from '../core/mathutil';
import {
  buildTerrain,
  canyonHalfWidth,
  distFromPath,
  heightAt,
  pathPoint,
  pathX,
  updateTerrainVisibility,
  WORLD,
} from '../world/terrain';
import { buildSky, updateSky, FOG_COLOR, type SkyBuild } from '../world/sky';
import { buildProps } from '../world/props';
import { Effects } from './effects';
import { Bullets, Missiles } from './weapons';
import { Player } from './player';
import { EnemyFighter, GroundTarget } from './enemies';
import {
  buildAaaGun,
  buildBunker,
  buildExtractionGate,
  buildFuelDepot,
  buildHangar,
  buildRadarStation,
  buildSamSite,
  type StructureModel,
} from './models';
import type { Combatant, CombatContext, DamageSource, Flare } from './types';
import { Hud, type HudFrame } from '../ui/hud';
import { Screens } from '../ui/screens';
import { TouchControls } from '../ui/touch';

type Phase = 'briefing' | 'strike' | 'extract' | 'won' | 'lost';

interface StrikeSpec {
  label: string;
  z: number;
  offset: number;
  build: () => StructureModel;
  hp: number;
  radius: number;
  kind: 'radar' | 'depot' | 'bunker' | 'hangar' | 'sam';
}

const STRIKE_SPECS: StrikeSpec[] = [
  { label: 'RADAR ALPHA', z: -2250, offset: -0.55, build: buildRadarStation, hp: 130, radius: 16, kind: 'radar' },
  { label: 'FUEL DEPOT', z: -1480, offset: 0.6, build: buildFuelDepot, hp: 150, radius: 22, kind: 'depot' },
  { label: 'SAM BATTERY', z: -640, offset: -0.5, build: buildSamSite, hp: 120, radius: 13, kind: 'sam' },
  { label: 'COMMAND BUNKER', z: 260, offset: 0.5, build: buildBunker, hp: 220, radius: 18, kind: 'bunker' },
  { label: 'AIR HANGAR', z: 1180, offset: -0.62, build: buildHangar, hp: 190, radius: 24, kind: 'hangar' },
  { label: 'RADAR BRAVO', z: 2020, offset: 0.58, build: buildRadarStation, hp: 130, radius: 16, kind: 'radar' },
];

const DEFENSE_SAMS = [-2600, -1900, -1050, -120, 700, 1600, 2500];
const DEFENSE_AAA = [-2400, -2050, -1650, -1250, -900, -400, 60, 480, 900, 1400, 1850, 2300, 2700];

const EXTRACT_Z = 3280;

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private sky!: SkyBuild;
  private terrainChunks: THREE.Mesh[] = [];

  private audio = new AudioBus();
  private input: Input;
  private hud: Hud;
  private screens: Screens;
  private touch: TouchControls;
  private effects!: Effects;
  private bullets!: Bullets;
  private missiles!: Missiles;
  private player!: Player;

  private combatants: Combatant[] = [];
  private enemyList: Combatant[] = [];
  private grounds: GroundTarget[] = [];
  private fighters: EnemyFighter[] = [];
  private flares: Flare[] = [];
  private strikeTargets: GroundTarget[] = [];
  private gate = new THREE.Group();
  private gatePos = new THREE.Vector3();

  private phase: Phase = 'briefing';
  private paused = false;
  private missionTime = 0;
  private score = 0;
  private airKills = 0;
  private groundKills = 0;
  private shotsHit = 0;
  private countedKills = new Set<number>();
  private hitMarker = 0;
  private shakeAmount = 0;
  private shakeTime = 0;
  private oobTimer: number | null = null;
  private wavesSpawned = 0;
  private camPos = new THREE.Vector3();
  private camQuat = new THREE.Quaternion();
  private camMode = 0;
  private fov = 64;
  private incomingCooldown = 0;
  private rng = new Rng(31337);
  private ctx!: CombatContext;
  private started = false;
  private endTimer = 0;

  constructor(private root: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    const isCoarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isCoarse ? 1.5 : 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = 'game-canvas';
    root.appendChild(this.renderer.domElement);

    const hudCanvas = document.createElement('canvas');
    hudCanvas.className = 'hud-canvas';
    root.appendChild(hudCanvas);
    this.hud = new Hud(hudCanvas);

    this.camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.6, 12000);
    this.scene.add(this.camera);

    this.input = new Input(this.renderer.domElement);
    this.screens = new Screens(root);
    this.touch = new TouchControls(root, this.input);
    this.touch.setVisible(false);

    this.screens.onStart = () => this.startMission();
    this.screens.onResume = () => this.setPaused(false);
    this.screens.onRestart = () => this.startMission();
    this.screens.onPause = () => this.setPaused(!this.paused);
    this.screens.onToggleSound = () => {
      this.audio.setMuted(this.audio.enabled);
      this.screens.alert(this.audio.enabled ? 'SOUND ON' : 'SOUND OFF');
    };

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.phase !== 'briefing') this.setPaused(true);
    });
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.hud.resize();
  };

  // --- world -------------------------------------------------------------
  build(): void {
    const terrain = buildTerrain();
    this.scene.add(terrain.group);
    this.terrainChunks = terrain.chunks;
    this.sky = buildSky(this.scene);
    const props = buildProps();
    this.scene.add(props.group);

    this.effects = new Effects(this.scene, FOG_COLOR, 0.00042);

    for (let i = 0; i < 12; i++) this.flares.push({ position: new THREE.Vector3(), life: 0 });

    this.ctx = {
      scene: this.scene,
      effects: this.effects,
      audio: this.audio,
      combatants: this.combatants,
      flares: this.flares,
      listener: this.camera.position,
      terrainHeight: (x, z) => heightAt(x, z),
      shake: (a) => this.shake(a),
      notifyHit: (t, byPlayer, killed, src) => this.onHit(t, byPlayer, killed, src),
      notifyIncoming: (d) => this.onIncoming(d),
    };

    this.bullets = new Bullets(this.ctx);
    this.missiles = new Missiles(this.ctx);
    this.player = new Player(this.ctx, this.bullets, this.missiles, this.flares);

    this.gate = buildExtractionGate(120);
    this.gatePos.copy(pathPoint(EXTRACT_Z, 200));
    this.gate.position.copy(this.gatePos);
    this.gate.visible = false;
    this.scene.add(this.gate);

    this.screens.showBriefing();
    this.screens.setHudVisible(false);
    this.camPos.copy(pathPoint(-3000, 260));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(pathPoint(-2400, 200));
  }

  // --- mission setup ------------------------------------------------------
  private clearEntities(): void {
    for (const g of this.grounds) g.dispose();
    for (const f of this.fighters) f.dispose();
    this.grounds = [];
    this.fighters = [];
    this.strikeTargets = [];
    this.combatants.length = 0;
    this.countedKills.clear();
    this.missiles.reset();
    this.bullets.reset();
    for (const f of this.flares) f.life = 0;
  }

  private placeGround(
    model: StructureModel,
    z: number,
    lateral: number,
    opts: {
      kind: 'radar' | 'depot' | 'bunker' | 'hangar' | 'sam' | 'aaa';
      label: string;
      hp: number;
      radius: number;
      isObjective: boolean;
      score: number;
    },
    seed: number
  ): GroundTarget {
    const w = canyonHalfWidth(z);
    const x = pathX(z) + lateral * w;
    const y = heightAt(x, z) - 2;
    const target = new GroundTarget(
      this.ctx,
      model,
      new THREE.Vector3(x, y, z),
      opts,
      this.bullets,
      this.missiles,
      seed
    );
    // Turreted emplacements keep a zero base yaw so their aiming stays true.
    if (!model.turret) target.group.rotation.y = this.rng.range(-Math.PI, Math.PI);
    this.grounds.push(target);
    this.combatants.push(target);
    return target;
  }

  startMission(): void {
    this.audio.init();
    this.clearEntities();
    this.rng = new Rng(31337);

    // Primary strike targets.
    STRIKE_SPECS.forEach((spec, i) => {
      const t = this.placeGround(
        spec.build(),
        spec.z,
        spec.offset,
        {
          kind: spec.kind,
          label: spec.label,
          hp: spec.hp,
          radius: spec.radius,
          isObjective: true,
          score: 900,
        },
        i + 1
      );
      this.strikeTargets.push(t);
    });

    // Air defence network.
    DEFENSE_SAMS.forEach((z, i) => {
      this.placeGround(
        buildSamSite(),
        z,
        i % 2 === 0 ? 0.62 : -0.66,
        { kind: 'sam', label: `SAM ${i + 1}`, hp: 90, radius: 12, isObjective: false, score: 320 },
        100 + i
      );
    });
    DEFENSE_AAA.forEach((z, i) => {
      this.placeGround(
        buildAaaGun(),
        z,
        i % 2 === 0 ? -0.35 : 0.38,
        { kind: 'aaa', label: `AAA ${i + 1}`, hp: 45, radius: 7, isObjective: false, score: 140 },
        200 + i
      );
    });

    // Interceptors (spawned in waves, created up front).
    for (let i = 0; i < 6; i++) {
      const f = new EnemyFighter(
        this.ctx,
        this.bullets,
        this.missiles,
        `MARAUDER ${i + 1}`,
        i < 2 ? 0 : i < 4 ? 0.5 : 1,
        i + 1
      );
      f.alive = false;
      f.group.visible = false;
      this.fighters.push(f);
      this.combatants.push(f);
    }
    this.wavesSpawned = 0;

    this.player.spawn(pathPoint(-3050, 230), Math.PI);
    this.combatants.push(this.player);

    this.phase = 'strike';
    this.paused = false;
    this.missionTime = 0;
    this.score = 0;
    this.airKills = 0;
    this.groundKills = 0;
    this.shotsHit = 0;
    this.hitMarker = 0;
    this.oobTimer = null;
    this.endTimer = 0;
    this.gate.visible = false;
    this.player.shotsFired = 0;

    this.camPos.copy(this.player.position).addScaledVector(this.player.forward, -40);
    this.camera.position.copy(this.camPos);

    this.screens.hideModal();
    this.screens.setHudVisible(true);
    this.screens.banner('OPERATION CANYON STRIKE', 'Ingress low — destroy all strike targets', 4);
    this.screens.feed('AWACS: Talon 1, you are cleared hot.');
    this.touch.setVisible(this.input.isTouch);
    this.input.clearPressed();
    this.started = true;
  }

  private setPaused(p: boolean): void {
    if (this.phase === 'won' || this.phase === 'lost' || this.phase === 'briefing') return;
    this.paused = p;
    if (p) {
      this.screens.showPause();
      this.audio.suspend();
      this.touch.releaseAll();
    } else {
      this.screens.hideModal();
      this.audio.resume();
    }
  }

  private shake(amount: number): void {
    this.shakeAmount = Math.min(2.6, this.shakeAmount + amount);
  }

  private onIncoming(dist: number): void {
    if (this.incomingCooldown > 0) return;
    this.incomingCooldown = 2.5;
    this.screens.alert('MISSILE INBOUND');
    this.screens.feed(`Warning: missile launch ${Math.round(dist)}m`, 'warn');
    this.audio.warn();
  }

  private onHit(target: Combatant, byPlayer: boolean, _killed: boolean, source: DamageSource): void {
    if (!byPlayer) return;
    if (source === 'gun') this.shotsHit++;
    this.hitMarker = 0.4;
    this.audio.hitMarker();
    if (!target.alive && !this.countedKills.has(target.id)) {
      this.countedKills.add(target.id);
      const pts =
        target.kind === 'fighter'
          ? 500
          : (target as GroundTarget).score !== undefined
            ? (target as GroundTarget).score
            : 200;
      this.score += pts;
      if (target.kind === 'fighter') {
        this.airKills++;
        this.screens.feed(`${target.label} splashed  +${pts}`, 'kill');
      } else {
        this.groundKills++;
        if (target.isObjective) {
          const left = this.strikeTargets.filter((t) => t.alive).length;
          this.screens.feed(`${target.label} DESTROYED  +${pts}`, 'kill');
          this.screens.banner(
            'TARGET DESTROYED',
            left > 0 ? `${left} strike target${left > 1 ? 's' : ''} remaining` : 'All strike targets down',
            2.4
          );
          this.audio.ui(true);
        } else {
          this.screens.feed(`${target.label} destroyed  +${pts}`, 'kill');
        }
      }
      this.checkWaves();
    }
  }

  private checkWaves(): void {
    const destroyed = this.strikeTargets.filter((t) => !t.alive).length;
    const want = destroyed >= 4 ? 2 : destroyed >= 2 ? 1 : 0;
    while (this.wavesSpawned < want) this.spawnWave();
  }

  private spawnWave(): void {
    const idx = this.wavesSpawned;
    this.wavesSpawned++;
    const count = 2;
    for (let i = 0; i < count; i++) {
      const f = this.fighters[idx * 2 + i];
      if (!f) continue;
      const z = clamp(this.player.position.z + this.rng.range(1400, 2200), WORLD.zStart, WORLD.zEnd);
      const pos = pathPoint(z, this.rng.range(260, 420));
      pos.x += this.rng.range(-160, 160);
      f.spawn(pos, this.rng.range(-0.4, 0.4));
    }
    this.screens.banner('ENEMY INTERCEPTORS', 'Bandits inbound — check your six', 3);
    this.screens.feed('AWACS: Bandits inbound!', 'warn');
    this.audio.warn();
  }

  private startExtraction(): void {
    this.phase = 'extract';
    this.gate.visible = true;
    this.screens.banner('ALL TARGETS DESTROYED', 'Egress north through the extraction gate', 4);
    this.screens.feed('AWACS: Strike package complete. Head for the gate.', 'good');
    this.audio.ui(true);
    // Final interceptor wave.
    for (let i = 4; i < 6; i++) {
      const f = this.fighters[i];
      if (!f) continue;
      const z = clamp(this.player.position.z + this.rng.range(900, 1500), WORLD.zStart, WORLD.zEnd);
      const pos = pathPoint(z, this.rng.range(280, 420));
      f.spawn(pos, this.rng.range(-0.3, 0.3));
    }
    this.wavesSpawned = 3;
  }

  private endMission(win: boolean, reason: string): void {
    if (this.phase === 'won' || this.phase === 'lost') return;
    this.phase = win ? 'won' : 'lost';
    this.endTimer = win ? 1.6 : 2.4;
    this.pendingReason = reason;
    this.audio.fanfare(win);
  }

  private pendingReason = '';

  private showResults(win: boolean): void {
    const destroyed = this.strikeTargets.filter((t) => !t.alive).length;
    let score = this.score;
    if (win) {
      score += Math.max(0, 620 - Math.floor(this.missionTime)) * 4;
      score += Math.round(this.player.hp) * 12;
    }
    const acc = this.player.shotsFired > 0 ? (this.shotsHit / this.player.shotsFired) * 100 : 0;
    const rank = !win ? 'D' : score >= 12000 ? 'S' : score >= 9500 ? 'A' : score >= 7000 ? 'B' : 'C';
    this.screens.setHudVisible(false);
    this.screens.showResult({
      win,
      title: win ? 'TALON 1 FEET DRY' : 'TALON 1 IS DOWN',
      reason: this.pendingReason,
      score: Math.round(score),
      targets: `${destroyed} / ${this.strikeTargets.length}`,
      air: this.airKills,
      ground: this.groundKills,
      time: formatTime(this.missionTime),
      accuracy: Math.round(acc),
      hull: Math.round(clamp01(this.player.hp / this.player.maxHp) * 100),
      rank,
    });
  }

  // --- loop ---------------------------------------------------------------
  start(): void {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private touchShown = false;

  private syncTouch(): void {
    if (!this.input.isTouch) return;
    document.body.classList.add('is-touch');
    const want = (this.phase === 'strike' || this.phase === 'extract') && !this.paused;
    if (want !== this.touchShown) {
      this.touchShown = want;
      this.touch.setVisible(want);
      this.hud.touchInset = want ? Math.min(190, window.innerHeight * 0.34) : 0;
      if (!want) this.touch.releaseAll();
    }
  }

  private frame(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.input.update();
    this.syncTouch();

    if (this.input.consume('pause')) {
      if (this.phase === 'strike' || this.phase === 'extract') this.setPaused(!this.paused);
    }
    if (this.input.consume('restart') && this.started) {
      if (this.phase === 'won' || this.phase === 'lost' || this.paused) this.startMission();
    }
    if (this.phase === 'briefing' && this.input.consume('confirm')) {
      this.startMission();
    }
    if (this.input.consume('view')) {
      this.camMode = (this.camMode + 1) % 3;
      this.screens.alert(['CHASE CAM', 'CLOSE CAM', 'COCKPIT'][this.camMode]);
    }
    if (this.input.consume('mouseToggle')) {
      this.screens.alert(this.input.mouseSteer ? 'MOUSE STEERING ON' : 'MOUSE STEERING OFF');
    }

    const running = (this.phase === 'strike' || this.phase === 'extract') && !this.paused;

    if (running) {
      this.missionTime += dt;
      this.simulate(dt);
    } else if (this.phase === 'won' || this.phase === 'lost') {
      this.audio.updateEngine(this.phase === 'won' ? 0.5 : 0, 0, 0);
      // Let the explosion and camera settle before the results panel.
      this.simulateAftermath(dt);
      if (this.endTimer > 0) {
        this.endTimer -= dt;
        if (this.endTimer <= 0) this.showResults(this.phase === 'won');
      }
    }

    this.updateCamera(dt, running);
    updateSky(this.sky, this.camera, running ? dt : 0);
    updateTerrainVisibility(this.terrainChunks, this.camera.position.z, 3400);
    this.effects.update(running || this.phase === 'won' || this.phase === 'lost' ? dt : 0);
    this.effects.faceCamera(this.camera);
    this.screens.update(dt);

    if (this.gate.visible) {
      const t = performance.now() * 0.001;
      this.gate.children.forEach((c, i) => {
        c.rotation.z = t * (0.4 + i * 0.12);
        const s = 1 + Math.sin(t * 2 + i) * 0.03;
        c.scale.set(s, s, 1);
      });
    }

    this.renderer.render(this.scene, this.camera);
    this.drawHud();
  }

  private simulateAftermath(dt: number): void {
    const p = this.player;
    if (p.alive) {
      // Keep the survivor coasting so the victory fly-out reads naturally.
      p.position.addScaledVector(p.velocity, dt);
      p.obj.position.copy(p.position);
      this.effects.burnerGlow(
        p.position.clone().addScaledVector(p.forward, -9),
        p.forward,
        0.45
      );
    }
    for (const g of this.grounds) g.update(dt, this.player);
    this.bullets.update(dt);
    this.missiles.update(dt);
  }

  private simulate(dt: number): void {
    const player = this.player;
    this.incomingCooldown = Math.max(0, this.incomingCooldown - dt);
    this.hitMarker = Math.max(0, this.hitMarker - dt * 2.2);
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 2.2);
    this.shakeTime += dt;

    this.enemyList.length = 0;
    for (const c of this.combatants) if (c.faction === 'enemy') this.enemyList.push(c);

    if (this.input.consume('target')) player.cycleTarget(this.enemyList);
    player.update(dt, this.input, this.enemyList);

    for (const f of this.fighters) if (f.alive) f.update(dt, player);
    for (const g of this.grounds) g.update(dt, player);

    this.bullets.update(dt);
    this.missiles.update(dt);

    this.audio.updateEngine(player.throttle, player.speedNorm, player.burner);

    // Engine glow particles.
    if (player.alive && player.burner > 0.1) {
      const back = player.position.clone().addScaledVector(player.forward, -9);
      this.effects.burnerGlow(back, player.forward, player.burner * 0.7);
    }

    if (!player.alive) {
      this.endMission(false, player.crashReason || 'Talon 1 was shot down over the canyon.');
      return;
    }

    this.updateBounds(dt);

    // Interceptors also show up on a timer so the sky never stays quiet.
    if (this.phase === 'strike' && this.wavesSpawned === 0 && this.missionTime > 80) this.spawnWave();

    if (this.phase === 'strike' && this.strikeTargets.every((t) => !t.alive)) {
      this.startExtraction();
    }

    if (this.phase === 'extract') {
      const d = player.position.distanceTo(this.gatePos);
      if (d < 150) {
        this.endMission(true, 'Strike package destroyed and Talon 1 is feet dry. Outstanding work.');
      }
    }
  }

  private updateBounds(dt: number): void {
    const p = this.player.position;
    const lateral = distFromPath(p.x, p.z);
    const outside =
      lateral > WORLD.corridor ||
      p.y > WORLD.ceiling ||
      p.z < WORLD.zStart - 260 ||
      p.z > WORLD.zEnd + 460;
    if (outside) {
      if (this.oobTimer === null) {
        this.oobTimer = 12;
        this.screens.alert('RETURN TO MISSION AREA');
      } else {
        this.oobTimer -= dt;
        if (this.oobTimer <= 0) {
          this.player.damage(999, 'crash');
          this.endMission(false, 'Talon 1 abandoned the mission area.');
        }
      }
    } else if (this.oobTimer !== null) {
      this.oobTimer = null;
    }
  }

  // --- camera -------------------------------------------------------------
  private updateCamera(dt: number, running: boolean): void {
    const player = this.player;
    if (!player) return;

    const fwd = player.forward;
    const target = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(player.quaternion);

    if (this.phase === 'briefing') {
      const t = performance.now() * 0.0001;
      const z = -2600 + Math.sin(t) * 700;
      const p = pathPoint(z, 320);
      this.camPos.lerp(p, 0.02);
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(pathPoint(z + 600, 160));
      return;
    }

    const dead = !player.alive;
    if (this.camMode === 2 && !dead) {
      const offset = new THREE.Vector3(0, 1.55, -4.6).applyQuaternion(player.quaternion);
      this.camPos.copy(player.position).add(offset);
      this.camera.position.copy(this.camPos);
      this.camQuat.slerp(player.quaternion, 1 - Math.exp(-22 * dt));
      this.camera.quaternion.copy(this.camQuat);
    } else {
      const dist = this.camMode === 1 ? 22 : 34 + player.speedNorm * 12;
      const height = this.camMode === 1 ? 5 : 8.5;
      const idealOffset = new THREE.Vector3(0, height, dist).applyQuaternion(player.quaternion);
      const ideal = new THREE.Vector3().copy(player.position).add(idealOffset);
      const ground = heightAt(ideal.x, ideal.z) + 9;
      if (ideal.y < ground) ideal.y = ground;
      const lambda = dead ? 2.5 : 9;
      this.camPos.lerp(ideal, 1 - Math.exp(-lambda * dt));
      this.camera.position.copy(this.camPos);

      target.copy(player.position).addScaledVector(fwd, dead ? 0 : 90);
      const upBlend = up.clone().lerp(new THREE.Vector3(0, 1, 0), dead ? 0.9 : 0.22).normalize();
      const m = new THREE.Matrix4().lookAt(this.camPos, target, upBlend);
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      this.camQuat.slerp(q, 1 - Math.exp(-(dead ? 3 : 12) * dt));
      this.camera.quaternion.copy(this.camQuat);
    }

    // Shake.
    if (this.shakeAmount > 0.001) {
      const s = this.shakeAmount;
      const t = this.shakeTime * 32;
      this.camera.position.x += Math.sin(t * 1.3) * s * 0.5;
      this.camera.position.y += Math.sin(t * 1.7 + 1.2) * s * 0.5;
      this.camera.position.z += Math.sin(t * 1.1 + 2.4) * s * 0.4;
      this.camera.rotateZ(Math.sin(t * 0.9) * s * 0.006);
    }

    const targetFov = 62 + player.speedNorm * 14 + player.burner * 6 + (this.camMode === 2 ? 6 : 0);
    this.fov = damp(this.fov, running ? targetFov : this.fov, 3, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  // --- hud ----------------------------------------------------------------
  private drawHud(): void {
    const player = this.player;
    if (!player || this.phase === 'briefing') {
      this.hud.draw({
        camera: this.camera,
        playerPos: this.camera.position,
        playerQuat: this.camera.quaternion,
        speed: 0,
        altitude: 0,
        agl: 0,
        throttle: 0,
        burner: 0,
        hp: 0,
        maxHp: 1,
        missiles: 0,
        maxMissiles: 1,
        flares: 0,
        gunAmmo: 0,
        gunHeat: 0,
        overheated: false,
        gLoad: 1,
        combatants: [],
        lockTarget: null,
        lockProgress: 0,
        locked: false,
        leadPoint: null,
        waypoint: null,
        waypointLabel: '',
        missileThreat: null,
        pullUp: false,
        stall: false,
        outOfBounds: null,
        hitMarker: 0,
        time: 0,
        alive: false,
      });
      return;
    }

    const waypoint = this.currentWaypoint();
    const lockTarget = player.lock.target;
    const frame: HudFrame = {
      camera: this.camera,
      playerPos: player.position,
      playerQuat: player.quaternion,
      speed: player.speed,
      altitude: player.position.y,
      agl: player.altitude,
      throttle: player.throttle,
      burner: player.burner,
      hp: player.hp,
      maxHp: player.maxHp,
      missiles: player.missileAmmo,
      maxMissiles: player.maxMissiles,
      flares: player.flareAmmo,
      gunAmmo: player.gunAmmo,
      gunHeat: player.gunHeat,
      overheated: player.overheated,
      gLoad: player.gLoad,
      combatants: this.combatants,
      lockTarget,
      lockProgress: player.lock.progress,
      locked: player.lock.locked,
      leadPoint: lockTarget && lockTarget.alive ? player.leadPoint(lockTarget) : null,
      waypoint: waypoint?.pos ?? null,
      waypointLabel: waypoint?.label ?? '',
      missileThreat: this.missiles.threatToPlayer(player.position),
      pullUp: player.groundWarning && player.alive,
      stall: player.stalling && player.alive,
      outOfBounds: this.oobTimer,
      hitMarker: this.hitMarker,
      time: performance.now() * 0.001,
      alive: player.alive && !this.paused && this.phase !== 'won' && this.phase !== 'lost',
    };
    this.hud.draw(frame);
    this.updatePanels();
  }

  private currentWaypoint(): { pos: THREE.Vector3; label: string } | null {
    if (this.phase === 'extract') return { pos: this.gatePos, label: 'EXTRACT' };
    let best: GroundTarget | null = null;
    let bestD = Infinity;
    for (const t of this.strikeTargets) {
      if (!t.alive) continue;
      const d = t.position.distanceTo(this.player.position);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (!best) return null;
    return { pos: best.position.clone().setY(best.position.y + 60), label: 'TARGET' };
  }

  private panelTimer = 0;

  private updatePanels(): void {
    const p = this.player;
    const hpPctNow = clamp01(p.hp / p.maxHp);
    // Vignette reacts every frame; the text panels refresh on a slower tick.
    const dmgFlash = clamp01(1 - (performance.now() / 1000 - p.lastDamageTime) * 1.6);
    const lowHp =
      hpPctNow < 0.35 ? (0.22 + Math.sin(performance.now() * 0.006) * 0.08) * (1 - hpPctNow) : 0;
    this.screens.setVignette(clamp01(dmgFlash * 0.75 + lowHp), hpPctNow < 0.35);

    this.panelTimer -= 1 / 60;
    if (this.panelTimer > 0) return;
    this.panelTimer = 0.12;

    const destroyed = this.strikeTargets.filter((t) => !t.alive).length;
    const total = this.strikeTargets.length;

    this.screens.setPhase(
      this.phase === 'extract' ? 'PHASE 2 — EGRESS' : 'PHASE 1 — STRIKE',
      this.phase === 'extract'
        ? 'Fly through the extraction gate'
        : `Destroy the enemy strike network (${destroyed}/${total})`
    );
    this.screens.setObjectives([
      {
        label: `STRIKE TARGETS ${destroyed}/${total}`,
        done: destroyed === total,
        active: this.phase === 'strike',
      },
      { label: 'EXTRACTION', done: this.phase === 'won', active: this.phase === 'extract' },
    ]);

    const hpPct = clamp01(p.hp / p.maxHp);
    const heat = Math.round(p.gunHeat * 100);
    this.screens.setStatus(`
      <div class="hull ${hpPct < 0.35 ? 'low' : ''}">
        <span>HULL</span>
        <div class="bar"><i style="width:${hpPct * 100}%"></i></div>
        <b>${Math.round(hpPct * 100)}%</b>
      </div>
      <div class="ammo">
        <div class="ammo-item ${p.missileAmmo === 0 ? 'empty' : ''}"><span>MSL</span><b>${p.missileAmmo}</b></div>
        <div class="ammo-item ${p.flareAmmo === 0 ? 'empty' : ''}"><span>FLR</span><b>${p.flareAmmo}</b></div>
        <div class="ammo-item ${p.overheated ? 'empty' : ''}"><span>GUN</span><b>${p.gunAmmo}</b></div>
        <div class="ammo-item"><span>HEAT</span><b>${heat}%</b></div>
      </div>
      <div class="mission-meta">
        <div><span>TIME</span><b>${formatTime(this.missionTime)}</b></div>
        <div><span>SCORE</span><b>${this.score.toLocaleString()}</b></div>
      </div>
    `);
  }
}
