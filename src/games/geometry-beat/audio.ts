/**
 * WebAudio-synthesized chiptune track.
 *
 * No audio files: a lookahead scheduler builds the track from oscillators and a
 * shared noise buffer, derived from the BPM. Because we own the clock, gameplay
 * reads `beat` straight from the audio playhead and stays perfectly in sync —
 * even when the render loop drops frames on a weak device.
 *
 * `songTime` is `AudioContext.currentTime - startTime`. Suspending the context
 * on pause freezes `currentTime`, so the song resumes exactly where it stopped.
 *
 * Layers: four-on-the-floor kick, backbeat snare, hi-hats, an 8th-note bassline
 * and a melodic lead (with a feedback-delay send). Everything runs through a
 * limiter so the stacked layers never clip. `intensity` (0 chill / 1 drive /
 * 2 rush) scales hat density and lead brightness for harder levels.
 */

const LOOKAHEAD = 0.2; // seconds scheduled ahead
const TICK_MS = 25; // scheduler poll interval

const ROOT_MIDI = 45; // A2
// Chord root offset (semitones) per 4-beat bar; loops every 8 bars (32 beats).
const PROGRESSION = [0, -2, 3, 5, 0, -2, 5, 3];
// Two-octave minor pentatonic the lead motifs index into.
const EXT_SCALE = [0, 3, 5, 7, 10, 12, 15, 17];
// Lead motifs: one per bar (8 eighth-notes), `null` = rest. Indexed into EXT_SCALE.
const MOTIFS: Array<Array<number | null>> = [
  [0, null, 2, null, 4, 2, 1, null],
  [4, null, 3, 2, null, 1, 0, null],
  [2, 2, null, 4, 3, null, 5, null],
  [0, 1, 2, 3, 4, 5, 4, 2],
];

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private leadBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  private startTime = 0;
  private nextBeat = 0;
  private timer = 0;
  private readonly secPerBeat: number;
  private readonly intensity: number;
  private playing = false;

  constructor(bpm: number, intensity = 1) {
    this.secPerBeat = 60 / bpm;
    this.intensity = intensity;
  }

  /** Seconds since beat 0 (negative during the brief lead-in). */
  get songTime(): number {
    if (!this.ctx) return 0;
    return this.ctx.currentTime - this.startTime;
  }

  /** Current fractional beat position. */
  get beat(): number {
    return this.songTime / this.secPerBeat;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Start from the top. Must be called from a user gesture on mobile. */
  async start(): Promise<void> {
    if (!this.ctx) this.build();
    await this.ctx!.resume();
    this.startTime = this.ctx!.currentTime + 0.15;
    this.nextBeat = 0;
    this.playing = true;
    this.runScheduler();
  }

  /** Pause without losing position. */
  async pause(): Promise<void> {
    this.playing = false;
    this.clearTimer();
    await this.ctx?.suspend();
  }

  /** Resume after a pause. */
  async resume(): Promise<void> {
    if (!this.ctx) {
      await this.start();
      return;
    }
    await this.ctx.resume();
    this.playing = true;
    this.runScheduler();
  }

  /** Fully stop and release the audio context. */
  stop(): void {
    this.playing = false;
    this.clearTimer();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.master = null;
      this.leadBus = null;
      this.noise = null;
    }
    this.startTime = 0;
  }

  // ---- audio graph ----
  private build(): void {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctor();
    this.ctx = ctx;

    // Limiter on the master output so stacked layers never clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);

    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(limiter);
    this.master = master;

    // Lead bus with a feedback-delay send for space.
    const leadBus = ctx.createGain();
    leadBus.connect(master); // dry
    const delay = ctx.createDelay(1);
    delay.delayTime.value = this.secPerBeat * 0.75;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.3;
    const wet = ctx.createGain();
    wet.gain.value = 0.25;
    leadBus.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(master);
    this.leadBus = leadBus;

    // Shared noise buffer for snare + hats.
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.3), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = 0;
    }
  }

  private runScheduler(): void {
    this.clearTimer();
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
  }

  private schedule(): void {
    if (!this.ctx || !this.playing) return;
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    while (this.startTime + this.nextBeat * this.secPerBeat < horizon) {
      this.scheduleBeat(this.nextBeat, this.startTime + this.nextBeat * this.secPerBeat);
      this.nextBeat++;
    }
  }

  private scheduleBeat(beatIndex: number, time: number): void {
    const spb = this.secPerBeat;
    const totalBars = PROGRESSION.length;
    const bar = Math.floor(beatIndex / 4) % totalBars;
    const beatInBar = beatIndex % 4;
    const chordOffset = PROGRESSION[bar];

    // --- Drums ---
    this.kick(time);
    if (this.intensity >= 1 && (beatInBar === 1 || beatInBar === 3)) {
      this.snare(time);
    }
    const hatSubdiv = this.intensity >= 2 ? 4 : this.intensity >= 1 ? 2 : 1;
    for (let k = 0; k < hatSubdiv; k++) {
      this.hat(time + (k * spb) / hatSubdiv, k === 0 ? 0.05 : 0.09);
    }
    // Drum fill on the last beat of the loop.
    if (bar === totalBars - 1 && beatInBar === 3 && this.intensity >= 1) {
      for (let k = 1; k < 4; k++) this.snare(time + (k * spb) / 4, 0.18);
    }

    // --- Bass (8th notes) ---
    const bassRoot = ROOT_MIDI + chordOffset;
    this.bass(time, midiToFreq(bassRoot), spb * 0.45);
    this.bass(time + spb * 0.5, midiToFreq(bassRoot + (beatInBar % 2 === 0 ? 7 : 12)), spb * 0.45);

    // --- Lead (motif eighths for this beat) ---
    const motif = MOTIFS[bar % MOTIFS.length];
    const leadType: OscillatorType = this.intensity >= 2 ? "sawtooth" : "square";
    for (let e = 0; e < 2; e++) {
      const degree = motif[beatInBar * 2 + e];
      if (degree == null) continue;
      const midi = ROOT_MIDI + 24 + chordOffset + EXT_SCALE[degree];
      this.lead(time + e * spb * 0.5, midiToFreq(midi), spb * 0.42, leadType);
    }
  }

  // ---- instruments ----
  private kick(time: number): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(50, time + 0.12);
    g.gain.setValueAtTime(0.9, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    osc.connect(g).connect(this.master);
    osc.start(time);
    osc.stop(time + 0.2);
  }

  private snare(time: number, peak = 0.3): void {
    this.noiseHit(time, 0.18, "bandpass", 1800, 0.7, peak);
  }

  private hat(time: number, peak: number): void {
    this.noiseHit(time, 0.04, "highpass", 7000, 0.5, peak);
  }

  private noiseHit(
    time: number,
    dur: number,
    type: BiquadFilterType,
    freq: number,
    q: number,
    peak: number,
  ): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(time);
    src.stop(time + dur + 0.02);
  }

  private bass(time: number, freq: number, dur: number): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 600;
    const g = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.3, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(lp).connect(g).connect(this.master);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  private lead(time: number, freq: number, dur: number, type: OscillatorType): void {
    if (!this.ctx || !this.leadBus) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.13, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g).connect(this.leadBus);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }
}
