export type Phase = 'ready' | 'playing' | 'paused' | 'won' | 'lost';

export interface AetherPlayState {
  phase: Phase;
  score: number;
  player: { x: number; y: number; z: number };
  relaysRestored: number;
  charge: number;
  seed: number;
  restartCount: number;
  progress: number;
  speed: number;
}
