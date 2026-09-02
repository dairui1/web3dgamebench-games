/** Procedural WebAudio sound effects; no external assets. */
export class AudioSys {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private engineGain: GainNode | null = null;
  private engineOscA: OscillatorNode | null = null;
  private engineOscB: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private lockOsc: OscillatorNode | null = null;
  private lockGain: GainNode | null = null;
  private lastBeep = 0;
  muted = false;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 320;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOscA = ctx.createOscillator();
    this.engineOscA.type = 'sawtooth';
    this.engineOscA.frequency.value = 55;
    this.engineOscB = ctx.createOscillator();
    this.engineOscB.type = 'triangle';
    this.engineOscB.frequency.value = 110;
    this.engineOscA.connect(this.engineFilter);
    this.engineOscB.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOscA.start();
    this.engineOscB.start();

    this.lockOsc = ctx.createOscillator();
    this.lockOsc.type = 'square';
    this.lockOsc.frequency.value = 1200;
    this.lockGain = ctx.createGain();
    this.lockGain.gain.value = 0;
    this.lockOsc.connect(this.lockGain);
    this.lockGain.connect(this.master);
    this.lockOsc.start();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  setEngine(throttle: number, active: boolean): void {
    if (!this.ctx || !this.engineGain || !this.engineOscA || !this.engineOscB || !this.engineFilter) return;
    const t = this.ctx.currentTime;
    const target = active ? 0.08 + throttle * 0.1 : 0;
    this.engineGain.gain.setTargetAtTime(target, t, 0.1);
    this.engineOscA.frequency.setTargetAtTime(48 + throttle * 60, t, 0.15);
    this.engineOscB.frequency.setTargetAtTime(96 + throttle * 130, t, 0.15);
    this.engineFilter.frequency.setTargetAtTime(240 + throttle * 500, t, 0.15);
  }

  /** Continuous lock tone: 0 = off, 1 = seeking (slow pulse), 2 = locked (steady). */
  setLockTone(state: 0 | 1 | 2, time: number): void {
    if (!this.ctx || !this.lockGain || !this.lockOsc) return;
    let g = 0;
    if (state === 1) g = Math.sin(time * 14) > 0 ? 0.03 : 0;
    else if (state === 2) g = 0.04;
    this.lockOsc.frequency.value = state === 2 ? 1500 : 1000;
    this.lockGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.01);
  }

  private playNoise(duration: number, gain: number, filterType: BiquadFilterType, freqStart: number, freqEnd: number, q = 1): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.Q.value = q;
    const t = ctx.currentTime;
    f.frequency.setValueAtTime(freqStart, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  private beep(freq: number, duration: number, gain: number, type: OscillatorType = 'square'): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + duration + 0.02);
  }

  gun(): void {
    this.playNoise(0.07, 0.25, 'bandpass', 1800, 500, 0.8);
  }

  enemyGun(distance: number): void {
    const v = Math.max(0, 1 - distance / 1500) * 0.12;
    if (v > 0.005) this.playNoise(0.06, v, 'bandpass', 1200, 400, 0.8);
  }

  missileLaunch(): void {
    this.playNoise(0.9, 0.35, 'lowpass', 3000, 300, 0.5);
    this.beep(220, 0.5, 0.06, 'sawtooth');
  }

  explosion(distance: number, big = false): void {
    const v = Math.max(0.05, 1 - distance / 3000) * (big ? 0.9 : 0.6);
    this.playNoise(big ? 1.4 : 0.8, v, 'lowpass', 1600, 60, 0.3);
    this.beep(60, 0.5, v * 0.5, 'sine');
  }

  hit(): void {
    this.playNoise(0.12, 0.3, 'highpass', 600, 200);
    this.beep(140, 0.15, 0.1, 'triangle');
  }

  hitConfirm(): void {
    this.beep(2400, 0.04, 0.05, 'square');
  }

  warning(time: number): void {
    if (time - this.lastBeep < 0.35) return;
    this.lastBeep = time;
    this.beep(880, 0.12, 0.08, 'square');
  }

  uiConfirm(): void {
    this.beep(660, 0.1, 0.08, 'sine');
    setTimeout(() => this.beep(990, 0.15, 0.08, 'sine'), 90);
  }

  flare(): void {
    this.playNoise(0.35, 0.25, 'highpass', 2500, 900);
  }

  win(): void {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.beep(f, 0.35, 0.1, 'triangle'), i * 140));
  }

  lose(): void {
    [440, 392, 330, 262].forEach((f, i) => setTimeout(() => this.beep(f, 0.4, 0.1, 'sawtooth'), i * 180));
  }
}
