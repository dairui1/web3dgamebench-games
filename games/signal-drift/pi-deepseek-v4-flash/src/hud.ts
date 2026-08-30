// DOM HUD: score, objective, relay pips, charge bar, waypoint, toasts, overlays.

export type OverlayKind = 'ready' | 'pause' | 'won' | 'lost' | null;
export type Tone = 'teal' | 'gold';

export interface HudButtons {
  onStart: () => void;
  onResume: () => void;
  onPause: () => void;
  onRestart: () => void;
  onMute: () => void;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class Hud {
  readonly root: HTMLElement;
  private scoreEl: HTMLElement;
  private speedEl: HTMLElement;
  private objEl: HTMLElement;
  private objBox: HTMLElement;
  private pips: HTMLElement[] = [];
  private chargeFill: HTMLElement;
  private chargeText: HTMLElement;
  private chargeBox: HTMLElement;
  private waypoint: HTMLElement;
  private wptDist: HTMLElement;
  private vig: HTMLElement;
  private flash: HTMLElement;
  private toasts: HTMLElement;
  private muteBtn: HTMLElement;
  private overlays = new Map<string, HTMLElement>();
  private on: HudButtons;

  constructor(on: HudButtons) {
    this.on = on;
    const root = document.createElement('div');
    root.id = 'hud';
    root.innerHTML = `
      <div id="score-box" class="corner">
        <div class="label">Score</div>
        <div id="score">0</div>
        <div id="speed-line">V <span id="speed">000</span></div>
      </div>
      <div id="obj-box" class="corner">
        <div id="obj-text">Initialize</div>
        <div id="relay-pips">
          <div class="pip"></div><div class="pip"></div><div class="pip"></div>
        </div>
      </div>
      <div id="right-box">
        <div style="display:flex;gap:6px">
          <button id="btn-mute" title="Mute (M)">♪</button>
          <button id="btn-pause" title="Pause (P)">❚❚</button>
        </div>
      </div>
      <div id="charge-box" class="corner">
        <div id="charge-top">
          <span class="label">Charge</span>
          <span id="charge-text">100</span>
        </div>
        <div id="charge-track"><div id="charge-fill"></div></div>
      </div>
      <div id="kbd-hint">wasd / arrows steer · shift boost · p pause · r restart</div>
      <button id="btn-boost">BOOST</button>
      <div id="joy"><div id="joy-base"></div><div id="joy-knob"></div></div>
      <div id="waypoint" class="hidden"><div class="wp-ring"></div><div class="wp-core"></div><div id="wpt-dist"></div></div>
    `;
    document.body.appendChild(root);
    this.root = root;

    this.scoreEl = root.querySelector('#score')!;
    this.speedEl = root.querySelector('#speed')!;
    this.objEl = root.querySelector('#obj-text')!;
    this.objBox = root.querySelector('#obj-box')!;
    root.querySelectorAll<HTMLElement>('.pip').forEach((p) => this.pips.push(p));
    this.chargeFill = root.querySelector('#charge-fill')!;
    this.chargeText = root.querySelector('#charge-text')!;
    this.chargeBox = root.querySelector('#charge-box')!;
    this.waypoint = root.querySelector('#waypoint')!;
    this.wptDist = root.querySelector('#wpt-dist')!;
    this.vig = document.createElement('div');
    this.vig.id = 'vig';
    document.body.appendChild(this.vig);
    this.flash = document.createElement('div');
    this.flash.id = 'flash';
    document.body.appendChild(this.flash);
    this.toasts = document.createElement('div');
    this.toasts.id = 'toasts';
    document.body.appendChild(this.toasts);
    this.muteBtn = root.querySelector('#btn-mute')!;

    // vignette sits under HUD but over canvas
    this.root.style.zIndex = '10';

    // overlay markup
    const mkOverlay = (id: string, inner: string): void => {
      const o = document.createElement('div');
      o.id = id;
      o.className = 'overlay hidden';
      o.innerHTML = inner;
      document.body.appendChild(o);
      this.overlays.set(id, o);
    };
    mkOverlay(
      'o-ready',
      `
        <div class="o-title">Signal Drift<small>COURIER RUN · RELAY FIELD · STORM</small></div>
        <div class="o-sub">A storm has crippled the relay network above the cloud sea.
        Your courier ship is the only one small enough to slip through the wreckage.</div>
        <div class="o-list">
          <div><b>1 ·</b> Restore the three damaged relay gates, in order.</div>
          <div><b>2 ·</b> Harvest charge orbs to keep the craft alive.</div>
          <div><b>3 ·</b> Dodge storm sentinels, mines and debris.</div>
          <div><b>4 ·</b> Cross the extraction ring to deliver the signal.</div>
        </div>
        <button class="btn" id="btn-start">Engage thrusters</button>
        <div class="key-hint">Space / Enter to launch · wasd or arrows to steer · shift to boost</div>
      `
    );
    mkOverlay(
      'o-lost',
      `
        <div class="o-title lost">Signal Lost<small>COURIER DOWN</small></div>
        <div class="o-sub" id="lost-reason">The craft ran out of charge.</div>
        <div class="o-stats">
          <div class="stat"><b id="lost-score">0</b><span>Score</span></div>
          <div class="stat"><b id="lost-relays">0/3</b><span>Relays</span></div>
          <div class="stat"><b id="lost-time">0s</b><span>Time</span></div>
        </div>
        <div>
          <button class="btn" id="btn-retry">Retry run</button>
        </div>
        <div class="key-hint">R to restart instantly</div>
      `
    );
    mkOverlay(
      'o-won',
      `
        <div class="o-title">Extraction Complete<small>DELIVERY CONFIRMED</small></div>
        <div class="o-sub">The relay field is online and your cargo is safe. Courier work will resume tomorrow.</div>
        <div class="o-stats">
          <div class="stat"><b id="won-score">0</b><span>Score</span></div>
          <div class="stat"><b id="won-time">0s</b><span>Time</span></div>
          <div class="stat"><b id="won-charge">0</b><span>Charge</span></div>
        </div>
        <div>
          <button class="btn" id="btn-again">Run it again</button>
        </div>
        <div class="key-hint">R to restart instantly</div>
      `
    );
    mkOverlay(
      'o-pause',
      `
        <div class="o-title">Paused<small>SIGNAL SUSPENDED</small></div>
        <div class="o-sub">The tab auto-pauses when it leaves focus.</div>
        <div>
          <button class="btn" id="btn-resume">Resume</button>
          <button class="btn ghost" id="btn-restart-pause">Restart</button>
        </div>
        <div class="key-hint">P / Esc to resume</div>
      `
    );

    const wire = (id: string, fn: () => void): void => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };
    wire('btn-start', () => this.on.onStart());
    wire('btn-resume', () => this.on.onResume());
    wire('btn-retry', () => this.on.onRestart());
    wire('btn-again', () => this.on.onRestart());
    wire('btn-restart-pause', () => this.on.onRestart());
    wire('btn-pause', () => this.on.onPause());
    this.muteBtn.addEventListener('click', () => this.on.onMute());
  }

