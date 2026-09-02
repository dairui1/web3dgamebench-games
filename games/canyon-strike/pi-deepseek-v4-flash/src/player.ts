// Player aircraft state & arcade flight model.

import * as THREE from 'three';
import { clamp, damp, lerp } from './math';
import type { InputState } from './input';

export interface PlayerState {
  alive: boolean;
  crashed: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  speed: number; // m/s
  hp: number;
  maxHp: number;
  missiles: number;
  flares: number;
  gunHeat: number; // 0..1
  stun: number; // control jitter timer
  smokeAcc: number;
  lockTime: number; // current lock acquisition
  target: { kind: string; dist: number; name: string; mesh: THREE.Object3D; pos: THREE.Vector3; hp: number; maxHp: number; alive: boolean; primary: boolean } | null;
  autoThrottle: boolean;
  time: number;
}

export const PLAYER_MAX_MISSILES = 44;
export const PLAYER_MAX_FLARES = 14;
export const PLAYER_MAX_HP = 100;

export class Player {
  s: PlayerState;
  private quat = new THREE.Quaternion();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private fwd = new THREE.Vector3(0, 0, -1);
  private up = new THREE.Vector3(0, 1, 0);
  private right = new THREE.Vector3(1, 0, 0);

  constructor() {
    this.s = {
      alive: true,
      crashed: false,
      pos: new THREE.Vector3(0, 120, 4900),
      vel: new THREE.Vector3(0, 0, -80),
      yaw: 0,
      pitch: 0,
      roll: 0,
      speed: 130,
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      missiles: PLAYER_MAX_MISSILES,
      flares: PLAYER_MAX_FLARES,
      gunHeat: 0,
      stun: 0,
      smokeAcc: 0,
      lockTime: 0,
      target: null,
      autoThrottle: true,
      time: 0,
    };
  }

  /** Fill in world state (forward, right, up vectors + world height for ground clamp). */
  update(dt: number, input: InputState, heightAt: (x: number, z: number) => number): boolean {
    const s = this.s;
    if (!s.alive) return false;
    s.time += dt;

    const auto = input.autoThrottle;
    s.autoThrottle = auto;
    let throttle = auto ? 0.58 : input.throttle;
    // manual throttle adjust
    if (input.throttleRaised) throttle += 0.55 * dt;
    if (input.throttleLowered) throttle -= 0.55 * dt;
    throttle = clamp(throttle, 0, 1);
    input.throttle = throttle;

    const stunMul = s.stun > 0 ? lerp(0.35, 1, 1 - s.stun / 1.2) : 1;
    const stunJitter = s.stun > 0 ? Math.sin(s.time * 40) * 0.22 * stunMul : 0;
    const pIn = clamp(input.pitch + stunJitter, -1, 1);
    const rIn = clamp(input.roll, -1, 1);

    // Pitch rate
    const maxPitchRate = 1.25;
    const targetPitchVel = -pIn * maxPitchRate;
    this.pitchVel = damp(this.pitchVel, targetPitchVel, 0.14, dt);
    s.pitch = clamp(s.pitch + this.pitchVel * dt, -1.25, 1.25);
    // Roll rate
    const maxRollRate = 2.6;
    const targetRollVel = rIn * maxRollRate;
    this.rollVel = damp(this.rollVel, targetRollVel, 0.12, dt);
    s.roll = clamp(s.roll + this.rollVel * dt, -Math.PI, Math.PI);
    if (Math.abs(rIn) < 0.05) {
      // ease back to level
      const level = -s.roll;
      const recover = clamp(level * 2.2 * dt, -2.4 * dt, 2.4 * dt);
      s.roll = clamp(s.roll + recover, -Math.PI, Math.PI);
    }

    // Bank-to-turn yaw
    const speedNorm = clamp(s.speed / 240, 0.2, 1);
    const yawRate = -Math.sin(s.roll) * 1.15 * speedNorm * (1 + rIn * 0.25);
    s.yaw += yawRate * dt;

    // Speed model
    const targetSpeed = 55 + throttle * 300;
    const accel = throttle > 0.02 ? 0.32 : 0.24;
    const brake = s.pitch > 0.05 ? 1 + Math.sin(s.pitch) * 0.55 : 1; // climb penalty
    s.speed = damp(s.speed, targetSpeed, accel * brake * 2.4, dt);

    // Orient
    this.euler.set(s.pitch, s.yaw, s.roll);
    this.quat.setFromEuler(this.euler);
    this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.right.set(1, 0, 0).applyQuaternion(this.quat);

    // Velocity toward desired
    const desired = this.fwd.clone().multiplyScalar(s.speed);
    const tau = 0.42;
    const k = 1 - Math.exp(-dt / tau);
    s.vel.lerp(desired, k);

    // Integrate
    s.pos.addScaledVector(s.vel, dt);

    // Keep the player inside the playable world
    s.pos.x = clamp(s.pos.x, -7800, 7800);
    s.pos.z = clamp(s.pos.z, -5050, 5050);

    // Terrain collision
    const land = heightAt(s.pos.x, s.pos.z);
    if (s.pos.y < land + 1.6) {
      s.alive = false;
      s.crashed = true;
      return true;
    }
    // Hard ceiling
    if (s.pos.y > 3600) s.pos.y = 3600;

    s.stun = Math.max(0, s.stun - dt);
    this.pitchVel *= 1;
    return false;
  }

  /** Horizontal distance from canyon centerline (for targeting laser calls). */
  getForward(out: THREE.Vector3): THREE.Vector3 {
    this.euler.set(this.s.pitch, this.s.yaw, 0);
    this.quat.setFromEuler(this.euler);
    return out.set(0, 0, -1).applyQuaternion(this.quat);
  }

  pitchVel = 0;
  rollVel = 0;
}