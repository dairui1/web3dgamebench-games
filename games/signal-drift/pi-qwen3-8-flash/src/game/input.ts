import { clamp } from './util';

export type Command = 'begin' | 'pause' | 'resume' | 'restart' | 'mute';

export interface AxisState {
  /** -1 left .. 1 right */
  yaw: number;
  /** -1 dive .. 1 climb */
  pitch: number;
  /** -1 left .. 1 right */
  roll: number;
  /** -1 slow .. 1 fast */
  throttle: number;
  boost: boolean;
  brake: boolean;
  /** Analog magnitude 0..1 of pointer steering (used for HUD stick). */
  stickMag: number;
  stickX: number;
  stickY: number;
}

const KEY_ROLES: Record<string, keyof AxisState | 'yaw-' | 'yaw+' | 'pitch-' | 'pitch+' | 'roll-' | 'roll+' | 'throttle-' | 'throttle+'> = {
  KeyA: 'yaw-',
  ArrowLeft: 'yaw-',
  KeyD: 'yaw+',
  ArrowRight: 'yaw+',
  KeyW: 'pitch+',
  ArrowUp: 'pitch+',
  KeyS: 'pitch-',
  ArrowDown: 'pitch-',
  KeyQ: 'roll-',
  KeyE: 'roll+',
  ShiftLeft: 'boost',
  ShiftRight: 'boost',
  Space: 'brake',
};

const PREVENT = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Space',
  'KeyA',
  'KeyD',
  'KeyW',
  'KeyS',
  'KeyQ',
  'KeyE',
]);

interface PointerTrack {
  id: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
  role: 'steer' | 'throttle';
}

/** Keyboard + pointer/touch steering. Produces an AxisState the sim smooths. */
export class InputManager {
  readonly axis: AxisState = {
    yaw: 0,
    pitch: 0,
    roll: 0,
    throttle: 0,
    boost: false,
    brake: false,
    stickMag: 0,
    stickX: 0,
    stickY: 0,
  };

  touchMode = false;
  private keys = new Set<string>();
  private pointers = new Map<number, PointerTrack>();
  private stickRadius = 78;
  private onCommand: (cmd: Command) => void = () => {};
  private surface: HTMLElement | null = null;
  private boostHeld = false;
  private brakeHeld = false;
  private stickAnchor: { x: number; y: number } | null = null;

  constructor(private controls: {
    steerZones: HTMLElement | null;
    boost: HTMLElement | null;
    brake: HTMLElement | null;
    stick: HTMLElement | null;
  }) {}

