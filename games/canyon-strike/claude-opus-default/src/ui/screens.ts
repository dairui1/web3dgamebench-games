export interface ObjectiveEntry {
  label: string;
  done: boolean;
  active?: boolean;
}

export interface ResultStats {
  win: boolean;
  title: string;
  reason: string;
  score: number;
  targets: string;
  air: number;
  ground: number;
  time: string;
  accuracy: number;
  hull: number;
  rank: string;
}

const BRIEFING_HTML = `
  <div class="panel">
    <div class="tag">MISSION 01 &mdash; OPERATION CANYON STRIKE</div>
    <h1>CANYON<span>STRIKE</span></h1>
    <p class="lede">
      Talon 1, you are cleared hot. Ingress low through the Redstone Canyon, destroy the
      enemy forward strike network, then egress through the extraction gate at the north
      mouth. Expect SAM batteries, flak and interceptors.
    </p>
    <div class="cols">
      <div>
        <h3>Objectives</h3>
        <ul class="brief-list">
          <li><b>1.</b> Destroy all 6 primary strike targets in the canyon</li>
          <li><b>2.</b> Survive the interceptor response</li>
          <li><b>3.</b> Fly through the extraction gate to egress</li>
        </ul>
      </div>
      <div>
        <h3>Controls</h3>
        <ul class="keys">
          <li><kbd>W</kbd><kbd>S</kbd> pitch &nbsp; <kbd>A</kbd><kbd>D</kbd> roll &nbsp; <kbd>Q</kbd><kbd>E</kbd> rudder</li>
          <li><kbd>Shift</kbd> throttle up &nbsp; <kbd>Ctrl</kbd>/<kbd>Z</kbd> throttle down</li>
          <li><kbd>Space</kbd> / LMB cannon &nbsp; <kbd>F</kbd> / RMB missile</li>
          <li><kbd>X</kbd> flares &nbsp; <kbd>T</kbd> switch target &nbsp; <kbd>C</kbd> camera</li>
          <li><kbd>M</kbd> mouse steering &nbsp; <kbd>I</kbd> invert pitch &nbsp; <kbd>P</kbd> pause</li>
          <li class="touch-only">Touch: left stick flies, right buttons fire</li>
        </ul>
      </div>
    </div>
    <div class="hint">Hold a lock until the brackets close, then launch. Flares defeat incoming missiles.</div>
    <button class="primary" data-action="start">START MISSION</button>
  </div>
`;

export class Screens {
  root: HTMLDivElement;
  private phaseEl: HTMLElement;
  private phaseSubEl: HTMLElement;
  private objectivesEl: HTMLElement;
  private statusEl: HTMLElement;
  private bannerEl: HTMLElement;
  private bannerTimer = 0;
  private vignetteEl: HTMLElement;
  private alertEl: HTMLElement;
  private modalEl: HTMLElement;
  private feedEl: HTMLElement;
  onStart: () => void = () => {};
  onResume: () => void = () => {};
  onRestart: () => void = () => {};
  onToggleSound: () => void = () => {};
  onPause: () => void = () => {};

