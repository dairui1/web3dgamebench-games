import * as THREE from 'three';
import type { Effects } from './effects';
import type { AudioBus } from '../core/audio';

export type Faction = 'player' | 'enemy';

export type TargetKind =
  | 'player'
  | 'fighter'
  | 'radar'
  | 'depot'
  | 'bunker'
  | 'hangar'
  | 'sam'
  | 'aaa';

export type DamageSource = 'gun' | 'missile' | 'crash' | 'collision';

export interface Combatant {
  readonly id: number;
  readonly kind: TargetKind;
  readonly faction: Faction;
  /** Callsign / label shown in the HUD. */
  readonly label: string;
  /** Mission-critical strike objective. */
  readonly isObjective: boolean;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly radius: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Missiles only lock onto entities that are lockable (alive + not wrecked). */
  lockable: boolean;
  damage(amount: number, source: DamageSource, from?: THREE.Vector3): void;
}

export interface Flare {
  position: THREE.Vector3;
  life: number;
}

export interface CombatContext {
  scene: THREE.Scene;
  effects: Effects;
  audio: AudioBus;
  /** All live combatants, both factions. */
  combatants: Combatant[];
  flares: Flare[];
  /** Camera position, used for sound attenuation. */
  listener: THREE.Vector3;
  terrainHeight(x: number, z: number): number;
  shake(amount: number): void;
  notifyHit(target: Combatant, byPlayer: boolean, killed: boolean, source: DamageSource): void;
  notifyIncoming(dist: number): void;
}

let nextId = 1;
export function makeId(): number {
  return nextId++;
}
export function resetIds(): void {
  nextId = 1;
}
