export interface HudTarget {
  x: number;
  y: number;
  onScreen: boolean;
  angle: number; // screen-space direction when off screen
  selected: boolean;
  locked: boolean;
  lockProgress: number;
  air: boolean;
  primary: boolean;
  dist: number;
  label: string;
  health: number;
}

export interface RadarBlip {
  x: number; // -1..1, right
  y: number; // -1..1, forward
  kind: 'ground' | 'air' | 'missile' | 'ext';
  primary: boolean;
}

export interface HudFrame {
  speed: number;
  altitude: number;
  agl: number;
  throttle: number;
  health: number;
  missiles: number;
  flares: number;
  gunHeat: number;
  score: number;
  time: number;
  objective: string;
  objectiveSub: string;
  warnings: string[];
  targets: HudTarget[];
  extraction: HudTarget | null;
  radar: RadarBlip[];
  heading: number;
  pipperX: number;
  pipperY: number;
  pipperVisible: boolean;
  lockState: 0 | 1 | 2;
  damageFlash: number;
  hitMarker: number;
  roll: number;
  pitch: number;
}

export interface TouchCallbacks {
  missile: () => void;
  target: () => void;
  flare: () => void;
  gun: (down: boolean) => void;
  throttleUp: (down: boolean) => void;
  throttleDown: (down: boolean) => void;
}

export interface EndStats {
  time: number;
  score: number;
  kills: number;
  primaries: number;
  primariesTotal: number;
  missilesFired: number;
  missileHits: number;
}

export class Hud {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private ui: HTMLDivElement;
  private overlay: HTMLDivElement;
  private overlayBody: HTMLDivElement;
  private objectiveEl: HTMLDivElement;
  private objectiveSubEl: HTMLDivElement;
  private scoreEl: HTMLDivElement;
  private warnEl: HTMLDivElement;
  private speedEl: HTMLDivElement;
  private altEl: HTMLDivElement;
  private throttleBar: HTMLDivElement;
  private healthBar: HTMLDivElement;
  private healthText: HTMLDivElement;
  private mslEl: HTMLDivElement;
  private flrEl: HTMLDivElement;
  private heatBar: HTMLDivElement;
  private msgEl: HTMLDivElement;
  private damageEl: HTMLDivElement;
  private touchEl: HTMLDivElement;
  private stickBase: HTMLDivElement;
  private stickKnob: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private messages: { text: string; t: number; el: HTMLDivElement }[] = [];
  private lastWarnKey = '';
  onStart: (() => void) | null = null;
  onRestart: (() => void) | null = null;

  constructor(root: HTMLElement, isTouch: boolean, cb: TouchCallbacks) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'hud';
    root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.ui = document.createElement('div');
    this.ui.id = 'ui';
    this.ui.innerHTML = `
      <div class="panel top-left">
        <div class="label">OBJECTIVE</div>
        <div id="objective" class="value"></div>
        <div id="objective-sub" class="sub"></div>
        <div id="score" class="sub score"></div>
      </div>
      <div id="warn" class="warn"></div>
      <div class="panel bottom-left">
        <div class="row"><span class="label">SPD</span><span id="spd" class="num"></span></div>
        <div class="row"><span class="label">ALT</span><span id="alt" class="num"></span></div>
        <div class="row"><span class="label">THR</span><div class="bar"><div id="thr" class="fill thr"></div></div></div>
      </div>
      <div class="panel bottom-right">
        <div class="row"><span class="label">HULL</span><div class="bar wide"><div id="hp" class="fill hp"></div></div><span id="hptext" class="num small"></span></div>
        <div class="row"><span class="label">MSL</span><span id="msl" class="num"></span></div>
        <div class="row"><span class="label">FLR</span><span id="flr" class="num"></span></div>
        <div class="row"><span class="label">GUN</span><div class="bar"><div id="heat" class="fill heat"></div></div></div>
      </div>
      <div id="messages"></div>
      <div id="hint" class="hint"></div>
      <div id="damage"></div>
    `;
    root.appendChild(this.ui);
    const q = <T extends HTMLElement>(sel: string) => this.ui.querySelector(sel) as T;
    this.objectiveEl = q('#objective');
    this.objectiveSubEl = q('#objective-sub');
    this.scoreEl = q('#score');
    this.warnEl = q('#warn');
    this.speedEl = q('#spd');
    this.altEl = q('#alt');
    this.throttleBar = q('#thr');
    this.healthBar = q('#hp');
    this.healthText = q('#hptext');
    this.mslEl = q('#msl');
    this.flrEl = q('#flr');
    this.heatBar = q('#heat');
    this.msgEl = q('#messages');
    this.damageEl = q('#damage');
    this.hintEl = q('#hint');

