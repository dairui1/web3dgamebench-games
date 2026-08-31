/**
 * Tiny procedural audio engine. No external assets.
 * The AudioContext is created lazily on the first user gesture only.
 */
export class AudioFX {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private humOscA: OscillatorNode | null = null;
  private humOscB: OscillatorNode | null = null;
  muted = false;

  /** Must be called from a user gesture (click / keydown). Safe to call many times. */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.5;
      master.connect(ctx.destination);
      this.master = master;

      // Shared white-noise buffer for bursts.
      const len = ctx.sampleRate * 1.2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;

      // Engine hum: low saw + sine through a lowpass.
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 320;
      lp.connect(master);
      const gain = ctx.createGain();
      gain.gain.value = 0.05;
      gain.connect(lp);
      const oscA = ctx.createOscillator();
      oscA.type = 'sawtooth';
      oscA.frequency.value = 52;
      oscA.connect(gain);
      oscA.start();
      const oscB = ctx.createOscillator();
      oscB.type = 'sine';
      oscB.frequency.value = 104;
      oscB.connect(gain);
      oscB.start();
      this.humOscA = oscA;
      this.humOscB = oscB;
      this.engineGain = gain;
    } catch {
      this.ctx = null;
    }
  }

  /** Call every frame with (speedRatio, boosting). */
  setEngine(speedRatio: number, boosting: boolean): void {
    if (!this.ctx || !this.engineGain || !this.humOscA || !this.humOscB) return;
    try {
      const t = this.ctx.currentTime;
      this.engineGain.gain.setTargetAtTime(0.035 + 0.05 * speedRatio + (boosting ? 0.045 : 0), t, 0.1);
      this.humOscA.frequency.setTargetAtTime(48 + 26 * speedRatio + (boosting ? 14 : 0), t, 0.08);
      this.humOscB.frequency.setTargetAtTime(97 + 44 * speedRatio + (boosting ? 22 : 0), t, 0.08);
    } catch {
      /* ignore */
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number): void {
    if (!this.ctx || !this.master) return;
    try {
      const t = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    } catch {
      /* ignore */
    }
  }

  private noise(dur: number, vol: number, filterFreq: number, type: BiquadFilterType = 'lowpass', delay = 0): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    try {
      const t = this.ctx.currentTime + delay;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = filterFreq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(this.master);
      src.start(t);
      src.stop(t + dur + 0.05);
    } catch {
      /* ignore */
    }
  }

  pickup(): void {
    this.tone(760, 0.14, 'sine', 0.12, 0, 1240);
    this.tone(1530, 0.1, 'sine', 0.05, 0.02);
  }

  restore(): void {
    this.tone(392, 0.5, 'triangle', 0.16);
    this.tone(523, 0.5, 'triangle', 0.16, 0.09);
    this.tone(659, 0.6, 'triangle', 0.16, 0.18);
    this.tone(1046, 0.7, 'sine', 0.1, 0.26);
  }

  damage(): void {
    this.noise(0.25, 0.4, 900);
    this.tone(140, 0.3, 'square', 0.18, 0, 60);
  }

  strike(): void {
    this.noise(0.9, 0.25, 240);
    this.tone(70, 0.5, 'sine', 0.2, 0, 40);
  }

  warning(): void {
    this.tone(880, 0.09, 'square', 0.045, 0, 660);
  }

  boostOn(): void {
    this.tone(220, 0.25, 'sawtooth', 0.06, 0, 440);
  }

  win(): void {
    const notes = [523, 659, 784, 1046, 1318];
    notes.forEach((n, i) => this.tone(n, 0.5, 'triangle', 0.16, i * 0.13));
    this.noise(1.2, 0.08, 4000, 'highpass', 0.05);
  }

  lose(): void {
    this.tone(330, 0.7, 'sawtooth', 0.16, 0, 110);
    this.tone(196, 1.0, 'sawtooth', 0.14, 0.2, 60);
    this.noise(1.1, 0.3, 500, 'lowpass', 0.1);
  }

  click(): void {
    this.tone(600, 0.06, 'sine', 0.08, 0, 900);
  }
}