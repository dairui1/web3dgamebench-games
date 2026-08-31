import { clamp } from './util';

/**
 * Tiny procedural synth. Nothing is loaded - every sound is generated from
 * oscillators and a procedurally filled noise buffer. Created only after the
 * player interacts (see unlock()).
 */
export class AudioKit {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineOscA: OscillatorNode | null = null;
  private engineOscB: OscillatorNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private started = false;
  private _muted = false;
  private lastBlip = 0;

  get muted(): boolean {
    return this._muted;
  }

  get ready(): boolean {
    return this.started;
  }

  unlock(): void {
    if (this.started) {
      void this.ctx?.resume();
      return;
    }
    try {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = this._muted ? 0 : 0.85;
      master.connect(ctx.destination);
      this.master = master;

      // Noise bed used by wind and impacts.
      const length = Math.floor(ctx.sampleRate * 2);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < length; i += 1) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.2 + white * 0.35;
      }
      this.noiseBuffer = buffer;

      const engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      const engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 420;
      engineFilter.Q.value = 3.5;
      engineGain.connect(master);
      engineFilter.connect(engineGain);
      const oscA = ctx.createOscillator();
      oscA.type = 'sawtooth';
      oscA.frequency.value = 58;
      const oscB = ctx.createOscillator();
      oscB.type = 'square';
      oscB.frequency.value = 43;
      const oscGain = ctx.createGain();
      oscGain.gain.value = 0.35;
      oscA.connect(oscGain);
      oscB.connect(oscGain);
      oscGain.connect(engineFilter);
      oscA.start();
      oscB.start();
      this.engineGain = engineGain;
      this.engineFilter = engineFilter;
      this.engineOscA = oscA;
      this.engineOscB = oscB;

      const wind = ctx.createBufferSource();
      wind.buffer = buffer;
      wind.loop = true;
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 700;
      windFilter.Q.value = 0.8;
      const windGain = ctx.createGain();
      windGain.gain.value = 0;
      wind.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(master);
      wind.start();
      this.windGain = windGain;
      this.windFilter = windFilter;

      this.started = true;
      void ctx.resume();
    } catch {
      this.ctx = null;
      this.started = false;
    }
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.85, this.ctx.currentTime, 0.05);
    }
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Continuous engine/wind mix. */
  setFlight(speed01: number, boosting: boolean, active: boolean, danger: number): void {
    if (!this.ctx || !this.started) return;
    const t = this.ctx.currentTime;
    const target = active ? 0.06 + speed01 * 0.2 + (boosting ? 0.14 : 0) : 0;
    this.engineGain?.gain.setTargetAtTime(target, t, 0.12);
    this.engineFilter?.frequency.setTargetAtTime(260 + speed01 * 900 + (boosting ? 500 : 0), t, 0.15);
    this.engineOscA?.frequency.setTargetAtTime(46 + speed01 * 60 + (boosting ? 22 : 0), t, 0.2);
    this.engineOscB?.frequency.setTargetAtTime(33 + speed01 * 40, t, 0.25);
    this.windGain?.gain.setTargetAtTime(active ? 0.02 + speed01 * 0.13 + danger * 0.08 : 0, t, 0.2);
    this.windFilter?.frequency.setTargetAtTime(500 + speed01 * 1500 + danger * 700, t, 0.3);
  }

  private tone(
    freq: number,
    duration: number,
    type: OscillatorType,
    gain: number,
    delay = 0,
    endFreq?: number,
  ): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + duration);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  private noiseBurst(duration: number, freq: number, gain: number): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 1.2;
    const g = ctx.createGain();
    const t0 = ctx.currentTime;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + duration + 0.05);
  }

  pickup(index: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastBlip < 0.045) return;
    this.lastBlip = now;
    const step = clamp(index % 8, 0, 7);
    this.tone(520 * Math.pow(1.06, step), 0.16, 'triangle', 0.18, 0, 940 * Math.pow(1.06, step));
  }

  impact(): void {
    this.noiseBurst(0.35, 180, 0.5);
    this.tone(120, 0.32, 'sawtooth', 0.22, 0, 44);
  }

  zap(): void {
    this.noiseBurst(0.22, 1800, 0.3);
    this.tone(880, 0.18, 'square', 0.1, 0, 180);
  }

  relayRestored(step: number): void {
    const base = 330 * Math.pow(1.06, step);
    [0, 0.09, 0.18, 0.3].forEach((delay, i) => {
      this.tone(base * [1, 1.26, 1.5, 2][i], 0.5, 'triangle', 0.17, delay);
    });
    this.noiseBurst(0.5, 900, 0.12);
  }

  unlockExtraction(): void {
    [0, 0.12, 0.24].forEach((d, i) => this.tone(220 * (1 + i * 0.5), 0.7, 'sine', 0.16, d));
    this.noiseBurst(0.7, 240, 0.18);
  }

  win(): void {
    [0, 0.14, 0.28, 0.42, 0.6].forEach((d, i) => {
      this.tone([392, 523, 659, 784, 1046][i], 0.9, 'triangle', 0.2, d);
    });
  }

  lose(): void {
    [0, 0.16, 0.32].forEach((d, i) => {
      this.tone([280, 200, 130][i], 1.1, 'sawtooth', 0.16, d, [180, 120, 60][i]);
    });
    this.noiseBurst(1.2, 120, 0.25);
  }

  uiClick(): void {
    this.tone(660, 0.09, 'square', 0.1, 0, 990);
  }

  warn(): void {
    this.tone(180, 0.28, 'sine', 0.14, 0, 140);
  }
}
