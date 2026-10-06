/**
 * Tiny synthesized sound effects (no audio files). The AudioContext is
 * created lazily on the first user gesture, as mobile browsers require.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  muted = false;

  /** Call from a user gesture (e.g. the Start button). */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    }
    void this.ctx.resume();
  }

  close(): void {
    void this.ctx?.close();
    this.ctx = null;
  }

  private blip(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== "running") return;
    const t = ctx.currentTime;
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

  hit(strength: number): void {
    this.blip(260 + strength * 320, 0.09, "triangle", 0.12 + strength * 0.18, 140);
  }

  bounce(strength: number): void {
    this.blip(120, 0.07, "sine", 0.08 + strength * 0.12, 70);
  }

  grab(): void {
    this.blip(330, 0.08, "sine", 0.12, 520);
  }

  launch(): void {
    this.blip(300, 0.14, "triangle", 0.14, 760);
  }

  score(): void {
    this.blip(520, 0.12, "square", 0.06);
    setTimeout(() => this.blip(780, 0.22, "square", 0.06), 110);
  }

  win(): void {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.blip(f, 0.25, "square", 0.06), i * 130));
  }
}
