/**
 * WebAudio-synthesized chiptune track.
 *
 * No audio files: a lookahead scheduler plays a kick, bass and lead arpeggio
 * derived from the BPM. Because we own the clock, gameplay can read `beat`
 * straight from the audio playhead and stay perfectly in sync — even when the
 * render loop drops frames on a weak device.
 *
 * `songTime` is `AudioContext.currentTime - startTime`. Suspending the context
 * on pause freezes `currentTime`, so the song resumes exactly where it stopped.
 */

const LOOKAHEAD = 0.2; // seconds scheduled ahead
const TICK_MS = 25; // scheduler poll interval

// Minor pentatonic relative to the root, used for the lead.
const SCALE = [0, 3, 5, 7, 10];
// Chord root offset (semitones) per 4-beat bar, looping every 16 beats.
const PROGRESSION = [0, -2, 3, 5];
const ROOT_MIDI = 45; // A2

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private startTime = 0;
  private nextBeat = 0;
  private timer = 0;
  private readonly secPerBeat: number;
  private playing = false;

  constructor(bpm: number) {
    this.secPerBeat = 60 / bpm;
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
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
    }
    await this.ctx.resume();
    this.startTime = this.ctx.currentTime + 0.15;
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
    }
    this.startTime = 0;
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
    const bar = Math.floor(beatIndex / 4) % PROGRESSION.length;
    const chordOffset = PROGRESSION[bar];

    this.kick(time);
    // Bass on the beat.
    this.tone(time, midiToFreq(ROOT_MIDI + chordOffset), this.secPerBeat * 0.9, "triangle", 0.32);
    // Lead arpeggio on the off-beat.
    const leadMidi = ROOT_MIDI + 24 + chordOffset + SCALE[beatIndex % SCALE.length];
    this.tone(time + this.secPerBeat * 0.5, midiToFreq(leadMidi), this.secPerBeat * 0.4, "square", 0.14);
  }

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

  private tone(
    time: number,
    freq: number,
    dur: number,
    type: OscillatorType,
    peak: number,
  ): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g).connect(this.master);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }
}
