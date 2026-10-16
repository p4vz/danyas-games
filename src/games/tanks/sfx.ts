/**
 * Synthesized sound effects (no audio files). The AudioContext is created on
 * the first user gesture, as mobile browsers require.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const len = Math.floor(this.ctx.sampleRate * 0.8);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    void this.ctx.resume();
  }

  close(): void {
    void this.ctx?.close();
    this.ctx = null;
  }

  private ready(): AudioContext | null {
    const ctx = this.ctx;
    return ctx && ctx.state === "running" ? ctx : null;
  }

  private blip(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, delay = 0): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private boom(dur: number, gain: number, cutoff: number): void {
    const ctx = this.ready();
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(60, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t);
    src.stop(t + dur);
  }

  fire(power: number): void {
    this.boom(0.25, 0.35, 1200 + power * 1500);
    this.blip(180, 0.15, "square", 0.08, 70);
  }

  explode(): void {
    this.boom(0.7, 0.6, 900);
    this.blip(90, 0.4, "sine", 0.3, 35);
  }

  pickup(): void {
    [660, 880, 1320].forEach((f, i) => this.blip(f, 0.12, "triangle", 0.12, undefined, i * 0.07));
  }

  crate(): void {
    this.blip(500, 0.25, "sine", 0.08, 300);
  }

  tick(): void {
    this.blip(1000, 0.05, "square", 0.05);
  }

  turn(): void {
    this.blip(440, 0.1, "triangle", 0.1, 660);
  }

  win(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.blip(f, 0.25, "square", 0.06, undefined, i * 0.13));
  }
}
