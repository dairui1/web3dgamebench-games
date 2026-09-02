import type { Input } from '../core/input';
import { clamp, clamp01 } from '../core/mathutil';

/** On-screen flight controls for phones and tablets. */
export class TouchControls {
  root: HTMLDivElement;
  private stick: HTMLDivElement;
  private knob: HTMLDivElement;
  private throttleEl: HTMLDivElement;
  private throttleFill: HTMLDivElement;
  private input: Input;
  private stickPointer: number | null = null;
  private throttlePointer: number | null = null;
  private throttleValue = 0.75;
  private radius = 62;

  constructor(parent: HTMLElement, input: Input) {
    this.input = input;
    const root = document.createElement('div');
    root.className = 'touch-ui';
    root.innerHTML = `
      <div class="stick" id="tStick"><div class="stick-ring"></div><div class="knob" id="tKnob"></div></div>
      <div class="throttle" id="tThrottle"><div class="thr-fill" id="tThrFill"></div><div class="thr-label">THR</div></div>
      <div class="rudder">
        <button class="tbtn small" data-btn="yawL">&#9664;</button>
        <button class="tbtn small" data-btn="yawR">&#9654;</button>
      </div>
      <div class="fire-cluster">
        <button class="tbtn wide" data-btn="tgt">TGT</button>
        <button class="tbtn wide" data-btn="flr">FLR</button>
        <button class="tbtn gun" data-btn="gun">GUN</button>
        <button class="tbtn msl" data-btn="msl">MSL</button>
      </div>
    `;
    parent.appendChild(root);
    this.root = root;
    this.stick = root.querySelector('#tStick')!;
    this.knob = root.querySelector('#tKnob')!;
    this.throttleEl = root.querySelector('#tThrottle')!;
    this.throttleFill = root.querySelector('#tThrFill')!;

    this.stick.addEventListener('pointerdown', this.onStickDown);
    this.stick.addEventListener('pointermove', this.onStickMove);
    this.stick.addEventListener('pointerup', this.onStickUp);
    this.stick.addEventListener('pointercancel', this.onStickUp);

    this.throttleEl.addEventListener('pointerdown', this.onThrottleDown);
    this.throttleEl.addEventListener('pointermove', this.onThrottleMove);
    this.throttleEl.addEventListener('pointerup', this.onThrottleUp);
    this.throttleEl.addEventListener('pointercancel', this.onThrottleUp);

    root.querySelectorAll<HTMLButtonElement>('.tbtn').forEach((btn) => {
      const kind = btn.dataset.btn!;
      const down = (e: PointerEvent): void => {
        e.preventDefault();
        btn.classList.add('pressed');
        this.press(kind, true);
      };
      const up = (e: PointerEvent): void => {
        e.preventDefault();
        btn.classList.remove('pressed');
        this.press(kind, false);
      };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    this.setThrottle(0.75);
  }

  private press(kind: string, on: boolean): void {
    switch (kind) {
      case 'gun':
        this.input.setTouchGun(on);
        break;
      case 'msl':
        if (on) this.input.press('missile');
        break;
      case 'flr':
        if (on) this.input.press('flare');
        break;
      case 'tgt':
        if (on) this.input.press('target');
        break;
      case 'yawL':
        this.input.setTouchYaw(on ? -1 : 0);
        break;
      case 'yawR':
        this.input.setTouchYaw(on ? 1 : 0);
        break;
    }
  }

  private onStickDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.stickPointer = e.pointerId;
    this.stick.setPointerCapture(e.pointerId);
    this.updateStick(e);
  };

  private onStickMove = (e: PointerEvent): void => {
    if (this.stickPointer !== e.pointerId) return;
    e.preventDefault();
    this.updateStick(e);
  };

  private onStickUp = (e: PointerEvent): void => {
    if (this.stickPointer !== e.pointerId) return;
    this.stickPointer = null;
    this.input.setStick(0, 0, false);
    this.knob.style.transform = 'translate(-50%, -50%)';
  };

  private updateStick(e: PointerEvent): void {
    const r = this.stick.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    this.radius = r.width * 0.42;
    let dx = (e.clientX - cx) / this.radius;
    let dy = (e.clientY - cy) / this.radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    this.input.setStick(dx, dy, true);
    this.knob.style.transform = `translate(calc(-50% + ${dx * this.radius}px), calc(-50% + ${
      dy * this.radius
    }px))`;
  }

  private onThrottleDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.throttlePointer = e.pointerId;
    this.throttleEl.setPointerCapture(e.pointerId);
    this.updateThrottle(e);
  };
  private onThrottleMove = (e: PointerEvent): void => {
    if (this.throttlePointer !== e.pointerId) return;
    e.preventDefault();
    this.updateThrottle(e);
  };
  private onThrottleUp = (e: PointerEvent): void => {
    if (this.throttlePointer !== e.pointerId) return;
    this.throttlePointer = null;
  };
  private updateThrottle(e: PointerEvent): void {
    const r = this.throttleEl.getBoundingClientRect();
    const v = clamp01(1 - (e.clientY - r.top) / r.height);
    this.setThrottle(v);
  }

  setThrottle(v: number): void {
    this.throttleValue = clamp(v, 0, 1);
    this.throttleFill.style.height = `${this.throttleValue * 100}%`;
    this.input.setThrottleAbsolute(this.throttleValue);
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'block' : 'none';
  }

  releaseAll(): void {
    this.input.setTouchGun(false);
    this.input.setTouchYaw(0);
    this.input.setStick(0, 0, false);
    this.root.querySelectorAll('.tbtn').forEach((b) => b.classList.remove('pressed'));
  }
}
