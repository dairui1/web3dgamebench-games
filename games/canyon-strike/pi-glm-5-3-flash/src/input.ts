// Unified input: keyboard, mouse and touch (virtual joystick + buttons).
// Produces a normalized control state consumed by the flight model.

import { clamp } from './utils';

export interface InputState {
  /** +1 = pull up (nose rises), -1 = push down */
  pitch: number;
  /** +1 = roll right, -1 = roll left */
  roll: number;
  /** +1 = yaw right, -1 = yaw left */
  yaw: number;
  /** throttle target 0..1 adjusted by player */
  throttle: number;
  fireGun: boolean;
  fireMissile: boolean;
  /** true on the frame missile fire was requested (edge) */
  missilePressed: boolean;
  /** any pointer/keyboard activity since last reset (for audio unlock) */
  anyActivity: boolean;
}

const KEY_PITCH_UP = ['arrowup', 'w'];
const KEY_PITCH_DOWN = ['arrowdown', 's'];

export class InputManager {
  readonly state: InputState = {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttle: 0.65,
    fireGun: false,
    fireMissile: false,
    missilePressed: false,
    anyActivity: false,
  };

  private keys = new Set<string>();
  private touchPitch = 0;
  private touchRoll = 0;
  private touchGun = false;
  private touchMissile = false;
  private mouseGun = false;
  private mouseMissile = false;

  private joyOrigin: { x: number; y: number } | null = null;
  private joyPointer = -1;

  private throttleTouchTimer: number | null = null;

  constructor(private root: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('pointerdown', this.onPointerDown);
    root.addEventListener('pointerup', this.onPointerUp);
    root.addEventListener('pointercancel', this.onPointerUp);
    this.buildTouchControls();
  }

  // --- keyboard / mouse -------------------------------------------------

  private onKeyDown = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (
      k === ' ' ||
      k === 'arrowup' ||
      k === 'arrowdown' ||
      k === 'arrowleft' ||
      k === 'arrowright'
    ) {
      e.preventDefault();
    }
    this.keys.add(k);
    this.state.anyActivity = true;
    if (k === 'f' || k === 'enter') this.state.missilePressed = true;
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.mouseGun = false;
    this.mouseMissile = false;
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return; // touch UI handles itself
    if ((e.target as HTMLElement)?.dataset?.uiButton) return;
    this.state.anyActivity = true;
    if (e.button === 0) this.mouseGun = true;
    if (e.button === 2) {
      this.mouseMissile = true;
      this.state.missilePressed = true;
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    if (e.button === 0) this.mouseGun = false;
    if (e.button === 2) this.mouseMissile = false;
  };

  // --- touch controls ----------------------------------------------------

