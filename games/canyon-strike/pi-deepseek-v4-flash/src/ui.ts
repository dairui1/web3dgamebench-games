// DOM UI: start/pause/win/lose screens, mission banners, kill feed.

import type { AudioFX } from './audio';

export interface GameStats {
  kills: number;
  primaryKills: number;
  timeSec: number;
  result: 'win' | 'lose' | null;
  reason: string;
}

export class UI {
  private root: HTMLElement;
  private screens: Record<string, HTMLDivElement> = {};
  private bannerEl: HTMLDivElement;
  private bannerTimer: number | null = null;
  private bannerQueue: { text: string; color: string }[] = [];
  private killFeed: HTMLDivElement;
  private hintEl: HTMLDivElement;
  onStart: (() => void) | null = null;
  onResume: (() => void) | null = null;
  onRestart: (() => void) | null = null;
  onToggleMute: (() => void) | null = null;

  constructor(root: HTMLElement, private audio: AudioFX) {
    this.root = root;

    const s = document.createElement('div');
    s.id = 'screens';
    root.appendChild(s);
    this.screensRoot = s;

    // Mission banner
    this.bannerEl = document.createElement('div');
    this.bannerEl.className = 'banner';
    root.appendChild(this.bannerEl);

    // Kill feed
    this.killFeed = document.createElement('div');
    this.killFeed.className = 'killfeed';
    root.appendChild(this.killFeed);

    // Context hint
    this.hintEl = document.createElement('div');
    this.hintEl.className = 'hint';
    root.appendChild(this.hintEl);

    this.buildStart();
    this.buildPause();
    this.buildEnd('win');
    this.buildEnd('defeat');
  }

  private screensRoot!: HTMLDivElement;

