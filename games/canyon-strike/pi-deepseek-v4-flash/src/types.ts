// Shared entity types for the simulation.

import * as THREE from 'three';

export type GroundKind = 'sam' | 'aa' | 'radar' | 'mortar';
export type TargetKind = GroundKind | 'fighter';

export interface Target {
  kind: TargetKind;
  name: string;
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Counts toward the strike quota. */
  primary: boolean;
  marker: THREE.Object3D | null;
  // AI timers / state
  fireCd: number;
  losTimer: number;
  moved: THREE.Vector3; // scratch
  prevPos: THREE.Vector3;
  // ground-only
  turret?: THREE.Object3D;
  // air-only fields
  air?: AirState;
}

export interface AirState {
  wpt: number;
  mode: 'patrol' | 'engage' | 'attack' | 'recover';
  burstTimer: number;
  gunAcc: number;
  shootCd: number;
  missileCd: number;
  speed: number;
  yaw: number;
  pitch: number;
  homeAlt: number;
  dir: THREE.Vector3; // current travel dir (normalized)
}

export interface PlayerMissile {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  target: Target | null;
  life: number;
  dead: boolean;
  smokeAcc: number;
  userData?: Record<string, unknown>;
}

export interface EnemyMissile {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  targetIsPlayer: boolean; // false → chasing a flare
  flarePos: THREE.Vector3 | null;
  targetPos: THREE.Vector3;
  life: number;
  dead: boolean;
  alerted: boolean;
  smokeAcc: number;
  obj: THREE.Object3D | null;
}

export interface Tracer {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  kill: boolean;
  fromEnemy: boolean;
  damage: number;
  obj: THREE.Object3D | null;
}

export interface MortarShell {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  obj: THREE.Object3D | null;
  target: THREE.Vector3;
}

export interface Flare {
  obj: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  bright: number;
}

export interface Debris {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  life: number;
  rot: THREE.Vector3;
}

import type { Canyon } from './canyon';
import type { Effects } from './effects';
import type { AudioFX } from './audio';
import type { Player } from './player';

/** Contract the simulation systems use to talk to the Game. */
export interface GameAPI {
  canyon: Canyon;
  effects: Effects;
  audio: AudioFX;
  targets: Target[];
  player: Player;
  scene: THREE.Scene;
  onTargetDamaged(t: Target, amount: number, byPlayer: boolean): void;
  onTargetKilled(t: Target, byPlayer: boolean, cause: string): void;
  addShake(amount: number): void;
  hudFlash(label: string): void;
  flaresRef: Flare[];
  cameraPos: THREE.Vector3;
  isMissionOver(): boolean;
  tracerObjs: { obj: THREE.Object3D; life: number }[];
}