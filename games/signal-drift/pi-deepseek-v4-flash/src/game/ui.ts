export interface UIStats {
  charge: number;
  relaysRestored: number;
  score: number;
  speed: number;
  boosting: boolean;
  timeMs: number;
  orbs: number;
  hits: number;
}

export interface UICallbacks {
  onStart: () => void;
  onResume: () => void;
  onRestart: () => void;
  onMute: () => void;
}

export class UI {
  private hud: HTMLElement;
  private chargeFill: HTMLElement;
  private chargeWrap: HTMLElement;
  private pips: HTMLElement[];
  private objectiveEl: HTMLElement;
  private scoreEl: HTMLElement;
  private speedEl: HTMLElement;
  private timeEl: HTMLElement;
  private boostVignette: HTMLElement;
  private damageVignette: HTMLElement;
  private flashEl: HTMLElement;
  private hintEl: HTMLElement;
  private muteBtn: HTMLElement;
  private winStats: HTMLElement;
  private title: HTMLElement;
  private paused: HTMLElement;
  private won: HTMLElement;
  private lost: HTMLElement;
  private lostReason: HTMLElement;
  private flashing = 0;
  private lastFlashT = 0;

  constructor(root: HTMLElement, cb: UICallbacks) {
    root.innerHTML = `
      <div id="hud">
        <div id="top-left">
          <div class="panel">
            <div class="hud-label">CHARGE</div>
            <div id="charge-wrap"><div id="charge-fill"></div></div>
            <div id="relay-pips"></div>
          </div>
        </div>
        <div id="top-center"><div id="objective" class="panel"></div></div>
        <div id="top-right">
          <div class="panel"><div class="hud-label">SCORE</div><div id="score">0</div></div>
        </div>
        <div id="root-corner">
          <div class="panel"><div class="hud-label">T+</div><div id="time">0:00</div></div>
          <div class="panel"><div class="hud-label">SPD</div><div id="speed">0</div></div>
        </div>
        <div id="boost-vignette"></div>
        <div id="damage-vignette"></div>
        <div id="flash"></div>
        <div id="hint" class="touch-only">drag / swipe to steer · tap = boost</div>
        <button id="btn-mute" aria-label="toggle sound">♪</button>
      </div>

      <div id="title" class="overlay">
        <div class="panel big">
          <div class="logo">SIGNAL&nbsp;DRIFT</div>
          <div class="tagline">a courier run through a storm-damaged relay field</div>
          <div class="mission">
            <div class="mission-item"><span class="dot dot-amber"></span>Restore <b>3 relay gates</b> in order</div>
            <div class="mission-item"><span class="dot dot-cyan"></span>Collect <b>charge orbs</b> — charge drains every second</div>
            <div class="mission-item"><span class="dot dot-red"></span>Evade <b>drift debris, drones and lightning</b></div>
            <div class="mission-item"><span class="dot dot-gold"></span>Cross the <b>extraction ring</b> to deliver</div>
          </div>
          <div class="controls">
            <div class="kbd-row"><span class="kbd">W A S D</span><span class="kbd">↑ ↓ ← →</span> steer</div>
            <div class="kbd-row"><span class="kbd">SHIFT</span> / <span class="kbd">SPACE</span> boost <span class="sep">·</span> <span class="kbd">P</span> pause <span class="sep">·</span> <span class="kbd">R</span> restart</div>
            <div class="kbd-row touch-only"><span class="kbd">drag</span> steer <span class="sep">·</span> <span class="kbd">tap</span> boost</div>
          </div>
          <button id="btn-start" class="primary">BEGIN DELIVERY</button>
        </div>
      </div>

      <div id="paused" class="overlay">
        <div class="panel big">
          <div class="logo small">SIGNAL DRIFT</div>
          <div class="title-line">PAUSED</div>
          <div class="pause-note">flight systems on hold</div>
          <button id="btn-resume" class="primary">RESUME</button>
          <button id="btn-restart-p" class="ghost">RESTART FLIGHT</button>
        </div>
      </div>

      <div id="won" class="overlay">
        <div class="panel big">
          <div class="title-line gold">EXTRACTION COMPLETE</div>
          <div class="tagline">the courier package is through — signal drift delivered</div>
          <div id="win-stats" class="stats"></div>
          <button id="btn-again" class="primary">DELIVER AGAIN</button>
        </div>
      </div>

      <div id="lost" class="overlay">
        <div class="panel big">
          <div class="title-line red">SIGNAL LOST</div>
          <div class="tagline">the courier is gone</div>
          <div id="lost-reason" class="pause-note"></div>
          <button id="btn-relaunch" class="primary">RELAUNCH</button>
        </div>
      </div>
    `;

    const $ = (id: string): HTMLElement => root.querySelector<HTMLElement>(`#${id}`)!;
    this.hud = $('hud');
    this.chargeFill = $('charge-fill');
    this.chargeWrap = $('charge-wrap');
    this.objectiveEl = $('objective');
    this.scoreEl = $('score');
    this.speedEl = $('speed');
    this.timeEl = $('time');
    this.boostVignette = $('boost-vignette');
    this.damageVignette = $('damage-vignette');
    this.flashEl = $('flash');
    this.hintEl = $('hint');
    this.muteBtn = $('btn-mute');
    this.winStats = $('win-stats');
    this.title = $('title');
    this.paused = $('paused');
    this.won = $('won');
    this.lost = $('lost');
    this.lostReason = $('lost-reason');
    this.pips = [];
    for (let i = 0; i < 3; i++) {
      const pip = document.createElement('div');
      pip.className = 'pip';
      this.pips.push(pip);
      $('relay-pips').appendChild(pip);
    }

    $('btn-start').addEventListener('click', () => cb.onStart());
    $('btn-resume').addEventListener('click', () => cb.onResume());
    $('btn-restart-p').addEventListener('click', () => cb.onRestart());
    $('btn-again').addEventListener('click', () => cb.onRestart());
    $('btn-relaunch').addEventListener('click', () => cb.onRestart());
    this.muteBtn.addEventListener('click', () => cb.onMute());
  }

