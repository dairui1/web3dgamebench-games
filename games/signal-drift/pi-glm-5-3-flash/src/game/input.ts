import { clamp } from '../core/mathutil';

export interface InputCallbacks {
  onConfirm: () => void;
  onPause: () => void;
  onMute: () => void;
}

/** Keyboard + pointer/touch input with an on-screen joystick. */
export class Input {
  private keys = new Set<string>();
  private joystickId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private joyVec = { x: 0, y: 0 };
  private touchBoostId: number | null = null;
  private boostHeld = false;

  joyActive = false;
  onJoyMove?: (dx: number, dy: number) => void;
  onJoyEnd?: () => void;
  onJoyStart?: (x: number, y: number) => void;
  onBoostVisual?: (active: boolean) => void;

  constructor(private layer: HTMLElement, private cb: InputCallbacks) {
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.clearAll);
    layer.addEventListener('pointerdown', this.pointerDown);
    window.addEventListener('pointermove', this.pointerMove);
    window.addEventListener('pointerup', this.pointerUp);
    window.addEventListener('pointercancel', this.pointerUp);
  }

  private keyDown = (e: KeyboardEvent): void => {
    if (e.repeat) {
      if (this.isGameKey(e.code)) e.preventDefault();
      return;
    }
    this.keys.add(e.code);
    if (e.code === 'Enter' || e.code === 'Space') {
      this.cb.onConfirm();
      e.preventDefault();
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
      this.cb.onPause();
      e.preventDefault();
    } else if (e.code === 'KeyM') {
      this.cb.onMute();
    }
    if (this.isGameKey(e.code)) e.preventDefault();
  };

  private isGameKey(code: string): boolean {
    return [
      'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'ShiftLeft', 'ShiftRight', 'Space', 'Enter', 'KeyP', 'Escape', 'KeyM',
    ].includes(code);
  }

  private keyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private clearAll = (): void => {
    this.keys.clear();
    this.endJoystick();
    this.setBoost(false);
    this.touchBoostId = null;
  };

  private pointerDown = (e: PointerEvent): void => {
    const w = window.innerWidth;
    if (e.clientX < w * 0.62) {
      if (this.joystickId !== null) return;
      this.joystickId = e.pointerId;
      this.joyOrigin.x = e.clientX;
      this.joyOrigin.y = e.clientY;
      this.joyVec.x = 0;
      this.joyVec.y = 0;
      this.joyActive = true;
      this.onJoyStart?.(e.clientX, e.clientY);
    } else {
      if (this.touchBoostId !== null) return;
      this.touchBoostId = e.pointerId;
      this.setBoost(true);
    }
  };

  private pointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.joystickId) return;
    const RADIUS = 46;
    let dx = e.clientX - this.joyOrigin.x;
    let dy = e.clientY - this.joyOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS;
      dy = (dy / len) * RADIUS;
    }
    this.joyVec.x = dx / RADIUS;
    this.joyVec.y = -dy / RADIUS;
    this.onJoyMove?.(dx, dy);
  };

  private pointerUp = (e: PointerEvent): void => {
    if (e.pointerId === this.joystickId) {
      this.endJoystick();
    } else if (e.pointerId === this.touchBoostId) {
      this.touchBoostId = null;
      this.setBoost(false);
    }
  };

  private endJoystick(): void {
    if (this.joystickId === null) return;
    this.joystickId = null;
    this.joyVec.x = 0;
    this.joyVec.y = 0;
    this.joyActive = false;
    this.onJoyEnd?.();
  }

  private setBoost(v: boolean): void {
    this.boostHeld = v;
    this.onBoostVisual?.(v);
  }

  /** Combined steering, dead-zoned. */
  steer(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    x += this.joyVec.x;
    y += this.joyVec.y;
    return { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
  }

  boost(): boolean {
    return this.boostHeld || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  dispose(): void {
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.clearAll);
    this.layer.removeEventListener('pointerdown', this.pointerDown);
    window.removeEventListener('pointermove', this.pointerMove);
    window.removeEventListener('pointerup', this.pointerUp);
    window.removeEventListener('pointercancel', this.pointerUp);
  }
}
