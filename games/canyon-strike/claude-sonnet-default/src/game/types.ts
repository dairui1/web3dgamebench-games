import * as THREE from 'three';

export type Team = 'player' | 'enemy';

export interface Damageable {
  readonly team: Team;
  readonly object: THREE.Object3D;
  readonly alive: boolean;
  readonly radius: number;
  applyDamage(amount: number, sourcePos?: THREE.Vector3): void;
}

export interface Targetable extends Damageable {
  readonly kind: string;
  readonly position: THREE.Vector3;
  readonly displayName: string;
}

export type GameState = 'briefing' | 'playing' | 'win' | 'lose';
