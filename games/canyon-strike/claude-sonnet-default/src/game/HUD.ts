import * as THREE from 'three';

export interface HudFrameData {
  health: number;
  maxHealth: number;
  speed: number;
  altitude: number;
  throttle: number;
  missileAmmo: number;
  gunReady: boolean;
  objective: string;
  targetsRemaining: number;
  totalTargets: number;
  missionTime: number;
  lockProgress: number; // 0..1
  locked: boolean;
  missileWarning: boolean;
  extractionActive: boolean;
  extractionDir: THREE.Vector2 | null; // screen-space direction if offscreen
  extractionDist: number | null;
  playerScreenHeading: number;
  radarBlips: { x: number; z: number; type: 'ground' | 'air' | 'extraction' }[];
}

export interface MissionStats {
  targetsDestroyed: number;
  totalTargets: number;
  shotsFired: number;
  hits: number;
  missionTime: number;
  cause?: string;
}

export class HUD {
  private root: HTMLDivElement;
  private briefingEl: HTMLDivElement;
  private endEl: HTMLDivElement;
  private hudEl: HTMLDivElement;

  private healthFill: HTMLDivElement;
  private healthText: HTMLSpanElement;
  private speedText: HTMLSpanElement;
  private altText: HTMLSpanElement;
  private throttleFill: HTMLDivElement;
  private missileText: HTMLSpanElement;
  private gunDot: HTMLSpanElement;
  private objectiveText: HTMLDivElement;
  private targetsText: HTMLDivElement;
  private timeText: HTMLDivElement;
  private reticle: HTMLDivElement;
  private lockBox: HTMLDivElement;
  private lockRing: HTMLDivElement;
  private missileWarnEl: HTMLDivElement;
  private messageEl: HTMLDivElement;
  private damageVignette: HTMLDivElement;
  private radarCanvas: HTMLCanvasElement;
  private radarCtx: CanvasRenderingContext2D;
  private waypointArrow: HTMLDivElement;
  private hitMarker: HTMLDivElement;
  private hitMarkerTimer = 0;
  private messageTimer = 0;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud-root';
    container.appendChild(this.root);

    this.briefingEl = document.createElement('div');
    this.briefingEl.className = 'overlay-screen briefing';
    this.root.appendChild(this.briefingEl);

    this.endEl = document.createElement('div');
    this.endEl.className = 'overlay-screen end hidden';
    this.root.appendChild(this.endEl);

    this.hudEl = document.createElement('div');
    this.hudEl.className = 'hud-layer hidden';
    this.root.appendChild(this.hudEl);

    // --- top-left status panel ---
    const statusPanel = document.createElement('div');
    statusPanel.className = 'panel status-panel';
    this.hudEl.appendChild(statusPanel);

    const healthRow = document.createElement('div');
    healthRow.className = 'bar-row';
    const healthLabel = document.createElement('span');
    healthLabel.className = 'bar-label';
    healthLabel.textContent = 'HULL';
    const healthBar = document.createElement('div');
    healthBar.className = 'bar-track';
    this.healthFill = document.createElement('div');
    this.healthFill.className = 'bar-fill health-fill';
    healthBar.appendChild(this.healthFill);
    this.healthText = document.createElement('span');
    this.healthText.className = 'bar-value';
    healthRow.append(healthLabel, healthBar, this.healthText);
    statusPanel.appendChild(healthRow);

    const throttleRow = document.createElement('div');
    throttleRow.className = 'bar-row';
    const throttleLabel = document.createElement('span');
    throttleLabel.className = 'bar-label';
    throttleLabel.textContent = 'THR';
    const throttleBar = document.createElement('div');
    throttleBar.className = 'bar-track';
    this.throttleFill = document.createElement('div');
    this.throttleFill.className = 'bar-fill throttle-fill';
    throttleBar.appendChild(this.throttleFill);
    throttleRow.append(throttleLabel, throttleBar);
    statusPanel.appendChild(throttleRow);

