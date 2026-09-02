/**
 * Unified input: keyboard, optional mouse steering, and touch (virtual stick + buttons).
 * Positive pitch = nose up, positive roll = roll right, positive yaw = nose right.
 */
export class Input {
  readonly isTouch: boolean;
  private keys = new Set<string>();
  private edges = new Set<string>();
  private mouseX = 0;
  private mouseY = 0;
  mouseSteer = false;
  invertY = false;
  mouseDown = false;

  // Touch state
  private stickId: number | null = null;
  private stickOriginX = 0;
  private stickOriginY = 0;
  stickX = 0;
  stickY = 0;
  touchGun = false;
  touchThrottleUp = false;
  touchThrottleDown = false;
  onStickChange: ((active: boolean, ox: number, oy: number, dx: number, dy: number) => void) | null = null;

  constructor(private el: HTMLElement) {
    this.isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const code = e.code;
      this.keys.add(code);
      this.edges.add(code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) e.preventDefault();
      if (code === 'KeyM') this.mouseSteer = !this.mouseSteer;
      if (code === 'KeyI') this.invertY = !this.invertY;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    el.addEventListener('mousemove', (e) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.mouseX = (e.clientX / w - 0.5) * 2;
      this.mouseY = (e.clientY / h - 0.5) * 2;
    });
    el.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.edges.add('MouseRight');
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    // Virtual stick on the left half of the screen.
    el.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
    el.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
    el.addEventListener('touchend', (e) => this.onTouchEnd(e), { passive: false });
    el.addEventListener('touchcancel', (e) => this.onTouchEnd(e), { passive: false });
  }

  private onTouchStart(e: TouchEvent): void {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const target = t.target as HTMLElement | null;
      if (target && target.closest('[data-btn], #overlay')) continue;
      if (this.stickId === null && t.clientX < window.innerWidth * 0.5) {
        this.stickId = t.identifier;
        this.stickOriginX = t.clientX;
        this.stickOriginY = t.clientY;
        this.stickX = 0;
        this.stickY = 0;
        this.onStickChange?.(true, t.clientX, t.clientY, 0, 0);
        e.preventDefault();
      }
    }
  }

  private onTouchMove(e: TouchEvent): void {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === this.stickId) {
        const radius = Math.min(window.innerWidth, window.innerHeight) * 0.12;
        let dx = (t.clientX - this.stickOriginX) / radius;
        let dy = (t.clientY - this.stickOriginY) / radius;
        const len = Math.hypot(dx, dy);
        if (len > 1) { dx /= len; dy /= len; }
        this.stickX = dx;
        this.stickY = dy;
        this.onStickChange?.(true, this.stickOriginX, this.stickOriginY, dx * radius, dy * radius);
        e.preventDefault();
      }
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === this.stickId) {
        this.stickId = null;
        this.stickX = 0;
        this.stickY = 0;
        this.onStickChange?.(false, 0, 0, 0, 0);
      }
    }
  }

  private axis(neg: string[], pos: string[]): number {
    let v = 0;
    for (const k of neg) if (this.keys.has(k)) { v -= 1; break; }
    for (const k of pos) if (this.keys.has(k)) { v += 1; break; }
    return v;
  }

  private applyDeadzone(v: number, dz = 0.1): number {
    const a = Math.abs(v);
    if (a < dz) return 0;
    return Math.sign(v) * Math.min(1, (a - dz) / (1 - dz));
  }

  get pitch(): number {
    let v = this.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
    if (v === 0 && this.stickId !== null) v = -this.applyDeadzone(this.stickY);
    else if (v === 0 && this.mouseSteer) v = -this.applyDeadzone(this.mouseY, 0.06);
    return this.invertY ? -v : v;
  }

  get roll(): number {
    let v = this.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    if (v === 0 && this.stickId !== null) v = this.applyDeadzone(this.stickX);
    else if (v === 0 && this.mouseSteer) v = this.applyDeadzone(this.mouseX, 0.06);
    return v;
  }

  get yaw(): number {
    return this.axis(['KeyQ'], ['KeyE']);
  }

  get throttleDelta(): number {
    let v = this.axis(['ControlLeft', 'ControlRight', 'KeyX'], ['ShiftLeft', 'ShiftRight', 'KeyZ']);
    if (this.touchThrottleUp) v += 1;
    if (this.touchThrottleDown) v -= 1;
    return v;
  }

  get gun(): boolean {
    return this.keys.has('KeyF') || this.mouseDown || this.touchGun;
  }

  get brake(): boolean {
    return this.keys.has('KeyC');
  }

  /** Edge-triggered check; consumes the press. */
  consume(code: string): boolean {
    if (this.edges.has(code)) {
      this.edges.delete(code);
      return true;
    }
    return false;
  }

  press(code: string): void {
    this.edges.add(code);
  }

  clearEdges(): void {
    this.edges.clear();
  }
}
