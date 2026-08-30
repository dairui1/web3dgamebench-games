export class Hud {
  readonly root: HTMLDivElement;
  private chargeFill: HTMLDivElement;
  private chargeLabel: HTMLDivElement;
  private relayPips: HTMLDivElement[] = [];
  private objectiveEl: HTMLDivElement;
  private scoreEl: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private toastTimer: number | null = null;

  private startOverlay: HTMLDivElement;
  private endOverlay: HTMLDivElement;
  private endTitle: HTMLDivElement;
  private endStats: HTMLDivElement;
  private pauseOverlay: HTMLDivElement;

  private muteBtn: HTMLButtonElement;

  onStart: (() => void) | null = null;
  onRestart: (() => void) | null = null;
  onToggleMute: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud-root';
    container.appendChild(this.root);

    // Top HUD bar
    const bar = document.createElement('div');
    bar.className = 'hud-bar';
    this.root.appendChild(bar);

    const chargeWrap = document.createElement('div');
    chargeWrap.className = 'charge-wrap';
    this.chargeLabel = document.createElement('div');
    this.chargeLabel.className = 'charge-label';
    this.chargeLabel.textContent = 'CHARGE';
    const chargeTrack = document.createElement('div');
    chargeTrack.className = 'charge-track';
    this.chargeFill = document.createElement('div');
    this.chargeFill.className = 'charge-fill';
    chargeTrack.appendChild(this.chargeFill);
    chargeWrap.appendChild(this.chargeLabel);
    chargeWrap.appendChild(chargeTrack);
    bar.appendChild(chargeWrap);

    const relayWrap = document.createElement('div');
    relayWrap.className = 'relay-wrap';
    for (let i = 0; i < 3; i++) {
      const pip = document.createElement('div');
      pip.className = 'relay-pip';
      pip.textContent = String(i + 1);
      relayWrap.appendChild(pip);
      this.relayPips.push(pip);
    }
    bar.appendChild(relayWrap);

    this.scoreEl = document.createElement('div');
    this.scoreEl.className = 'score-label';
    this.scoreEl.textContent = 'SCORE 0';
    bar.appendChild(this.scoreEl);

    this.muteBtn = document.createElement('button');
    this.muteBtn.className = 'mute-btn';
    this.muteBtn.textContent = 'SOUND ON';
    this.muteBtn.addEventListener('click', () => this.onToggleMute?.());
    bar.appendChild(this.muteBtn);

    this.objectiveEl = document.createElement('div');
    this.objectiveEl.className = 'objective-label';
    this.root.appendChild(this.objectiveEl);

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast';
    this.root.appendChild(this.toastEl);

    // Start overlay
    this.startOverlay = document.createElement('div');
    this.startOverlay.className = 'overlay start-overlay';
    this.startOverlay.innerHTML = `
      <div class="panel">
        <div class="title">SIGNAL DRIFT</div>
        <div class="subtitle">Storm-damaged relay field, above the cloud sea</div>
        <p class="blurb">
          Pilot your courier craft through the drifting relay field. Restore all three
          relays <strong>in order</strong>, keep your charge above zero, and cross the
          gold extraction ring to make it home.
        </p>
        <ul class="controls-list">
          <li><strong>Steer</strong> — Arrow keys / WASD, or drag the on-screen stick</li>
          <li><strong>Boost</strong> — Shift, or the BOOST button</li>
          <li><strong>Restart</strong> — R, any time</li>
        </ul>
        <button class="btn primary" id="btn-start">BEGIN FLIGHT</button>
      </div>
    `;
    this.root.appendChild(this.startOverlay);
    this.startOverlay.querySelector('#btn-start')?.addEventListener('click', () => this.onStart?.());

    // End overlay
    this.endOverlay = document.createElement('div');
    this.endOverlay.className = 'overlay end-overlay hidden';
    this.endOverlay.innerHTML = `
      <div class="panel">
        <div class="title end-title">RESULT</div>
        <div class="end-stats"></div>
        <button class="btn primary" id="btn-restart">RESTART</button>
      </div>
    `;
    this.root.appendChild(this.endOverlay);
    this.endTitle = this.endOverlay.querySelector('.end-title') as HTMLDivElement;
    this.endStats = this.endOverlay.querySelector('.end-stats') as HTMLDivElement;
    this.endOverlay.querySelector('#btn-restart')?.addEventListener('click', () => this.onRestart?.());

    // Pause overlay
    this.pauseOverlay = document.createElement('div');
    this.pauseOverlay.className = 'overlay pause-overlay hidden';
    this.pauseOverlay.innerHTML = `<div class="panel"><div class="title">PAUSED</div><div class="subtitle">Tab hidden — return to resume</div></div>`;
    this.root.appendChild(this.pauseOverlay);
  }

  setCharge(charge: number, max: number): void {
    const pct = Math.max(0, Math.min(1, charge / max));
    this.chargeFill.style.width = `${pct * 100}%`;
    this.chargeFill.classList.toggle('low', pct < 0.3);
    this.chargeLabel.textContent = `CHARGE ${Math.max(0, Math.round(charge))}`;
  }

  setRelays(restored: number): void {
    this.relayPips.forEach((pip, i) => {
      pip.classList.toggle('restored', i < restored);
      pip.classList.toggle('next', i === restored);
    });
  }

  setObjective(text: string): void {
    this.objectiveEl.textContent = text;
  }

  setScore(score: number): void {
    this.scoreEl.textContent = `SCORE ${Math.round(score)}`;
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2200);
  }

  showStart(show: boolean): void {
    this.startOverlay.classList.toggle('hidden', !show);
  }

  showEnd(win: boolean, score: number, relaysRestored: number): void {
    this.endTitle.textContent = win ? 'EXTRACTED' : 'CRAFT LOST';
    this.endTitle.classList.toggle('win', win);
    this.endTitle.classList.toggle('lose', !win);
    this.endStats.innerHTML = `
      <div>Relays restored: ${relaysRestored} / 3</div>
      <div>Final score: ${Math.round(score)}</div>
    `;
    this.endOverlay.classList.remove('hidden');
  }

  hideEnd(): void {
    this.endOverlay.classList.add('hidden');
  }

  showPause(show: boolean): void {
    this.pauseOverlay.classList.toggle('hidden', !show);
  }

  setMuteLabel(muted: boolean): void {
    this.muteBtn.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
  }
}
