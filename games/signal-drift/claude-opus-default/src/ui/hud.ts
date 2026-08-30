export type Phase = 'ready' | 'playing' | 'paused' | 'won' | 'lost';

export interface HudState {
  charge: number;
  relaysRestored: number;
  objective: string;
  score: number;
  speed01: number;
  danger: number;
}

export interface RunSummary {
  score: number;
  relaysRestored: number;
  time: number;
  charge: number;
  reason: string;
}

const SPEED_BARS = 10;

/** All 2D interface: HUD readouts, overlays and the touch control layer. */
export class Hud {
  readonly root: HTMLDivElement;

  onStart: (() => void) | null = null;
  onRestart: (() => void) | null = null;
  onResume: (() => void) | null = null;
  onToggleMute: (() => void) | null = null;

  private readonly hud: HTMLDivElement;
  private readonly overlay: HTMLDivElement;
  private readonly objective: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly chargeWrap: HTMLElement;
  private readonly chargeFill: HTMLElement;
  private readonly chargeValue: HTMLElement;
  private readonly pips: HTMLElement[] = [];
  private readonly bars: HTMLElement[] = [];
  private readonly toastEl: HTMLElement;
  private readonly dangerEl: HTMLElement;
  private readonly touchLayer: HTMLDivElement;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly audioBtn: HTMLButtonElement;

  private toastTimer = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.style.position = 'absolute';
    this.root.style.inset = '0';
    this.root.style.pointerEvents = 'none';
    this.root.innerHTML = `
      <div class="hud">
        <div class="hud-row">
          <div class="panel" id="objective-panel">
            <span class="label">Objective</span>
            <span id="objective">Bring relay 01 online</span>
          </div>
          <div class="right-stack">
            <div class="panel">
              <span class="label">Relays</span>
              <div class="pips">
                <i class="pip"></i><i class="pip"></i><i class="pip"></i>
              </div>
            </div>
            <div class="panel">
              <span class="label">Score</span>
              <span class="value" id="score">0</span>
            </div>
          </div>
        </div>
        <div class="hud-row">
          <div class="panel charge-wrap" id="charge-wrap">
            <span class="label">Charge</span>
            <div class="charge-track"><div class="charge-fill" id="charge-fill"></div></div>
            <span class="value" id="charge-value" style="font-size:11px">100%</span>
          </div>
          <div class="panel">
            <span class="label">Drift</span>
            <div class="speed-bars" id="speed-bars"></div>
          </div>
        </div>
        <div class="toast" id="toast"></div>
        <div class="danger-vignette" id="danger"></div>
      </div>
      <div class="touch" id="touch">
        <div class="stick" id="stick"><div class="stick-knob" id="knob"></div></div>
        <button class="tbtn" id="boost-btn">Boost</button>
        <button class="tbtn" id="brake-btn">Brake</button>
      </div>
      <button class="audio-toggle" id="audio-toggle">Sound: on</button>
      <div class="overlay" id="overlay"></div>
    `;
    parent.appendChild(this.root);

    const q = <T extends HTMLElement>(id: string): T => {
      const el = this.root.querySelector<T>(`#${id}`);
      if (!el) throw new Error(`Missing HUD element #${id}`);
      return el;
    };

    this.hud = this.root.querySelector('.hud') as HTMLDivElement;
    this.overlay = q('overlay');
    this.objective = q('objective');
    this.scoreEl = q('score');
    this.chargeWrap = q('charge-wrap');
    this.chargeFill = q('charge-fill');
    this.chargeValue = q('charge-value');
    this.toastEl = q('toast');
    this.dangerEl = q('danger');
    this.touchLayer = q('touch');
    this.stick = q('stick');
    this.knob = q('knob');
    this.audioBtn = q('audio-toggle');
    this.pips.push(...Array.from(this.root.querySelectorAll<HTMLElement>('.pip')));

    const barHolder = q('speed-bars');
    for (let i = 0; i < SPEED_BARS; i++) {
      const bar = document.createElement('i');
      bar.style.height = `${5 + i * 1.15}px`;
      barHolder.appendChild(bar);
      this.bars.push(bar);
    }