  private buildTouchControls(): void {
    const isTouch =
      'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
    if (!isTouch) return;

    const layer = document.createElement('div');
    layer.id = 'touch-layer';

    // Virtual joystick (left side)
    const joy = document.createElement('div');
    joy.id = 'touch-joystick';
    const stick = document.createElement('div');
    stick.id = 'touch-stick';
    joy.appendChild(stick);
    layer.appendChild(joy);

    joy.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        if (this.joyPointer !== -1) return;
        this.joyPointer = e.pointerId;
        const rect = joy.getBoundingClientRect();
        this.joyOrigin = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
        joy.setPointerCapture(e.pointerId);
      },
      { passive: false },
    );
    joy.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joyPointer || !this.joyOrigin) return;
      const dx = e.clientX - this.joyOrigin.x;
      const dy = e.clientY - this.joyOrigin.y;
      const max = 58;
      const nx = clamp(dx / max, -1, 1);
      const ny = clamp(dy / max, -1, 1);
      this.touchRoll = nx;
      this.touchPitch = -ny; // dragging down pulls up (classic flight)
      stick.style.transform = `translate(${nx * max * 0.6}px, ${ny * max * 0.6}px)`;
    });
    const joyEnd = (e: PointerEvent): void => {
      if (e.pointerId !== this.joyPointer) return;
      this.joyPointer = -1;
      this.joyOrigin = null;
      this.touchPitch = 0;
      this.touchRoll = 0;
      stick.style.transform = 'translate(0px, 0px)';
    };
    joy.addEventListener('pointerup', joyEnd);
    joy.addEventListener('pointercancel', joyEnd);

    // Action buttons (right side)
    const mkBtn = (label: string, id: string): HTMLDivElement => {
      const b = document.createElement('div');
      b.className = 'touch-btn';
      b.id = id;
      b.dataset.uiButton = '1';
      b.textContent = label;
      return b;
    };
    const gun = mkBtn('GUN', 'touch-gun');
    const msl = mkBtn('MSL', 'touch-msl');
    const faster = mkBtn('SPD+', 'touch-fast');
    const slower = mkBtn('SPD-', 'touch-slow');
    layer.appendChild(gun);
    layer.appendChild(msl);
    layer.appendChild(faster);
    layer.appendChild(slower);

    gun.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      gun.setPointerCapture(e.pointerId);
      this.touchGun = true;
      this.state.anyActivity = true;
    });
    const gunEnd = (): void => {
      this.touchGun = false;
    };
    gun.addEventListener('pointerup', gunEnd);
    gun.addEventListener('pointercancel', gunEnd);

    msl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.touchMissile = true;
      this.state.missilePressed = true;
      this.state.anyActivity = true;
    });
    const mslEnd = (): void => {
      this.touchMissile = false;
    };
    msl.addEventListener('pointerup', mslEnd);
    msl.addEventListener('pointercancel', mslEnd);

    const holdThrottle = (el: HTMLDivElement, delta: number): void => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        this.state.anyActivity = true;
        const step = (): void => {
          this.state.throttle = clamp(this.state.throttle + delta * 0.04, 0, 1);
          this.throttleTouchTimer = window.setTimeout(step, 50);
        };
        step();
      });
      const stop = (): void => {
        if (this.throttleTouchTimer !== null) {
          clearTimeout(this.throttleTouchTimer);
          this.throttleTouchTimer = null;
        }
      };
      el.addEventListener('pointerup', stop);
      el.addEventListener('pointercancel', stop);
    };
    holdThrottle(faster, 1);
    holdThrottle(slower, -1);

    this.root.appendChild(layer);
  }

  // --- per-frame ----------------------------------------------------------

  /** Recompute the aggregate input state. Call once per frame before use. */
  update(dt: number): void {
    const s = this.state;
    const keyPitchUp = KEY_PITCH_UP.some((k) => this.keys.has(k)) ? 1 : 0;
    const keyPitchDown = KEY_PITCH_DOWN.some((k) => this.keys.has(k)) ? 1 : 0;
    const keyRollL = this.keys.has('arrowleft') || this.keys.has('a') ? 1 : 0;
    const keyRollR = this.keys.has('arrowright') || this.keys.has('d') ? 1 : 0;
    const keyYawL = this.keys.has('q') ? 1 : 0;
    const keyYawR = this.keys.has('e') ? 1 : 0;

    s.pitch = clamp(this.touchPitch + keyPitchUp - keyPitchDown, -1, 1);
    s.roll = clamp(this.touchRoll + keyRollR - keyRollL, -1, 1);
    s.yaw = clamp(keyYawR - keyYawL, -1, 1);

    if (this.keys.has('shift')) s.throttle = clamp(s.throttle + dt * 0.6, 0, 1);
    if (this.keys.has('control')) s.throttle = clamp(s.throttle - dt * 0.6, 0, 1);

    s.fireGun = this.keys.has(' ') || this.mouseGun || this.touchGun;
    s.fireMissile = this.touchMissile;
  }

  consumeMissilePress(): boolean {
    const p = this.state.missilePressed;
    this.state.missilePressed = false;
    return p;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
