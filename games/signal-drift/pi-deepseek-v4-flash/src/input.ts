// Keyboard + pointer/touch input. Emits axis state consumed by the game loop.

export interface InputCallbacks {
  onStart?: () => void; // any key to begin (ready state)
  onTogglePause?: () => void;
  onRestart?: () => void;
  onMute?: () => void;
}

export class Input {
  lx = 0; // -1..1 lateral (right positive)
  ly = 0; // -1..1 vertical (up positive)
  boost = false;
  private keys = new Set<string>();
  private joy = { active: false, id: -1, ax: 0, ay: 0, kx: 0, ky: 0, cx: 0, cy: 0 };
  private boostPtr = false;
  private readonly on: InputCallbacks;
  private el: HTMLElement | null = null;
  private joyBase: HTMLDivElement | null = null;
  private joyKnob: HTMLDivElement | null = null;
  private joyWrap: HTMLDivElement | null = null;
  private boostBtn: HTMLButtonElement | null = null;
  private maxJoy = 64;

  constructor(on: InputCallbacks) {
    this.on = on;
  }

  /** Attach all listeners to the game root and HUD elements. */
  attach(root: HTMLElement, hud: HTMLElement): void {
    this.el = root;
    this.joyBase = hud.querySelector<HTMLDivElement>('#joy-base');
    this.joyKnob = hud.querySelector<HTMLDivElement>('#joy-knob');
    this.joyWrap = hud.querySelector<HTMLDivElement>('#joy');
    this.boostBtn = hud.querySelector<HTMLButtonElement>('#btn-boost');

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    root.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    if (this.boostBtn) {
      this.boostBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.boostPtr = true;
        this.boost = true;
        this.boostBtn!.classList.add('active');
      });
      const endBoost = (e: Event): void => {
        e.preventDefault();
        this.boostPtr = false;
        this.boost = this.keys.has('Shift') || this.keys.has(' ');
        this.boostBtn!.classList.remove('active');
      };
      this.boostBtn.addEventListener('pointerup', endBoost);
      this.boostBtn.addEventListener('pointercancel', endBoost);
      this.boostBtn.addEventListener('pointerleave', endBoost);
    }
  }

  startArmed = false; // set by the game when a start key should begin the run

  private onKeyDown = (e: KeyboardEvent): void => {
    const k = e.key;
    if (
      k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight' ||
      k === ' '
    ) {
      e.preventDefault();
    }
    if (e.repeat) return;
    this.keys.add(k);
    if (k === 'Shift' || k === ' ') this.boost = true;
    if (this.startArmed && (k === ' ' || k === 'Enter')) this.on.onStart?.();
    if (k === 'p' || k === 'P' || k === 'Escape') this.on.onTogglePause?.();
    if (k === 'r' || k === 'R') this.on.onRestart?.();
    if (k === 'm' || k === 'M') this.on.onMute?.();
  };
  private onKeyUp = (e: KeyboardEvent): void => {
    const k = e.key;
    this.keys.delete(k);
    if (k === 'Shift' || k === ' ') {
      this.boost = this.boostPtr || this.keys.has('Shift') || this.keys.has(' ');
    }
  };

  releaseAll(): void {
    this.keys.clear();
    this.boost = false;
    this.boostPtr = false;
    this.boostBtn?.classList.remove('active');
    this.endJoystick();
  }

  // Re-bindable: instance method passed to addEventListener must stay bound.
  private onBlur = (): void => this.releaseAll();
  private onPointerDown = (e: PointerEvent): void => {
    if (this.joy.active) return;
    this.joy.active = true;
    this.joy.id = e.pointerId;
    this.joy.ax = e.clientX;
    this.joy.ay = e.clientY;
    this.joy.cx = 0;
    this.joy.cy = 0;
    this.updateJoystickUi();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.joy.active || e.pointerId !== this.joy.id) return;
    const dx = e.clientX - this.joy.ax;
    const dy = e.clientY - this.joy.ay;
    this.joy.cx = dx;
    this.joy.cy = dy;
    this.updateJoystickUi();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.joy.active && e.pointerId === this.joy.id) this.endJoystick();
  };

  private endJoystick(): void {
    if (!this.joy.active) return;
    this.joy.active = false;
    this.joy.cx = 0;
    this.joy.cy = 0;
    this.joyWrap?.classList.remove('active');
  }

  private updateJoystickUi(): void {
    if (!this.joyWrap || !this.joyKnob) return;
    const d = Math.hypot(this.joy.cx, this.joy.cy);
    const m = d > this.maxJoy ? this.maxJoy / d : 1;
    const kx = this.joy.cx * m;
    const ky = this.joy.cy * m;
    if (this.joy.active) {
      this.joyWrap.classList.add('active');
      this.joyWrap.style.left = `${this.joy.ax - 75}px`;
      this.joyWrap.style.top = `${this.joy.ay - 60}px`;
    }
    this.joyKnob.style.transform = `translate(${kx}px, ${ky}px)`;
  }

  /** Called every frame; computes softened axes from keys + joystick. */
  frame(): void {
    // keyboard axes
    let kx = 0;
    let ky = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('a') || this.keys.has('A')) kx -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('d') || this.keys.has('D')) kx += 1;
    if (this.keys.has('ArrowUp') || this.keys.has('w') || this.keys.has('W')) ky += 1;
    if (this.keys.has('ArrowDown') || this.keys.has('s') || this.keys.has('S')) ky -= 1;

    let jx = 0;
    let jy = 0;
    if (this.joy.active) {
      const d = Math.hypot(this.joy.cx, this.joy.cy);
      const m = Math.min(1, d / this.maxJoy);
      const ang = Math.atan2(this.joy.cy, this.joy.cx);
      jx = Math.cos(ang) * m;
      jy = -Math.sin(ang) * m;
    }
    this.lx = Math.max(-1, Math.min(1, kx + jx));
    this.ly = Math.max(-1, Math.min(1, ky + jy));
  }

  setStartEligible(eligible: boolean): void {
    this.startArmed = eligible;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    if (this.el) {
      this.el.removeEventListener('pointerdown', this.onPointerDown);
      window.removeEventListener('pointermove', this.onPointerMove);
      window.removeEventListener('pointerup', this.onPointerUp);
      window.removeEventListener('pointercancel', this.onPointerUp);
    }
  }
}