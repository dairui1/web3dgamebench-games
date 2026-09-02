// Unified input: keyboard (desktop), mouse drag steering + fire (desktop),
// and virtual touch joysticks + buttons (mobile). Exposes smoothed analog axes.

export interface InputState {
  /** Pitch: -1 nose up, +1 nose down */
  pitch: number;
  /** Roll: -1 bank left, +1 bank right */
  roll: number;
  /** Throttle target 0..1 (auto-cruise blends toward cruiseThrottle) */
  throttle: number;
  throttleRaised: boolean; // throttle up key held
  throttleLowered: boolean; // throttle down key held
  fireHeld: boolean;
  missilePressed: boolean; // edge
  flarePressed: boolean; // edge
  targetPressed: boolean; // edge
  pausePressed: boolean; // edge
  autoThrottle: boolean;
  touchMode: boolean;
}

const PITCH_UP = ['KeyW', 'ArrowUp'];
const PITCH_DOWN = ['KeyS', 'ArrowDown'];
const ROLL_LEFT = ['KeyA', 'ArrowLeft'];
const ROLL_RIGHT = ['KeyD', 'ArrowRight'];
const THROTTLE_UP = ['ShiftLeft', 'ShiftRight', 'KeyR'];
const THROTTLE_DOWN = ['ControlLeft', 'ControlRight', 'KeyF'];
const FIRE_KEYS = ['KeyJ', 'Space'];
const MISSILE_KEYS = ['Enter', 'KeyK'];
const FLARE_KEYS = ['KeyX'];
const TARGET_KEYS = ['KeyE', 'Tab', 'KeyQ'];
const PAUSE_KEYS = ['Escape', 'KeyP'];
const AUTOTHROTTLE_KEYS = ['KeyT'];

export class Input {
  state: InputState = {
    pitch: 0,
    roll: 0,
    throttle: 0.55,
    throttleRaised: false,
    throttleLowered: false,
    fireHeld: false,
    missilePressed: false,
    flarePressed: false,
    targetPressed: false,
    pausePressed: false,
    autoThrottle: true,
    touchMode: false,
  };

