import * as THREE from 'three';
import { buildEngineGlow, buildJet } from './Models.ts';
import type { Damageable, Team } from './types.ts';
import { clamp, damp, lerp } from './utils.ts';
import type { InputState } from './Input.ts';

const MIN_SPEED = 34;
const MAX_SPEED = 210;
const STALL_SPEED = 40;

export class Aircraft implements Damageable {
  readonly team: Team = 'player';
  readonly object: THREE.Group;
  readonly radius = 3.2;

  health = 100;
  maxHealth = 100;
  alive = true;

  speed = 90;
  velocity = new THREE.Vector3();
  quaternion = new THREE.Quaternion();

  rollAngle = 0;
  pitchRate = 0;
  yawRate = 0;

  gunCooldown = 0;
  missileCooldown = 0;
  missileAmmo = 8;

  private engineLight: THREE.PointLight;
  private trailPositions: Float32Array;
  private trailHead = 0;
  private trailPoints: THREE.Points;
  private trailCount = 40;
  private damageFlash = 0;

  constructor(scene: THREE.Scene) {
    this.object = buildJet(0x8b95a1, 0xff9d3d);
    this.object.position.set(0, 140, -150);
    scene.add(this.object);

    this.engineLight = buildEngineGlow(0xff8a3d);
    this.engineLight.position.set(0, 0, 5);
    this.object.add(this.engineLight);

    this.trailPositions = new Float32Array(this.trailCount * 3);
    for (let i = 0; i < this.trailCount; i++) {
      this.trailPositions[i * 3] = this.object.position.x;
      this.trailPositions[i * 3 + 1] = this.object.position.y;
      this.trailPositions[i * 3 + 2] = this.object.position.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xdfe8ff,
      size: 1.6,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    this.trailPoints = new THREE.Points(geo, mat);
    scene.add(this.trailPoints);

    this.object.quaternion.identity();
    this.quaternion.copy(this.object.quaternion);
  }

  get position(): THREE.Vector3 {
    return this.object.position;
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.object.quaternion);
  }

  get speedRatio(): number {
    return clamp((this.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED), 0, 1);
  }

  applyDamage(amount: number): void {
    if (!this.alive) return;
    this.health = clamp(this.health - amount, 0, this.maxHealth);
    this.damageFlash = 1;
    if (this.health <= 0) {
      this.alive = false;
    }
  }

  get flashIntensity(): number {
    return this.damageFlash;
  }

  update(dt: number, input: InputState) {
    if (!this.alive) return;

    const targetSpeed = lerp(MIN_SPEED, MAX_SPEED, input.throttle);
    this.speed = damp(this.speed, targetSpeed, 1.4, dt);

    const rollInput = clamp(input.roll, -1, 1);
    const pitchInput = clamp(input.pitch, -1, 1);
    const yawInput = clamp(input.yaw, -1, 1);

    const rollSpeed = 2.1;
    this.rollAngle = damp(this.rollAngle, rollInput * 1.05, 6, dt);

    const pitchRateTarget = pitchInput * 0.85;
    this.pitchRate = damp(this.pitchRate, pitchRateTarget, 6, dt);

    const coordinatedYaw = -this.rollAngle * 0.55;
    const yawRateTarget = yawInput * 0.6 + coordinatedYaw;
    this.yawRate = damp(this.yawRate, yawRateTarget, 5, dt);

    const rollDelta = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, -1), rollInput * rollSpeed * dt);
    const pitchDelta = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.pitchRate * dt);
    const yawDelta = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yawRate * dt);

    this.object.quaternion.multiply(yawDelta).multiply(pitchDelta).multiply(rollDelta);
    this.object.quaternion.normalize();

    const forward = this.forward;
    const stallPenalty = this.speed < STALL_SPEED ? (STALL_SPEED - this.speed) * 0.6 : 0;
    this.object.position.addScaledVector(forward, this.speed * dt);
    this.object.position.y -= stallPenalty * dt;

    this.quaternion.copy(this.object.quaternion);

    // engine glow scales with throttle
    this.engineLight.intensity = lerp(1.5, 5, input.throttle);

    // trail
    this.trailHead = (this.trailHead + 1) % this.trailCount;
    const tailPos = this.object.position.clone().addScaledVector(forward, 4.2);
    this.trailPositions[this.trailHead * 3] = tailPos.x;
    this.trailPositions[this.trailHead * 3 + 1] = tailPos.y;
    this.trailPositions[this.trailHead * 3 + 2] = tailPos.z;
    (this.trailPoints.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.trailPoints.material as THREE.PointsMaterial).opacity = lerp(0.1, 0.45, input.throttle);

    this.gunCooldown = Math.max(0, this.gunCooldown - dt);
    this.missileCooldown = Math.max(0, this.missileCooldown - dt);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.2);
  }

  canFireGun(): boolean {
    return this.gunCooldown <= 0 && this.alive;
  }

  fireGun() {
    this.gunCooldown = 0.09;
  }

  canFireMissile(): boolean {
    return this.missileCooldown <= 0 && this.missileAmmo > 0 && this.alive;
  }

  fireMissile() {
    this.missileCooldown = 0.6;
    this.missileAmmo -= 1;
  }

  gunMuzzle(): THREE.Vector3 {
    return this.object.position.clone().addScaledVector(this.forward, 4.5);
  }

  reset(scene: THREE.Scene) {
    void scene;
    this.health = this.maxHealth;
    this.alive = true;
    this.speed = 90;
    this.rollAngle = 0;
    this.pitchRate = 0;
    this.yawRate = 0;
    this.missileAmmo = 8;
    this.gunCooldown = 0;
    this.missileCooldown = 0;
    this.object.position.set(0, 140, -150);
    this.object.quaternion.identity();
    this.quaternion.copy(this.object.quaternion);
  }
}
