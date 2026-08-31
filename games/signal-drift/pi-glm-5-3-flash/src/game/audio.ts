/** Tiny WebAudio synth. Created only after a user gesture; fully optional. */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  muted = false;
  available = false;

  /** Call from a user-gesture handler. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.24;
      this.master.connect(this.ctx.destination);

      // reusable noise buffer
      const len = this.ctx.sampleRate * 1.4;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      this.available = true;
    } catch {
      this.available = false;
    }
  }

  startEngine(): void {
    if (!this.available || !this.ctx || !this.master || this.engineOsc) return;
    try {
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 420;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 52;
      this.engineOsc2 = this.ctx.createOscillator();
      this.engineOsc2.type = 'square';
      this.engineOsc2.frequency.value = 104;
      this.engineOsc.connect(this.engineFilter);
      this.engineOsc2.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engineOsc.start();
      this.engineOsc2.start();
    } catch {
      this.engineOsc = null;
    }
  }

  setEngine(speed: number, boost: number, alive: boolean): void {
    if (!this.engineOsc || !this.engineGain || !this.engineFilter || !this.ctx) return;
    const t = this.ctx.currentTime;
    const vol = alive ? (0.028 + speed * 0.0005 + boost * 0.03) : 0;
    this.engineGain.gain.setTargetAtTime(vol, t, 0.12);
    this.engineOsc.frequency.setTargetAtTime(48 + speed * 0.55 + boost * 26, t, 0.15);
    this.engineOsc2?.frequency.setTargetAtTime(96 + speed * 1.1 + boost * 52, t, 0.15);
    this.engineFilter.frequency.setTargetAtTime(380 + speed * 4 + boost * 500, t, 0.2);
  }

  stopEngine(): void {
    if (this.engineOsc && this.engineGain && this.ctx) {
      this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number): void {
    if (!this.available || !this.ctx || !this.master) return;
    try {
      const t0 = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(vol, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch {
      /* ignore */
    }
  }

  private noise(dur: number, vol: number, from: number, to: number): void {
    if (!this.available || !this.ctx || !this.master || !this.noiseBuffer) return;
    try {
      const t0 = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(from, t0);
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      src.start(t0);
      src.stop(t0 + dur + 0.05);
    } catch {
      /* ignore */
    }
  }

  pickup(): void {
    this.tone(620, 0.14, 'sine', 0.16, 0, 980);
  }

  relay(): void {
    this.tone(523, 0.22, 'triangle', 0.15, 0);
    this.tone(659, 0.22, 'triangle', 0.15, 0.1);
    this.tone(784, 0.34, 'triangle', 0.17, 0.2);
  }

  hit(): void {
    this.noise(0.3, 0.4, 900, 120);
    this.tone(92, 0.24, 'sine', 0.3, 0, 50);
  }

  surge(): void {
    this.noise(0.4, 0.22, 500, 90);
  }

  thunder(): void {
    this.noise(1.3, 0.34, 700, 60);
  }

  warn(): void {
    this.tone(880, 0.1, 'square', 0.05);
    this.tone(880, 0.1, 'square', 0.05, 0.16);
  }

  win(): void {
    this.tone(523, 0.18, 'triangle', 0.15, 0);
    this.tone(659, 0.18, 'triangle', 0.15, 0.14);
    this.tone(784, 0.18, 'triangle', 0.15, 0.28);
    this.tone(1046, 0.5, 'triangle', 0.18, 0.42);
  }

  lose(): void {
    this.noise(0.9, 0.4, 600, 50);
    this.tone(220, 0.8, 'sawtooth', 0.12, 0, 60);
  }

  ui(): void {
    this.tone(440, 0.07, 'sine', 0.1);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.24, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  }
}
