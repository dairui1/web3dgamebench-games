// Mission flow: objectives, primary-target quota, air-wave spawns and the
// extraction zone.

import * as THREE from 'three';
import type { Enemies } from './enemies';
import type { Canyon } from './canyon';
import type { Target } from './types';
import type { AudioFX } from './audio';
import { buildExtractionBeacon } from './models';

export const PRIMARY_QUOTA = 5;

export class Mission {
  phase: 'strike' | 'extract' | 'over' = 'strike';
  primaryTotal = 0;
  primaryKilled = 0;
  kills = 0;
  beacon: THREE.Object3D | null = null;
  private wave1 = false;
  private wave2 = false;
  private wave3 = false;
  private enemies: Enemies;
  private canyon: Canyon;
  private audio: AudioFX;
  private scene: THREE.Scene;
  extractionPos = new THREE.Vector3(0, 0, -4900);

  constructor(enemies: Enemies, canyon: Canyon, audio: AudioFX, scene: THREE.Scene) {
    this.enemies = enemies;
    this.canyon = canyon;
    this.audio = audio;
    this.scene = scene;
  }

  setupGroundForces(): void {
    this.primaryTotal = 0;
    const samFracs = [0.07, 0.15, 0.24, 0.33, 0.42, 0.51, 0.61];
    for (const f of samFracs) {
      this.enemies.spawnGround('sam', f, true);
      this.primaryTotal++;
    }
    const aaFracs = [0.105, 0.19, 0.3, 0.46, 0.58];
    for (const f of aaFracs) this.enemies.spawnGround('aa', f, false);
    const radarFracs = [0.045, 0.27, 0.44, 0.56, 0.66];
    for (const f of radarFracs) this.enemies.spawnGround('radar', f, false);
    const mortarFracs = [0.36, 0.54, 0.64];
    for (const f of mortarFracs) this.enemies.spawnGround('mortar', f, false);
    // patrol scout
    this.enemies.spawnFighter(0.17, 0, 0);
  }

  /** Spawn air waves as the strike progresses; returns a warning string. */
  spawnWaves(playerS: number): string | null {
    const alive = this.enemies.targets.filter((t) => t.kind === 'fighter' && t.alive).length;
    const cap = 4;
    if (alive >= cap) return null;
    let warn: string | null = null;
    if (!this.wave1 && this.primaryKilled >= 1) {
      this.wave1 = true;
      this.enemies.spawnFighter(Math.min(1, playerS + 0.13), -180, 60);
      this.enemies.spawnFighter(Math.min(1, playerS + 0.17), 160, 30);
      warn = '⚠ BANDITS INBOUND — CANYON AHEAD';
    }
    if (!this.wave2 && this.primaryKilled >= 2 && alive < cap) {
      this.wave2 = true;
      const s1 = Math.max(0, playerS - 0.06);
      this.enemies.spawnFighter(s1, -140, -20);
      this.enemies.spawnFighter(Math.max(0, s1 - 0.03), 120, 10);
      warn = '⚠ BANDITS ON YOUR SIX';
    }
    if (!this.wave3 && this.primaryKilled >= 4) {
      this.wave3 = true;
      const s2 = Math.min(1, playerS + 0.09);
      this.enemies.spawnFighter(s2, -120, 80);
      this.enemies.spawnFighter(s2 + 0.02, 140, 40);
      warn = '⚠ MORE BANDITS — FINAL PUSH';
    }
    return warn;
  }

  onTargetKilled(t: Target, byPlayer: boolean): void {
    if (!byPlayer) return;
    this.kills++;
    if (t.primary) this.primaryKilled++;
  }

  /** Called every frame; returns objective string for the HUD. */
  update(playerS: number): string {
    if (this.phase === 'extract' || this.phase === 'over') {
      return 'STRIKE COMPLETE — REACH THE EXTRACTION ZONE';
    }
    if (this.primaryKilled >= PRIMARY_QUOTA) {
      this.phase = 'extract';
      // build beacon
      const s = this.canyon.sampleAt(0.985 * this.canyon.samples);
      const terrainY = this.canyon.heightAt(s.x, s.z);
      this.extractionPos.set(s.x, terrainY + 1, s.z);
      this.beacon = buildExtractionBeacon();
      this.beacon.position.copy(this.extractionPos);
      this.scene.add(this.beacon);
      this.audio.missionComplete();
    }
    return `STRIKE  ${this.primaryKilled}/${PRIMARY_QUOTA} SAM BATTERIES DESTROYED`;
  }

  updateBeacon(time: number, dt: number): void {
    if (!this.beacon) return;
    const ring = this.beacon.userData.ring as THREE.Mesh | undefined;
    if (ring) {
      ring.scale.setScalar(1 + Math.sin(time * 2.2) * 0.06);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.sin(time * 4) * 0.35;
    }
    const beam = this.beacon.userData.beam as THREE.Mesh | undefined;
    if (beam) {
      (beam.material as THREE.MeshBasicMaterial).opacity = 0.1 + Math.sin(time * 2.4) * 0.06;
    }
    void dt;
  }
}