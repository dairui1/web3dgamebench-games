import * as THREE from 'three';
import { Terrain, MISSION_BOUND } from './terrain';
import {
  buildJet, buildSamSite, buildAaaGun, buildRadar, buildDepot, buildMissile,
  buildExtractionBeacon, makeCloudTexture,
} from './models';
import { ParticleSystem } from './particles';
import { AudioSys } from './audio';
import { Input } from './input';
import { Hud, type HudFrame, type HudTarget, type RadarBlip, type EndStats } from './hud';

type State = 'menu' | 'playing' | 'won' | 'lost';
type EnemyKind = 'sam' | 'aaa' | 'radar' | 'depot' | 'fighter';
type Owner = 'player' | 'enemy';

const PLAYER_MIN_SPEED = 110;
const PLAYER_MAX_SPEED = 400;
const PLAYER_RADIUS = 9;
const BULLET_SPEED = 1100;
const ENEMY_BULLET_SPEED = 750;
const MAX_BULLETS = 400;
const LOCK_TIME = 0.7;
const LOCK_RANGE = 2600;
const LOCK_CONE = 0.45; // radians
const EXTRACTION_RADIUS = 140;

const NEG_Z = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpM = new THREE.Matrix4();

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function randomDir(out: THREE.Vector3): THREE.Vector3 {
  return out.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
}

/** Distance from point p to segment a-b. */
function segmentPointDistance(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3): number {
  tmpB.subVectors(b, a);
  const len2 = tmpB.lengthSq();
  let t = 0;
  if (len2 > 0) t = clamp(tmpC.subVectors(p, a).dot(tmpB) / len2, 0, 1);
  tmpC.copy(a).addScaledVector(tmpB, t);
  return tmpC.distanceTo(p);
}

interface EnemySpec {
  label: string;
  health: number;
  radius: number;
  score: number;
  primary: boolean;
}

const SPECS: Record<EnemyKind, EnemySpec> = {
  sam: { label: 'SAM', health: 55, radius: 13, score: 200, primary: true },
  aaa: { label: 'AAA', health: 35, radius: 10, score: 100, primary: false },
  radar: { label: 'RADAR', health: 65, radius: 15, score: 250, primary: true },
  depot: { label: 'DEPOT', health: 70, radius: 18, score: 250, primary: true },
  fighter: { label: 'BANDIT', health: 45, radius: 12, score: 150, primary: false },
};

class Enemy {
  readonly spec: EnemySpec;
  health: number;
  alive = true;
  cooldown = rand(2, 5);
  turret: THREE.Object3D | null = null;
  muzzles: THREE.Object3D[] = [];
  dish: THREE.Object3D | null = null;
  // Fighter state
  vel = new THREE.Vector3();
  speed = 260;
  turnRate = 1.25;
  state: 'attack' | 'break' = 'break';
  waypoint = new THREE.Vector3();
  aiTimer = 3;
  bank = 0;
  missileCd = rand(6, 10);
  burst = 0;
  afterburner: THREE.Mesh | null = null;

  constructor(readonly kind: EnemyKind, readonly obj: THREE.Group) {
    this.spec = SPECS[kind];
    this.health = this.spec.health;
  }

  get pos(): THREE.Vector3 {
    return this.obj.position;
  }
}

interface Bullet {
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  owner: Owner;
  dmg: number;
}

class Missile {
  dir = new THREE.Vector3();
  speed: number;
  life: number;
  smokeTimer = 0;
  constructor(
    readonly obj: THREE.Group,
    readonly owner: Owner,
    public target: Enemy | 'player' | null,
    readonly maxSpeed: number,
    readonly turnRate: number,
    readonly dmg: number,
    startSpeed: number,
    life: number,
  ) {
    this.speed = startSpeed;
    this.life = life;
  }
  get pos(): THREE.Vector3 {
    return this.obj.position;
  }
}

interface Flash {
  mesh: THREE.Mesh;
  t: number;
  maxT: number;
  size: number;
}

interface BurnSite {
  pos: THREE.Vector3;
  t: number;
  timer: number;
}

interface GroundSpec {
  z: number;
  off: number;
  kind: EnemyKind;
}