  /* ------------------------------ state ------------------------------ */
  setScore(n: number): void {
    this.scoreEl.textContent = Math.round(n).toString();
  }

  setSpeed(v: number, boosting: boolean): void {
    this.speedEl.textContent = String(Math.round(v)).padStart(3, '0');
    this.speedEl.classList.toggle('speed-boost', boosting);
  }

  setObjective(text: string, warn = false): void {
    this.objEl.textContent = text;
    this.objBox.classList.toggle('warn', warn);
  }

  setPips(restored: number): void {
    this.pips.forEach((p, i) => p.classList.toggle('done', i < restored));
  }

  setCharge(v: number, max: number): void {
    const pct = Math.max(0, Math.min(1, v / max));
    this.chargeFill.style.width = `${pct * 100}%`;
    this.chargeText.textContent = Math.round(v).toString();
    this.chargeBox.classList.toggle('low', v < 34);
    this.chargeBox.classList.toggle('crit', v < 16);
  }

  setVignette(danger: boolean, boost: boolean): void {
    this.vig.classList.toggle('danger', danger);
    this.vig.classList.toggle('boost', boost);
  }

  flashColor(color: 'white' | 'red', strength = 1): void {
    this.flash.classList.toggle('red', color === 'red');
    const el = this.flash;
    el.style.opacity = String(0.55 * strength);
    requestAnimationFrame(() => {
      el.style.transition = 'opacity 0.42s ease-out';
      el.style.opacity = '0';
      setTimeout(() => {
        el.style.transition = '';
      }, 460);
    });
  }

  toast(text: string, x: number, y: number, tone: Tone = 'teal', big = false): void {
    const t = document.createElement('div');
    t.className = `toast ${tone}${big ? ' big' : ''}`;
    t.textContent = text;
    t.style.left = `${x}px`;
    t.style.top = `${y}px`;
    this.toasts.appendChild(t);
    setTimeout(() => t.remove(), 1000);
  }

  waypointShow(x: number, y: number, angleDeg: number, dist: number, gold: boolean): void {
    this.waypoint.classList.remove('hidden');
    this.waypoint.classList.toggle('gold', gold);
    this.waypoint.style.left = `${x}px`;
    this.waypoint.style.top = `${y}px`;
    this.waypoint.style.transform = `rotate(${angleDeg}deg)`;
    this.wptDist.textContent = dist < 10 ? '' : `${Math.round(dist)}m`;
  }

  waypointHide(): void {
    this.waypoint.classList.add('hidden');
  }

  /* ------------------------------ overlays ------------------------------ */
  showOverlay(kind: OverlayKind): void {
    for (const [id, el] of this.overlays) el.classList.toggle('hidden', id !== `o-${kind ?? 'none'}`);
    this.root.classList.toggle('hidden', !!kind);
  }

  setLostStats(reason: string, score: number, relays: number, time: number): void {
    document.getElementById('lost-reason')!.textContent = reason;
    document.getElementById('lost-score')!.textContent = Math.round(score).toString();
    document.getElementById('lost-relays')!.textContent = `${relays}/3`;
    document.getElementById('lost-time')!.textContent = `${time.toFixed(1)}s`;
  }

  setWonStats(score: number, time: number, charge: number): void {
    document.getElementById('won-score')!.textContent = Math.round(score).toString();
    document.getElementById('won-time')!.textContent = `${time.toFixed(1)}s`;
    document.getElementById('won-charge')!.textContent = Math.round(charge).toString();
  }

  setMuteIcon(muted: boolean): void {
    this.muteBtn.textContent = muted ? '×♪' : '♪';
  }
}