    // Touch controls
    this.touchEl = document.createElement('div');
    this.touchEl.id = 'touch';
    this.touchEl.innerHTML = `
      <div id="stick-base"><div id="stick-knob"></div></div>
      <div class="tbtns">
        <button data-btn="thr-up" class="tbtn small">THR +</button>
        <button data-btn="thr-down" class="tbtn small">THR −</button>
        <button data-btn="target" class="tbtn small">TGT</button>
        <button data-btn="flare" class="tbtn small">FLARE</button>
        <button data-btn="gun" class="tbtn big gun">GUN</button>
        <button data-btn="missile" class="tbtn big msl">MISSILE</button>
      </div>
    `;
    root.appendChild(this.touchEl);
    this.stickBase = this.touchEl.querySelector('#stick-base') as HTMLDivElement;
    this.stickKnob = this.touchEl.querySelector('#stick-knob') as HTMLDivElement;
    this.touchEl.style.display = isTouch ? 'block' : 'none';
    const hold = (name: string, fn: (down: boolean) => void) => {
      const b = this.touchEl.querySelector(`[data-btn="${name}"]`) as HTMLButtonElement;
      const down = (e: Event) => { e.preventDefault(); fn(true); b.classList.add('active'); };
      const up = (e: Event) => { e.preventDefault(); fn(false); b.classList.remove('active'); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    const tap = (name: string, fn: () => void) => {
      const b = this.touchEl.querySelector(`[data-btn="${name}"]`) as HTMLButtonElement;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); b.classList.add('active'); });
      const up = () => b.classList.remove('active');
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    hold('gun', cb.gun);
    hold('thr-up', cb.throttleUp);
    hold('thr-down', cb.throttleDown);
    tap('missile', cb.missile);
    tap('target', cb.target);
    tap('flare', cb.flare);

    // Overlay (menu / end screens)
    this.overlay = document.createElement('div');
    this.overlay.id = 'overlay';
    this.overlayBody = document.createElement('div');
    this.overlayBody.className = 'card';
    this.overlay.appendChild(this.overlayBody);
    root.appendChild(this.overlay);

