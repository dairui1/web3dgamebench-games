import { clamp } from './util';

export type Phase = 'ready' | 'playing' | 'paused' | 'won' | 'lost';

export interface HudSnapshot {
  phase: Phase;
  charge: number;
  chargeMax: number;
  relays: number;
  objective: string;
  distance: number;
  score: number;
  speed: number;
  maxSpeed: number;
  throttle01: number;
  boosting: boolean;
  elapsedMs: number;
  impacts: number;
  cellsLeft: number;
  danger: number;
  lowCharge: boolean;
  shear: 'none' | 'top' | 'bottom';
  fps: number;
  best: number;
  message: string;
}

const RELAY_LABELS = ['01', '02', '03'];

/** DOM HUD, overlays and the touch control chrome. */
export class Hud {
  readonly root: HTMLElement;
  readonly playSurface: HTMLElement;
  readonly boostButton: HTMLElement;
  readonly brakeButton: HTMLElement;
  readonly stick: HTMLElement;
  private chargeFill: HTMLElement;
  private chargeValue: HTMLElement;
  private relayPips: HTMLElement[] = [];
  private objectiveLine: HTMLElement;
  private distanceLine: HTMLElement;
  private scoreValue: HTMLElement;
  private clockValue: HTMLElement;
  private fpsValue: HTMLElement;
  private speedValue: HTMLElement;
  private throttleFill: HTMLElement;
  private reticle: HTMLElement;
  private reticleRing: HTMLElement;
  private reticleTag: HTMLElement;
  private warnBand: HTMLElement;
  private damageVeil: HTMLElement;
  private chargeVeil: HTMLElement;
  private overlays: Record<Phase | 'none', HTMLElement | null>;
  private messageValue: HTMLElement;
  private statLines: Record<string, HTMLElement>;
  private readyStats: HTMLElement;
  private buttons: { pause: HTMLElement; mute: HTMLElement };
  private lastWarn = '';
  private flashTimer = 0;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'sd-hud';
    this.root.innerHTML = HUD_MARKUP;
    container.appendChild(this.root);

    const q = <T extends HTMLElement>(sel: string): T => {
      const el = this.root.querySelector(sel) as T | null;
      if (!el) throw new Error(`HUD element missing: ${sel}`);
      return el;
    };

    this.playSurface = q('.sd-surface');
    this.boostButton = q('[data-ctrl="boost"]');
    this.brakeButton = q('[data-ctrl="brake"]');
    this.stick = q('.sd-stick');
    this.chargeFill = q('.sd-charge__fill');
    this.chargeValue = q('.sd-charge__value');
    this.relayPips = Array.from(this.root.querySelectorAll('.sd-pip')) as HTMLElement[];
    this.objectiveLine = q('.sd-objective__title');
    this.distanceLine = q('.sd-objective__dist');
    this.scoreValue = q('.sd-score__value');
    this.clockValue = q('.sd-clock__value');
    this.fpsValue = q('.sd-fps__value');
    this.speedValue = q('.sd-speed__value');
    this.throttleFill = q('.sd-throttle__fill');
    this.reticle = q('.sd-reticle');
    this.reticleRing = q('.sd-reticle__ring');
    this.reticleTag = q('.sd-reticle__tag');
    this.warnBand = q('.sd-warn');
    this.damageVeil = q('.sd-veil--damage');
    this.chargeVeil = q('.sd-veil--charge');
    this.messageValue = q('.sd-message');
    this.readyStats = q('.sd-ready__field');
    this.statLines = {
      time: q('[data-stat="time"]'),
      score: q('[data-stat="score"]'),
      relays: q('[data-stat="relays"]'),
      charge: q('[data-stat="charge"]'),
      impacts: q('[data-stat="impacts"]'),
      cells: q('[data-stat="cells"]'),
      best: q('[data-stat="best"]'),
    };
    this.buttons = {
      pause: q('[data-action="pause"]'),
      mute: q('[data-action="mute"]'),
    };