    const flightRow = document.createElement('div');
    flightRow.className = 'flight-row';
    this.speedText = document.createElement('span');
    this.altText = document.createElement('span');
    flightRow.append(this.speedText, this.altText);
    statusPanel.appendChild(flightRow);

    const weaponsRow = document.createElement('div');
    weaponsRow.className = 'weapons-row';
    this.gunDot = document.createElement('span');
    this.gunDot.className = 'gun-dot';
    const gunLabel = document.createElement('span');
    gunLabel.textContent = 'GUN';
    this.missileText = document.createElement('span');
    this.missileText.className = 'missile-text';
    weaponsRow.append(this.gunDot, gunLabel, this.missileText);
    statusPanel.appendChild(weaponsRow);

    // --- top-right objective panel ---
    const objPanel = document.createElement('div');
    objPanel.className = 'panel objective-panel';
    this.hudEl.appendChild(objPanel);
    this.objectiveText = document.createElement('div');
    this.objectiveText.className = 'objective-text';
    this.targetsText = document.createElement('div');
    this.targetsText.className = 'targets-text';
    this.timeText = document.createElement('div');
    this.timeText.className = 'time-text';
    objPanel.append(this.objectiveText, this.targetsText, this.timeText);

    // --- center reticle + lock box ---
    this.reticle = document.createElement('div');
    this.reticle.className = 'reticle';
    this.reticle.innerHTML = '<div class="reticle-cross"></div>';
    this.hudEl.appendChild(this.reticle);

    this.lockBox = document.createElement('div');
    this.lockBox.className = 'lock-box hidden';
    this.hudEl.appendChild(this.lockBox);

    this.lockRing = document.createElement('div');
    this.lockRing.className = 'lock-ring hidden';
    this.hudEl.appendChild(this.lockRing);

    this.hitMarker = document.createElement('div');
    this.hitMarker.className = 'hit-marker hidden';
    this.hitMarker.textContent = '✕';
    this.hudEl.appendChild(this.hitMarker);

    // --- missile warning ---
    this.missileWarnEl = document.createElement('div');
    this.missileWarnEl.className = 'missile-warning hidden';
    this.missileWarnEl.textContent = '⚠ MISSILE LOCK ⚠';
    this.hudEl.appendChild(this.missileWarnEl);

    // --- center message banner ---
    this.messageEl = document.createElement('div');
    this.messageEl.className = 'message-banner hidden';
    this.hudEl.appendChild(this.messageEl);

    // --- damage vignette ---
    this.damageVignette = document.createElement('div');
    this.damageVignette.className = 'damage-vignette';
    this.hudEl.appendChild(this.damageVignette);

    // --- radar ---
    const radarWrap = document.createElement('div');
    radarWrap.className = 'radar-wrap';
    this.radarCanvas = document.createElement('canvas');
    this.radarCanvas.width = 150;
    this.radarCanvas.height = 150;
    radarWrap.appendChild(this.radarCanvas);
    this.hudEl.appendChild(radarWrap);
    this.radarCtx = this.radarCanvas.getContext('2d')!;

    // --- waypoint arrow ---
    this.waypointArrow = document.createElement('div');
    this.waypointArrow.className = 'waypoint-arrow hidden';
    this.waypointArrow.textContent = '▲';
    this.hudEl.appendChild(this.waypointArrow);