  constructor(parent: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'ui-root';
    root.innerHTML = `
      <div class="topbar">
        <div class="phase">
          <div class="phase-name" id="phaseName">STANDBY</div>
          <div class="phase-sub" id="phaseSub"></div>
        </div>
        <div class="objectives" id="objectives"></div>
        <div class="status" id="status"></div>
      </div>
      <button class="pause-btn" id="pauseBtn" aria-label="Pause mission">&#10073;&#10073;</button>
      <div class="banner" id="banner"></div>
      <div class="alert" id="alert"></div>
      <div class="feed" id="feed"></div>
      <div class="vignette" id="vignette"></div>
      <div class="modal" id="modal"></div>
    `;
    parent.appendChild(root);
    this.root = root;
    this.phaseEl = root.querySelector('#phaseName')!;
    this.phaseSubEl = root.querySelector('#phaseSub')!;
    this.objectivesEl = root.querySelector('#objectives')!;
    this.statusEl = root.querySelector('#status')!;
    this.bannerEl = root.querySelector('#banner')!;
    this.vignetteEl = root.querySelector('#vignette')!;
    this.alertEl = root.querySelector('#alert')!;
    this.modalEl = root.querySelector('#modal')!;
    this.feedEl = root.querySelector('#feed')!;

    root.querySelector('#pauseBtn')!.addEventListener('click', () => this.onPause());

    this.modalEl.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const action = t.dataset.action;
      if (!action) return;
      if (action === 'start') this.onStart();
      if (action === 'resume') this.onResume();
      if (action === 'restart') this.onRestart();
      if (action === 'sound') this.onToggleSound();
    });
  }

  setHudVisible(v: boolean): void {
    this.root.classList.toggle('hud-hidden', !v);
  }

  showBriefing(): void {
    this.modalEl.className = 'modal show briefing';
    this.modalEl.innerHTML = BRIEFING_HTML;
  }

  showPause(): void {
    this.modalEl.className = 'modal show';
    this.modalEl.innerHTML = `
      <div class="panel small">
        <h2>PAUSED</h2>
        <p class="lede">Mission clock halted.</p>
        <button class="primary" data-action="resume">RESUME</button>
        <button class="ghost" data-action="restart">RESTART MISSION</button>
        <button class="ghost" data-action="sound">TOGGLE SOUND</button>
      </div>
    `;
  }

  showResult(s: ResultStats): void {
    this.modalEl.className = `modal show ${s.win ? 'win' : 'lose'}`;
    this.modalEl.innerHTML = `
      <div class="panel">
        <div class="tag">${s.win ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED'}</div>
        <h2>${s.title}</h2>
        <p class="lede">${s.reason}</p>
        <div class="stats">
          <div><span>Score</span><b>${s.score.toLocaleString()}</b></div>
          <div><span>Strike targets</span><b>${s.targets}</b></div>
          <div><span>Aircraft downed</span><b>${s.air}</b></div>
          <div><span>Ground kills</span><b>${s.ground}</b></div>
          <div><span>Mission time</span><b>${s.time}</b></div>
          <div><span>Gun accuracy</span><b>${s.accuracy}%</b></div>
          <div><span>Hull remaining</span><b>${s.hull}%</b></div>
          <div><span>Rank</span><b class="rank">${s.rank}</b></div>
        </div>
        <button class="primary" data-action="restart">FLY AGAIN</button>
      </div>
    `;
  }

  hideModal(): void {
    this.modalEl.className = 'modal';
    this.modalEl.innerHTML = '';
  }

  get modalOpen(): boolean {
    return this.modalEl.classList.contains('show');
  }

  setPhase(name: string, sub: string): void {
    this.phaseEl.textContent = name;
    this.phaseSubEl.textContent = sub;
  }

  setObjectives(list: ObjectiveEntry[]): void {
    this.objectivesEl.innerHTML = list
      .map(
        (o) =>
          `<div class="obj ${o.done ? 'done' : ''} ${o.active ? 'active' : ''}"><i></i>${o.label}</div>`
      )
      .join('');
  }

  setStatus(html: string): void {
    this.statusEl.innerHTML = html;
  }

  banner(title: string, sub = '', duration = 3): void {
    this.bannerEl.innerHTML = `<div class="banner-title">${title}</div>${
      sub ? `<div class="banner-sub">${sub}</div>` : ''
    }`;
    this.bannerEl.classList.add('show');
    this.bannerTimer = duration;
  }

  alert(text: string): void {
    this.alertEl.textContent = text;
    this.alertEl.classList.add('show');
    window.setTimeout(() => this.alertEl.classList.remove('show'), 900);
  }

  feed(text: string, cls = ''): void {
    const row = document.createElement('div');
    row.className = `feed-row ${cls}`;
    row.textContent = text;
    this.feedEl.appendChild(row);
    window.setTimeout(() => row.classList.add('fade'), 2600);
    window.setTimeout(() => row.remove(), 3400);
    while (this.feedEl.children.length > 5) this.feedEl.firstChild?.remove();
  }

  setVignette(intensity: number, danger = false): void {
    this.vignetteEl.style.opacity = `${intensity}`;
    this.vignetteEl.classList.toggle('danger', danger);
  }

  update(dt: number): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.classList.remove('show');
    }
  }
}