    this.overlays = {
      ready: q('#sd-screen-ready'),
      playing: null,
      paused: q('#sd-screen-paused'),
      won: q('#sd-screen-won'),
      lost: q('#sd-screen-lost'),
      none: null,
    };
  }

  get pauseButton(): HTMLElement {
    return this.buttons.pause;
  }

  get muteButton(): HTMLElement {
    return this.buttons.mute;
  }

  setMuted(muted: boolean): void {
    this.buttons.mute.textContent = muted ? 'audio off' : 'audio on';
    this.buttons.mute.classList.toggle('is-off', muted);
  }

  setTouchMode(on: boolean): void {
    this.root.classList.toggle('is-touch', on);
  }

  /** Transient toast used for pickups, gate state and warnings. */
  flash(message: string, tone: 'good' | 'bad' | 'info' = 'info'): void {
    this.messageValue.textContent = message;
    this.messageValue.className = `sd-message is-${tone}`;
    this.messageValue.style.opacity = '1';
    this.flashTimer = 1.6;
  }

  showPhase(phase: Phase): void {
    (Object.keys(this.overlays) as (keyof typeof this.overlays)[]).forEach((key) => {
      const el = this.overlays[key];
      if (el) el.classList.toggle('is-open', key === phase && phase !== 'playing');
    });
    this.root.classList.toggle('is-playing', phase === 'playing');
    this.root.dataset.phase = phase;
  }

  setReadySummary(text: string): void {
    this.readyStats.textContent = text;
  }

  private formatClock(ms: number): string {
    const total = Math.max(0, ms);
    const s = Math.floor(total / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  update(snapshot: HudSnapshot, dt: number): void {
    const charge01 = clamp(snapshot.charge / snapshot.chargeMax, 0, 1);
    this.chargeFill.style.width = `${(charge01 * 100).toFixed(1)}%`;
    this.chargeFill.style.background = charge01 < 0.25 ? 'var(--sd-bad)' : charge01 < 0.5 ? 'var(--sd-warn)' : 'var(--sd-good)';
    this.chargeValue.textContent = `${Math.round(snapshot.charge)}`;
    this.objectiveLine.textContent = snapshot.objective;
    this.distanceLine.textContent = Number.isFinite(snapshot.distance)
      ? `${Math.round(snapshot.distance)} m`
      : '-- m';
    this.scoreValue.textContent = Math.round(snapshot.score).toLocaleString('en-US');
    this.clockValue.textContent = this.formatClock(snapshot.elapsedMs);
    this.fpsValue.textContent = `${Math.round(snapshot.fps)}`;
    this.speedValue.textContent = `${Math.round(snapshot.speed * 3.2)}`;
    this.throttleFill.style.height = `${(clamp(snapshot.throttle01, 0, 1) * 100).toFixed(1)}%`;

    this.relayPips.forEach((pip, i) => {
      pip.classList.toggle('is-done', i < snapshot.relays);
      pip.classList.toggle('is-next', i === snapshot.relays);
    });

    // Warning band.
    let warn = '';
    if (snapshot.shear === 'top') warn = 'STORM SHEAR — DESCEND';
    else if (snapshot.shear === 'bottom') warn = 'CLOUD SHEAR — CLIMB';
    else if (snapshot.lowCharge) warn = 'CHARGE CRITICAL';
    else if (snapshot.danger > 0.55) warn = 'HAZARD PROXIMITY';
    if (warn !== this.lastWarn) {
      this.warnBand.textContent = warn;
      this.lastWarn = warn;
    }
    this.warnBand.classList.toggle('is-on', warn !== '');
    this.warnBand.classList.toggle('is-pulse', warn !== '' && (snapshot.lowCharge || snapshot.shear !== 'none'));

    const damageVeil = clamp(snapshot.danger * 0.35, 0, 0.5);
    this.damageVeil.style.opacity = `${damageVeil.toFixed(3)}`;
    this.chargeVeil.style.opacity = snapshot.lowCharge
      ? `${(0.22 + 0.16 * Math.sin(performance.now() / 160)).toFixed(3)}`
      : '0';

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.messageValue.style.opacity = '0';
    }

    if (snapshot.phase === 'won' || snapshot.phase === 'lost') {
      this.statLines.time.textContent = this.formatClock(snapshot.elapsedMs);
      this.statLines.score.textContent = Math.round(snapshot.score).toLocaleString('en-US');
      this.statLines.relays.textContent = `${snapshot.relays} / 3`;
      this.statLines.charge.textContent = `${Math.round(snapshot.charge)}%`;
      this.statLines.impacts.textContent = `${snapshot.impacts}`;
      this.statLines.cells.textContent = `${46 - snapshot.cellsLeft} / 46`;
      this.statLines.best.textContent = Math.round(Math.max(snapshot.best, snapshot.score)).toLocaleString('en-US');
    }
  }

  /** Screen-space marker for the current objective. */
  setReticle(x: number, y: number, visible: boolean, label: string, offscreenDir: number | null): void {
    this.reticle.style.opacity = visible ? '1' : '0.7';
    this.reticle.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
    this.reticle.classList.toggle('is-edge', !visible);
    this.reticleTag.textContent = label;
    if (offscreenDir !== null) {
      this.reticle.style.setProperty('--sd-arrow', `${offscreenDir}rad`);
    }
  }
}