  enabled = true;
  private keys = new Set<string>();
  private dragPointer: number | null = null;
  private dragLastX = 0;
  private dragLastY = 0;
  private dragActive = false;
  private mousePitch = 0;
  private mouseRoll = 0;
  private joystick: Joystick | null = null;
  private throttleStick: Joystick | null = null;
  private fireBtn: TouchBtn | null = null;
  private missileBtn: TouchBtn | null = null;
  private flareBtn: TouchBtn | null = null;
  private onPause: (() => void) | null = null;
  onMuteRequest: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, private uiRoot: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth < 820;
    this.state.touchMode = isTouch;
    if (isTouch) this.buildTouchUI();
  }

  setPauseHandler(fn: () => void): void {
    this.onPause = fn;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
  }

  /** Clear held keys / edges for pause or game-over. */
  resetEdges(): void {
    const s = this.state;
    s.missilePressed = false;
    s.flarePressed = false;
    s.targetPressed = false;
    s.pausePressed = false;
    s.fireHeld = false;
    if (this.joystick) this.joystick.reset();
    if (this.throttleStick) this.throttleStick.reset();
  }

  private onBlur = (): void => {
    this.keys.clear();
    this.dragActive = false;
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Tab') e.preventDefault();
    if (!this.enabled) return;
    this.keys.add(e.code);
    const s = this.state;
    if (MISSILE_KEYS.includes(e.code)) s.missilePressed = true;
    if (FLARE_KEYS.includes(e.code)) s.flarePressed = true;
    if (TARGET_KEYS.includes(e.code)) s.targetPressed = true;
    if (PAUSE_KEYS.includes(e.code)) {
      if (!e.repeat) {
        s.pausePressed = true;
        if (this.onPause && e.code === 'Escape') this.onPause();
      }
    }
    if (AUTOTHROTTLE_KEYS.includes(e.code) && !e.repeat) {
      s.autoThrottle = !s.autoThrottle;
    }
    if (FIRE_KEYS.includes(e.code)) s.fireHeld = true;
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    const s = this.state;
    if (FIRE_KEYS.includes(e.code)) s.fireHeld = false;
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    if (this.state.touchMode) return; // touch UI handles own pointers
    if (e.button === 0) {
      this.dragPointer = e.pointerId;
      this.dragLastX = e.clientX;
      this.dragLastY = e.clientY;
      this.dragActive = false;
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.enabled) return;
    if (this.state.touchMode) return;
    if (e.pointerId !== this.dragPointer) return;
    const dx = e.clientX - this.dragLastX;
    const dy = e.clientY - this.dragLastY;
    this.dragLastX = e.clientX;
    this.dragLastY = e.clientY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.dragActive = true;
    if (this.dragActive) {
      this.mouseRoll = clampAxis(-dx / 9, 0.16);
      this.mousePitch = clampAxis(dy / 9, 0.16);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragPointer) return;
    this.dragPointer = null;
    this.mousePitch = 0;
    this.mouseRoll = 0;
    if (!this.dragActive) {
      // Treat as a click → fire gun
      this.state.fireHeld = true;
      setTimeout(() => {
        this.state.fireHeld = false;
      }, 60);
    }
    this.dragActive = false;
  };

  /** Called once per frame; resolves axes from keyboard/mouse/touch. */
  update(dt: number): void {
    void dt;
    const s = this.state;
    if (!this.enabled) {
      s.pitch = 0;
      s.roll = 0;
      return;
    }
    let pitch = 0;
    let roll = 0;
    const k = this.keys;
    if (k.has(PITCH_UP[0]) || k.has(PITCH_UP[1])) pitch -= 1;
    if (k.has(PITCH_DOWN[0]) || k.has(PITCH_DOWN[1])) pitch += 1;
    if (k.has(ROLL_LEFT[0]) || k.has(ROLL_LEFT[1])) roll -= 1;
    if (k.has(ROLL_RIGHT[0]) || k.has(ROLL_RIGHT[1])) roll += 1;
    // Mouse damping toward 0
    this.mousePitch = this.mousePitch * (1 - Math.min(1, dt * 8));
    this.mouseRoll = this.mouseRoll * (1 - Math.min(1, dt * 8));
    pitch = clampNum(pitch + this.mousePitch, -1, 1);
    roll = clampNum(roll + this.mouseRoll, -1, 1);

    if (this.joystick) {
      const jx = this.joystick.x;
      const jy = this.joystick.y;
      if (Math.abs(jx) > 0.08 || Math.abs(jy) > 0.08) {
        roll = clampNum(roll + jx, -1, 1);
        pitch = clampNum(pitch + jy, -1, 1);
      }
    }
    s.pitch = pitch;
    s.roll = roll;

    s.throttleRaised = k.has(THROTTLE_UP[0]) || k.has(THROTTLE_UP[1]) || k.has(THROTTLE_UP[2]);
    s.throttleLowered = k.has(THROTTLE_DOWN[0]) || k.has(THROTTLE_DOWN[1]) || k.has(THROTTLE_DOWN[2]);
    if (this.throttleStick && Math.abs(this.throttleStick.y) > 0.1) {
      s.throttleRaised = this.throttleStick.y < -0.1;
      s.throttleLowered = this.throttleStick.y > 0.1;
      s.autoThrottle = false;
    }
  }

  private buildTouchUI(): void {
    const mk = (cls: string): HTMLDivElement => {
      const d = document.createElement('div');
      d.className = cls;
      this.uiRoot.appendChild(d);
      return d;
    };
    const zone = document.createElement('div');
    zone.className = 'touch-ui';
    this.uiRoot.appendChild(zone);

    this.joystick = new Joystick(zone, 'left');
    this.throttleStick = new Joystick(zone, 'right', true);
    this.fireBtn = new TouchBtn(zone, 'fire', 'FIRE');
    this.fireBtn.onPress = () => {
      this.state.fireHeld = true;
    };
    this.fireBtn.onRelease = () => {
      this.state.fireHeld = false;
    };
    this.missileBtn = new TouchBtn(zone, 'missile', 'MISSILE');
    this.missileBtn.onPress = () => {
      this.state.missilePressed = true;
    };
    this.flareBtn = new TouchBtn(zone, 'flare', 'FLARE');
    this.flareBtn.onPress = () => {
      this.state.flarePressed = true;
    };
    const auto = new TouchBtn(zone, 'auto', 'CRUISE');
    auto.toggleable = true;
    auto.on = this.state.autoThrottle;
    auto.onPress = () => {
      this.state.autoThrottle = !auto.on;
      auto.on = this.state.autoThrottle;
      auto.update();
    };
    const pauseBtn = new TouchBtn(zone, 'auto', 'PAUSE');
    pauseBtn.onPress = () => {
      this.onPause?.();
    };
    pauseBtn.el.classList.remove('auto');
    pauseBtn.el.classList.add('pause');
    const muteBtn = new TouchBtn(zone, 'auto', 'SOUND');
    muteBtn.toggleable = true;
    muteBtn.onPress = () => {
      this.onMuteRequest?.();
    };
    muteBtn.el.classList.remove('auto');
    muteBtn.el.classList.add('mute');
  }
}