    this.audioBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onToggleMute?.();
    });
  }

  get boostButton(): HTMLElement {
    return this.root.querySelector('#boost-btn') as HTMLElement;
  }

  get brakeButton(): HTMLElement {
    return this.root.querySelector('#brake-btn') as HTMLElement;
  }

  setTouchVisible(on: boolean): void {
    this.touchLayer.classList.toggle('on', on);
  }

  setMuteLabel(muted: boolean): void {
    this.audioBtn.textContent = muted ? 'Sound: off' : 'Sound: on';
  }

  setStick(originX: number, originY: number, knobX: number, knobY: number, active: boolean): void {
    this.stick.classList.toggle('on', active);
    this.knob.classList.toggle('on', active);
    if (!active) return;
    this.stick.style.left = `${originX}px`;
    this.stick.style.top = `${originY}px`;
    // The knob is positioned inside the 116px ring, whose centre is at 58,58.
    this.knob.style.left = `${knobX - originX + 58}px`;
    this.knob.style.top = `${knobY - originY + 58}px`;
  }

  update(state: HudState): void {
    this.objective.textContent = state.objective;
    this.scoreEl.textContent = Math.round(state.score).toLocaleString('en-US');
    const pct = Math.max(0, Math.min(100, state.charge));
    this.chargeFill.style.width = `${pct}%`;
    this.chargeValue.textContent = `${Math.round(pct)}%`;
    this.chargeWrap.classList.toggle('low', pct < 30);
    for (let i = 0; i < this.pips.length; i++) {
      const pip = this.pips[i];
      pip.classList.toggle('done', i < state.relaysRestored);
      pip.classList.toggle('next', i === state.relaysRestored);
    }
    const lit = Math.round(state.speed01 * SPEED_BARS);
    for (let i = 0; i < this.bars.length; i++) this.bars[i].classList.toggle('on', i < lit);
    this.dangerEl.style.opacity = `${Math.min(0.72, state.danger)}`;
  }

  tick(dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }

  toast(text: string, warn = false, duration = 1.8): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.toggle('warn', warn);
    this.toastEl.classList.add('show');
    this.toastTimer = duration;
  }

  setHudVisible(visible: boolean): void {
    this.hud.classList.toggle('visible', visible);
  }

  showTitle(): void {
    this.overlay.innerHTML = `
      <div class="card">
        <div class="eyebrow">Cloud Deck 7 &middot; Courier Run 94721</div>
        <h1>Signal Drift</h1>
        <p class="blurb">
          The storm tore through the relay field and left three nodes dark above an
          endless cloud layer. Thread your courier craft along the corridor, ignite
          each relay in order, then run the extraction ring before your cells die.
        </p>
        <div class="brief">
          <div><span>Restore</span><b>3 relays, in order</b></div>
          <div><span>Survive</span><b>Charge drains &mdash; collect motes</b></div>
          <div><span>Escape</span><b>Cross the extraction ring</b></div>
        </div>
        <div class="keys keys-desktop">
          <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or <kbd>&#8592;</kbd><kbd>&#8593;</kbd><kbd>&#8595;</kbd><kbd>&#8594;</kbd> steer &nbsp;&middot;&nbsp;
          <kbd>Space</kbd>/<kbd>Shift</kbd> boost &nbsp;&middot;&nbsp; <kbd>X</kbd> brake<br />
          <kbd>P</kbd> pause &nbsp;&middot;&nbsp; <kbd>R</kbd> restart &nbsp;&middot;&nbsp; <kbd>M</kbd> sound
        </div>
        <div class="keys keys-touch">
          Drag anywhere to steer &nbsp;&middot;&nbsp; hold <b>BOOST</b> / <b>BRAKE</b><br />
          Tap the field to restart &nbsp;&middot;&nbsp; keyboard also works
        </div>
        <button class="primary" id="start-btn">Engage</button>
        <div class="hint">Press Enter or tap Engage</div>
      </div>
    `;
    this.overlay.classList.remove('hidden');
    this.overlay.querySelector('#start-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onStart?.();
    });
  }

  showPaused(): void {
    this.overlay.innerHTML = `
      <div class="card">
        <div class="eyebrow">Signal held</div>
        <h2>Paused</h2>
        <p class="blurb">The relay field is holding position. Resume when you are ready.</p>
        <button class="primary" id="resume-btn">Resume</button>
        <div class="hint">Press P or Esc &middot; R restarts the run</div>
      </div>
    `;
    this.overlay.classList.remove('hidden');
    this.overlay.querySelector('#resume-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onResume?.();
    });
  }

  showResult(won: boolean, summary: RunSummary): void {
    const mm = Math.floor(summary.time / 60);
    const ss = Math.floor(summary.time % 60);
    this.overlay.innerHTML = `
      <div class="card">
        <div class="eyebrow">${won ? 'Extraction confirmed' : 'Signal lost'}</div>
        <h2 class="${won ? 'win' : 'lose'}">${won ? 'Field Restored' : 'Run Failed'}</h2>
        <p class="blurb">${summary.reason}</p>
        <div class="stats">
          <div>Score<b>${Math.round(summary.score).toLocaleString('en-US')}</b></div>
          <div>Relays<b>${summary.relaysRestored}/3</b></div>
          <div>Time<b>${mm}:${ss.toString().padStart(2, '0')}</b></div>
          <div>Charge<b>${Math.max(0, Math.round(summary.charge))}%</b></div>
        </div>
        <button class="primary" id="again-btn">Fly again</button>
        <div class="hint">Press R or Enter</div>
      </div>
    `;
    this.overlay.classList.remove('hidden');
    this.overlay.querySelector('#again-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onRestart?.();
    });
  }

  hideOverlay(): void {
    this.overlay.classList.add('hidden');
  }
}
