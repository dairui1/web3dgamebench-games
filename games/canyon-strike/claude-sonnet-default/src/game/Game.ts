import * as THREE from 'three';
import { Aircraft } from './Aircraft.ts';
import { InputManager } from './Input.ts';
import { buildExtractionGate } from './Models.ts';
import { CANYON_END_Z, CANYON_START_Z, buildSkyDome, buildTerrainMesh, heightAt, pathX } from './Terrain.ts';
import { ChaseCamera } from './ChaseCamera.ts';
import { EnemyBase, EnemyFighter, spawnGroundEnemiesAlongCanyon } from './Enemy.ts';
import { ProjectileManager } from './Projectile.ts';
import { ExplosionSystem } from './Explosion.ts';
import { AudioManager } from './Audio.ts';
import { HUD } from './HUD.ts';
import type { Damageable, GameState } from './types.ts';
import { clamp, randRange } from './utils.ts';

const LOCK_CONE_COS = 0.985; // ~10 degrees
const ACQUIRE_CONE_COS = 0.86; // ~30 degrees

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: ChaseCamera;
  private clock = new THREE.Clock();

  private aircraft!: Aircraft;
  private enemies: EnemyBase[] = [];
  private extractionGroup!: THREE.Group;
  private extractionPos = new THREE.Vector3();
  private extractionRadius = 75;

  private projectiles: ProjectileManager;
  private explosions: ExplosionSystem;
  private audio = new AudioManager();
  private hud: HUD;
  private input: InputManager;

  private state: GameState = 'briefing';
  private currentTarget: EnemyBase | null = null;
  private lockProgress = 0;
  private missileWarningTimer = 0;

  private missionTime = 0;
  private shotsFired = 0;
  private hits = 0;
  private totalTargets = 0;
  private targetsDestroyed = 0;
  private allEnemiesCleared = false;
  private extractionActive = false;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xbfe0ff, 900, 3400);

    this.camera = new ChaseCamera(window.innerWidth / window.innerHeight);

    this.projectiles = new ProjectileManager(this.scene);
    this.explosions = new ExplosionSystem(this.scene);

    this.buildWorld();

    this.hud = new HUD(container);
    this.input = new InputManager(this.renderer.domElement);

    window.addEventListener('resize', this.onResize);

    this.hud.showBriefing(() => this.startMission(), this.input.isTouch);
    this.renderer.setAnimationLoop(this.loop);
  }

  private buildWorld() {
    this.scene.add(buildSkyDome());
    this.scene.add(buildTerrainMesh());

    const hemi = new THREE.HemisphereLight(0xbfe0ff, 0x3a3226, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.4);
    sun.position.set(-600, 900, -300);
    this.scene.add(sun);
    const ambient = new THREE.AmbientLight(0xffffff, 0.15);
    this.scene.add(ambient);

    this.aircraft = new Aircraft(this.scene);

    const gateZ = CANYON_END_Z - 260;
    const gateX = pathX(gateZ);
    const gateY = heightAt(gateX, gateZ) + 5;
    this.extractionGroup = buildExtractionGate();
    this.extractionGroup.position.set(gateX, gateY, gateZ);
    this.scene.add(this.extractionGroup);
    this.extractionPos.set(gateX, gateY + 30, gateZ);

    this.spawnEnemies();
  }

  private spawnEnemies() {
    for (const e of this.enemies) this.scene.remove(e.object);
    this.enemies = [];

    const zoneStart = CANYON_START_Z + 500;
    const zoneEnd = CANYON_END_Z - 500;

    const ground = spawnGroundEnemiesAlongCanyon(6, zoneStart, zoneEnd, (i) => (i % 3 === 2 ? 'sam' : 'turret'));
    for (const g of ground) {
      this.scene.add(g.object);
      this.enemies.push(g);
    }

    const fighterCount = 4;
    for (let i = 0; i < fighterCount; i++) {
      const z = zoneStart + ((zoneEnd - zoneStart) * (i + 1)) / (fighterCount + 1) + randRange(-100, 100);
      const x = pathX(z) + randRange(-140, 140);
      const y = heightAt(x, z) + randRange(150, 260);
      const fighter = new EnemyFighter(new THREE.Vector3(x, y, z));
      this.scene.add(fighter.object);
      this.enemies.push(fighter);
    }

    this.totalTargets = this.enemies.length;
    this.targetsDestroyed = 0;
    this.allEnemiesCleared = false;
    this.extractionActive = false;
  }

  private startMission() {
    this.hud.hideBriefing();
    this.resetMission();
    this.state = 'playing';
  }

  private resetMission() {
    this.aircraft.reset(this.scene);
    this.projectiles.clear();
    this.spawnEnemies();
    this.missionTime = 0;
    this.shotsFired = 0;
    this.hits = 0;
    this.currentTarget = null;
    this.lockProgress = 0;
    this.missileWarningTimer = 0;
  }

  private restart() {
    this.resetMission();
    this.state = 'playing';
  }

  private onResize = () => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.resize(window.innerWidth / window.innerHeight);
  };

  private loop = () => {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.update(dt);
    this.renderer.render(this.scene, this.camera.camera);
  };

  private update(dt: number) {
    if (this.state !== 'playing') {
      this.camera.update(dt, this.aircraft, this.aircraft.speedRatio);
      return;
    }

    this.missionTime += dt;
    const inputState = this.input.update();

    this.aircraft.update(dt, inputState);
    this.camera.update(dt, this.aircraft, this.aircraft.speedRatio);

    // terrain collision for player
    const groundH = heightAt(this.aircraft.position.x, this.aircraft.position.z);
    if (this.aircraft.alive && this.aircraft.position.y <= groundH + 2.2) {
      this.aircraft.applyDamage(999);
      this.explosions.spawn(this.aircraft.position, 2.2);
      this.audio.explosion(1.6);
      this.aircraft.object.visible = false;
    }

    // enemy AI + fire requests
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.update(dt, this.aircraft.position, this.aircraft.alive);
      const requests = e.drainFireRequests();
      for (const r of requests) {
        if (r.kind === 'bullet') {
          this.projectiles.spawnBullet(r.origin, r.direction, 'enemy', r.damage);
        } else {
          this.projectiles.spawnMissile(r.origin, r.direction, 'enemy', r.damage, this.aircraft);
          this.audio.missileLaunch();
        }
      }
    }

    // targeting
    this.updateTargeting(dt, inputState.cycleTarget);

    // weapons fire
    if (inputState.fireGun && this.aircraft.canFireGun()) {
      this.aircraft.fireGun();
      this.projectiles.spawnBullet(this.aircraft.gunMuzzle(), this.aircraft.forward, 'player', 6, 420);
      this.shotsFired++;
      this.audio.gunshot();
    }
    if (inputState.fireMissile) {
      if (this.aircraft.canFireMissile() && this.currentTarget && this.lockProgress >= 1) {
        this.aircraft.fireMissile();
        this.projectiles.spawnMissile(this.aircraft.gunMuzzle(), this.aircraft.forward, 'player', 34, this.currentTarget);
        this.shotsFired++;
        this.audio.missileLaunch();
      } else {
        this.audio.lockBeep(false);
      }
    }

    // projectile update + collisions
    const targets: Damageable[] = [...this.enemies.filter((e) => e.alive), this.aircraft];
    this.projectiles.update(
      dt,
      heightAt,
      targets,
      (pos, scale) => {
        this.explosions.spawn(pos, scale);
        this.audio.explosion(scale);
      },
      (target, damage, isPlayerHit) => {
        const wasAlive = target.alive;
        target.applyDamage(damage);
        if (isPlayerHit) {
          this.camera.addShake(0.4);
          this.hud.addShakeFlashClass();
          this.audio.hit();
        } else {
          this.hits++;
          this.hud.flashHitMarker();
          this.audio.hit();
          if (wasAlive && !target.alive) {
            this.targetsDestroyed++;
            if (target === this.currentTarget) {
              this.currentTarget = null;
              this.lockProgress = 0;
            }
          }
        }
      },
      this.aircraft.position,
      this.aircraft.alive,
    );

    this.explosions.update(dt);

    // enemy destroyed cleanup (remove mesh after death, with brief delay handled by scale-out)
    for (const e of this.enemies) {
      if (!e.alive && e.object.visible) {
        e.object.visible = false;
        this.explosions.spawn(e.object.position, e instanceof EnemyFighter ? 1.4 : 1.1);
        this.audio.explosion(e instanceof EnemyFighter ? 1.4 : 1.1);
      }
    }

    if (!this.allEnemiesCleared && this.enemies.every((e) => !e.alive)) {
      this.allEnemiesCleared = true;
      this.extractionActive = true;
      this.hud.showMessage('ALL HOSTILES DESTROYED — PROCEED TO EXTRACTION', 4);
    }

    // missile warning: any enemy missile homed on player
    let warn = false;
    for (const m of this.projectiles.missiles) {
      if (m.team === 'enemy' && m.target === this.aircraft) {
        warn = true;
        break;
      }
    }
    if (warn && this.missileWarningTimer <= 0) this.audio.alarm();
    this.missileWarningTimer = warn ? 0.6 : Math.max(0, this.missileWarningTimer - dt);

    // extraction check
    if (this.extractionActive && this.aircraft.alive) {
      const dist = this.aircraft.position.distanceTo(this.extractionPos);
      if (dist < this.extractionRadius) {
        this.triggerWin();
      }
    }

    if (!this.aircraft.alive && this.state === 'playing') {
      this.triggerLose('Your aircraft was lost in the canyon.');
    }

    this.updateHud(dt, inputState.cycleTarget);
  }

  private updateTargeting(dt: number, cyclePressed: boolean) {
    const aliveEnemies = this.enemies.filter((e) => e.alive);
    const forward = this.aircraft.forward;

    if (this.currentTarget && !this.currentTarget.alive) {
      this.currentTarget = null;
      this.lockProgress = 0;
    }

    if (cyclePressed && aliveEnemies.length > 0) {
      let idx = this.currentTarget ? aliveEnemies.indexOf(this.currentTarget) : -1;
      idx = (idx + 1) % aliveEnemies.length;
      this.currentTarget = aliveEnemies[idx];
      this.lockProgress = 0;
    }

    if (!this.currentTarget && aliveEnemies.length > 0) {
      let best: EnemyBase | null = null;
      let bestCos = ACQUIRE_CONE_COS;
      for (const e of aliveEnemies) {
        const dir = e.position.clone().sub(this.aircraft.position).normalize();
        const c = dir.dot(forward);
        if (c > bestCos) {
          bestCos = c;
          best = e;
        }
      }
      if (best) {
        this.currentTarget = best;
        this.lockProgress = 0;
      }
    }

    if (this.currentTarget) {
      const dir = this.currentTarget.position.clone().sub(this.aircraft.position).normalize();
      const c = dir.dot(forward);
      if (c > LOCK_CONE_COS) {
        const prevLocked = this.lockProgress >= 1;
        this.lockProgress = clamp(this.lockProgress + dt / 1.1, 0, 1);
        if (!prevLocked && this.lockProgress >= 1) this.audio.lockBeep(true);
      } else if (c > 0.3) {
        this.lockProgress = clamp(this.lockProgress - dt * 0.6, 0, 1);
      } else {
        this.currentTarget = null;
        this.lockProgress = 0;
      }
    }
  }

  private updateHud(dt: number, cyclePressed: boolean) {
    void cyclePressed;
    const w = window.innerWidth;
    const h = window.innerHeight;

    let screenPos: { x: number; y: number } | null = null;
    let onScreen = false;
    if (this.currentTarget) {
      const v = this.currentTarget.position.clone().project(this.camera.camera);
      const toTarget = this.currentTarget.position.clone().sub(this.camera.camera.position);
      const camForward = new THREE.Vector3();
      this.camera.camera.getWorldDirection(camForward);
      onScreen = toTarget.dot(camForward) > 0 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      screenPos = { x: (v.x * 0.5 + 0.5) * w, y: (1 - (v.y * 0.5 + 0.5)) * h };
    }
    this.hud.updateLockBox(screenPos, this.lockProgress, onScreen);

    const forward = this.aircraft.forward;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.aircraft.object.quaternion);
    let extractionDir: THREE.Vector2 | null = null;
    let extractionDist: number | null = null;
    if (this.extractionActive) {
      const toGate = this.extractionPos.clone().sub(this.aircraft.position);
      extractionDist = toGate.length();
      const localForward = toGate.dot(forward);
      const localRight = toGate.dot(right);
      extractionDir = new THREE.Vector2(localRight, localForward);
    }

    const radarBlips: { x: number; z: number; type: 'ground' | 'air' | 'extraction' }[] = [];
    const camRightFlat = right.clone();
    camRightFlat.y = 0;
    camRightFlat.normalize();
    const fwdFlat = forward.clone();
    fwdFlat.y = 0;
    fwdFlat.normalize();
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const rel = e.position.clone().sub(this.aircraft.position);
      radarBlips.push({
        x: rel.dot(camRightFlat),
        z: -rel.dot(fwdFlat),
        type: e instanceof EnemyFighter ? 'air' : 'ground',
      });
    }
    if (this.extractionActive) {
      const rel = this.extractionPos.clone().sub(this.aircraft.position);
      radarBlips.push({ x: rel.dot(camRightFlat), z: -rel.dot(fwdFlat), type: 'extraction' });
    }

    const remaining = this.enemies.filter((e) => e.alive).length;
    const objective = this.allEnemiesCleared
      ? 'Proceed to the extraction gate'
      : 'Destroy all ground and air hostiles';

    this.hud.update(dt, {
      health: this.aircraft.health,
      maxHealth: this.aircraft.maxHealth,
      speed: this.aircraft.speed,
      altitude: Math.max(0, this.aircraft.position.y - heightAt(this.aircraft.position.x, this.aircraft.position.z)),
      throttle: this.input.state.throttle,
      missileAmmo: this.aircraft.missileAmmo,
      gunReady: this.aircraft.canFireGun(),
      objective,
      targetsRemaining: remaining,
      totalTargets: this.totalTargets,
      missionTime: this.missionTime,
      lockProgress: this.lockProgress,
      locked: this.lockProgress >= 1,
      missileWarning: this.missileWarningTimer > 0,
      extractionActive: this.extractionActive,
      extractionDir,
      extractionDist,
      playerScreenHeading: 0,
      radarBlips,
    });
  }

  private triggerWin() {
    this.state = 'win';
    this.hud.showEnd(
      true,
      {
        targetsDestroyed: this.targetsDestroyed,
        totalTargets: this.totalTargets,
        shotsFired: this.shotsFired,
        hits: this.hits,
        missionTime: this.missionTime,
      },
      () => this.restart(),
    );
  }

  private triggerLose(cause: string) {
    this.state = 'lose';
    this.hud.showEnd(
      false,
      {
        targetsDestroyed: this.targetsDestroyed,
        totalTargets: this.totalTargets,
        shotsFired: this.shotsFired,
        hits: this.hits,
        missionTime: this.missionTime,
        cause,
      },
      () => this.restart(),
    );
  }
}
