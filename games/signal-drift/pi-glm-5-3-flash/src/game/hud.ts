export interface WinStats {
  score: number;
  cellCount: number;
  elapsed: number;
  timeBonus: number;
}

export interface LoseStats {
  reason: string;
  score: number;
  relays: number;
}

export type OverlayKind = 'title' | 'paused' | 'won' | 'lost' | null;

export interface HudCallbacks {
  onStart: () => void;
  onResume: () => void;
  onRestart: () => void;
}

/** All DOM UI: in-play HUD, toasts, overlays, touch controls. */
export class Hud {
  private chargeFill: HTMLElement;
  private chargeNum: HTMLElement;
  private chargeWrap: HTMLElement;
  private pips: HTMLElement[] = [];
  private relayText: HTMLElement;
  private objective: HTMLElement;
  private score: HTMLElement;
  private speed: HTMLElement;
  private hint: HTMLElement;
  private toasts: HTMLElement;
  private vignette: HTMLElement;
  private hitflash: HTMLElement;
  private speedlines: HTMLElement;
  private overlay: HTMLElement;
  private joyBase: HTMLElement;
  private joyKnob: HTMLElement;
  private boostBtn: HTMLElement;
  private toastCount = 0;

  constructor(private cb: HudCallbacks) {
    const hud = document.createElement('div');
    hud.id = 'hud';
    hud.innerHTML = `
      <div id="hud-left">
        <div id="charge-wrap">
          <div class="hud-label">CHARGE</div>
          <div id="charge-bar"><div id="charge-fill"></div></div>
          <div id="charge-num">100</div>
        </div>
        <div id="relay-row">
          <div class="pip"></div><div class="pip"></div><div class="pip"></div>
          <span id="relay-text">RELAYS 0/3</span>
        </div>
        <div id="objective"></div>
      </div>
      <div id="hud-right">
        <div id="score">000000</div>
        <div id="speed">36 u/s</div>
      </div>
      <div id="hint"></div>
      <div id="toasts"></div>
      <div id="vignette"></div>
      <div id="hitflash"></div>
      <div id="speedlines"></div>
    `;
    document.body.appendChild(hud);

    const touchUi = document.createElement('div');
    touchUi.id = 'touch-ui';
    touchUi.innerHTML = `
      <div id="joy-hint"></div>
      <div id="joy-base"><div id="joy-knob"></div></div>
      <div id="boost-btn">BOOST</div>
    `;
    document.body.appendChild(touchUi);

    const layer = document.createElement('div');
    layer.id = 'touch-layer';
    document.body.appendChild(layer);
    this.touchLayer = layer;

    this.overlay = document.createElement('div');
    this.overlay.id = 'overlay';
    document.body.appendChild(this.overlay);

    this.chargeFill = document.getElementById('charge-fill')!;
    this.chargeNum = document.getElementById('charge-num')!;
    this.chargeWrap = document.getElementById('charge-wrap')!;
    this.pips = Array.from(document.querySelectorAll('.pip')) as HTMLElement[];
    this.relayText = document.getElementById('relay-text')!;
    this.objective = document.getElementById('objective')!;
    this.score = document.getElementById('score')!;
    this.speed = document.getElementById('speed')!;
    this.hint = document.getElementById('hint')!;
    this.toasts = document.getElementById('toasts')!;
    this.vignette = document.getElementById('vignette')!;
    this.hitflash = document.getElementById('hitflash')!;
    this.speedlines = document.getElementById('speedlines')!;
    this.joyBase = document.getElementById('joy-base')!;
    this.joyKnob = document.getElementById('joy-knob')!;
    this.boostBtn = document.getElementById('boost-btn')!;

    this.boostBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.boostBtn.classList.add('active');
    });
    const boostRelease = () => this.boostBtn.classList.remove('active');
    this.boostBtn.addEventListener('pointerup', boostRelease);
    this.boostBtn.addEventListener('pointercancel', boostRelease);
    this.boostBtn.addEventListener('pointerleave', boostRelease);

    this.setTouchVisible(false);
    this.setHudVisible(false);
    this.showOverlay('title');
  }

  private touchLayer: HTMLElement;

  getTouchLayer(): HTMLElement {
    return this.touchLayer;
  }

  /* ---------------- in-play HUD ---------------- */

  setCharge(v: number, low: boolean): void {
    const pct = Math.max(0, Math.min(100, v));
    this.chargeFill.style.width = `${pct}%`;
    this.chargeNum.textContent = `${Math.max(0, Math.ceil(v))}`;
    this.chargeWrap.classList.toggle('low', low);
  }

  setRelays(n: number): void {
    this.pips.forEach((p, i) => {
      p.classList.toggle('lit', i < n);
      p.classList.toggle('next', i === n);
    });
    this.relayText.textContent = `RELAYS ${n}/3`;
  }

  setObjective(text: string): void {
    if (this.objective.textContent !== text) this.objective.textContent = text;
  }

  setScore(n: number): void {
    this.score.textContent = `${Math.max(0, Math.round(n))}`.padStart(6, '0');
  }

  setSpeed(v: number): void {
    this.speed.textContent = `${Math.round(v)} u/s`;
  }

  setHint(text: string): void {
    this.hint.innerHTML = text;
    this.hint.classList.add('visible');
  }

  fadeHint(): void {
    this.hint.classList.remove('visible');
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
    if (this.toastCount >= 3) return;
    this.toastCount++;
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toasts.appendChild(el);
    window.setTimeout(() => el.classList.add('show'), 16);
    window.setTimeout(() => {
      el.classList.remove('show');
      window.setTimeout(() => {
        el.remove();
        this.toastCount--;
      }, 320);
    }, 1900);
  }

  setDanger(v: number): void {
    this.vignette.style.opacity = `${Math.min(1, Math.max(0, v))}`;
  }

  setSpeedlines(v: number): void {
    this.speedlines.style.opacity = `${Math.min(1, Math.max(0, v))}`;
  }

  hitFlash(): void {
    this.hitflash.classList.remove('flash');
    void this.hitflash.offsetWidth;
    this.hitflash.classList.add('flash');
  }

  /* ---------------- touch visuals ---------------- */

  setTouchVisible(v: boolean): void {
    document.getElementById('touch-ui')!.style.display = v ? 'block' : 'none';
  }

  setHudVisible(v: boolean): void {
    document.getElementById('hud')!.classList.toggle('hidden', !v);
  }

  showJoy(x: number, y: number): void {
    this.joyBase.style.display = 'block';
    this.joyBase.style.left = `${x}px`;
    this.joyBase.style.top = `${y}px`;
    this.moveJoy(0, 0);
  }

  moveJoy(dx: number, dy: number): void {
    this.joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  hideJoy(): void {
    this.joyBase.style.display = 'none';
  }

  setBoostVisual(v: boolean): void {
    this.boostBtn.classList.toggle('active', v);
  }

  /* ---------------- overlays ---------------- */

  showOverlay(kind: Exclude<OverlayKind, null>, stats?: WinStats | LoseStats): void {
    const el = this.overlay;
    el.classList.remove('hidden');
    el.className = kind === 'title' ? 'title-mode' : '';
    el.id = 'overlay';

    if (kind === 'title') {
      el.innerHTML = `
        <div class="panel title-panel">
          <div class="eyebrow">STORM-DAMAGED RELAY FIELD · SECTOR 7</div>
          <h1>SIGNAL<span> DRIFT</span></h1>
          <p class="tagline">The grid is down and the storm took the relays offline.<br>
          Fly the courier corridor above the cloud sea and bring the signal home.</p>
          <ul class="mission">
            <li><b>RESTORE THE RELAYS</b> — fly through gates 1 → 2 → 3, in order</li>
            <li><b>STAY CHARGED</b> — collect cells; if charge hits zero, you fall</li>
            <li><b>AVOID THE STORM</b> — mines, cutters and arc lightning</li>
            <li><b>EXTRACT</b> — cross the extraction ring once it comes online</li>
          </ul>
          <div class="controls-row">
            <div class="ctrl"><span class="key">W A S D</span> / arrows — steer</div>
            <div class="ctrl"><span class="key">SHIFT</span> — boost</div>
            <div class="ctrl"><span class="key">P</span> — pause</div>
            <div class="ctrl"><span class="key">M</span> — sound</div>
            <div class="ctrl touch-only">touch left — steer · right — boost</div>
          </div>
          <button id="btn-start" class="btn primary">▶ BEGIN RUN</button>
          <div class="foot desktop-only">press ENTER to launch</div>
          <div class="foot touch-only">tap BEGIN RUN to launch</div>
        </div>`;
      document.getElementById('btn-start')!.addEventListener('click', () => this.cb.onStart());
    } else if (kind === 'paused') {
      el.innerHTML = `
        <div class="panel">
          <h2>PAUSED</h2>
          <p class="tagline">The storm waits for no courier.</p>
          <div class="btn-row">
            <button id="btn-resume" class="btn primary">RESUME</button>
            <button id="btn-restart" class="btn">RESTART RUN</button>
          </div>
          <div class="foot">P / ESC to resume</div>
        </div>`;
      document.getElementById('btn-resume')!.addEventListener('click', () => this.cb.onResume());
      document.getElementById('btn-restart')!.addEventListener('click', () => this.cb.onRestart());
    } else if (kind === 'won') {
      const s = stats as WinStats;
      el.innerHTML = `
        <div class="panel">
          <div class="eyebrow good">SIGNAL RESTORED · GRID ONLINE</div>
          <h2 class="good">EXTRACTION COMPLETE</h2>
          <div class="stats">
            <div class="stat"><span>Relays restored</span><b>3 / 3</b></div>
            <div class="stat"><span>Charge cells</span><b>${s.cellCount}</b></div>
            <div class="stat"><span>Run time</span><b>${s.elapsed.toFixed(1)}s</b></div>
            <div class="stat"><span>Time bonus</span><b>+${s.timeBonus}</b></div>
            <div class="stat total"><span>FINAL SCORE</span><b>${s.score}</b></div>
          </div>
          <button id="btn-again" class="btn primary">FLY AGAIN</button>
          <div class="foot">press ENTER to relaunch</div>
        </div>`;
      document.getElementById('btn-again')!.addEventListener('click', () => this.cb.onRestart());
    } else {
      const s = stats as LoseStats;
      el.innerHTML = `
        <div class="panel">
          <div class="eyebrow bad">TRANSMISSION TERMINATED</div>
          <h2 class="bad">SIGNAL LOST</h2>
          <p class="tagline">${s.reason}</p>
          <div class="stats">
            <div class="stat"><span>Relays restored</span><b>${s.relays} / 3</b></div>
            <div class="stat total"><span>SCORE</span><b>${s.score}</b></div>
          </div>
          <button id="btn-retry" class="btn primary">RETRY RUN</button>
          <div class="foot">press ENTER to relaunch</div>
        </div>`;
      document.getElementById('btn-retry')!.addEventListener('click', () => this.cb.onRestart());
    }
  }

  hideOverlay(): void {
    this.overlay.classList.add('hidden');
  }
}