function clampNum(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function clampAxis(v: number, max: number): number {
  const a = Math.abs(v);
  if (a < 0.02) return 0;
  return clampNum(v, -max, max);
}

class Joystick {
  x = 0;
  y = 0;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private pid: number | null = null;
  private active = false;

  constructor(parent: HTMLElement, side: 'left' | 'right', verticalOnly = false) {
    this.base = document.createElement('div');
    this.base.className = 'joy-base ' + (verticalOnly ? 'joy-vert joy-' + side : 'joy-' + side);
    this.knob = document.createElement('div');
    this.knob.className = 'joy-knob';
    this.base.appendChild(this.knob);
    parent.appendChild(this.base);
    this.base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.pid = e.pointerId;
      this.active = true;
      this.base.setPointerCapture(e.pointerId);
      this.move(e.clientX, e.clientY, verticalOnly);
    });
    this.base.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pid) return;
      this.move(e.clientX, e.clientY, verticalOnly);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== this.pid) return;
      this.pid = null;
      this.active = false;
      this.x = 0;
      this.y = 0;
      this.knob.style.transform = 'translate(0px, 0px)';
    };
    this.base.addEventListener('pointerup', end);
    this.base.addEventListener('pointercancel', end);
  }

  private move(cx: number, cy: number, verticalOnly: boolean): void {
    const r = this.base.getBoundingClientRect();
    const dx = (cx - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (cy - (r.top + r.height / 2)) / (r.height / 2);
    const mag = Math.hypot(dx, dy);
    const max = 1;
    const sx = mag > max ? dx / mag : dx;
    const sy = mag > max ? dy / mag : dy;
    this.x = verticalOnly ? 0 : clampNum(sx, -1, 1);
    this.y = clampNum(sy, -1, 1);
    this.knob.style.transform = `translate(${this.x * 36}px, ${this.y * 36}px)`;
  }

  reset(): void {
    this.x = 0;
    this.y = 0;
    if (this.knob) this.knob.style.transform = 'translate(0px, 0px)';
  }
}

class TouchBtn {
  on: boolean;
  toggleable = false;
  onPress: (() => void) | null = null;
  onRelease: (() => void) | null = null;
  el: HTMLDivElement;

  constructor(parent: HTMLElement, cls: string, label: string) {
    this.el = document.createElement('div');
    this.el.className = 'tbtn ' + cls;
    this.el.textContent = label;
    this.on = false;
    parent.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.toggleable) {
        if (this.onPress) this.onPress();
        return;
      }
      if (this.onPress) this.onPress();
      this.el.classList.add('pressed');
    });
    const end = (): void => {
      this.el.classList.remove('pressed');
      if (!this.toggleable && this.onRelease) this.onRelease();
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
    this.el.addEventListener('pointerleave', end);
  }

  update(): void {
    this.el.classList.toggle('on', this.on);
  }
}