  private mkPanel(id: string, title: string, body: string, buttons: { label: string; cls: string; action: () => void }[], options?: { sub?: string; wide?: boolean }): HTMLDivElement {
    const sc = document.createElement('div');
    sc.className = 'screen';
    sc.id = 'screen-' + id;
    const panel = document.createElement('div');
    panel.className = 'panel' + (options?.wide ? ' wide' : '');
    const h1 = document.createElement('h1');
    h1.textContent = title;
    panel.appendChild(h1);
    if (options?.sub) {
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = options.sub;
      panel.appendChild(sub);
    }
    const p = document.createElement('div');
    p.className = 'body';
    p.innerHTML = body;
    panel.appendChild(p);
    const btns = document.createElement('div');
    btns.className = 'btns';
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = 'btn ' + b.cls;
      btn.textContent = b.label;
      btn.addEventListener('click', b.action);
      btns.appendChild(btn);
    }
    panel.appendChild(btns);
    sc.appendChild(panel);
    this.screensRoot.appendChild(sc);
    this.screens[id] = sc;
    return sc;
  }

  private buildStart(): void {
    const body = `
      <div class="brief">
        <p><span class="lbl">MISSION</span> Hostile bridgehead blocks the canyon route.<br>
        Fly through <b>Red Canyon</b>, destroy <b>5 of 7 SAM batteries</b>, then reach the <b class="grn">green extraction zone</b> at the far end.</p>
        <p><span class="lbl">THREATS</span> SAM sites · AAA guns · radar stations · mortars · enemy bandits</p>
      </div>
      <div class="controls">
        <div><span class="kbd">W/S</span><span class="kbd">↑/↓</span> pitch &nbsp; <span class="kbd">A/D</span><span class="kbd">←/→</span> roll</div>
        <div><span class="kbd">Shift</span> / <span class="kbd">Ctrl</span> throttle &nbsp; <span class="kbd">T</span> autopilot-cruise</div>
        <div><span class="kbd">Click/Hold LMB</span> gun &nbsp; <span class="kbd">Space</span> missile &nbsp; <span class="kbd">X</span> flares</div>
        <div><span class="kbd">E</span> cycle target · <span class="kbd">Esc/P</span> pause &nbsp;—&nbsp; or <b>drag the mouse</b> to steer, <b>touch sticks</b> on mobile</div>
      </div>`;
    this.mkPanel(
      'start',
      'CAN YON STRIKE',
      body,
      [
        { label: '▶  START MISSION', cls: 'primary', action: () => this.onStart?.() },
        { label: this.audio.muted ? '🔇 UNMUTE' : '🔊 MUTE', cls: 'ghost', action: () => this.onToggleMute?.() },
      ],
      { sub: 'ARCADE AIR COMBAT · THREE.JS' }
    );
  }

  private buildPause(): void {
    this.mkPanel(
      'pause',
      'PAUSED',
      '<div class="controls"><div>Flight controls are disabled while paused.</div></div>',
      [
        { label: '▶ RESUME', cls: 'primary', action: () => this.onResume?.() },
        { label: '↻ RESTART', cls: 'ghost', action: () => this.onRestart?.() },
        { label: this.audio.muted ? '🔇 UNMUTE' : '🔊 MUTE', cls: 'ghost', action: () => this.onToggleMute?.() },
      ]
    );
  }

  private buildEnd(id: 'win' | 'defeat'): void {
    const isWin = id === 'win';
    this.mkPanel(
      id,
      isWin ? 'MISSION COMPLETE' : 'AIRCRAFT LOST',
      isWin
        ? '<p class="resultline">Strike successful — you punched through Red Canyon.</p><div class="stats" id="stats-win"></div>'
        : '<p class="resultline" id="defeat-reason"></p><div class="stats" id="stats-lose"></div>',
      [{ label: '↻ FLY AGAIN', cls: 'primary', action: () => this.onRestart?.() }],
      { wide: true }
    );
  }

  showStart(): void {
    this.show('start');
  }

  showPause(): void {
    this.show('pause');
  }

  showEnd(stats: GameStats): void {
    const isWin = stats.result === 'win';
    this.show(isWin ? 'win' : 'defeat');
    if (!isWin) {
      const r = document.getElementById('defeat-reason');
      if (r) r.textContent = stats.reason;
    }
    const statsEl = document.getElementById(isWin ? 'stats-win' : 'stats-lose');
    if (statsEl) {
      const mins = Math.floor(stats.timeSec / 60);
      const secs = Math.floor(stats.timeSec % 60);
      statsEl.innerHTML = `
        <div><b>${stats.kills}</b><span>targets destroyed</span></div>
        <div><b>${stats.primaryKills}</b><span>SAM sites</span></div>
        <div><b>${mins}:${String(secs).padStart(2, '0')}</b><span>mission time</span></div>`;
    }
  }

  show(id: string): void {
    for (const k in this.screens) this.screens[k].style.display = k === id ? 'flex' : 'none';
  }

  hideAll(): void {
    for (const k in this.screens) this.screens[k].style.display = 'none';
  }

  /** Mission banner queue with fade animation. */
  showBanner(text: string, color = '#ffd76a', dur = 3.5): void {
    this.bannerQueue.push({ text, color });
    while (this.bannerQueue.length > 4) this.bannerQueue.shift();
    if (this.bannerTimer !== null) return;
    const next = (): void => {
      const item = this.bannerQueue.shift();
      if (!item || !item.text) {
        this.bannerEl.style.opacity = '0';
        this.bannerTimer = null;
        return;
      }
      this.bannerEl.textContent = item.text;
      this.bannerEl.style.color = item.color;
      this.bannerEl.style.opacity = '1';
      this.bannerTimer = window.setTimeout(() => {
        this.bannerEl.style.opacity = '0';
        this.bannerTimer = window.setTimeout(next, 500);
      }, dur * 1000);
    };
    next();
  }

  addKillFeed(text: string, color = '#ffd76a'): void {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.color = color;
    this.killFeed.appendChild(el);
    while (this.killFeed.children.length > 5) this.killFeed.removeChild(this.killFeed.firstChild!);
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 700);
    }, 3800);
  }

  showHint(text: string, ms = 4000): void {
    this.hintEl.textContent = text;
    this.hintEl.style.opacity = '1';
    window.clearTimeout(this.hintTimer ?? undefined);
    this.hintTimer = window.setTimeout(() => {
      this.hintEl.style.opacity = '0';
    }, ms);
  }
  private hintTimer: number | null = null;

  updateMuteLabel(): void {
    // refresh pause/start button labels
    const labels = ['🔇 UNMUTE', '🔊 MUTE'];
    const cur = this.audio.muted ? labels[0] : labels[1];
    for (const sc of Object.values(this.screens)) {
      for (const b of Array.from(sc.querySelectorAll('button'))) {
        if (b.textContent === labels[0] || b.textContent === labels[1]) b.textContent = cur;
      }
    }
  }
}

export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}