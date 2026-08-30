import { clamp } from './rng';

type Action = 'start' | 'restart' | 'pause' | 'mute';

/**
 * Unified keyboard / pointer / touch input. Steering is reported as two axes
 * in [-1, 1] regardless of the device that produced it.
 */
export class Input {
  steer = 0;
  climb = 0;
  boost = false;
  brake = false;
  usingTouch = false;

  private readonly keys = new Set<string>();
  private touchSteer = 0;
  private touchClimb = 0;
  private touchBoost = false;
  private brakeTouch = false;
  private stickId: number | null = null;
  private stickX = 0;
  private stickY = 0;
  private listeners: Array<() => void> = [];

  onAction: ((action: Action) => void) | null = null;
  onFirstGesture: (() => void) | null = null;
  onStickMove:
    | ((originX: number, originY: number, knobX: number, knobY: number, active: boolean) => void)
    | null = null;
  onTouchDetected: (() => void) | null = null;

  private gestureSeen = false;

  constructor(
    private readonly surface: HTMLElement,
    private readonly stickRadius = 62,
  ) {
    const keydown = (e: KeyboardEvent) => {
      if (e.repeat) {
        if (this.isGameKey(e.code)) e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      this.gesture();
      switch (e.code) {
        case 'Enter':
        case 'Space':
          this.fire('start');
          break;
        case 'KeyR':
          this.fire('restart');
          break;
        case 'Escape':
        case 'KeyP':
          this.fire('pause');
          break;
        case 'KeyM':
          this.fire('mute');
          break;
      }
      if (this.isGameKey(e.code)) e.preventDefault();
    };
    const keyup = (e: KeyboardEvent) => this.keys.delete(e.code);
    const blur = () => this.keys.clear();

    window.addEventListener('keydown', keydown, { passive: false });
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    this.listeners.push(() => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
    });

    const down = (e: PointerEvent) => {
      this.gesture();
      if (e.pointerType === 'touch' || e.pointerType === 'pen') this.markTouch();
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      this.stickX = e.clientX;
      this.stickY = e.clientY;
      this.onStickMove?.(e.clientX, e.clientY, e.clientX, e.clientY, true);
      surface.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      const dx = e.clientX - this.stickX;
      const dy = e.clientY - this.stickY;
      this.touchSteer = clamp(dx / this.stickRadius, -1, 1);
      this.touchClimb = clamp(-dy / this.stickRadius, -1, 1);
      this.onStickMove?.(
        this.stickX,
        this.stickY,
        this.stickX + clamp(dx, -this.stickRadius, this.stickRadius),
        this.stickY + clamp(dy, -this.stickRadius, this.stickRadius),
        true,
      );
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.touchSteer = 0;
      this.touchClimb = 0;
      this.onStickMove?.(0, 0, 0, 0, false);
    };

    surface.addEventListener('pointerdown', down);
    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerup', up);
    surface.addEventListener('pointercancel', up);
    surface.addEventListener('lostpointercapture', up);
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
    this.listeners.push(() => {
      surface.removeEventListener('pointerdown', down);
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerup', up);
      surface.removeEventListener('pointercancel', up);
      surface.removeEventListener('lostpointercapture', up);
    });

    const touchStart = () => this.markTouch();
    window.addEventListener('touchstart', touchStart, { passive: true });
    this.listeners.push(() => window.removeEventListener('touchstart', touchStart));

    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const touchCapable = (navigator.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in window;
    if (coarse || (touchCapable && window.innerWidth < 900)) this.usingTouch = true;
  }

  /** Re-check on resize: a narrow viewport on a touch device gets the pad. */
  refreshTouchCapability(): void {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const touchCapable = (navigator.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in window;
    if (coarse || (touchCapable && window.innerWidth < 900)) this.markTouch();
  }

  private markTouch(): void {
    if (this.usingTouch) return;
    this.usingTouch = true;
    this.onTouchDetected?.();
  }

  /** Wire an on-screen button (touch layout) to the boost control. */
  bindBoostButton(el: HTMLElement): void {
    const set = (v: boolean) => (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.touchBoost = v;
      this.markTouch();
      this.gesture();
    };
    el.addEventListener('pointerdown', set(true));
    el.addEventListener('pointerup', set(false));
    el.addEventListener('pointerleave', set(false));
    el.addEventListener('pointercancel', set(false));
  }

  bindBrakeButton(el: HTMLElement): void {
    const set = (v: boolean) => (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.brakeTouch = v;
      this.markTouch();
      this.gesture();
    };
    el.addEventListener('pointerdown', set(true));
    el.addEventListener('pointerup', set(false));
    el.addEventListener('pointerleave', set(false));
    el.addEventListener('pointercancel', set(false));
  }

  private isGameKey(code: string): boolean {
    return (
      code.startsWith('Arrow') ||
      code === 'Space' ||
      ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyP', 'KeyM', 'KeyX'].includes(code)
    );
  }

  private gesture(): void {
    if (this.gestureSeen) return;
    this.gestureSeen = true;
    this.onFirstGesture?.();
  }

  private fire(action: Action): void {
    this.onAction?.(action);
  }

  /** Recompute axis values; call once per frame before reading them. */
  sample(): void {
    const key = (...codes: string[]) => codes.some((c) => this.keys.has(c));
    let steer = 0;
    let climb = 0;
    if (key('ArrowLeft', 'KeyA')) steer -= 1;
    if (key('ArrowRight', 'KeyD')) steer += 1;
    if (key('ArrowUp', 'KeyW')) climb += 1;
    if (key('ArrowDown', 'KeyS')) climb -= 1;
    this.steer = clamp(steer + this.touchSteer, -1, 1);
    this.climb = clamp(climb + this.touchClimb, -1, 1);
    this.boost = key('Space', 'ShiftLeft', 'ShiftRight') || this.touchBoost;
    this.brake = key('KeyX', 'ControlLeft', 'ControlRight') || this.brakeTouch;
  }

  releaseAll(): void {
    this.keys.clear();
    this.touchSteer = 0;
    this.touchClimb = 0;
    this.touchBoost = false;
    this.brakeTouch = false;
    this.stickId = null;
  }

  dispose(): void {
    for (const off of this.listeners) off();
    this.listeners = [];
  }
}
