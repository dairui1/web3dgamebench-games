// Canyon Strike - procedural WebAudio (no asset files): weapons, ambience, UI.
export type ShotKind = 'rifle' | 'cannon' | 'acid' | 'turret' | 'napalm';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private ambBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;
  private nightGain: GainNode | null = null;
  private whineGain: GainNode | null = null;
  private started = false;
  volMaster = 0.75;
  volSfx = 0.85;
  volAmb = 0.6;

  /** Must run inside a user gesture. */
  ensure(): void {
    if (this.started) return;
    const AC: typeof AudioContext = (window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext;
    if (!AC) return;
    try {
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.volMaster;
      this.master.connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = this.volSfx;
      this.sfxBus.connect(this.master);
      this.ambBus = ctx.createGain();
      this.ambBus.gain.value = this.volAmb;
      this.ambBus.connect(this.master);

      const len = Math.floor(ctx.sampleRate * 2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;

      // wind bed
      const wsrc = ctx.createBufferSource();
      wsrc.buffer = buf;
      wsrc.loop = true;
      const wf = ctx.createBiquadFilter();
      wf.type = 'bandpass';
      wf.frequency.value = 420;
      wf.Q.value = 0.6;
      const wg = ctx.createGain();
      wg.gain.value = 0.05;
      wsrc.connect(wf).connect(wg).connect(this.ambBus);
      wsrc.start();
      this.windGain = wg;
      this.windFilter = wf;

      // rain bed
      const rsrc = ctx.createBufferSource();
      rsrc.buffer = buf;
      rsrc.loop = true;
      const rf = ctx.createBiquadFilter();
      rf.type = 'highpass';
      rf.frequency.value = 1800;
      const rg = ctx.createGain();
      rg.gain.value = 0;
      rsrc.connect(rf).connect(rg).connect(this.ambBus);
      rsrc.start();
      this.rainGain = rg;

      // low night drone
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 46;
      const of = ctx.createBiquadFilter();
      of.type = 'lowpass';
      of.frequency.value = 150;
      const og = ctx.createGain();
      og.gain.value = 0;
      osc.connect(of).connect(og).connect(this.ambBus);
      osc.start();
      this.nightGain = og;

      // insect whine (wetlands at night)
      const w2 = ctx.createOscillator();
      w2.type = 'sawtooth';
      w2.frequency.value = 5200;
      const w2f = ctx.createBiquadFilter();
      w2f.type = 'bandpass';
      w2f.frequency.value = 5200;
      w2f.Q.value = 12;
      const w2g = ctx.createGain();
      w2g.gain.value = 0;
      w2.connect(w2f).connect(w2g).connect(this.ambBus);
      w2.start();
      this.whineGain = w2g;

      this.started = true;
    } catch {
      this.ctx = null;
    }
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  setVolumes(master: number, sfx: number, amb: number): void {
    this.volMaster = master;
    this.volSfx = sfx;
    this.volAmb = amb;
    if (this.master) this.master.gain.value = master;
    if (this.sfxBus) this.sfxBus.gain.value = sfx;
    if (this.ambBus) this.ambBus.gain.value = amb;
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private burst(o: { dur: number; type: BiquadFilterType; f0: number; f1: number; q: number; gain: number; attack?: number; dist?: number }): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noise) return;
    const t = this.now();
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = o.type;
    f.Q.value = o.q;
    f.frequency.setValueAtTime(o.f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, o.f1), t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t);
    src.stop(t + o.dur + 0.02);
  }

  private tone(o: { f0: number; f1: number; dur: number; type: OscillatorType; gain: number; delay?: number }): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    const t = this.now() + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + o.dur + 0.02);
  }

  shot(kind: ShotKind, pan = 0): void {
    if (!this.started) return;
    switch (kind) {
      case 'rifle':
        this.burst({ dur: 0.1, type: 'bandpass', f0: 2600, f1: 500, q: 1.1, gain: 0.4 });
        this.tone({ f0: 190, f1: 60, dur: 0.09, type: 'square', gain: 0.12 });
        break;
      case 'turret':
        this.burst({ dur: 0.16, type: 'bandpass', f0: 1800, f1: 320, q: 0.9, gain: 0.5 });
        this.tone({ f0: 150, f1: 45, dur: 0.16, type: 'sawtooth', gain: 0.16 });
        break;
      case 'cannon':
        this.burst({ dur: 0.32, type: 'lowpass', f0: 1400, f1: 120, q: 0.7, gain: 0.75 });
        this.tone({ f0: 110, f1: 32, dur: 0.3, type: 'triangle', gain: 0.3 });
        break;
      case 'acid':
        this.tone({ f0: 640, f1: 180, dur: 0.22, type: 'sawtooth', gain: 0.16 });
        this.burst({ dur: 0.2, type: 'bandpass', f0: 900, f1: 260, q: 3, gain: 0.2 });
        break;
      case 'napalm':
        this.burst({ dur: 1.1, type: 'lowpass', f0: 900, f1: 90, q: 0.5, gain: 0.7, attack: 0.06 });
        break;
    }
    void pan;
  }

  explode(size = 1): void {
    if (!this.started) return;
    this.burst({ dur: 0.55 * size, type: 'lowpass', f0: 1100, f1: 70, q: 0.6, gain: 0.8 * Math.min(1, size) });
    this.tone({ f0: 90 * (2 - size), f1: 28, dur: 0.5 * size, type: 'triangle', gain: 0.3 });
  }

  impact(): void {
    this.burst({ dur: 0.12, type: 'lowpass', f0: 700, f1: 120, q: 0.8, gain: 0.5 });
    this.tone({ f0: 210, f1: 70, dur: 0.11, type: 'square', gain: 0.1 });
  }

  thud(): void {
    this.burst({ dur: 0.09, type: 'bandpass', f0: 340, f1: 120, q: 1.5, gain: 0.35 });
  }

  metal(): void {
    this.burst({ dur: 0.16, type: 'bandpass', f0: 3200, f1: 1400, q: 2.5, gain: 0.3 });
    this.tone({ f0: 1650, f1: 900, dur: 0.14, type: 'triangle', gain: 0.07 });
  }

  build(): void {
    this.metal();
    this.tone({ f0: 320, f1: 520, dur: 0.16, type: 'square', gain: 0.09, delay: 0.09 });
  }

  ui(): void {
    this.tone({ f0: 880, f1: 1180, dur: 0.05, type: 'square', gain: 0.05 });
  }

  deny(): void {
    this.tone({ f0: 240, f1: 120, dur: 0.16, type: 'sawtooth', gain: 0.11 });
  }

  siren(): void {
    this.tone({ f0: 420, f1: 720, dur: 0.7, type: 'sawtooth', gain: 0.14 });
    this.tone({ f0: 720, f1: 420, dur: 0.7, type: 'sawtooth', gain: 0.12, delay: 0.7 });
  }

  chime(): void {
    this.tone({ f0: 660, f1: 660, dur: 0.3, type: 'sine', gain: 0.16 });
    this.tone({ f0: 990, f1: 990, dur: 0.42, type: 'sine', gain: 0.13, delay: 0.12 });
    this.tone({ f0: 1320, f1: 1320, dur: 0.6, type: 'sine', gain: 0.1, delay: 0.24 });
  }

  gear(): void {
    this.burst({ dur: 0.1, type: 'highpass', f0: 2400, f1: 3800, q: 1, gain: 0.2 });
    this.tone({ f0: 520, f1: 780, dur: 0.12, type: 'triangle', gain: 0.08 });
  }

  thunder(): void {
    if (!this.started) return;
    this.burst({ dur: 1.8, type: 'lowpass', f0: 320, f1: 45, q: 0.4, gain: 0.75, attack: 0.12 });
    this.burst({ dur: 0.7, type: 'bandpass', f0: 140, f1: 60, q: 0.4, gain: 0.5, attack: 0.05 });
  }

  waterDrop(): void {
    this.tone({ f0: 1200, f1: 420, dur: 0.12, type: 'sine', gain: 0.1 });
  }

  fire(): void {
    this.burst({ dur: 0.9, type: 'lowpass', f0: 500, f1: 80, q: 0.5, gain: 0.4, attack: 0.1 });
  }

  /** Continuous ambience mixer, called every frame. */
  ambience(wind: number, rain: number, night: number, mosquitoes: number): void {
    if (!this.started || !this.ctx) return;
    const t = this.now();
    const set = (g: GainNode | null, v: number): void => {
      if (!g) return;
      g.gain.setTargetAtTime(v, t, 0.4);
    };
    set(this.windGain, 0.02 + wind * 0.07);
    if (this.windFilter) this.windFilter.frequency.setTargetAtTime(300 + wind * 500, t, 0.5);
    set(this.rainGain, rain * 0.16);
    set(this.nightGain, night * 0.05);
    set(this.whineGain, mosquitoes * 0.035);
  }
}