  attach(surface: HTMLElement, onCommand: (cmd: Command) => void): void {
    this.surface = surface;
    this.onCommand = onCommand;
    this.detectMode();

    window.addEventListener('keydown', this.handleKeyDown, { passive: false });
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    window.addEventListener('touchstart', () => this.detectMode(true), { passive: true, once: true });

    if (this.controls.steerZones) {
      const zones = this.controls.steerZones;
      zones.addEventListener('pointerdown', this.handlePointerDown);
      zones.addEventListener('pointermove', this.handlePointerMove);
      zones.addEventListener('pointerup', this.handlePointerUp);
      zones.addEventListener('pointercancel', this.handlePointerUp);
      zones.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    const hold = (el: HTMLElement | null, setter: (v: boolean) => void) => {
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        setter(true);
      });
      const release = () => setter(false);
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('pointerleave', release);
    };
    hold(this.controls.boost, (v) => (this.boostHeld = v));
    hold(this.controls.brake, (v) => (this.brakeHeld = v));
  }

  detach(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    if (this.surface) this.surface.removeEventListener('pointerdown', this.beginFromClick);
  }

  private beginFromClick = (): void => {};

  private detectMode(force = false): void {
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const narrow = window.innerWidth <= 820;
    const smallHeight = window.innerHeight <= 700 && narrow;
    if (force || coarse || narrow || smallHeight) this.touchMode = true;
    else this.touchMode = false;
  }

  recheckMode(): void {
    this.detectMode();
  }

  private handleBlur = (): void => {
    this.keys.clear();
    this.pointers.clear();
    this.boostHeld = false;
    this.brakeHeld = false;
    this.stickAnchor = null;
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.repeat) {
      if (PREVENT.has(e.code)) e.preventDefault();
      return;
    }
    if (PREVENT.has(e.code) && !e.metaKey && !e.ctrlKey) e.preventDefault();
    this.keys.add(e.code);
    if (e.code === 'Enter') this.onCommand('begin');
    if (e.code === 'KeyP' || e.code === 'Escape') this.onCommand('pause');
    if (e.code === 'KeyR') this.onCommand('restart');
    if (e.code === 'KeyM') this.onCommand('mute');
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private handlePointerDown = (e: PointerEvent): void => {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const role: PointerTrack['role'] = relX < rect.width * 0.52 ? 'steer' : 'throttle';
    if (role === 'steer' && this.pointers.size >= 1) return;
    if (role === 'throttle' && [...this.pointers.values()].some((p) => p.role === 'throttle')) return;
    el.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, {
      id: e.pointerId,
      originX: e.clientX,
      originY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      role,
    });
    if (role === 'steer') {
      this.stickAnchor = { x: e.clientX, y: e.clientY };
      if (this.controls.stick) {
        this.controls.stick.style.opacity = '1';
        this.controls.stick.style.left = `${e.clientX}px`;
        this.controls.stick.style.top = `${e.clientY}px`;
      }
    }
  };

  private handlePointerMove = (e: PointerEvent): void => {
    const track = this.pointers.get(e.pointerId);
    if (!track) return;
    track.x = e.clientX;
    track.y = e.clientY;
  };

  private handlePointerUp = (e: PointerEvent): void => {
    const track = this.pointers.get(e.pointerId);
    if (!track) return;
    this.pointers.delete(e.pointerId);
    if (track.role === 'steer') {
      this.stickAnchor = null;
      if (this.controls.stick) this.controls.stick.style.opacity = '0';
    }
  };

  /** Combine keyboard, pointer and touch into the analog axis state. */
  sample(dt: number): AxisState {
    let yaw = 0;
    let pitch = 0;
    let roll = 0;
    let throttle = 0;
    let boost = this.boostHeld;
    let brake = this.brakeHeld;

    for (const code of this.keys) {
      const role = KEY_ROLES[code];
      if (!role) continue;
      switch (role) {
        case 'yaw-':
          yaw -= 1;
          break;
        case 'yaw+':
          yaw += 1;
          break;
        case 'pitch+':
          pitch += 1;
          break;
        case 'pitch-':
          pitch -= 1;
          break;
        case 'roll-':
          roll -= 1;
          break;
        case 'roll+':
          roll += 1;
          break;
        case 'throttle+':
          throttle += 1;
          break;
        case 'throttle-':
          throttle -= 1;
          break;
        case 'boost':
          boost = true;
          break;
        case 'brake':
          brake = true;
          break;
        default:
          break;
      }
    }

    for (const track of this.pointers.values()) {
      const dx = track.x - track.originX;
      const dy = track.y - track.originY;
      if (track.role === 'steer') {
        yaw = clamp(dx / this.stickRadius, -1, 1);
        pitch = clamp(-dy / this.stickRadius, -1, 1);
        brake = brake || dy > this.stickRadius * 1.5;
      } else {
        throttle = clamp(-dy / (this.stickRadius * 1.2), -1, 1);
      }
    }

    const target = {
      yaw: clamp(yaw, -1, 1),
      pitch: clamp(pitch, -1, 1),
      roll: clamp(roll, -1, 1),
      throttle: clamp(throttle, -1, 1),
    };
    const a = this.axis;
    a.yaw = target.yaw;
    a.pitch = target.pitch;
    a.roll = target.roll;
    a.throttle = target.throttle;
    a.boost = boost;
    a.brake = brake;
    a.stickX = target.yaw;
    a.stickY = -target.pitch;
    a.stickMag = clamp(Math.hypot(target.yaw, target.pitch), 0, 1);
    void dt;
    return a;
  }

  get stickPosition(): { x: number; y: number } | null {
    return this.stickAnchor;
  }

  clear(): void {
    this.keys.clear();
    this.pointers.clear();
    this.boostHeld = false;
    this.brakeHeld = false;
    this.stickAnchor = null;
    if (this.controls.stick) this.controls.stick.style.opacity = '0';
  }
}