const GROUND_LAYOUT: GroundSpec[] = [
  { z: 2300, off: -0.4, kind: 'aaa' },
  { z: 1950, off: 0.3, kind: 'sam' },
  { z: 1550, off: -0.5, kind: 'radar' },
  { z: 1500, off: 0.5, kind: 'aaa' },
  { z: 1050, off: 0.0, kind: 'depot' },
  { z: 1000, off: -0.6, kind: 'aaa' },
  { z: 450, off: -0.4, kind: 'sam' },
  { z: 380, off: 0.5, kind: 'sam' },
  { z: -150, off: 0.2, kind: 'radar' },
  { z: -650, off: -0.6, kind: 'aaa' },
  { z: -720, off: 0.6, kind: 'aaa' },
  { z: -1200, off: -0.3, kind: 'sam' },
  { z: -1250, off: 0.45, kind: 'depot' },
  { z: -1800, off: 0.0, kind: 'sam' },
  { z: -1850, off: -0.6, kind: 'aaa' },
  { z: -2350, off: 0.4, kind: 'aaa' },
  { z: -2400, off: -0.5, kind: 'radar' },
];

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private terrain = new Terrain();
  private sky: THREE.Mesh;
  private input: Input;
  private hud: Hud;
  private audio = new AudioSys();
  private fire = new ParticleSystem(4000, true);
  private smoke = new ParticleSystem(4000, false);

  // Player
  private playerGroup: THREE.Group;
  private afterburner: THREE.Mesh;
  private pos = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private vel = new THREE.Vector3();
  private speed = 220;
  private throttle = 0.65;
  private health = 100;
  private missiles = 36;
  private flares = 8;
  private gunHeat = 0;
  private overheated = false;
  private gunCooldown = 0;
  private gunSide = 1;
  private missileCooldown = 0;
  private flareCooldown = 0;
  private regenTimer = 0;
  private pitchIn = 0;
  private rollIn = 0;
  private yawIn = 0;

  // Camera
  private camPos = new THREE.Vector3();
  private camQuat = new THREE.Quaternion();
  private shake = 0;
  private damageFlash = 0;
  private hitMarker = 0;

  // Targeting
  private target: Enemy | null = null;
  private lockTimer = 0;
  private locked = false;
  private retargetTimer = 0;

  // World
  private enemies: Enemy[] = [];
  private bullets: Bullet[] = [];
  private missileList: Missile[] = [];
  private flashes: Flash[] = [];
  private burnSites: BurnSite[] = [];
  private bulletMeshPlayer: THREE.InstancedMesh;
  private bulletMeshEnemy: THREE.InstancedMesh;
  private bulletDummy = new THREE.Object3D();
  private extraction: THREE.Group;
  private extractionPos = new THREE.Vector3();
  private extractionActive = false;
  private flashGeo = new THREE.SphereGeometry(1, 12, 8);

  // Mission
  private state: State = 'menu';
  private time = 0;
  private menuTime = 0;
  private score = 0;
  private kills = 0;
  private primariesKilled = 0;
  private primariesTotal = 0;
  private missilesFired = 0;
  private missileHits = 0;
  private wavesSpawned = new Set<number>();
  private outOfBoundsTimer = 0;
  private endReason = '';
  private lastTime = performance.now();

  constructor(private root: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.domElement.classList.add('gl');
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    root.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.5, 9000);
    this.scene.fog = new THREE.Fog(0xcdd9e6, 700, 5600);
    this.scene.background = new THREE.Color(0xcdd9e6);

    this.input = new Input(this.renderer.domElement);
    this.hud = new Hud(root, this.input.isTouch, {
      missile: () => this.input.press('Space'),
      target: () => this.input.press('KeyT'),
      flare: () => this.input.press('KeyX'),
      gun: (d) => { this.input.touchGun = d; },
      throttleUp: (d) => { this.input.touchThrottleUp = d; },
      throttleDown: (d) => { this.input.touchThrottleDown = d; },
    });
    this.input.onStickChange = (a, ox, oy, dx, dy) => this.hud.setStick(a, ox, oy, dx, dy);
    this.hud.onStart = () => this.startMission();
    this.hud.onRestart = () => this.startMission();

    // Lighting
    const sunDir = new THREE.Vector3(0.45, 0.7, 0.35).normalize();
    const hemi = new THREE.HemisphereLight(0xbdd7ff, 0x8a6a4a, 0.8);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.1);
    sun.position.copy(sunDir).multiplyScalar(1000);
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0x404050, 0.35));

    // Sky
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(6000, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: {
          topColor: { value: new THREE.Color(0x2a5fb3) },
          horizonColor: { value: new THREE.Color(0xcdd9e6) },
          sunDir: { value: sunDir },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 sunDir;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float h = max(0.0, d.y);
            vec3 c = mix(horizonColor, topColor, pow(h, 0.5));
            float s = max(0.0, dot(d, sunDir));
            c += vec3(1.0, 0.92, 0.75) * pow(s, 400.0) * 2.0;
            c += vec3(1.0, 0.85, 0.6) * pow(s, 6.0) * 0.18;
            gl_FragColor = vec4(c, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    // Terrain and clouds
    this.scene.add(this.terrain.mesh);
    const cloudTex = makeCloudTexture();
    for (let i = 0; i < 44; i++) {
      const mat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: rand(0.35, 0.6), depthWrite: false });
      const s = new THREE.Sprite(mat);
      s.position.set(rand(-3400, 3400), rand(760, 1050), rand(-3400, 3400));
      const w = rand(500, 1000);
      s.scale.set(w, w * rand(0.28, 0.42), 1);
      this.scene.add(s);
    }

    // Player
    const jet = buildJet(0x9fb4c7, 0xe07b39);
    this.playerGroup = jet.group;
    this.afterburner = jet.afterburner;
    this.scene.add(this.playerGroup);

    // Particles
    this.scene.add(this.fire.points);
    this.scene.add(this.smoke.points);

    // Bullets
    const bulletGeo = new THREE.BoxGeometry(0.35, 0.35, 7);
    this.bulletMeshPlayer = new THREE.InstancedMesh(bulletGeo, new THREE.MeshBasicMaterial({ color: 0xffe66d }), MAX_BULLETS);
    this.bulletMeshEnemy = new THREE.InstancedMesh(bulletGeo, new THREE.MeshBasicMaterial({ color: 0xff7a3d }), MAX_BULLETS);
    for (const m of [this.bulletMeshPlayer, this.bulletMeshEnemy]) {
      m.frustumCulled = false;
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(m);
    }

    // Extraction beacon
    this.extraction = buildExtractionBeacon();
    this.extraction.visible = false;
    this.scene.add(this.extraction);

    window.addEventListener('resize', () => this.resize());
    this.resize();

    window.addEventListener('keydown', (e) => {
      if (this.state === 'menu' && (e.code === 'Enter' || e.code === 'Space')) this.startMission();
      else if ((this.state === 'won' || this.state === 'lost') && (e.code === 'Enter' || e.code === 'KeyR')) this.startMission();
    });
    const gesture = () => this.audio.init();
    window.addEventListener('pointerdown', gesture);
    window.addEventListener('keydown', gesture);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.lastTime = performance.now();
    });

    this.resetWorld();
    this.hud.setHudVisible(false);
    this.hud.showMenu(this.input.isTouch);
    this.hud.setHint(this.input.isTouch ? '' : 'TAB target · SPACE missile · F gun · X flare · M mouse-steer');

    this.renderer.setAnimationLoop(() => this.loop());
  }

  // ---------------------------------------------------------------- setup

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.input.isTouch ? 1.5 : 2));
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hud.resize();
  }

  private resetWorld(): void {
    for (const e of this.enemies) this.scene.remove(e.obj);
    for (const m of this.missileList) this.scene.remove(m.obj);
    for (const f of this.flashes) this.scene.remove(f.mesh);
    this.enemies = [];
    this.bullets = [];
    this.missileList = [];
    this.flashes = [];
    this.burnSites = [];
    this.fire.clear();
    this.smoke.clear();
    this.hud.clearMessages();

    // Player start at the canyon mouth, flying toward -Z.
    const startZ = 2950;
    const startX = this.terrain.canyonCenterX(startZ);
    this.pos.set(startX, this.terrain.floorHeightAt(startX, startZ) + 150, startZ);
    this.quat.identity();
    this.speed = 240;
    this.throttle = 0.65;
    this.health = 100;
    this.missiles = 36;
    this.flares = 8;
    this.gunHeat = 0;
    this.overheated = false;
    this.pitchIn = this.rollIn = this.yawIn = 0;
    this.vel.set(0, 0, -this.speed);
    this.playerGroup.visible = true;
    this.playerGroup.position.copy(this.pos);
    this.playerGroup.quaternion.copy(this.quat);
    this.camQuat.copy(this.quat);
    this.camPos.copy(this.pos).add(new THREE.Vector3(0, 8, 32));
    this.target = null;
    this.lockTimer = 0;
    this.locked = false;
    this.shake = 0;
    this.damageFlash = 0;
    this.hitMarker = 0;
    this.time = 0;
    this.score = 0;
    this.kills = 0;
    this.primariesKilled = 0;
    this.missilesFired = 0;
    this.missileHits = 0;
    this.wavesSpawned.clear();
    this.outOfBoundsTimer = 0;
    this.extractionActive = false;
    this.extraction.visible = false;

    // Ground targets
    this.primariesTotal = 0;
    for (const g of GROUND_LAYOUT) {
      const x = this.terrain.canyonCenterX(g.z) + this.terrain.canyonHalfWidth(g.z) * g.off;
      const y = this.terrain.heightAt(x, g.z);
      this.spawnGround(g.kind, x, y, g.z);
    }
    // Opening patrol
    this.spawnFighters(2, 1400, 'ahead');

    const ez = -2950;
    const ex = this.terrain.canyonCenterX(ez);
    this.extractionPos.set(ex, this.terrain.floorHeightAt(ex, ez) + 70, ez);
    this.extraction.position.set(ex, this.terrain.floorHeightAt(ex, ez) + 2, ez);
  }

  private spawnGround(kind: EnemyKind, x: number, y: number, z: number): void {
    let group: THREE.Group;
    let turret: THREE.Object3D | null = null;
    let muzzles: THREE.Object3D[] = [];
    let dish: THREE.Object3D | null = null;
    if (kind === 'sam') {
      const p = buildSamSite();
      group = p.group; turret = p.turret; muzzles = p.muzzles;
    } else if (kind === 'aaa') {
      const p = buildAaaGun();
      group = p.group; turret = p.turret; muzzles = p.muzzles;
    } else if (kind === 'radar') {
      const p = buildRadar();
      group = p.group; dish = p.dish;
    } else {
      group = buildDepot();
    }
    group.position.set(x, y - 0.5, z);
    group.rotation.y = rand(0, Math.PI * 2);
    this.scene.add(group);
    const e = new Enemy(kind, group);
    e.turret = turret;
    e.muzzles = muzzles;
    e.dish = dish;
    if (e.spec.primary) this.primariesTotal++;
    this.enemies.push(e);
  }

  private spawnFighters(n: number, distance: number, where: 'ahead' | 'behind'): void {
    const fwd = tmpA.copy(NEG_Z).applyQuaternion(this.quat);
    for (let i = 0; i < n; i++) {
      const jet = buildJet(0x3a3f47, 0xc0392b);
      const e = new Enemy('fighter', jet.group);
      e.afterburner = jet.afterburner;
      const zBase = this.pos.z + (where === 'ahead' ? -distance : distance) + (i - (n - 1) / 2) * 120;
      const z = clamp(zBase, -3100, 3100);
      const x = this.terrain.canyonCenterX(z) + (i - (n - 1) / 2) * 90;
      const y = this.terrain.floorHeightAt(x, z) + rand(180, 320);
      e.pos.set(x, y, z);
      // Face the player.
      const dir = tmpB.subVectors(this.pos, e.pos).normalize();
      if (where === 'ahead') dir.copy(fwd).negate();
      tmpM.lookAt(e.pos, tmpC.copy(e.pos).add(dir), UP);
      e.obj.quaternion.setFromRotationMatrix(tmpM);
      e.vel.copy(dir).multiplyScalar(e.speed);
      e.state = 'attack';
      e.aiTimer = 4;
      e.cooldown = rand(1, 3);
      this.scene.add(e.obj);
      this.enemies.push(e);
    }
  }

  private startMission(): void {
    this.audio.init();
    this.audio.uiConfirm();
    this.resetWorld();
    this.input.clearEdges();
    this.state = 'playing';
    this.hud.hideOverlay();
    this.hud.setHudVisible(true);
    this.hud.pushMessage('MISSION START — DESTROY PRIMARY TARGETS', 'good');
    this.updateCamera(0, true);
  }

  private endMission(won: boolean, reason: string): void {
    if (this.state !== 'playing') return;
    this.state = won ? 'won' : 'lost';
    this.endReason = reason;
    this.audio.setLockTone(0, 0);
    if (won) this.audio.win(); else this.audio.lose();
    const stats: EndStats = {
      time: this.time,
      score: this.score,
      kills: this.kills,
      primaries: this.primariesKilled,
      primariesTotal: this.primariesTotal,
      missilesFired: this.missilesFired,
      missileHits: this.missileHits,
    };
    window.setTimeout(() => {
      if (this.state === 'won' || this.state === 'lost') this.hud.showEnd(won, this.endReason, stats);
    }, won ? 900 : 1600);
  }

  // ---------------------------------------------------------------- loop

  private loop(): void {
    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    dt = clamp(dt, 0, 0.05);

    if (this.state === 'menu') this.updateMenu(dt);
    else this.updatePlaying(dt);

    this.sky.position.copy(this.camera.position);
    this.fire.setViewportHeight(this.renderer.domElement.height, this.camera.fov);
    this.smoke.setViewportHeight(this.renderer.domElement.height, this.camera.fov);
    this.fire.update(dt);
    this.smoke.update(dt);
    this.updateFlashes(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private updateMenu(dt: number): void {
    this.menuTime += dt;
    const t = this.menuTime * 0.25;
    const r = 55;
    this.camera.position.set(this.pos.x + Math.cos(t) * r, this.pos.y + 14 + Math.sin(t * 0.7) * 6, this.pos.z + Math.sin(t) * r);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.pos);
    this.camera.fov = 60;
    this.camera.updateProjectionMatrix();
    this.playerGroup.position.copy(this.pos);
    this.playerGroup.quaternion.copy(this.quat);
    this.playerGroup.rotation.z = Math.sin(this.menuTime * 0.8) * 0.06;
    this.afterburner.scale.set(1, 1, 1 + Math.random() * 0.2);
    this.audio.setEngine(0.3, false);
    for (const e of this.enemies) if (e.kind === 'radar' && e.dish) e.dish.rotation.y += dt * 0.8;
  }

  private updatePlaying(dt: number): void {
    const playing = this.state === 'playing';
    if (playing) {
      this.time += dt;
      this.updatePlayer(dt);
      this.updateWeapons(dt);
      this.updateTargeting(dt);
      this.checkObjectives(dt);
    }
    this.updateEnemies(dt, playing);
    this.updateBullets(dt, playing);
    this.updateMissiles(dt, playing);
    this.updateBurnSites(dt);
    this.updateCamera(dt, false);

    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.6);
    this.hitMarker = Math.max(0, this.hitMarker - dt);
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.extraction.rotation.y += dt * 0.6;

    this.audio.setEngine(this.throttle, playing);
    this.audio.setLockTone(playing ? (this.locked ? 2 : this.target && this.lockTimer > 0 ? 1 : 0) : 0, this.time);
    this.hud.update(this.buildHudFrame(), dt);
  }

  // ---------------------------------------------------------------- player

  private forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(NEG_Z).applyQuaternion(this.quat);
  }

  private updatePlayer(dt: number): void {
    const inp = this.input;
    this.throttle = clamp(this.throttle + inp.throttleDelta * 0.7 * dt, 0, 1);
    const fwd = this.forward(tmpA);
    let targetSpeed = PLAYER_MIN_SPEED + (PLAYER_MAX_SPEED - PLAYER_MIN_SPEED) * this.throttle;
    if (inp.brake) targetSpeed = PLAYER_MIN_SPEED;
    targetSpeed += -fwd.y * 70; // dive to gain, climb to bleed
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * (inp.brake ? 1.6 : 0.9));
    this.speed = clamp(this.speed, PLAYER_MIN_SPEED * 0.8, PLAYER_MAX_SPEED * 1.15);

    const smooth = Math.min(1, dt * 9);
    this.pitchIn += (inp.pitch - this.pitchIn) * smooth;
    this.rollIn += (inp.roll - this.rollIn) * smooth;
    this.yawIn += (inp.yaw - this.yawIn) * smooth;

    const speedNorm = clamp((this.speed - PLAYER_MIN_SPEED) / (PLAYER_MAX_SPEED - PLAYER_MIN_SPEED), 0, 1);
    const agility = 1.05 - speedNorm * 0.25;
    const pitchRate = 1.7 * agility;
    const rollRate = 3.2;
    const yawRate = 0.8;

    const q = this.quat;
    q.multiply(tmpQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.pitchIn * pitchRate * dt));
    q.multiply(tmpQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -this.rollIn * rollRate * dt));
    q.multiply(tmpQ.setFromAxisAngle(UP, -this.yawIn * yawRate * dt));

    const right = tmpB.set(1, 0, 0).applyQuaternion(q);
    const up = tmpC.set(0, 1, 0).applyQuaternion(q);
    if (up.y > 0) {
      // Coordinated turn from bank angle
      q.premultiply(tmpQ.setFromAxisAngle(UP, right.y * 0.5 * dt));
      // Gentle self-levelling when hands-off
      if (Math.abs(this.rollIn) < 0.05) q.multiply(tmpQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -right.y * 0.35 * dt));
    }
    q.normalize();

    this.forward(fwd);
    this.vel.copy(fwd).multiplyScalar(this.speed);
    this.pos.addScaledVector(this.vel, dt);
    // Low-speed sink
    const sink = Math.max(0, (170 - this.speed) / 170) * 28;
    this.pos.y -= sink * dt;
    if (this.pos.y > 1500) {
      this.pos.y = 1500;
      if (fwd.y > 0) q.multiply(tmpQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -fwd.y * 1.5 * dt));
    }

    this.playerGroup.position.copy(this.pos);
    this.playerGroup.quaternion.copy(this.quat);
    const abScale = 0.4 + this.throttle * 1.0 + Math.random() * 0.15;
    this.afterburner.scale.set(0.6 + this.throttle * 0.5, 0.6 + this.throttle * 0.5, abScale);

    // Engine contrail at high throttle
    if (this.throttle > 0.85 && Math.random() < 0.6) {
      tmpB.set(0, 0, 11).applyQuaternion(this.quat).add(this.pos);
      this.smoke.emit(tmpB, tmpC.set(0, 0, 0), { life: 0.5, size: 2, color: 0x9ad0ff, growth: 4 });
    }

    // Terrain collision
    const gh = this.terrain.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y < gh + 3) {
      this.pos.y = gh + 3;
      this.crashPlayer('Impacted the canyon wall. Watch the PULL UP warning and keep the nose above the ridgeline.');
      return;
    }

    // Health regeneration after a lull
    this.regenTimer = Math.max(0, this.regenTimer - dt);
    if (this.regenTimer <= 0 && this.health < 100 && this.health > 0) {
      this.health = Math.min(100, this.health + 2.5 * dt);
    }

    // Mission bounds
    const oob = Math.abs(this.pos.x) > MISSION_BOUND || Math.abs(this.pos.z) > MISSION_BOUND;
    if (oob) {
      this.outOfBoundsTimer += dt;
      if (this.outOfBoundsTimer > 8) this.endMission(false, 'Left the mission area. Stay within the canyon operating zone.');
    } else {
      this.outOfBoundsTimer = 0;
    }
  }

  private crashPlayer(reason: string): void {
    if (this.state !== 'playing') return;
    this.health = 0;
    this.explode(this.pos, 3, true);
    this.playerGroup.visible = false;
    this.shake = 1.5;
    this.damageFlash = 1.5;
    this.endMission(false, reason);
  }

  private damagePlayer(dmg: number, source: string): void {
    if (this.state !== 'playing') return;
    this.health -= dmg;
    this.damageFlash = Math.min(1.2, this.damageFlash + 0.5 + dmg / 60);
    this.shake = Math.min(1.2, this.shake + 0.25 + dmg / 80);
    this.regenTimer = 6;
    this.audio.hit();
    tmpA.copy(this.pos);
    for (let i = 0; i < 6; i++) {
      this.fire.emit(tmpA, randomDir(tmpB).multiplyScalar(rand(10, 40)), { life: 0.4, size: 3, color: 0xffb060 });
    }
    if (this.health <= 0) {
      this.crashPlayer(`Shot down by ${source}. Break hard when the MISSILE warning sounds and use flares.`);
    }
  }

  // ---------------------------------------------------------------- weapons

  private updateWeapons(dt: number): void {
    const inp = this.input;
    this.gunCooldown -= dt;
    this.missileCooldown -= dt;
    this.flareCooldown -= dt;

    // Cannon
    if (inp.gun && !this.overheated) {
      while (this.gunCooldown <= 0) {
        this.gunCooldown += 1 / 24;
        this.fireGun();
        this.gunHeat += 0.022;
        if (this.gunHeat >= 1) {
          this.gunHeat = 1;
          this.overheated = true;
          this.hud.pushMessage('CANNON OVERHEAT', 'bad');
          break;
        }
      }
    } else {
      this.gunCooldown = Math.max(0, this.gunCooldown);
      this.gunHeat = Math.max(0, this.gunHeat - dt * 0.4);
      if (this.overheated && this.gunHeat < 0.45) this.overheated = false;
    }
    if (!inp.gun) this.gunHeat = Math.max(0, this.gunHeat - dt * 0.1);

    // Missile
    if (inp.consume('Space')) {
      if (this.missiles <= 0) this.hud.pushMessage('NO MISSILES REMAINING', 'bad');
      else if (this.missileCooldown <= 0) this.fireMissile();
    }

    // Flares
    if (inp.consume('KeyX')) {
      if (this.flares <= 0) this.hud.pushMessage('NO FLARES', 'bad');
      else if (this.flareCooldown <= 0) this.deployFlares();
    }
  }

  private fireGun(): void {
    this.gunSide = -this.gunSide;
    const muzzle = tmpA.set(this.gunSide * 2.2, -0.3, -4).applyQuaternion(this.quat).add(this.pos);
    const dir = this.forward(tmpB);
    dir.x += (Math.random() - 0.5) * 0.008;
    dir.y += (Math.random() - 0.5) * 0.008;
    dir.z += (Math.random() - 0.5) * 0.008;
    dir.normalize();
    const vel = dir.multiplyScalar(BULLET_SPEED).add(this.vel);
    this.spawnBullet(muzzle, vel, 'player', 6, 1.6);
    this.fire.emit(muzzle, tmpC.copy(this.vel), { life: 0.06, size: 4, color: 0xfff0a0 });
    this.audio.gun();
  }

  private spawnBullet(pos: THREE.Vector3, vel: THREE.Vector3, owner: Owner, dmg: number, life: number): void {
    if (this.bullets.length >= MAX_BULLETS * 2) return;
    this.bullets.push({ pos: pos.clone(), prev: pos.clone(), vel: vel.clone(), life, owner, dmg });
  }

  private fireMissile(): void {
    this.missiles--;
    this.missilesFired++;
    this.missileCooldown = 0.45;
    this.gunSide = -this.gunSide;
    const obj = buildMissile(0xe8e8e8);
    obj.position.set(this.gunSide * 5.5, -1.2, 1).applyQuaternion(this.quat).add(this.pos);
    obj.quaternion.copy(this.quat);
    const target = this.locked && this.target && this.target.alive ? this.target : null;
    const m = new Missile(obj, 'player', target, 680, 3.2, 65, this.speed + 60, 7);
    this.forward(m.dir);
    this.scene.add(obj);
    this.missileList.push(m);
    this.audio.missileLaunch();
    if (!target) this.hud.pushMessage('MISSILE AWAY — NO LOCK', '');
  }

  private deployFlares(): void {
    this.flares--;
    this.flareCooldown = 1.2;
    this.audio.flare();
    this.hud.pushMessage('FLARES', 'good');
    const back = tmpA.set(0, -1, 4).applyQuaternion(this.quat).add(this.pos);
    for (let i = 0; i < 10; i++) {
      const v = randomDir(tmpB).multiplyScalar(rand(20, 60));
      v.y -= 20;
      this.fire.emit(back, v, { life: rand(1.2, 2.0), size: 5, color: 0xffd080, drag: 0.6, gravity: 25 });
      this.smoke.emit(back, v, { life: 1.5, size: 4, color: 0xdddddd, growth: 5, drag: 0.6, gravity: 15 });
    }
    let spoofed = 0;
    for (const m of this.missileList) {
      if (m.owner !== 'enemy' || m.target !== 'player') continue;
      if (m.pos.distanceTo(this.pos) < 700 && Math.random() < 0.8) {
        m.target = null;
        // Send it after the flare cloud instead
        m.dir.copy(back).sub(m.pos).normalize();
        spoofed++;
      }
    }
    if (spoofed > 0) this.hud.pushMessage(`${spoofed} MISSILE${spoofed > 1 ? 'S' : ''} SPOOFED`, 'good');
  }

  // ---------------------------------------------------------------- targeting

  private angleTo(e: Enemy, fwd: THREE.Vector3): number {
    tmpC.subVectors(e.pos, this.pos).normalize();
    return Math.acos(clamp(fwd.dot(tmpC), -1, 1));
  }

  private updateTargeting(dt: number): void {
    const fwd = this.forward(tmpA);
    if (this.target && !this.target.alive) {
      this.target = null;
      this.lockTimer = 0;
      this.locked = false;
    }
    const alive = this.enemies.filter((e) => e.alive);

    const cycleA = this.input.consume('Tab');
    const cycleB = this.input.consume('KeyT');
    const cycleC = this.input.consume('MouseRight');
    if (cycleA || cycleB || cycleC) {
      const sorted = alive
        .map((e) => ({ e, a: this.angleTo(e, fwd), d: e.pos.distanceTo(this.pos) }))
        .filter((x) => x.d < 3500)
        .sort((x, y) => x.a - y.a);
      if (sorted.length > 0) {
        const idx = this.target ? sorted.findIndex((x) => x.e === this.target) : -1;
        const next = sorted[(idx + 1) % sorted.length].e;
        if (next !== this.target) {
          this.target = next;
          this.lockTimer = 0;
          this.locked = false;
        }
      }
    }

    this.retargetTimer -= dt;
    if (this.retargetTimer <= 0) {
      this.retargetTimer = 0.4;
      const currentAngle = this.target ? this.angleTo(this.target, fwd) : Infinity;
      const currentDist = this.target ? this.target.pos.distanceTo(this.pos) : Infinity;
      if (!this.target || currentAngle > 1.2 || currentDist > 3500) {
        let best: Enemy | null = null;
        let bestScore = Infinity;
        for (const e of alive) {
          const d = e.pos.distanceTo(this.pos);
          if (d > 3200) continue;
          const a = this.angleTo(e, fwd);
          if (a > 1.1) continue;
          const s = a * 1500 + d * (e.spec.primary ? 0.6 : 1);
          if (s < bestScore) { bestScore = s; best = e; }
        }
        if (best && best !== this.target) {
          this.target = best;
          this.lockTimer = 0;
          this.locked = false;
        }
      }
    }

    if (this.target) {
      const a = this.angleTo(this.target, fwd);
      const d = this.target.pos.distanceTo(this.pos);
      if (a < LOCK_CONE && d < LOCK_RANGE) {
        this.lockTimer = Math.min(LOCK_TIME, this.lockTimer + dt);
      } else {
        this.lockTimer = Math.max(0, this.lockTimer - dt * 2.5);
      }
      const wasLocked = this.locked;
      this.locked = this.lockTimer >= LOCK_TIME;
      if (this.locked && !wasLocked) this.audio.hitConfirm();
    }
  }

  // ---------------------------------------------------------------- enemies

  private updateEnemies(dt: number, playing: boolean): void {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      switch (e.kind) {
        case 'fighter': this.updateFighter(e, dt, playing); break;
        case 'sam': this.updateSam(e, dt, playing); break;
        case 'aaa': this.updateAaa(e, dt, playing); break;
        case 'radar': if (e.dish) e.dish.rotation.y += dt * 1.2; break;
        default: break;
      }
    }
  }

  private aimTurret(e: Enemy): void {
    if (!e.turret) return;
    e.turret.lookAt(this.pos);
  }

  private updateSam(e: Enemy, dt: number, playing: boolean): void {
    this.aimTurret(e);
    if (!playing) return;
    e.cooldown -= dt;
    const d = e.pos.distanceTo(this.pos);
    if (d < 2100 && d > 150 && e.cooldown <= 0) {
      e.cooldown = rand(7, 10);
      const muzzle = e.muzzles[Math.floor(Math.random() * e.muzzles.length)];
      muzzle.getWorldPosition(tmpA);
      const obj = buildMissile(0xbcbcbc);
      obj.position.copy(tmpA);
      const m = new Missile(obj, 'enemy', 'player', 330, 1.55, 32, 120, 9);
      m.dir.set(0, 1, 0).addScaledVector(tmpB.subVectors(this.pos, tmpA).normalize(), 0.6).normalize();
      obj.quaternion.setFromUnitVectors(NEG_Z, m.dir);
      this.scene.add(obj);
      this.missileList.push(m);
      this.hud.pushMessage('SAM LAUNCH', 'bad');
      this.audio.missileLaunch();
      for (let i = 0; i < 12; i++) {
        this.smoke.emit(tmpA, randomDir(tmpC).multiplyScalar(rand(5, 20)), { life: 1.5, size: 6, color: 0xcccccc, growth: 8 });
      }
    }
  }

  private updateAaa(e: Enemy, dt: number, playing: boolean): void {
    this.aimTurret(e);
    if (!playing) return;
    e.cooldown -= dt;
    const d = e.pos.distanceTo(this.pos);
    if (d > 1250) return;
    if (e.cooldown <= 0) {
      if (e.burst <= 0) {
        e.burst = 8;
      }
      e.burst--;
      e.cooldown = e.burst > 0 ? 0.09 : rand(1.8, 2.8);
      const muzzle = e.muzzles[e.burst % e.muzzles.length];
      muzzle.getWorldPosition(tmpA);
      // Lead the player
      const tof = d / ENEMY_BULLET_SPEED;
      tmpB.copy(this.pos).addScaledVector(this.vel, tof * 0.9);
      const dir = tmpB.sub(tmpA).normalize();
      dir.x += (Math.random() - 0.5) * 0.06;
      dir.y += (Math.random() - 0.5) * 0.06;
      dir.z += (Math.random() - 0.5) * 0.06;
      dir.normalize().multiplyScalar(ENEMY_BULLET_SPEED);
      this.spawnBullet(tmpA, dir, 'enemy', 5, 2.2);
      this.fire.emit(tmpA, tmpC.set(0, 0, 0), { life: 0.08, size: 6, color: 0xffc070 });
      this.audio.enemyGun(d);
    }
  }

  private updateFighter(e: Enemy, dt: number, playing: boolean): void {
    const pos = e.pos;
    const fwd = tmpA.copy(NEG_Z).applyQuaternion(e.obj.quaternion);
    const desired = new THREE.Vector3();
    e.aiTimer -= dt;
    e.missileCd -= dt;
    e.cooldown -= dt;

    const toP = tmpB.subVectors(this.pos, pos);
    const dist = toP.length();
    toP.normalize();

    if (!playing) {
      desired.copy(fwd);
    } else if (e.state === 'attack') {
      desired.copy(this.pos).addScaledVector(this.vel, (dist / 700) * 0.4).sub(pos).normalize();
      if (dist < 160 && e.aiTimer <= 0) {
        e.state = 'break';
        e.aiTimer = rand(3, 5);
        const right = tmpC.set(1, 0, 0).applyQuaternion(e.obj.quaternion);
        e.waypoint.copy(pos).addScaledVector(fwd, 700).addScaledVector(right, (Math.random() < 0.5 ? -1 : 1) * 500);
        e.waypoint.y += rand(100, 250);
      }
    } else {
      desired.subVectors(e.waypoint, pos).normalize();
      if (pos.distanceTo(e.waypoint) < 150 || e.aiTimer <= 0) {
        e.state = 'attack';
        e.aiTimer = rand(4, 6);
      }
    }

    // Terrain avoidance
    const gh = this.terrain.heightAt(pos.x, pos.z);
    tmpC.copy(pos).addScaledVector(fwd, 320);
    const ah = this.terrain.heightAt(tmpC.x, tmpC.z);
    if (pos.y - gh < 60 || pos.y - ah < 70) {
      desired.set(fwd.x, 0, fwd.z).normalize().multiplyScalar(0.55);
      desired.y = 1;
      desired.normalize();
    }
    if (pos.y > 1000) desired.y = Math.min(desired.y, -0.3);
    if (Math.abs(pos.x) > 3200 || Math.abs(pos.z) > 3200) desired.set(0, 400, 0).sub(pos).normalize();

    // Rotate forward toward desired within turn rate
    const angle = fwd.angleTo(desired);
    const step = Math.min(angle, e.turnRate * dt);
    const newFwd = tmpC.copy(fwd);
    if (angle > 1e-4) {
      const axis = new THREE.Vector3().crossVectors(fwd, desired);
      if (axis.lengthSq() < 1e-8) axis.copy(UP);
      axis.normalize();
      newFwd.applyAxisAngle(axis, step);
    }
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(e.obj.quaternion);
    const lateral = desired.dot(right);
    const targetBank = clamp(-lateral * 1.8, -1.3, 1.3);
    e.bank += (targetBank - e.bank) * Math.min(1, dt * 3);
    tmpM.lookAt(pos, new THREE.Vector3().copy(pos).add(newFwd), UP);
    e.obj.quaternion.setFromRotationMatrix(tmpM);
    e.obj.quaternion.multiply(tmpQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), e.bank));

    const wantSpeed = dist > 900 ? 340 : 265;
    e.speed += (wantSpeed - e.speed) * Math.min(1, dt * 0.6);
    e.vel.copy(newFwd).multiplyScalar(e.speed);
    pos.addScaledVector(e.vel, dt);
    if (e.afterburner) e.afterburner.scale.set(0.8, 0.8, 0.8 + Math.random() * 0.3);

    if (!playing) return;

    // Guns
    const aim = Math.acos(clamp(newFwd.dot(toP), -1, 1));
    if (dist < 900 && dist > 40 && aim < 0.1 && e.cooldown <= 0) {
      e.cooldown = 0.1;
      const muzzle = new THREE.Vector3(0, -0.5, -8).applyQuaternion(e.obj.quaternion).add(pos);
      const tof = dist / (ENEMY_BULLET_SPEED + e.speed);
      const lead = new THREE.Vector3().copy(this.pos).addScaledVector(this.vel, tof * 0.85).sub(muzzle).normalize();
      lead.x += (Math.random() - 0.5) * 0.03;
      lead.y += (Math.random() - 0.5) * 0.03;
      lead.z += (Math.random() - 0.5) * 0.03;
      lead.normalize().multiplyScalar(ENEMY_BULLET_SPEED).add(e.vel);
      this.spawnBullet(muzzle, lead, 'enemy', 4, 1.6);
      this.audio.enemyGun(dist);
    }
    // Missiles
    if (dist < 1700 && dist > 250 && aim < 0.35 && e.missileCd <= 0) {
      e.missileCd = rand(9, 13);
      const obj = buildMissile(0xbcbcbc);
      obj.position.set(Math.random() < 0.5 ? -4 : 4, -1, 0).applyQuaternion(e.obj.quaternion).add(pos);
      const m = new Missile(obj, 'enemy', 'player', 520, 2.0, 28, e.speed + 40, 7);
      m.dir.copy(newFwd);
      obj.quaternion.copy(e.obj.quaternion);
      this.scene.add(obj);
      this.missileList.push(m);
      this.hud.pushMessage('BANDIT MISSILE LAUNCH', 'bad');
      this.audio.missileLaunch();
    }
    // Collision with player
    if (dist < e.spec.radius + PLAYER_RADIUS) {
      this.destroyEnemy(e, 'collision');
      this.damagePlayer(45, 'a mid-air collision');
    }
  }

  private damageEnemy(e: Enemy, dmg: number, hitPos: THREE.Vector3, byMissile: boolean): void {
    if (!e.alive) return;
    e.health -= dmg;
    this.hitMarker = 0.25;
    this.audio.hitConfirm();
    for (let i = 0; i < (byMissile ? 10 : 3); i++) {
      this.fire.emit(hitPos, randomDir(tmpB).multiplyScalar(rand(8, 30)), { life: 0.35, size: 2.5, color: 0xffcc80 });
    }
    if (e.health <= 0) this.destroyEnemy(e, byMissile ? 'missile' : 'gun');
  }

  private destroyEnemy(e: Enemy, _cause: string): void {
    if (!e.alive) return;
    e.alive = false;
    e.obj.visible = false;
    this.explode(e.pos, e.kind === 'fighter' ? 1.4 : 2.2, e.kind !== 'aaa');
    this.kills++;
    this.score += e.spec.score;
    const names: Record<EnemyKind, string> = {
      sam: 'SAM SITE DESTROYED', aaa: 'AA GUN DESTROYED', radar: 'RADAR STATION DESTROYED',
      depot: 'FUEL DEPOT DESTROYED', fighter: 'BANDIT DOWN',
    };
    if (e.spec.primary) {
      this.primariesKilled++;
      this.hud.pushMessage(`${names[e.kind]}  (${this.primariesKilled}/${this.primariesTotal})`, 'good');
    } else {
      this.hud.pushMessage(names[e.kind], '');
    }
    if (e.kind !== 'fighter') {
      this.burnSites.push({ pos: e.pos.clone(), t: 30, timer: 0 });
    }
    if (this.target === e) {
      this.target = null;
      this.locked = false;
      this.lockTimer = 0;
    }
    // Retarget missiles that were chasing it
    for (const m of this.missileList) if (m.target === e) m.target = null;
  }

  // ---------------------------------------------------------------- projectiles

  private updateBullets(dt: number, playing: boolean): void {
    const bullets = this.bullets;
    let pc = 0;
    let ec = 0;
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.life -= dt;
      b.prev.copy(b.pos);
      b.pos.addScaledVector(b.vel, dt);
      let dead = b.life <= 0;
      if (!dead && b.pos.y < this.terrain.heightAt(b.pos.x, b.pos.z)) {
        dead = true;
        this.smoke.emit(b.pos, tmpA.set(0, 6, 0), { life: 0.6, size: 4, color: 0xa08868, growth: 6 });
      }
      if (!dead && playing) {
        if (b.owner === 'player') {
          for (const e of this.enemies) {
            if (!e.alive) continue;
            if (segmentPointDistance(b.prev, b.pos, e.pos) < e.spec.radius) {
              this.damageEnemy(e, b.dmg, b.pos, false);
              dead = true;
              break;
            }
          }
        } else if (segmentPointDistance(b.prev, b.pos, this.pos) < PLAYER_RADIUS) {
          this.damagePlayer(b.dmg, 'enemy gunfire');
          dead = true;
        }
      }
      if (dead) {
        bullets[i] = bullets[bullets.length - 1];
        bullets.pop();
        continue;
      }
      const mesh = b.owner === 'player' ? this.bulletMeshPlayer : this.bulletMeshEnemy;
      const idx = b.owner === 'player' ? pc++ : ec++;
      if (idx >= MAX_BULLETS) continue;
      this.bulletDummy.position.copy(b.pos);
      this.bulletDummy.lookAt(tmpA.copy(b.pos).add(b.vel));
      this.bulletDummy.updateMatrix();
      mesh.setMatrixAt(idx, this.bulletDummy.matrix);
    }
    this.bulletMeshPlayer.count = Math.min(pc, MAX_BULLETS);
    this.bulletMeshEnemy.count = Math.min(ec, MAX_BULLETS);
    this.bulletMeshPlayer.instanceMatrix.needsUpdate = true;
    this.bulletMeshEnemy.instanceMatrix.needsUpdate = true;
  }

  private updateMissiles(dt: number, playing: boolean): void {
    const list = this.missileList;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      m.life -= dt;
      m.speed = Math.min(m.maxSpeed, m.speed + 420 * dt);
      let targetPos: THREE.Vector3 | null = null;
      let targetVel: THREE.Vector3 | null = null;
      if (m.target === 'player') {
        if (playing) { targetPos = this.pos; targetVel = this.vel; }
      } else if (m.target) {
        if (m.target.alive) { targetPos = m.target.pos; targetVel = m.target.vel; } else m.target = null;
      }
      if (targetPos) {
        const d = m.pos.distanceTo(targetPos);
        const lead = tmpA.copy(targetPos);
        if (targetVel) lead.addScaledVector(targetVel, (d / m.speed) * 0.7);
        const desired = lead.sub(m.pos).normalize();
        const angle = m.dir.angleTo(desired);
        const step = Math.min(angle, m.turnRate * dt);
        if (angle > 1e-4) {
          const axis = tmpB.crossVectors(m.dir, desired);
          if (axis.lengthSq() > 1e-8) m.dir.applyAxisAngle(axis.normalize(), step).normalize();
        }
      }
      m.pos.addScaledVector(m.dir, m.speed * dt);
      m.obj.quaternion.setFromUnitVectors(NEG_Z, m.dir);

      // Smoke trail
      m.smokeTimer -= dt;
      while (m.smokeTimer <= 0) {
        m.smokeTimer += 0.012;
        tmpA.copy(m.pos).addScaledVector(m.dir, -2);
        this.smoke.emit(tmpA, randomDir(tmpB).multiplyScalar(4), { life: rand(1.0, 1.6), size: 2.5, color: 0xd8d8d8, growth: 7, drag: 1 });
        this.fire.emit(tmpA, tmpB.set(0, 0, 0), { life: 0.12, size: 3, color: 0xffb060 });
      }

      let dead = false;
      let hit = false;
      if (m.pos.y < this.terrain.heightAt(m.pos.x, m.pos.z)) {
        dead = true;
        this.explode(m.pos, 0.9, false);
      } else if (playing && m.owner === 'player') {
        for (const e of this.enemies) {
          if (!e.alive) continue;
          if (m.pos.distanceTo(e.pos) < e.spec.radius + 7) {
            this.missileHits++;
            this.damageEnemy(e, m.dmg, m.pos, true);
            this.explode(m.pos, 1.0, false);
            dead = true;
            hit = true;
            break;
          }
        }
      } else if (playing && m.owner === 'enemy') {
        if (m.pos.distanceTo(this.pos) < PLAYER_RADIUS + 6) {
          this.damagePlayer(m.dmg, 'a missile');
          this.explode(m.pos, 1.0, false);
          dead = true;
          hit = true;
        }
      }
      if (!dead && m.life <= 0) {
        dead = true;
        this.explode(m.pos, 0.5, false);
      }
      if (dead) {
        void hit;
        this.scene.remove(m.obj);
        list[i] = list[list.length - 1];
        list.pop();
      }
    }
  }

  // ---------------------------------------------------------------- effects

  private explode(pos: THREE.Vector3, size: number, big: boolean): void {
    const p = pos.clone();
    const n = Math.floor(28 * size);
    for (let i = 0; i < n; i++) {
      const v = randomDir(tmpB).multiplyScalar(rand(15, 55) * size);
      this.fire.emit(p, v, { life: rand(0.35, 0.8), size: rand(4, 9) * size, color: Math.random() < 0.5 ? 0xffb040 : 0xff6a1a, growth: 6 * size, drag: 2 });
    }
    const ns = Math.floor(22 * size);
    for (let i = 0; i < ns; i++) {
      const v = randomDir(tmpB).multiplyScalar(rand(8, 30) * size);
      v.y += 12;
      this.smoke.emit(p, v, { life: rand(1.2, 2.6), size: rand(5, 10) * size, color: 0x333333, growth: 10 * size, drag: 1.2 });
    }
    // Sparks
    for (let i = 0; i < 14 * size; i++) {
      const v = randomDir(tmpB).multiplyScalar(rand(60, 140) * size);
      this.fire.emit(p, v, { life: rand(0.5, 1.1), size: 1.5, color: 0xffe0a0, gravity: 120, drag: 0.5 });
    }
    const mesh = new THREE.Mesh(
      this.flashGeo,
      new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    mesh.position.copy(p);
    this.scene.add(mesh);
    this.flashes.push({ mesh, t: 0, maxT: 0.35, size: 18 * size });
    this.audio.explosion(p.distanceTo(this.pos), big);
    const d = p.distanceTo(this.pos);
    if (d < 250) this.shake = Math.min(1, this.shake + (1 - d / 250) * 0.6);
  }

  private updateFlashes(dt: number): void {
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t += dt;
      const k = f.t / f.maxT;
      if (k >= 1) {
        this.scene.remove(f.mesh);
        (f.mesh.material as THREE.Material).dispose();
        this.flashes.splice(i, 1);
        continue;
      }
      const s = f.size * (0.3 + k * 0.7);
      f.mesh.scale.setScalar(s);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
    }
  }

  private updateBurnSites(dt: number): void {
    for (let i = this.burnSites.length - 1; i >= 0; i--) {
      const b = this.burnSites[i];
      b.t -= dt;
      if (b.t <= 0) { this.burnSites.splice(i, 1); continue; }
      b.timer -= dt;
      while (b.timer <= 0) {
        b.timer += 0.08;
        tmpA.copy(b.pos).add(randomDir(tmpB).multiplyScalar(6));
        tmpA.y = b.pos.y + 3;
        this.smoke.emit(tmpA, tmpB.set(rand(-3, 3), rand(12, 22), rand(-3, 3)), { life: rand(2.5, 4), size: 6, color: 0x2a2a2a, growth: 9, drag: 0.4 });
        if (Math.random() < 0.5) this.fire.emit(tmpA, tmpB.set(0, 8, 0), { life: 0.4, size: 5, color: 0xff7a20 });
      }
    }
  }

  // ---------------------------------------------------------------- mission logic

  private checkObjectives(_dt: number): void {
    if (this.primariesKilled >= 3 && !this.wavesSpawned.has(2)) {
      this.wavesSpawned.add(2);
      this.spawnFighters(3, 1300, 'behind');
      this.hud.pushMessage('WARNING — BANDITS ON YOUR SIX', 'bad');
    }
    if (this.primariesKilled >= 6 && !this.wavesSpawned.has(3)) {
      this.wavesSpawned.add(3);
      this.spawnFighters(2, 1600, 'ahead');
      this.hud.pushMessage('BANDITS INBOUND', 'bad');
    }
    if (this.primariesKilled >= this.primariesTotal && !this.extractionActive) {
      this.extractionActive = true;
      this.extraction.visible = true;
      this.wavesSpawned.add(4);
      this.spawnFighters(3, 1500, 'ahead');
      this.hud.pushMessage('ALL PRIMARY TARGETS DESTROYED', 'good');
      this.hud.pushMessage('PROCEED TO EXTRACTION BEACON', 'good');
      this.audio.uiConfirm();
    }
    if (this.extractionActive && this.pos.distanceTo(this.extractionPos) < EXTRACTION_RADIUS) {
      this.hud.pushMessage('EXTRACTION REACHED', 'good');
      this.endMission(true, 'Every primary target in Redstone Canyon is burning and the Kestrel made it to the beacon.');
    }
  }

  // ---------------------------------------------------------------- camera

  private updateCamera(dt: number, instant: boolean): void {
    const k = instant ? 1 : Math.min(1, dt * 4.5);
    this.camQuat.slerp(this.quat, k);
    const back = tmpA.set(0, 0, 1).applyQuaternion(this.camQuat);
    const up = tmpB.set(0, 1, 0).applyQuaternion(this.camQuat);
    const dist = 28 + this.speed * 0.025;
    const desired = tmpC.copy(this.pos).addScaledVector(back, dist).addScaledVector(up, 7.5);
    this.camPos.lerp(desired, instant ? 1 : Math.min(1, dt * 9));
    const gh = this.terrain.heightAt(this.camPos.x, this.camPos.z);
    if (this.camPos.y < gh + 6) this.camPos.y = gh + 6;
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      const s = this.shake * 1.6;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
    }
    const look = this.forward(new THREE.Vector3()).multiplyScalar(70).add(this.pos);
    this.camera.up.copy(up);
    this.camera.lookAt(look);
    const fov = 66 + clamp((this.speed - PLAYER_MIN_SPEED) / (PLAYER_MAX_SPEED - PLAYER_MIN_SPEED), 0, 1.2) * 16;
    if (Math.abs(fov - this.camera.fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  // ---------------------------------------------------------------- HUD

  private project(world: THREE.Vector3, w: number, h: number): { x: number; y: number; onScreen: boolean; angle: number } {
    const v = tmpA.copy(world).project(this.camera);
    const behind = v.z > 1;
    const x = ((v.x + 1) / 2) * w;
    const y = ((1 - v.y) / 2) * h;
    const onScreen = !behind && Math.abs(v.x) < 1 && Math.abs(v.y) < 1;
    let dx = v.x;
    let dy = -v.y;
    if (behind) { dx = -dx; dy = -dy; }
    return { x, y, onScreen, angle: Math.atan2(dy * h, dx * w) };
  }

  private buildHudFrame(): HudFrame {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const fwd = this.forward(new THREE.Vector3());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat);
    const targets: HudTarget[] = [];
    const radar: RadarBlip[] = [];
    const radarRange = 2600;
    const fx = fwd.x, fz = fwd.z;
    const fl = Math.hypot(fx, fz) || 1;
    const hfx = fx / fl, hfz = fz / fl;
    const rx = -hfz, rz = hfx;

    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dist = e.pos.distanceTo(this.pos);
      const p = this.project(e.pos, w, h);
      targets.push({
        x: p.x, y: p.y, onScreen: p.onScreen, angle: p.angle,
        selected: e === this.target, locked: e === this.target && this.locked,
        lockProgress: e === this.target ? this.lockTimer / LOCK_TIME : 0,
        air: e.kind === 'fighter', primary: e.spec.primary, dist, label: e.spec.label,
        health: e.health / e.spec.health,
      });
      const dx = e.pos.x - this.pos.x;
      const dz = e.pos.z - this.pos.z;
      radar.push({ x: (dx * rx + dz * rz) / radarRange, y: (dx * hfx + dz * hfz) / radarRange, kind: e.kind === 'fighter' ? 'air' : 'ground', primary: e.spec.primary });
    }
    let missileWarning = false;
    for (const m of this.missileList) {
      if (m.owner !== 'enemy') continue;
      const dx = m.pos.x - this.pos.x;
      const dz = m.pos.z - this.pos.z;
      radar.push({ x: (dx * rx + dz * rz) / radarRange, y: (dx * hfx + dz * hfz) / radarRange, kind: 'missile', primary: false });
      if (m.target === 'player' && m.pos.distanceTo(this.pos) < 1600) missileWarning = true;
    }
    let extraction: HudTarget | null = null;
    if (this.extractionActive) {
      const p = this.project(this.extractionPos, w, h);
      const dist = this.pos.distanceTo(this.extractionPos);
      extraction = { x: p.x, y: p.y, onScreen: p.onScreen, angle: p.angle, selected: false, locked: false, lockProgress: 0, air: false, primary: false, dist, label: 'EXT', health: 1 };
      const dx = this.extractionPos.x - this.pos.x;
      const dz = this.extractionPos.z - this.pos.z;
      radar.push({ x: (dx * rx + dz * rz) / radarRange, y: (dx * hfx + dz * hfz) / radarRange, kind: 'ext', primary: false });
    }

    const pip = this.project(tmpB.copy(this.pos).addScaledVector(fwd, 900), w, h);
    const gh = this.terrain.heightAt(this.pos.x, this.pos.z);
    const agl = this.pos.y - gh;
    const warnings: string[] = [];
    if (this.state === 'playing') {
      if (missileWarning) warnings.push('MISSILE');
      tmpB.copy(this.pos).addScaledVector(this.vel, 1.6);
      const aheadH = this.terrain.heightAt(tmpB.x, tmpB.z);
      if ((agl < 35 && fwd.y < 0.05) || tmpB.y < aheadH + 15) warnings.push('PULL UP');
      if (this.outOfBoundsTimer > 0) warnings.push(`RETURN TO MISSION AREA ${Math.ceil(8 - this.outOfBoundsTimer)}`);
      if (this.overheated) warnings.push('GUN OVERHEAT');
      if (warnings.length > 0) this.audio.warning(this.time);
    }

    const fightersAlive = this.enemies.filter((e) => e.alive && e.kind === 'fighter').length;
    const primariesLeft = this.primariesTotal - this.primariesKilled;
    let objective: string;
    let objectiveSub: string;
    if (this.state === 'won') {
      objective = 'MISSION ACCOMPLISHED';
      objectiveSub = '';
    } else if (this.state === 'lost') {
      objective = 'MISSION FAILED';
      objectiveSub = '';
    } else if (primariesLeft > 0) {
      objective = `DESTROY PRIMARY TARGETS  ${this.primariesKilled}/${this.primariesTotal}`;
      objectiveSub = fightersAlive > 0 ? `${fightersAlive} bandit${fightersAlive > 1 ? 's' : ''} airborne · follow the canyon south` : 'Follow the canyon south';
    } else {
      objective = 'REACH THE EXTRACTION BEACON';
      objectiveSub = `${Math.round(this.pos.distanceTo(this.extractionPos))} m to beacon${fightersAlive > 0 ? ` · ${fightersAlive} bandits pursuing` : ''}`;
    }

    return {
      speed: this.speed,
      altitude: this.pos.y,
      agl,
      throttle: this.throttle,
      health: this.health,
      missiles: this.missiles,
      flares: this.flares,
      gunHeat: this.gunHeat,
      score: this.score,
      time: this.time,
      objective,
      objectiveSub,
      warnings,
      targets,
      extraction,
      radar,
      heading: Math.atan2(fwd.x, -fwd.z),
      pipperX: pip.x,
      pipperY: pip.y,
      pipperVisible: pip.onScreen && this.state === 'playing',
      lockState: this.state !== 'playing' ? 0 : this.locked ? 2 : this.target && this.lockTimer > 0 ? 1 : 0,
      damageFlash: this.damageFlash,
      hitMarker: this.hitMarker,
      roll: Math.atan2(-right.y, up.y),
      pitch: fwd.y,
    };
  }
}
