// Procedural sound effects via WebAudio. No external assets.

export class AudioFX {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineLfo: OscillatorNode | null = null;
  private engineLfoGain: GainNode | null = null;
  private windSrc: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  muted = false;

  /** Must be called from a user gesture (Start button). */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(this.ctx.destination);
    this.startEngine();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
    }
  }

  private startEngine(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 70;
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineOsc2.frequency.value = 46;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 420;
    this.engineFilter.Q.value = 2.5;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    // Slow rumble LFO
    this.engineLfo = ctx.createOscillator();
    this.engineLfo.type = 'sine';
    this.engineLfo.frequency.value = 8;
    this.engineLfoGain = ctx.createGain();
    this.engineLfoGain.gain.value = 9;
    this.engineLfo.connect(this.engineLfoGain);
    this.engineLfoGain.connect(this.engineOsc.frequency);
    this.engineOsc.start();
    this.engineOsc2.start();
    this.engineLfo.start();
    // Wind-noise loop
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.windSrc = ctx.createBufferSource();
    this.windSrc.buffer = buf;
    this.windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 700;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    this.windSrc.start();
  }

  /** Called every frame with throttle 0..1 to shape the engine hum. */
  engine(throttle: number, rpm: number, damaged: boolean): void {
    if (!this.ctx || !this.engineOsc || !this.engineOsc2 || !this.engineGain || !this.engineFilter) return;
    const t = this.ctx.currentTime;
    const base = 55 + throttle * 120 + rpm * 40;
    const wob = damaged ? 1.3 : 1;
    this.engineOsc.frequency.setTargetAtTime(base, t, 0.08);
    this.engineOsc2.frequency.setTargetAtTime(base * 0.68 * wob, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(280 + throttle * 700 + (damaged ? 160 : 0), t, 0.1);
    const vol = damaged ? 0.045 : 0.038;
    this.engineGain.gain.setTargetAtTime(vol * (0.35 + throttle * 0.65), t, 0.15);
    if (this.windGain && this.windFilter) {
      const sn = rpm < 0 ? 0 : rpm > 1 ? 1 : rpm;
      this.windFilter.frequency.setTargetAtTime(500 + sn * 900, t, 0.1);
      this.windGain.gain.setTargetAtTime(sn * 0.028 + (damaged ? 0.006 : 0), t, 0.2);
    }
  }

  private blip(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, filterFreq: number, filterType: BiquadFilterType = 'bandpass', slideTo?: number): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(filterFreq, t);
    if (slideTo !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
  }

  gun(): void {
    this.noise(0.14, 0.16, 900, 'bandpass', 300);
    this.blip(180, 0.06, 'square', 0.05, 90);
  }

  gunOverheat(): void {
    this.blip(220, 0.25, 'sawtooth', 0.12, 90);
  }

  missileLaunch(): void {
    this.noise(0.7, 0.3, 600, 'lowpass', 2400);
    this.blip(300, 0.5, 'sawtooth', 0.08, 900);
  }

  enemyMissileLaunch(): void {
    this.noise(0.6, 0.22, 500, 'lowpass', 1900);
  }

  flare(): void {
    this.noise(0.4, 0.2, 2000, 'highpass');
    this.blip(1200, 0.3, 'sine', 0.05, 300);
  }

  lock(): void {
    this.blip(1180, 0.09, 'square', 0.09);
  }

  locked(): void {
    this.blip(1180, 0.07, 'square', 0.1);
    setTimeout(() => this.blip(1560, 0.09, 'square', 0.1), 90);
  }

  alert(): void {
    this.blip(880, 0.12, 'square', 0.12);
    setTimeout(() => this.blip(660, 0.14, 'square', 0.12), 150);
  }

  hit(): void {
    this.noise(0.1, 0.14, 1400, 'bandpass', 500);
  }

  hitTarget(): void {
    this.blip(1400, 0.07, 'square', 0.09, 700);
  }

  explode(big: boolean): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.noise(big ? 1.6 : 0.9, big ? 0.55 : 0.35, 220, 'lowpass', 40);
    if (!this.master) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(big ? 150 : 110, t);
    o.frequency.exponentialRampToValueAtTime(28, t + (big ? 1.1 : 0.7));
    const g = ctx.createGain();
    g.gain.setValueAtTime(big ? 0.55 : 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (big ? 1.3 : 0.8));
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 1.4);
  }

  gunImpact(): void {
    this.noise(0.08, 0.1, 2500, 'highpass');
  }

  uiClick(): void {
    this.blip(700, 0.06, 'sine', 0.09, 1100);
  }

  missionComplete(): void {
    const notes = [523, 659, 784, 1046];
    notes.forEach((n, i) => setTimeout(() => this.blip(n, 0.5, 'triangle', 0.14), i * 160));
  }

  missionFail(): void {
    const notes = [392, 311, 233, 155];
    notes.forEach((n, i) => setTimeout(() => this.blip(n, 0.6, 'sawtooth', 0.12), i * 220));
  }

  touchdown(): void {
    this.noise(0.8, 0.25, 300, 'lowpass', 60);
  }
}