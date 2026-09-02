// Procedural sound effects via WebAudio (no external assets).

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineNoise: AudioBufferSourceNode | null = null;
  private engineNoiseGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.buildEngine();
    } catch {
      this.ctx = null;
    }
  }

  private buildEngine(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;

    // Noise buffer for gun / explosions / engine rumble.
    const len = ctx.sampleRate * 1.5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineGain.connect(this.master);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    lp.connect(this.engineGain);

    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 60;
    this.engineOsc.connect(lp);
    this.engineOsc.start();

    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'triangle';
    this.engineOsc2.frequency.value = 92;
    const g2 = ctx.createGain();
    g2.gain.value = 0.4;
    this.engineOsc2.connect(g2);
    g2.connect(lp);
    this.engineOsc2.start();

    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const nlp = ctx.createBiquadFilter();
    nlp.type = 'lowpass';
    nlp.frequency.value = 300;
    const ng = ctx.createGain();
    ng.gain.value = 0.5;
    noise.connect(nlp);
    nlp.connect(ng);
    ng.connect(this.engineGain);
    noise.start();
    this.engineNoise = noise;
    this.engineNoiseGain = ng;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** speed01: 0..1 throttle-ish, alive: whether engine should run */
  updateEngine(speed01: number, alive: boolean): void {
    if (!this.ctx || !this.engineGain || !this.engineOsc || !this.engineOsc2)
      return;
    const t = this.ctx.currentTime;
    const target = alive ? 0.05 + speed01 * 0.1 : 0;
    this.engineGain.gain.setTargetAtTime(target, t, 0.1);
    const f = 55 + speed01 * 70;
    this.engineOsc.frequency.setTargetAtTime(f, t, 0.15);
    this.engineOsc2.frequency.setTargetAtTime(f * 1.5, t, 0.15);
    if (this.engineNoiseGain)
      this.engineNoiseGain.gain.setTargetAtTime(
        alive ? 0.3 + speed01 * 0.4 : 0,
        t,
        0.1,
      );
  }

  private noiseBurst(
    duration: number,
    gain: number,
    filterType: BiquadFilterType,
    freqStart: number,
    freqEnd: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuffer) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freqStart, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  private blip(
    freq: number,
    duration: number,
    gain: number,
    type: OscillatorType = 'square',
    freqEnd?: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd !== undefined)
      o.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + duration + 0.02);
  }

  gun(): void {
    this.noiseBurst(0.08, 0.25, 'highpass', 1200, 500);
    this.blip(180, 0.05, 0.12, 'square', 90);
  }

  missileLaunch(): void {
    this.noiseBurst(0.7, 0.4, 'lowpass', 3000, 200);
    this.blip(500, 0.4, 0.15, 'sawtooth', 120);
  }

  explosion(big = false): void {
    this.noiseBurst(big ? 1.1 : 0.6, big ? 0.8 : 0.5, 'lowpass', 900, 60);
    this.blip(big ? 90 : 140, big ? 0.7 : 0.4, 0.3, 'triangle', 40);
  }

  hit(): void {
    this.blip(900, 0.06, 0.2, 'square', 500);
  }

  lockTone(): void {
    this.blip(1300, 0.07, 0.15, 'sine');
  }

  lockAcquired(): void {
    this.blip(1700, 0.12, 0.2, 'sine');
  }

  warningBeep(): void {
    this.blip(700, 0.12, 0.22, 'square', 550);
  }

  damageAlarm(): void {
    this.blip(420, 0.2, 0.25, 'sawtooth', 260);
  }

  uiClick(): void {
    this.blip(800, 0.06, 0.15, 'sine');
  }

  fanfareWin(): void {
    const notes = [523, 659, 784, 1047];
    notes.forEach((n, i) => {
      window.setTimeout(() => this.blip(n, 0.25, 0.2, 'triangle'), i * 160);
    });
  }

  fanfareLose(): void {
    const notes = [440, 349, 262, 196];
    notes.forEach((n, i) => {
      window.setTimeout(() => this.blip(n, 0.35, 0.22, 'sawtooth'), i * 220);
    });
  }
}
