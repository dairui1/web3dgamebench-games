import { clamp } from './rng';

/**
 * Fully synthesised audio (no files). The context is only created after the
 * player's first gesture, per browser autoplay policy.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private windGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private started = false;

  muted = false;

  /** Must be called from a user gesture handler. */
  start(): void {
    if (this.started) return;
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.started = true;

    try {
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(ctx.destination);

      // Procedural noise bed used for thruster wash and impacts.
      const length = Math.floor(ctx.sampleRate * 2);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.2;
      }
      this.noiseBuffer = buffer;

      const wind = ctx.createBufferSource();
      wind.buffer = buffer;
      wind.loop = true;
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 620;
      windFilter.Q.value = 0.7;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0.0;
      wind.connect(windFilter).connect(this.windGain).connect(this.master);
      wind.start();

      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0;
      const engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 900;
      this.engineGain.connect(engineFilter).connect(this.master);

      this.engineOsc = ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 70;
      this.engineOsc.connect(this.engineGain);
      this.engineOsc.start();

      this.engineSub = ctx.createOscillator();
      this.engineSub.type = 'triangle';
      this.engineSub.frequency.value = 46;
      this.engineSub.connect(this.engineGain);
      this.engineSub.start();
    } catch {
      this.ctx = null;
    }
  }

  resume(): void {
    void this.ctx?.resume();
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
    }
  }

  /** Continuous engine/wind bed driven by throttle and speed. */
  setDrive(throttle: number, speed01: number, alive: boolean): void {
    if (!this.ctx || !this.engineGain || !this.engineOsc || !this.engineSub || !this.windGain) return;
    const t = this.ctx.currentTime;
    const gain = alive ? 0.055 + throttle * 0.075 : 0;
    this.engineGain.gain.setTargetAtTime(gain, t, 0.12);
    this.engineOsc.frequency.setTargetAtTime(58 + speed01 * 92, t, 0.15);
    this.engineSub.frequency.setTargetAtTime(38 + speed01 * 34, t, 0.2);
    this.windGain.gain.setTargetAtTime(alive ? 0.02 + speed01 * 0.1 : 0, t, 0.2);
  }

  private tone(
    freq: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    delay = 0,
    endFreq = freq,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  private noise(duration: number, volume: number, freq: number, q = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuffer) return;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.25), t0 + duration);
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
    src.stop(t0 + duration + 0.05);
  }

  pickup(pitch = 0): void {
    this.tone(720 + pitch * 40, 0.16, 'triangle', 0.16, 0, 1180 + pitch * 60);
  }

  scrape(intensity: number): void {
    this.noise(0.18, clamp(intensity, 0.05, 0.5) * 0.5, 1400, 2);
  }

  impact(): void {
    this.noise(0.55, 0.42, 900, 0.8);
    this.tone(140, 0.4, 'sawtooth', 0.24, 0, 48);
  }

  relay(index: number): void {
    const base = 320 + index * 90;
    this.tone(base, 0.5, 'triangle', 0.16, 0, base * 1.5);
    this.tone(base * 1.5, 0.6, 'sine', 0.12, 0.06, base * 2.0);
    this.tone(base * 2, 0.8, 'sine', 0.08, 0.14, base * 3);
  }

  alarm(): void {
    this.tone(520, 0.12, 'square', 0.07, 0, 380);
  }

  win(): void {
    const notes = [392, 523, 659, 784, 1046];
    notes.forEach((n, i) => this.tone(n, 0.55, 'triangle', 0.15, i * 0.11, n * 1.01));
  }

  lose(): void {
    this.tone(220, 1.4, 'sawtooth', 0.2, 0, 42);
    this.noise(1.1, 0.3, 480, 0.6);
  }

  ui(): void {
    this.tone(660, 0.08, 'square', 0.07, 0, 880);
  }
}