  setObjective(text: string): void {
    this.objectiveEl.textContent = text;
  }

  /** Per-frame HUD update. Returns whether a layout change happened. */
  update(stats: UIStats, nowMs: number): void {
    const ch = Math.max(0, Math.min(100, stats.charge));
    this.chargeFill.style.width = `${ch}%`;
    this.chargeFill.style.background = ch > 45
      ? 'linear-gradient(90deg,#2fe3c0,#9ff6e2)'
      : ch > 22
        ? 'linear-gradient(90deg,#ffc14d,#ffe3a1)'
        : 'linear-gradient(90deg,#ff4d4d,#ff9a6b)';
    this.chargeWrap.classList.toggle('low', ch <= 22);
    for (let i = 0; i < 3; i++) {
      this.pips[i].classList.toggle('on', i < stats.relaysRestored);
      this.pips[i].classList.toggle('next', i === stats.relaysRestored);
    }
    this.scoreEl.textContent = String(Math.floor(stats.score));
    this.speedEl.textContent = String(Math.floor(stats.speed * 1.6));
    const s = Math.floor(stats.timeMs / 1000);
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    this.timeEl.textContent = `${mm}:${ss.toString().padStart(2, '0')}`;
    this.boostVignette.style.opacity = stats.boosting ? '1' : '0';

    // flashes (dom-driven, time based)
    if (this.flashing > 0) {
      const t = nowMs - this.lastFlashT;
      const a = this.flashing * Math.max(0, 0.65 - t / 300);
      this.flashEl.style.opacity = String(a.toFixed(3));
      if (a <= 0.01) {
        this.flashing = 0;
        this.flashEl.style.opacity = '0';
      }
    }
  }

  flash(color: string, amount = 1): void {
    this.flashEl.style.background = color;
    this.flashing = amount;
    this.lastFlashT = performance.now();
  }

  pulseDamage(): void {
    this.damageVignette.classList.remove('pulse');
    void this.damageVignette.offsetWidth;
    this.damageVignette.classList.add('pulse');
  }

  showOverlay(phase: 'ready' | 'paused' | 'won' | 'lost' | null): void {
    this.title.classList.toggle('hidden', phase !== 'ready');
    this.paused.classList.toggle('hidden', phase !== 'paused');
    this.won.classList.toggle('hidden', phase !== 'won');
    this.lost.classList.toggle('hidden', phase !== 'lost');
    this.hud.classList.toggle('hidden', phase === 'ready');
  }

  showWinStats(stats: { timeMs: number; orbs: number; relays: number; score: number; hits: number }): void {
    const s = Math.floor(stats.timeMs / 1000);
    this.winStats.innerHTML = `
      <div class="stat-row"><span>flight time</span><b>${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}</b></div>
      <div class="stat-row"><span>charge orbs</span><b>${stats.orbs}</b></div>
      <div class="stat-row"><span>relays restored</span><b>${stats.relays}</b></div>
      <div class="stat-row"><span>hazard hits</span><b>${stats.hits}</b></div>
      <div class="stat-row total"><span>score</span><b>${Math.floor(stats.score)}</b></div>
    `;
  }

  setLostReason(text: string): void {
    this.lostReason.textContent = text;
  }

  setMuted(muted: boolean): void {
    this.muteBtn.textContent = muted ? '×' : '♪';
    this.muteBtn.classList.toggle('off', muted);
  }

  get isTouchHintVisible(): boolean {
    return this.hintEl.offsetParent !== null;
  }
}