    this.resize();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setStick(active: boolean, ox: number, oy: number, dx: number, dy: number): void {
    if (!active) {
      this.stickBase.style.display = 'none';
      return;
    }
    this.stickBase.style.display = 'block';
    this.stickBase.style.left = `${ox}px`;
    this.stickBase.style.top = `${oy}px`;
    this.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  setHint(text: string): void {
    this.hintEl.textContent = text;
  }

  setHudVisible(v: boolean): void {
    this.ui.style.opacity = v ? '1' : '0';
    this.canvas.style.opacity = v ? '1' : '0';
    this.touchEl.style.visibility = v ? 'visible' : 'hidden';
  }

  showMenu(isTouch: boolean): void {
    this.overlay.style.display = 'flex';
    const controls = isTouch
      ? `<p>Left side: drag to steer. Right side buttons: throttle, target cycle, flares, gun, missile.</p>`
      : `<table class="keys">
          <tr><td>W / S or ↑ / ↓</td><td>Pitch (press I to invert)</td></tr>
          <tr><td>A / D or ← / →</td><td>Roll</td></tr>
          <tr><td>Q / E</td><td>Yaw</td></tr>
          <tr><td>Shift / Ctrl</td><td>Throttle up / down</td></tr>
          <tr><td>Space</td><td>Fire missile (lock on first)</td></tr>
          <tr><td>F or Left Mouse</td><td>Cannon</td></tr>
          <tr><td>Tab / T</td><td>Cycle target</td></tr>
          <tr><td>X</td><td>Flares</td></tr>
          <tr><td>M</td><td>Toggle mouse steering</td></tr>
        </table>`;
    this.overlayBody.innerHTML = `
      <div class="eyebrow">OPERATION</div>
      <h1>CANYON STRIKE</h1>
      <p class="brief">Enemy air defenses are dug into Redstone Canyon. Fly the gorge low, destroy every
      <b>primary target</b> (SAM sites, radar and fuel depots), survive the bandit patrols, then reach the
      <b>extraction beacon</b> at the far end.</p>
      ${controls}
      <button id="start-btn" class="cta">START MISSION</button>
      <p class="tiny">Press Enter or Space to launch · Aircraft: RF-9 Kestrel</p>
    `;
    const btn = this.overlayBody.querySelector('#start-btn') as HTMLButtonElement;
    btn.addEventListener('click', () => this.onStart?.());
  }

  showEnd(won: boolean, reason: string, s: EndStats): void {
    this.overlay.style.display = 'flex';
    const acc = s.missilesFired > 0 ? Math.round((s.missileHits / s.missilesFired) * 100) : 0;
    const mm = Math.floor(s.time / 60);
    const ss = Math.floor(s.time % 60).toString().padStart(2, '0');
    this.overlayBody.innerHTML = `
      <div class="eyebrow ${won ? 'good' : 'bad'}">${won ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED'}</div>
      <h1 class="${won ? 'good' : 'bad'}">${won ? 'EXTRACTED' : 'KESTREL DOWN'}</h1>
      <p class="brief">${reason}</p>
      <table class="stats">
        <tr><td>Time</td><td>${mm}:${ss}</td></tr>
        <tr><td>Score</td><td>${s.score}</td></tr>
        <tr><td>Primary targets</td><td>${s.primaries} / ${s.primariesTotal}</td></tr>
        <tr><td>Total kills</td><td>${s.kills}</td></tr>
        <tr><td>Missile accuracy</td><td>${acc}% (${s.missileHits}/${s.missilesFired})</td></tr>
      </table>
      <button id="restart-btn" class="cta">${won ? 'FLY AGAIN' : 'RETRY MISSION'}</button>
      <p class="tiny">Press Enter or R to restart</p>
    `;
    const btn = this.overlayBody.querySelector('#restart-btn') as HTMLButtonElement;
    btn.addEventListener('click', () => this.onRestart?.());
  }

  hideOverlay(): void {
    this.overlay.style.display = 'none';
  }

  pushMessage(text: string, cls = ''): void {
    const el = document.createElement('div');
    el.className = `msg ${cls}`;
    el.textContent = text;
    this.msgEl.appendChild(el);
    this.messages.push({ text, t: 3.2, el });
    while (this.messages.length > 4) {
      const m = this.messages.shift()!;
      m.el.remove();
    }
  }

  clearMessages(): void {
    for (const m of this.messages) m.el.remove();
    this.messages = [];
  }

  update(f: HudFrame, dt: number): void {
    // Messages fade
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      m.t -= dt;
      if (m.t <= 0) {
        m.el.remove();
        this.messages.splice(i, 1);
      } else if (m.t < 0.6) {
        m.el.style.opacity = String(m.t / 0.6);
      }
    }

    this.objectiveEl.textContent = f.objective;
    this.objectiveSubEl.textContent = f.objectiveSub;
    const mm = Math.floor(f.time / 60);
    const ss = Math.floor(f.time % 60).toString().padStart(2, '0');
    this.scoreEl.textContent = `SCORE ${f.score}   T+${mm}:${ss}`;
    this.speedEl.textContent = `${Math.round(f.speed * 2.2)}`;
    this.altEl.textContent = `${Math.round(f.altitude)}`;
    this.throttleBar.style.width = `${Math.round(f.throttle * 100)}%`;
    this.healthBar.style.width = `${Math.max(0, Math.round(f.health))}%`;
    this.healthBar.className = `fill hp ${f.health < 30 ? 'crit' : f.health < 60 ? 'warn' : ''}`;
    this.healthText.textContent = `${Math.max(0, Math.round(f.health))}`;
    this.mslEl.textContent = `${f.missiles}`;
    this.flrEl.textContent = `${f.flares}`;
    this.heatBar.style.width = `${Math.round(f.gunHeat * 100)}%`;
    this.heatBar.className = `fill heat ${f.gunHeat > 0.85 ? 'crit' : ''}`;
    this.damageEl.style.opacity = String(Math.min(1, f.damageFlash));

    const warnKey = f.warnings.join('|');
    if (warnKey !== this.lastWarnKey) {
      this.lastWarnKey = warnKey;
      this.warnEl.innerHTML = f.warnings.map((w) => `<div class="w">${w}</div>`).join('');
    }

    this.drawCanvas(f);
  }

