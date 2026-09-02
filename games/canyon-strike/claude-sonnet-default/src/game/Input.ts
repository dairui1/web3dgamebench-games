import { clamp, isTouchDevice } from './utils.ts';

export interface InputState {
  pitch: number; // -1 dive .. +1 climb
  roll: number; // -1 left .. +1 right
  yaw: number; // -1 left .. +1 right
  throttle: number; // 0..1
  fireGun: boolean;
  fireMissile: boolean; // edge-triggered, consumed by reader
  cycleTarget: boolean; // edge-triggered
}

const KEY_MAP: Record<string, boolean> = {};

export class InputManager {
  readonly state: InputState = {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttle: 0.55,
    fireGun: false,
    fireMissile: false,
    cycleTarget: false,
  };

  private touchActive = isTouchDevice();
  private stickTouchId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickVec = { x: 0, y: 0 };
  private el: HTMLElement;
  private touchRoot: HTMLDivElement | null = null;

  constructor(target: HTMLElement) {
    this.el = target;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    this.el.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);

    if (this.touchActive) {
      this.buildTouchControls();
    }
  }

  get isTouch(): boolean {
    return this.touchActive;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    KEY_MAP[e.code] = true;
    if (e.code === 'Tab') e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    KEY_MAP[e.code] = false;
  };

  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) this.state.fireGun = true;
    if (e.button === 2) this.state.fireMissile = true;
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.state.fireGun = false;
  };

  /** Call once per frame; consumes edge-triggered flags and returns snapshot. */
  update(): InputState {
    const s = this.state;

    if (!this.touchActive) {
      const pitchUp = KEY_MAP['ArrowUp'] || KEY_MAP['KeyW'];
      const pitchDown = KEY_MAP['ArrowDown'] || KEY_MAP['KeyS'];
      const rollLeft = KEY_MAP['ArrowLeft'] || KEY_MAP['KeyA'];
      const rollRight = KEY_MAP['ArrowRight'] || KEY_MAP['KeyD'];
      const yawLeft = KEY_MAP['KeyQ'];
      const yawRight = KEY_MAP['KeyE'];

      s.pitch = (pitchUp ? 1 : 0) - (pitchDown ? 1 : 0);
      s.roll = (rollRight ? 1 : 0) - (rollLeft ? 1 : 0);
      s.yaw = (yawRight ? 1 : 0) - (yawLeft ? 1 : 0);

      if (KEY_MAP['ShiftLeft'] || KEY_MAP['ShiftRight']) s.throttle = clamp(s.throttle + 0.02, 0, 1);
      if (KEY_MAP['KeyC']) s.throttle = clamp(s.throttle - 0.02, 0, 1);

      s.fireGun = s.fireGun || KEY_MAP['Space'];
      if (KEY_MAP['KeyF']) s.fireMissile = true;
      if (KEY_MAP['Tab']) s.cycleTarget = true;
    } else {
      s.pitch = clamp(-this.stickVec.y, -1, 1);
      s.roll = clamp(this.stickVec.x, -1, 1);
      s.yaw = 0;
    }

    const out: InputState = { ...s };
    // reset edge-triggered
    s.fireMissile = false;
    s.cycleTarget = false;
    if (!this.touchActive) s.fireGun = false;
    KEY_MAP['Tab'] = false;
    KEY_MAP['KeyF'] = false;
    return out;
  }

  private buildTouchControls() {
    const root = document.createElement('div');
    root.className = 'touch-controls';
    this.touchRoot = root;

    const stickBase = document.createElement('div');
    stickBase.className = 'stick-base';
    const stickKnob = document.createElement('div');
    stickKnob.className = 'stick-knob';
    stickBase.appendChild(stickKnob);
    root.appendChild(stickBase);

    const stickRadius = 60;

    const resetStick = () => {
      this.stickTouchId = null;
      this.stickVec = { x: 0, y: 0 };
      stickKnob.style.transform = `translate(-50%, -50%)`;
    };

    const handleMove = (clientX: number, clientY: number) => {
      const dx = clientX - this.stickOrigin.x;
      const dy = clientY - this.stickOrigin.y;
      const len = Math.hypot(dx, dy);
      const clampedLen = Math.min(len, stickRadius);
      const nx = len > 0 ? (dx / len) * clampedLen : 0;
      const ny = len > 0 ? (dy / len) * clampedLen : 0;
      stickKnob.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
      this.stickVec = { x: clamp(nx / stickRadius, -1, 1), y: clamp(ny / stickRadius, -1, 1) };
    };

    stickBase.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      this.stickTouchId = t.identifier;
      const rect = stickBase.getBoundingClientRect();
      this.stickOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      handleMove(t.clientX, t.clientY);
      e.preventDefault();
    });
    window.addEventListener(
      'touchmove',
      (e) => {
        for (const t of Array.from(e.changedTouches)) {
          if (t.identifier === this.stickTouchId) {
            handleMove(t.clientX, t.clientY);
            e.preventDefault();
          }
        }
      },
      { passive: false },
    );
    window.addEventListener('touchend', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.stickTouchId) resetStick();
      }
    });
    window.addEventListener('touchcancel', () => resetStick());

    const btnRow = document.createElement('div');
    btnRow.className = 'touch-buttons';
    root.appendChild(btnRow);

    const throttleCol = document.createElement('div');
    throttleCol.className = 'throttle-col';
    const throttleUp = document.createElement('button');
    throttleUp.className = 'touch-btn throttle-btn';
    throttleUp.textContent = '▲';
    const throttleDown = document.createElement('button');
    throttleDown.className = 'touch-btn throttle-btn';
    throttleDown.textContent = '▼';
    throttleCol.appendChild(throttleUp);
    throttleCol.appendChild(throttleDown);
    root.appendChild(throttleCol);

    let throttleUpHeld = false;
    let throttleDownHeld = false;
    const bindHold = (el: HTMLElement, onStart: () => void, onEnd: () => void) => {
      el.addEventListener('touchstart', (e) => {
        onStart();
        e.preventDefault();
      });
      el.addEventListener('touchend', (e) => {
        onEnd();
        e.preventDefault();
      });
      el.addEventListener('touchcancel', () => onEnd());
    };
    bindHold(
      throttleUp,
      () => (throttleUpHeld = true),
      () => (throttleUpHeld = false),
    );
    bindHold(
      throttleDown,
      () => (throttleDownHeld = true),
      () => (throttleDownHeld = false),
    );
    setInterval(() => {
      if (throttleUpHeld) this.state.throttle = clamp(this.state.throttle + 0.02, 0, 1);
      if (throttleDownHeld) this.state.throttle = clamp(this.state.throttle - 0.02, 0, 1);
    }, 32);

    const gunBtn = document.createElement('button');
    gunBtn.className = 'touch-btn fire-btn gun-btn';
    gunBtn.textContent = 'GUN';
    bindHold(
      gunBtn,
      () => (this.state.fireGun = true),
      () => (this.state.fireGun = false),
    );
    btnRow.appendChild(gunBtn);

    const missileBtn = document.createElement('button');
    missileBtn.className = 'touch-btn fire-btn missile-btn';
    missileBtn.textContent = 'MSL';
    missileBtn.addEventListener('touchstart', (e) => {
      this.state.fireMissile = true;
      e.preventDefault();
    });
    btnRow.appendChild(missileBtn);

    const targetBtn = document.createElement('button');
    targetBtn.className = 'touch-btn fire-btn target-btn';
    targetBtn.textContent = 'TGT';
    targetBtn.addEventListener('touchstart', (e) => {
      this.state.cycleTarget = true;
      e.preventDefault();
    });
    btnRow.appendChild(targetBtn);

    document.body.appendChild(root);
  }

  setTouchControlsVisible(visible: boolean) {
    if (this.touchRoot) this.touchRoot.style.display = visible ? 'flex' : 'none';
  }
}
