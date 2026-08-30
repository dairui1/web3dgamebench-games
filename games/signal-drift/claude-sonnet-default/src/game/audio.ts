/** Lightweight synthesized SFX/engine hum. No audio assets are loaded — everything is generated with WebAudio oscillators. */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private started = false;
  private muted = false;

  primeOnGesture(): void {
    const start = () => {
      if (this.started) return;
      this.started = true;
      this.init();
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
    };
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
  }

  private init(): void {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineGain.connect(this.master);

    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 60;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    this.engineOsc.connect(filter);
    filter.connect(this.engineGain);
    this.engineOsc.start();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.35, this.ctx.currentTime, 0.05);
  }

  setEngine(speedFrac: number, running: boolean): void {
    if (!this.ctx || !this.engineGain || !this.engineOsc || this.muted) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(running ? 0.05 + speedFrac * 0.09 : 0, t, 0.15);
    this.engineOsc.frequency.setTargetAtTime(55 + speedFrac * 140, t, 0.1);
  }

  private blip(freqStart: number, freqEnd: number, duration: number, type: OscillatorType, gainPeak: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(gainPeak, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  orb(): void {
    this.blip(520, 920, 0.16, 'triangle', 0.25);
  }
  relay(): void {
    this.blip(220, 660, 0.5, 'sine', 0.32);
    window.setTimeout(() => this.blip(440, 880, 0.4, 'sine', 0.26), 120);
  }
  impact(): void {
    this.blip(180, 40, 0.35, 'sawtooth', 0.4);
  }
  win(): void {
    this.blip(300, 1200, 0.9, 'sine', 0.3);
  }
  lose(): void {
    this.blip(200, 30, 1.1, 'sawtooth', 0.35);
  }
}