const HUD_MARKUP = /* html */ `
  <div class="sd-surface"></div>
  <div class="sd-veil sd-veil--damage"></div>
  <div class="sd-veil sd-veil--charge"></div>

  <div class="sd-panel sd-panel--top-left">
    <div class="sd-brand">
      <span class="sd-brand__mark"></span>
      <span class="sd-brand__text">SIGNAL<em>DRIFT</em></span>
    </div>
    <div class="sd-meta">
      <span class="sd-clock"><i>T</i><span class="sd-clock__value">0:00</span></span>
      <span class="sd-score"><i>SCORE</i><span class="sd-score__value">0</span></span>
      <span class="sd-fps"><span class="sd-fps__value">60</span>fps</span>
    </div>
  </div>

  <div class="sd-panel sd-panel--charge">
    <div class="sd-charge">
      <div class="sd-charge__head">
        <span class="sd-label">CHARGE</span>
        <span class="sd-charge__value">100</span>
      </div>
      <div class="sd-charge__track"><div class="sd-charge__fill"></div></div>
      <div class="sd-ticks"><i></i><i></i><i></i><i></i></div>
    </div>
    <div class="sd-relays">
      <span class="sd-label">RELAYS</span>
      <div class="sd-pips">
        ${RELAY_LABELS.map((l) => `<div class="sd-pip"><span>${l}</span></div>`).join('')}
      </div>
    </div>
    <div class="sd-objective">
      <span class="sd-objective__title">STAND BY</span>
      <span class="sd-objective__dist">-- m</span>
    </div>
  </div>

  <div class="sd-panel sd-panel--speed">
    <div class="sd-throttle"><div class="sd-throttle__fill"></div></div>
    <div class="sd-speed">
      <span class="sd-speed__value">0</span>
      <span class="sd-label">m/s x3.2</span>
    </div>
  </div>

  <div class="sd-panel sd-panel--top-right">
    <button class="sd-btn" data-action="pause" type="button">pause</button>
    <button class="sd-btn" data-action="mute" type="button">audio on</button>
  </div>

  <div class="sd-warn"></div>
  <div class="sd-message"></div>
  <div class="sd-reticle"><div class="sd-reticle__ring"></div><span class="sd-reticle__tag"></span></div>

  <div class="sd-touch">
    <div class="sd-stick"><i class="sd-stick__knob"></i></div>
    <div class="sd-touch__hint left">drag to steer</div>
    <div class="sd-touch__hint right">drag: throttle</div>
    <div class="sd-touch__pads">
      <button class="sd-pad sd-pad--brake" data-ctrl="brake" type="button">brake</button>
      <button class="sd-pad sd-pad--boost" data-ctrl="boost" type="button">boost</button>
    </div>
  </div>

  <section class="sd-screen" id="sd-screen-ready">
    <div class="sd-card">
      <p class="sd-kicker">COURIER CONTRACT 0<b>94721</b> · RELAY FIELD KEPLER-DRIFT</p>
      <h1 class="sd-title">SIGNAL<span>DRIFT</span></h1>
      <p class="sd-blurb">
        The storm tore the tether apart. Ride the courier hull out over the cloud sea,
        bring power back to <b>three relay gates in order</b>, and burn for the extraction
        ring before the cells run dry.
      </p>
      <div class="sd-cols">
        <div class="sd-col">
          <h2>OBJECTIVE</h2>
          <ol>
            <li>Collect <b>charge cells</b> — they keep the hull alive.</li>
            <li>Punch <b>RELAY 01 → 02 → 03</b> in order through the gate mouth.</li>
            <li>Dodge sweepers, storm cells and discharge arcs.</li>
            <li>Cross the <b>extraction ring</b> to win the contract.</li>
          </ol>
        </div>
        <div class="sd-col sd-col--keys">
          <h2>CONTROLS</h2>
          <p class="sd-keys"><b>W A S D</b> / arrows — climb, dive, turn</p>
          <p class="sd-keys"><b>Q E</b> — roll &nbsp; <b>SHIFT</b> — boost</p>
          <p class="sd-keys"><b>SPACE</b> — air brake &nbsp; <b>drag</b> — pointer steering</p>
          <p class="sd-keys"><b>P</b> — pause &nbsp; <b>R</b> — restart &nbsp; <b>M</b> — audio</p>
          <p class="sd-keys sd-keys--touch">Phone: left thumb steers, right thumb trims throttle, pads boost &amp; brake.</p>
        </div>
      </div>
      <button class="sd-cta" data-action="begin" type="button">BEGIN RUN <span>enter</span></button>
      <p class="sd-ready__field">Field seeded 94721 · deterministic hazard lanes</p>
    </div>
  </section>

  <section class="sd-screen" id="sd-screen-paused">
    <div class="sd-card sd-card--small">
      <p class="sd-kicker">TETHER HOLD</p>
      <h1 class="sd-title sd-title--small">PAUSED</h1>
      <p class="sd-blurb">Charge draw is suspended. The storm is not.</p>
      <div class="sd-row">
        <button class="sd-cta" data-action="resume" type="button">RESUME <span>p</span></button>
        <button class="sd-ghost" data-action="restart" type="button">restart run</button>
      </div>
    </div>
  </section>

  <section class="sd-screen" id="sd-screen-won">
    <div class="sd-card">
      <p class="sd-kicker is-good">CONTRACT CLOSED</p>
      <h1 class="sd-title sd-title--win">SIGNAL<span>RESTORED</span></h1>
      <p class="sd-blurb">All three relays are humming and the extraction ring logged your hull. The tether holds.</p>
      <ul class="sd-stats">
        <li><span>time</span><b data-stat="time">0:00</b></li>
        <li><span>relays</span><b data-stat="relays">0 / 3</b></li>
        <li><span>cells</span><b data-stat="cells">0 / 46</b></li>
        <li><span>impacts</span><b data-stat="impacts">0</b></li>
        <li><span>charge left</span><b data-stat="charge">0%</b></li>
        <li><span>score</span><b data-stat="score">0</b></li>
      </ul>
      <div class="sd-row">
        <button class="sd-cta" data-action="restart" type="button">FLY AGAIN <span>r</span></button>
      </div>
    </div>
  </section>

  <section class="sd-screen" id="sd-screen-lost">
    <div class="sd-card">
      <p class="sd-kicker is-bad">SIGNAL LOST</p>
      <h1 class="sd-title sd-title--lose">HULL<em>DRIFT</em></h1>
      <p class="sd-blurb">Charge ran dry and the courier dropped into the cloud sea. The tether waits for another run.</p>
      <ul class="sd-stats">
        <li><span>time</span><b data-stat="time">0:00</b></li>
        <li><span>relays</span><b data-stat="relays">0 / 3</b></li>
        <li><span>cells</span><b data-stat="cells">0 / 46</b></li>
        <li><span>impacts</span><b data-stat="impacts">0</b></li>
        <li><span>best score</span><b data-stat="best">0</b></li>
        <li><span>score</span><b data-stat="score">0</b></li>
      </ul>
      <div class="sd-row">
        <button class="sd-cta" data-action="restart" type="button">RESTART <span>r</span></button>
      </div>
    </div>
  </section>
`;