  private drawCanvas(f: HudFrame): void {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1.5;
    ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';

    const cx = w / 2;
    const cy = h / 2;

    // Boresight crosshair
    ctx.strokeStyle = 'rgba(120,255,170,0.85)';
    ctx.beginPath();
    ctx.moveTo(cx - 22, cy); ctx.lineTo(cx - 8, cy);
    ctx.moveTo(cx + 8, cy); ctx.lineTo(cx + 22, cy);
    ctx.moveTo(cx, cy - 22); ctx.lineTo(cx, cy - 8);
    ctx.moveTo(cx, cy + 8); ctx.lineTo(cx, cy + 22);
    ctx.stroke();

    // Gun pipper
    if (f.pipperVisible) {
      ctx.beginPath();
      ctx.arc(f.pipperX, f.pipperY, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(f.pipperX, f.pipperY, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(120,255,170,0.9)';
      ctx.fill();
    }

    // Hit marker
    if (f.hitMarker > 0) {
      ctx.strokeStyle = `rgba(255,80,80,${Math.min(1, f.hitMarker * 4)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.moveTo(f.pipperX + sx * 6, f.pipperY + sy * 6);
        ctx.lineTo(f.pipperX + sx * 14, f.pipperY + sy * 14);
      }
      ctx.stroke();
      ctx.lineWidth = 1.5;
    }

    // Attitude ladder (subtle)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-f.roll);
    ctx.strokeStyle = 'rgba(120,255,170,0.35)';
    const pitchPx = f.pitch * 220;
    ctx.beginPath();
    ctx.moveTo(-90, pitchPx); ctx.lineTo(-40, pitchPx);
    ctx.moveTo(40, pitchPx); ctx.lineTo(90, pitchPx);
    ctx.stroke();
    ctx.restore();

    // Heading tape
    ctx.fillStyle = 'rgba(120,255,170,0.9)';
    ctx.textAlign = 'center';
    const hdg = ((f.heading * 180) / Math.PI + 360) % 360;
    ctx.fillText(`${Math.round(hdg).toString().padStart(3, '0')}°`, cx, 28);
    ctx.strokeStyle = 'rgba(120,255,170,0.5)';
    ctx.beginPath();
    for (let d = -60; d <= 60; d += 10) {
      const hd = (Math.round(hdg / 10) * 10 + d);
      const off = (hd - hdg) * 3;
      const x = cx + off;
      if (Math.abs(off) > 180) continue;
      ctx.moveTo(x, 40); ctx.lineTo(x, hd % 30 === 0 ? 50 : 45);
    }
    ctx.stroke();

    // Targets
    for (const t of f.targets) this.drawTarget(t, w, h);
    if (f.extraction) this.drawExtraction(f.extraction, w, h);

    // Lock state ring at center
    if (f.lockState > 0) {
      const sel = f.targets.find((t) => t.selected);
      const p = sel ? sel.lockProgress : 0;
      ctx.strokeStyle = f.lockState === 2 ? 'rgba(255,90,90,0.9)' : 'rgba(255,220,90,0.8)';
      ctx.beginPath();
      ctx.arc(cx, cy, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (f.lockState === 2 ? 1 : p));
      ctx.stroke();
    }

    this.drawRadar(f, w, h);
  }

  private drawTarget(t: HudTarget, w: number, h: number): void {
    const ctx = this.ctx;
    const color = t.locked ? 'rgba(255,80,80,0.95)' : t.selected ? 'rgba(255,220,90,0.95)' : t.primary ? 'rgba(255,150,90,0.8)' : 'rgba(120,255,170,0.75)';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    if (!t.onScreen) {
      if (!t.selected && !t.primary) return;
      const cx = w / 2;
      const cy = h / 2;
      const r = Math.min(w, h) * 0.42;
      const x = cx + Math.cos(t.angle) * r;
      const y = cy + Math.sin(t.angle) * r;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t.angle);
      ctx.beginPath();
      ctx.moveTo(10, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7); ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.textAlign = 'center';
      ctx.fillText(`${t.label} ${Math.round(t.dist)}`, x, y + 16);
      return;
    }
    const s = t.selected ? 18 : 12;
    ctx.lineWidth = t.selected ? 2 : 1.2;
    ctx.beginPath();
    if (t.air) {
      // Diamond for aircraft
      ctx.moveTo(t.x, t.y - s); ctx.lineTo(t.x + s, t.y); ctx.lineTo(t.x, t.y + s); ctx.lineTo(t.x - s, t.y); ctx.closePath();
    } else {
      ctx.rect(t.x - s, t.y - s, s * 2, s * 2);
    }
    ctx.stroke();
    if (t.selected && !t.locked && t.lockProgress > 0) {
      ctx.beginPath();
      ctx.arc(t.x, t.y, s + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t.lockProgress);
      ctx.stroke();
    }
    if (t.locked) {
      ctx.beginPath();
      ctx.arc(t.x, t.y, s + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText('LOCK', t.x, t.y - s - 16);
    }
    ctx.textAlign = 'left';
    ctx.fillText(`${t.label}`, t.x + s + 6, t.y - 6);
    ctx.fillText(`${Math.round(t.dist)}`, t.x + s + 6, t.y + 8);
    // Health bar for selected
    if (t.selected) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(t.x - s, t.y + s + 5, s * 2, 3);
      ctx.fillStyle = color;
      ctx.fillRect(t.x - s, t.y + s + 5, s * 2 * Math.max(0, t.health), 3);
    }
    ctx.lineWidth = 1.5;
  }

  private drawExtraction(t: HudTarget, w: number, h: number): void {
    const ctx = this.ctx;
    const color = 'rgba(80,255,160,0.95)';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    let x = t.x;
    let y = t.y;
    if (!t.onScreen) {
      const r = Math.min(w, h) * 0.42;
      x = w / 2 + Math.cos(t.angle) * r;
      y = h / 2 + Math.sin(t.angle) * r;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t.angle);
      ctx.beginPath();
      ctx.moveTo(12, 0); ctx.lineTo(-6, -8); ctx.lineTo(-6, 8); ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else {
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.5;
    }
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(`EXTRACT ${Math.round(t.dist)}`, x, y + 26);
    ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
  }

  private drawRadar(f: HudFrame, w: number, h: number): void {
    const ctx = this.ctx;
    const r = Math.min(70, Math.min(w, h) * 0.11);
    const cx = w / 2;
    const cy = h - r - 18;
    ctx.fillStyle = 'rgba(6,20,14,0.55)';
    ctx.strokeStyle = 'rgba(120,255,170,0.5)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
    ctx.stroke();
    for (const b of f.radar) {
      const len = Math.hypot(b.x, b.y);
      const sc = len > 1 ? 1 / len : 1;
      const x = cx + b.x * sc * r;
      const y = cy - b.y * sc * r;
      if (b.kind === 'ext') {
        ctx.fillStyle = 'rgba(80,255,160,1)';
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      } else if (b.kind === 'missile') {
        ctx.fillStyle = 'rgba(255,240,120,1)';
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      } else if (b.kind === 'air') {
        ctx.fillStyle = 'rgba(255,80,80,1)';
        ctx.beginPath();
        ctx.moveTo(x, y - 4); ctx.lineTo(x + 4, y + 3); ctx.lineTo(x - 4, y + 3); ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = b.primary ? 'rgba(255,150,90,1)' : 'rgba(255,220,120,0.8)';
        ctx.fillRect(x - 3, y - 3, 6, 6);
      }
    }
    // Player
    ctx.fillStyle = 'rgba(120,255,170,1)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 6); ctx.lineTo(cx + 4, cy + 4); ctx.lineTo(cx - 4, cy + 4); ctx.closePath();
    ctx.fill();
  }
}
