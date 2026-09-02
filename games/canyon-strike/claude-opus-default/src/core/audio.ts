import { clamp, clamp01 } from './mathutil';

/** Small synthesised sound bank – no external assets required. */
export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineOscA: OscillatorNode | null = null;
  private engineOscB: OscillatorNode | null = null;
  private burnerGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private lastGun = 0;
  enabled = true;

  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    type Win = Window & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? (window as Win).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    this.master = master;

    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    // Engine: two detuned saws + filtered noise.
    const eg = ctx.createGain();
    eg.gain.value = 0;
    const ef = ctx.createBiquadFilter();
    ef.type = 'lowpass';
    ef.frequency.value = 600;
    ef.Q.value = 2.4;
    eg.connect(ef);
    ef.connect(master);
    const oa = ctx.createOscillator();
    oa.type = 'sawtooth';
    oa.frequency.value = 70;
    const ob = ctx.createOscillator();
    ob.type = 'sawtooth';
    ob.frequency.value = 104;
    oa.connect(eg);
    ob.connect(eg);
    oa.start();
    ob.start();

    const burner = ctx.createBufferSource();
    burner.buffer = buf;
    burner.loop = true;
    const bg = ctx.createGain();
    bg.gain.value = 0;
    const bf = ctx.createBiquadFilter();
    bf.type = 'bandpass';
    bf.frequency.value = 420;
    bf.Q.value = 0.7;
    burner.connect(bf);
    bf.connect(bg);
    bg.connect(master);
    burner.start();

    this.engineGain = eg;
    this.engineFilter = ef;
    this.engineOscA = oa;
    this.engineOscB = ob;
    this.burnerGain = bg;
  }

  suspend(): void {
    void this.ctx?.suspend();
  }
  resume(): void {
    void this.ctx?.resume();
  }
  setMuted(m: boolean): void {
    this.enabled = !m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private noise(dur: number, gain: number, type: BiquadFilterType, f0: number, f1: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuffer || !this.enabled) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    const t = this.now();
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private tone(
    freq: number,
    dur: number,
    gain: number,
    type: OscillatorType = 'sine',
    freqEnd?: number
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.enabled) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    const t = this.now();
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  updateEngine(throttle: number, speedNorm: number, burner: number): void {
    if (!this.ctx || !this.engineGain) return;
    const t = this.now();
    const base = 58 + throttle * 62 + speedNorm * 34;
    this.engineOscA?.frequency.setTargetAtTime(base, t, 0.15);
    this.engineOscB?.frequency.setTargetAtTime(base * 1.49, t, 0.15);
    this.engineFilter?.frequency.setTargetAtTime(420 + throttle * 900, t, 0.2);
    this.engineGain.gain.setTargetAtTime(0.05 + throttle * 0.1, t, 0.2);
    this.burnerGain?.gain.setTargetAtTime(burner * 0.11, t, 0.15);
  }

  gunShot(): void {
    const t = this.now();
    if (t - this.lastGun < 0.045) return;
    this.lastGun = t;
    this.noise(0.09, 0.16, 'bandpass', 1800, 500);
    this.tone(180, 0.06, 0.09, 'square', 90);
  }

  missileLaunch(): void {
    this.noise(0.75, 0.3, 'lowpass', 2600, 260);
    this.tone(320, 0.5, 0.1, 'sawtooth', 90);
  }

  explosion(dist = 0, big = 1): void {
    const att = clamp01(1 - dist / 2600);
    if (att <= 0.02) return;
    this.noise(0.55 * big, Math.min(0.5, 0.42 * att * big), 'lowpass', 900 * big, 80);
    this.tone(Math.max(45, 90 * (2 - big)), 0.42 * big, 0.28 * att, 'sine', 32);
  }

  hitMarker(): void {
    this.tone(1450, 0.06, 0.09, 'square', 900);
  }

  playerHit(): void {
    this.noise(0.3, 0.32, 'lowpass', 1500, 120);
    this.tone(70, 0.34, 0.24, 'sawtooth', 40);
  }

  lockSearch(): void {
    this.tone(880, 0.05, 0.055, 'square');
  }

  lockAcquired(): void {
    this.tone(1320, 0.22, 0.07, 'square');
  }

  warn(): void {
    this.tone(560, 0.14, 0.07, 'sawtooth');
  }

  flare(): void {
    this.noise(0.4, 0.2, 'highpass', 700, 2400);
  }

  ui(up = true): void {
    this.tone(up ? 660 : 380, 0.1, 0.06, 'triangle', up ? 990 : 260);
  }

  fanfare(win: boolean): void {
    const seq = win ? [523, 659, 784, 1047] : [392, 330, 262, 196];
    seq.forEach((f, i) => {
      window.setTimeout(() => this.tone(f, 0.45, 0.09, 'triangle'), i * 150);
    });
  }

  volume(v: number): void {
    if (this.master) this.master.gain.value = clamp(v, 0, 1);
  }
}
