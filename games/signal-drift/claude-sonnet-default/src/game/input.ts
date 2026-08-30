export interface SteerState {
  x: number; // -1 (left) .. 1 (right)
  y: number; // -1 (down) .. 1 (up)
  boost: boolean;
}

const isCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

export class InputController {
  readonly state: SteerState = { x: 0, y: 0, boost: false };
  private keys = new Set<string>();
  private touchRoot: HTMLDivElement;
  private stickBase: HTMLDivElement;
  private stickNub: HTMLDivElement;
  private boostBtn: HTMLDivElement;
  private stickTouchId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickVec = { x: 0, y: 0 };
  private readonly stickRadius = 52;
  private destroyed = false;

  constructor(private root: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clearKeys);

    this.touchRoot = document.createElement('div');
    this.touchRoot.className = 'touch-controls';

    this.stickBase = document.createElement('div');
    this.stickBase.className = 'stick-base';
    this.stickNub = document.createElement('div');
    this.stickNub.className = 'stick-nub';
    this.stickBase.appendChild(this.stickNub);

    this.boostBtn = document.createElement('div');
    this.boostBtn.className = 'boost-btn';
    this.boostBtn.textContent = 'BOOST';

    this.touchRoot.appendChild(this.stickBase);
    this.touchRoot.appendChild(this.boostBtn);
    this.root.appendChild(this.touchRoot);

    if (!(hasTouch || isCoarsePointer)) {
      this.touchRoot.style.display = 'none';
    }

    this.stickBase.addEventListener('pointerdown', this.onStickDown);
    window.addEventListener('pointermove', this.onStickMove);
    window.addEventListener('pointerup', this.onStickUp);
    window.addEventListener('pointercancel', this.onStickUp);

    this.boostBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.state.boost = true;
      this.boostBtn.classList.add('active');
    });
    const releaseBoost = () => {
      this.state.boost = false;
      this.boostBtn.classList.remove('active');
    };
    this.boostBtn.addEventListener('pointerup', releaseBoost);
    this.boostBtn.addEventListener('pointercancel', releaseBoost);
    this.boostBtn.addEventListener('pointerleave', releaseBoost);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.state.boost = true;
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.state.boost = false;
  };
  private clearKeys = () => {
    this.keys.clear();
    this.state.boost = false;
  };

  private onStickDown = (e: PointerEvent) => {
    e.preventDefault();
    this.stickTouchId = e.pointerId;
    const rect = this.stickBase.getBoundingClientRect();
    this.stickOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    this.updateStick(e.clientX, e.clientY);
  };
  private onStickMove = (e: PointerEvent) => {
    if (this.stickTouchId !== e.pointerId) return;
    this.updateStick(e.clientX, e.clientY);
  };
  private onStickUp = (e: PointerEvent) => {
    if (this.stickTouchId !== e.pointerId) return;
    this.stickTouchId = null;
    this.stickVec = { x: 0, y: 0 };
    this.stickNub.style.transform = 'translate(-50%, -50%)';
  };
  private updateStick(clientX: number, clientY: number) {
    let dx = clientX - this.stickOrigin.x;
    let dy = clientY - this.stickOrigin.y;
    const dist = Math.hypot(dx, dy);
    if (dist > this.stickRadius) {
      dx = (dx / dist) * this.stickRadius;
      dy = (dy / dist) * this.stickRadius;
    }
    this.stickVec = { x: dx / this.stickRadius, y: -dy / this.stickRadius };
    this.stickNub.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  update(): void {
    let kx = 0;
    let ky = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) kx -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) kx += 1;
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) ky += 1;
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) ky -= 1;

    this.state.x = THREE_clamp(kx + this.stickVec.x, -1, 1);
    this.state.y = THREE_clamp(ky + this.stickVec.y, -1, 1);
  }

  isPressed(code: string): boolean {
    return this.keys.has(code);
  }

  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clearKeys);
    window.removeEventListener('pointermove', this.onStickMove);
    window.removeEventListener('pointerup', this.onStickUp);
    window.removeEventListener('pointercancel', this.onStickUp);
    this.touchRoot.remove();
  }
}

function THREE_clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