    // --- controls hint ---
    const hint = document.createElement('div');
    hint.className = 'controls-hint';
    hint.textContent = 'W/S Pitch · A/D Roll · Q/E Yaw · Shift/C Throttle · Space Gun · F Missile · Tab Target';
    this.hudEl.appendChild(hint);
  }

  showBriefing(onStart: () => void, isTouch: boolean) {
    this.briefingEl.classList.remove('hidden');
    this.endEl.classList.add('hidden');
    this.hudEl.classList.add('hidden');
    this.briefingEl.innerHTML = '';

    const title = document.createElement('h1');
    title.textContent = 'CANYON STRIKE';
    const subtitle = document.createElement('p');
    subtitle.className = 'subtitle';
    subtitle.textContent = 'Original arcade air-combat mission';

    const brief = document.createElement('div');
    brief.className = 'brief-text';
    brief.innerHTML = `
      <p>Pilot your strike fighter deep into a hostile mountain canyon. Destroy every ground battery and enemy
      interceptor, then break north for the extraction gate to complete the mission.</p>
    `;

    const controls = document.createElement('div');
    controls.className = 'controls-grid';
    controls.innerHTML = isTouch
      ? `
      <div><b>Left stick</b> — Pitch &amp; Roll</div>
      <div><b>GUN</b> — Fire cannon</div>
      <div><b>MSL</b> — Fire missile (needs lock)</div>
      <div><b>TGT</b> — Cycle target</div>
      <div><b>▲/▼</b> — Throttle up/down</div>
      `
      : `
      <div><b>W / S / ↑ / ↓</b> — Pitch</div>
      <div><b>A / D / ← / →</b> — Roll</div>
      <div><b>Q / E</b> — Rudder</div>
      <div><b>Shift / C</b> — Throttle up/down</div>
      <div><b>Space</b> — Fire cannon</div>
      <div><b>F</b> — Fire missile</div>
      <div><b>Tab</b> — Cycle target lock</div>
      `;

    const startBtn = document.createElement('button');
    startBtn.className = 'primary-btn';
    startBtn.textContent = 'START MISSION';
    startBtn.addEventListener('click', onStart);
    startBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      onStart();
    });

    this.briefingEl.append(title, subtitle, brief, controls, startBtn);
  }

  hideBriefing() {
    this.briefingEl.classList.add('hidden');
    this.hudEl.classList.remove('hidden');
  }

  showEnd(win: boolean, stats: MissionStats, onRestart: () => void) {
    this.hudEl.classList.add('hidden');
    this.endEl.classList.remove('hidden');
    this.endEl.innerHTML = '';

    const title = document.createElement('h1');
    title.textContent = win ? 'MISSION COMPLETE' : 'AIRCRAFT DOWN';
    title.className = win ? 'win-title' : 'lose-title';

    const sub = document.createElement('p');
    sub.className = 'subtitle';
    sub.textContent = win
      ? 'All hostiles neutralized. Extraction confirmed.'
      : stats.cause ?? 'Your aircraft was lost in the canyon.';

    const statsBox = document.createElement('div');
    statsBox.className = 'stats-box';
    const accuracy = stats.shotsFired > 0 ? Math.round((stats.hits / stats.shotsFired) * 100) : 0;
    const mins = Math.floor(stats.missionTime / 60);
    const secs = Math.floor(stats.missionTime % 60);
    statsBox.innerHTML = `
      <div>Targets destroyed: <b>${stats.targetsDestroyed} / ${stats.totalTargets}</b></div>
      <div>Accuracy: <b>${accuracy}%</b></div>
      <div>Mission time: <b>${mins}:${secs.toString().padStart(2, '0')}</b></div>
    `;

    const restartBtn = document.createElement('button');
    restartBtn.className = 'primary-btn';
    restartBtn.textContent = 'RESTART MISSION';
    restartBtn.addEventListener('click', onRestart);
    restartBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      onRestart();
    });

    this.endEl.append(title, sub, statsBox, restartBtn);
  }

  flashHitMarker() {
    this.hitMarker.classList.remove('hidden');
    this.hitMarkerTimer = 0.25;
  }

  showMessage(text: string, duration = 2.5) {
    this.messageEl.textContent = text;
    this.messageEl.classList.remove('hidden');
    this.messageTimer = duration;
  }

  update(dt: number, data: HudFrameData) {
    const healthRatio = Math.max(0, data.health / data.maxHealth);
    this.healthFill.style.width = `${healthRatio * 100}%`;
    this.healthFill.style.background =
      healthRatio > 0.5 ? '#5fd66c' : healthRatio > 0.25 ? '#e0c23d' : '#e0503d';
    this.healthText.textContent = `${Math.round(data.health)}`;

    this.throttleFill.style.width = `${data.throttle * 100}%`;

    this.speedText.textContent = `SPD ${Math.round(data.speed)}`;
    this.altText.textContent = `ALT ${Math.round(data.altitude)}`;

    this.gunDot.style.background = data.gunReady ? '#5fd66c' : '#444';
    this.missileText.textContent = `MSL ${data.missileAmmo}`;

    this.objectiveText.textContent = data.objective;
    this.targetsText.textContent =
      data.targetsRemaining > 0 ? `Hostiles remaining: ${data.targetsRemaining} / ${data.totalTargets}` : 'All hostiles clear';
    const mins = Math.floor(data.missionTime / 60);
    const secs = Math.floor(data.missionTime % 60);
    this.timeText.textContent = `T+ ${mins}:${secs.toString().padStart(2, '0')}`;

    this.reticle.classList.toggle('locked', data.locked);
    this.missileWarnEl.classList.toggle('hidden', !data.missileWarning);

    this.damageVignette.style.opacity = `${Math.min(1, (1 - data.health / data.maxHealth) * 0.6)}`;

    if (this.hitMarkerTimer > 0) {
      this.hitMarkerTimer -= dt;
      if (this.hitMarkerTimer <= 0) this.hitMarker.classList.add('hidden');
    }
    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.messageEl.classList.add('hidden');
    }

    // radar draw
    const ctx = this.radarCtx;
    const w = this.radarCanvas.width;
    const h = this.radarCanvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10, 20, 15, 0.55)';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,255,150,0.35)';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();

    const range = 500;
    for (const blip of data.radarBlips) {
      const rx = (blip.x / range) * (w / 2 - 6);
      const rz = (blip.z / range) * (h / 2 - 6);
      const bx = w / 2 + rx;
      const by = h / 2 + rz;
      ctx.fillStyle = blip.type === 'extraction' ? '#3da8ff' : blip.type === 'air' ? '#ff5252' : '#ffb347';
      ctx.beginPath();
      ctx.arc(bx, by, blip.type === 'extraction' ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // player marker
    ctx.fillStyle = '#e8ecef';
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2 - 5);
    ctx.lineTo(w / 2 - 4, h / 2 + 5);
    ctx.lineTo(w / 2 + 4, h / 2 + 5);
    ctx.closePath();
    ctx.fill();

    // waypoint arrow
    if (data.extractionActive && data.extractionDir) {
      this.waypointArrow.classList.remove('hidden');
      const angle = Math.atan2(data.extractionDir.x, data.extractionDir.y);
      this.waypointArrow.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
      const distText = data.extractionDist !== null ? `${Math.round(data.extractionDist)}m` : '';
      this.waypointArrow.setAttribute('data-dist', distText);
    } else {
      this.waypointArrow.classList.add('hidden');
    }
  }

  updateLockBox(screenPos: { x: number; y: number } | null, progress: number, onScreen: boolean) {
    if (screenPos && onScreen) {
      this.lockBox.classList.remove('hidden');
      this.lockBox.style.left = `${screenPos.x}px`;
      this.lockBox.style.top = `${screenPos.y}px`;
      if (progress > 0 && progress < 1) {
        this.lockRing.classList.remove('hidden');
        this.lockRing.style.left = `${screenPos.x}px`;
        this.lockRing.style.top = `${screenPos.y}px`;
        const deg = progress * 360;
        this.lockRing.style.background = `conic-gradient(#ffd23d ${deg}deg, rgba(255,255,255,0.15) ${deg}deg)`;
      } else {
        this.lockRing.classList.add('hidden');
      }
    } else {
      this.lockBox.classList.add('hidden');
      this.lockRing.classList.add('hidden');
    }
  }

  addShakeFlashClass() {
    this.root.classList.add('impact-flash');
    setTimeout(() => this.root.classList.remove('impact-flash'), 120);
  }
}
