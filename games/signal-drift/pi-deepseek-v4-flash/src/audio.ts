// Procedural WebAudio soundscape — fully synthesized, no assets.
// The AudioContext is only created after the first user interaction.

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private boostGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private windGain: GainNode | null = null;
  private muted = false;
  private lowBeepCooldown = 0;
  enabled = true;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  start(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(ctx.destination);

      // shared noise buffer
      const len = Math.floor(ctx.sampleRate * 1.2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;

      // engine: two detuned saws through a lowpass
      const eng = ctx.createGain();
      eng.gain.value = 0;
      this.engineGain = eng;
      for (const f of [58, 62]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.value = 0.5;
        o.connect(g);
        g.connect(eng);
        o.start();
      }
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 260;
      eng.connect(lp);
      lp.connect(this.master);

      // boost buzz
      const bg = ctx.createGain();
      bg.gain.value = 0;
      this.boostGain = bg;
      const bo = ctx.createOscillator();
      bo.type = 'triangle';
      bo.frequency.value = 132;
      const bg2 = ctx.createGain();
      bg2.gain.value = 0.35;
      bo.connect(bg2);
      bg2.connect(bg);
      bo.start();
      bg.connect(this.master);

      // wind (speed-dependent filtered noise)
      const wg = ctx.createGain();
      wg.gain.value = 0;
      this.windGain = wg;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 520;
      bp.Q.value = 0.6;
      src.connect(bp);
      bp.connect(wg);
      wg.connect(this.master);
      src.start();

      if (ctx.state === 'suspended') void ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** speedFrac 0..1, boost 0..1 */
  setEngine(speedFrac: number, boost: number): void {
    if (!this.ctx || !this.engineGain || !this.boostGain || !this.windGain) return;
    const t = this.ctx.currentTime;
    const target = 0.028 + speedFrac * 0.05;
    this.engineGain.gain.setTargetAtTime(target, t, 0.12);
    this.boostGain.gain.setTargetAtTime(boost * 0.05, t, 0.08);
    this.windGain.gain.setTargetAtTime(0.02 + speedFrac * 0.085, t, 0.2);
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    when = 0,
    slideTo?: number
  ): void {
    if (!this.ctx || !this.master) return;
    try {
      const t0 = this.ctx.currentTime + when;
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(this.master);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    } catch {
      /* ignore */
    }
  }

  private noise(dur: number, vol: number, freq: number, q = 0.8, when = 0): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    try {
      const t0 = this.ctx.currentTime + when;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = q;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(bp);
      bp.connect(g);
      g.connect(this.master);
      src.start(t0);
      src.stop(t0 + dur + 0.05);
    } catch {
      /* ignore */
    }
  }

  pickup(): void {
    this.tone(660, 0.09, 'sine', 0.16, 0, 990);
    this.tone(1320, 0.08, 'triangle', 0.08, 0.02);
  }

  arch(): void {
    this.tone(780, 0.12, 'sine', 0.14, 0, 1170);
  }

  hit(): void {
    this.noise(0.28, 0.4, 900, 0.5);
    this.tone(190, 0.32, 'sawtooth', 0.22, 0, 55);
    this.tone(90, 0.4, 'sine', 0.3, 0.02, 40);
  }

  relay(): void {
    const notes = [523, 659, 784, 1047];
    notes.forEach((n, i) => this.tone(n, 0.34, 'triangle', 0.2, i * 0.07));
    this.tone(2093, 0.6, 'sine', 0.05, 0.1);
    this.noise(0.5, 0.08, 2400, 1.2, 0.05);
  }

  lowCharge(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (t < this.lowBeepCooldown) return;
    this.lowBeepCooldown = t + 1.5;
    this.tone(880, 0.07, 'square', 0.06);
    this.tone(660, 0.07, 'square', 0.05, 0.11);
  }

  win(): void {
    const notes = [523, 659, 784, 1047, 1319, 1568];
    notes.forEach((n, i) => this.tone(n, 0.5, 'triangle', 0.2, i * 0.11));
    this.noise(1.0, 0.06, 3600, 0.6, 0.2);
    this.tone(2093, 1.0, 'sine', 0.06, 0.55);
  }

  lose(): void {
    const notes = [330, 262, 196, 147];
    notes.forEach((n, i) => this.tone(n, 0.55, 'sawtooth', 0.16, i * 0.17));
    this.noise(0.8, 0.22, 300, 0.4, 0.1);
  }

  restoreHum(): void {
    this.tone(98, 0.8, 'sine', 0.1, 0, 147);
  }

  lightning(): void {
    this.noise(0.7, 0.3, 250, 0.5);
    this.noise(0.25, 0.24, 2600, 1.1);
  }

  click(): void {
    this.tone(420, 0.05, 'square', 0.05, 0, 520);
  }

  dispose(): void {
    if (this.ctx) void this.ctx.close().catch(() => undefined);
    this.ctx = null;
  }
}