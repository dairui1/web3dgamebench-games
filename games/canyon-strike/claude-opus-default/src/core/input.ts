import { clamp } from './mathutil';

export type Action =
  | 'missile'
  | 'flare'
  | 'target'
  | 'view'
  | 'pause'
  | 'restart'
  | 'confirm'
  | 'mouseToggle';

/**
 * Unified input: keyboard + optional mouse steering + touch controls.
 * Touch widgets (built by the HUD) push their state in through the setters.
 */
export class Input {
  pitch = 0;
  roll = 0;
  yaw = 0;
  /** -1 .. 1 throttle change request */
  throttleAxis = 0;
  /** Absolute 0..1 throttle demand (touch slider), or null. */
  throttleAbsolute: number | null = null;
  gun = false;
  mouseSteer = false;
  invertPitch = false;
  isTouch = false;

  private keys = new Set<string>();
  private pressed = new Set<Action>();
  private touchStick = { x: 0, y: 0, active: false };
  private touchYaw = 0;
  private touchThrottle = 0;
  private touchGun = false;
  private mouse = { x: 0, y: 0, inside: false };
  private el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.gun = false;
    });
    el.addEventListener('mousemove', this.onMouseMove);
    el.addEventListener('mouseleave', () => (this.mouse.inside = false));
    el.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener(
      'touchstart',
      () => {
        this.isTouch = true;
      },
      { once: true, passive: true }
    );
    if (window.matchMedia?.('(pointer: coarse)').matches) this.isTouch = true;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) {
      if (this.blocks(e.code)) e.preventDefault();
      return;
    }
    this.keys.add(e.code);
    switch (e.code) {
      case 'KeyF':
      case 'Enter':
      case 'KeyJ':
        this.pressed.add('missile');
        this.pressed.add('confirm');
        break;
      case 'KeyX':
        this.pressed.add('flare');
        break;
      case 'Tab':
      case 'KeyT':
        this.pressed.add('target');
        break;
      case 'KeyC':
        this.pressed.add('view');
        break;
      case 'KeyP':
      case 'Escape':
        this.pressed.add('pause');
        break;
      case 'KeyR':
        this.pressed.add('restart');
        break;
      case 'KeyM':
        this.pressed.add('mouseToggle');
        this.mouseSteer = !this.mouseSteer;
        break;
      case 'KeyI':
        this.invertPitch = !this.invertPitch;
        break;
      case 'Space':
        this.pressed.add('confirm');
        break;
    }
    if (this.blocks(e.code)) e.preventDefault();
  };

  private blocks(code: string): boolean {
    return (
      code === 'Space' ||
      code === 'Tab' ||
      code.startsWith('Arrow') ||
      code === 'ShiftLeft' ||
      code === 'ControlLeft'
    );
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent): void => {
    const r = this.el.getBoundingClientRect();
    this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.mouse.y = ((e.clientY - r.top) / r.height) * 2 - 1;
    this.mouse.inside = true;
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseHeld = true;
    if (e.button === 2) this.pressed.add('missile');
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseHeld = false;
  };

  key(code: string): boolean {
    return this.keys.has(code);
  }

  consume(action: Action): boolean {
    if (this.pressed.has(action)) {
      this.pressed.delete(action);
      return true;
    }
    return false;
  }

  clearPressed(): void {
    this.pressed.clear();
  }

  // --- touch bridges ------------------------------------------------------
  setStick(x: number, y: number, active: boolean): void {
    this.touchStick.x = clamp(x, -1, 1);
    this.touchStick.y = clamp(y, -1, 1);
    this.touchStick.active = active;
    this.isTouch = true;
  }
  setTouchThrottle(v: number): void {
    this.touchThrottle = clamp(v, -1, 1);
  }
  /** Absolute throttle from the touch slider (null = use the rate axis). */
  setThrottleAbsolute(v: number | null): void {
    this.throttleAbsolute = v;
    this.isTouch = true;
  }
  setTouchYaw(v: number): void {
    this.touchYaw = clamp(v, -1, 1);
  }
  setTouchGun(v: boolean): void {
    this.touchGun = v;
  }
  press(a: Action): void {
    this.pressed.add(a);
  }

  /** Refresh continuous axes; call once per frame before simulation. */
  update(): void {
    let pitch = 0;
    let roll = 0;
    let yaw = 0;
    if (this.key('KeyW') || this.key('ArrowUp')) pitch += 1;
    if (this.key('KeyS') || this.key('ArrowDown')) pitch -= 1;
    if (this.key('KeyA') || this.key('ArrowLeft')) roll -= 1;
    if (this.key('KeyD') || this.key('ArrowRight')) roll += 1;
    if (this.key('KeyQ')) yaw -= 1;
    if (this.key('KeyE')) yaw += 1;

    if (this.touchStick.active) {
      roll += this.touchStick.x;
      pitch += -this.touchStick.y;
    }
    yaw += this.touchYaw;

    if (this.mouseSteer && this.mouse.inside && !this.touchStick.active) {
      const dead = 0.06;
      const mx = Math.abs(this.mouse.x) < dead ? 0 : this.mouse.x;
      const my = Math.abs(this.mouse.y) < dead ? 0 : this.mouse.y;
      roll += clamp(mx * 1.7, -1, 1);
      pitch += clamp(-my * 1.7, -1, 1);
    }

    this.pitch = clamp(pitch, -1, 1) * (this.invertPitch ? -1 : 1);
    this.roll = clamp(roll, -1, 1);
    this.yaw = clamp(yaw, -1, 1);

    let thr = this.touchThrottle;
    if (this.key('ShiftLeft') || this.key('ShiftRight')) thr += 1;
    if (this.key('ControlLeft') || this.key('ControlRight') || this.key('KeyZ')) thr -= 1;
    this.throttleAxis = clamp(thr, -1, 1);

    this.gun = this.mouseHeld || this.key('Space') || this.touchGun;
  }

  private mouseHeld = false;
}
