/** A single obstacle, timed to a musical beat. */
export type NoteType = "spike" | "double" | "block";

export interface Note {
  /** Beat at which this obstacle reaches the player's X position. */
  beat: number;
  type: NoteType;
}

export interface Beatmap {
  id: string;
  name: string;
  /** Difficulty label shown in the level list. */
  difficulty: string;
  bpm: number;
  /**
   * Scroll-speed multiplier (default 1). Higher = obstacles approach faster =
   * less reaction time. Clearability is invariant to this (jump airtime is fixed
   * in seconds while both obstacle X and the jump arc scale with pxPerBeat), so
   * it is a pure reaction-difficulty knob — see engine.ts `layout()`.
   */
  speed?: number;
  /** Music intensity forwarded to GameAudio: 0 chill, 1 drive, 2 rush. */
  intensity?: number;
  /** Obstacles, sorted ascending by beat. */
  notes: Note[];
}

/**
 * Build a note list from a compact step pattern.
 *
 * Each step is the gap (in beats) until the next obstacle, paired with its type.
 * Notes start after `leadIn` beats so the player gets reaction time, and the
 * pattern repeats until `length` beats are filled.
 */
function buildNotes(
  pattern: Array<{ gap: number; type: NoteType }>,
  leadIn: number,
  length: number,
): Note[] {
  const notes: Note[] = [];
  let beat = leadIn;
  let i = 0;
  while (beat < length) {
    const step = pattern[i % pattern.length];
    notes.push({ beat, type: step.type });
    beat += step.gap;
    i++;
  }
  return notes;
}

export const BEATMAPS: Beatmap[] = [
  {
    id: "warmup",
    name: "Warmup",
    difficulty: "Easy",
    bpm: 120,
    notes: buildNotes(
      [
        { gap: 4, type: "spike" },
        { gap: 4, type: "spike" },
        { gap: 6, type: "block" },
        { gap: 4, type: "spike" },
      ],
      8,
      120,
    ),
  },
  {
    id: "pulse",
    name: "Pulse",
    difficulty: "Medium",
    bpm: 132,
    notes: buildNotes(
      [
        { gap: 3, type: "spike" },
        { gap: 3, type: "block" },
        { gap: 2, type: "spike" },
        { gap: 4, type: "double" },
        { gap: 3, type: "spike" },
      ],
      8,
      150,
    ),
  },
  {
    id: "overdrive",
    name: "Overdrive",
    difficulty: "Hard",
    bpm: 150,
    notes: buildNotes(
      [
        { gap: 2, type: "spike" },
        { gap: 2, type: "spike" },
        { gap: 3, type: "double" },
        { gap: 2, type: "block" },
        { gap: 2, type: "spike" },
        { gap: 3, type: "double" },
      ],
      8,
      170,
    ),
  },
  {
    id: "hyperbeat",
    name: "Hyperbeat",
    difficulty: "Expert",
    bpm: 160,
    // Fast scroll + varied gaps so you can't just hold to bounce — every jump
    // must be timed. Gaps stay >= ~2 beats (re-jump cadence at 160bpm).
    speed: 1.35,
    intensity: 2,
    notes: buildNotes(
      [
        { gap: 2, type: "spike" },
        { gap: 2, type: "spike" },
        { gap: 3, type: "double" },
        { gap: 2.5, type: "block" },
        { gap: 2, type: "spike" },
        { gap: 2.5, type: "double" },
        { gap: 2, type: "spike" },
        { gap: 3.5, type: "block" },
      ],
      8,
      190,
    ),
  },
  {
    id: "mayhem",
    name: "Mayhem",
    difficulty: "Insane",
    bpm: 176,
    // At 176bpm a 2-beat gap (~0.68s) is below jump airtime, so spikes are
    // spaced >= 2.5 beats; the brutal pace comes from the 1.6x scroll speed.
    speed: 1.6,
    intensity: 2,
    notes: buildNotes(
      [
        { gap: 2.5, type: "spike" },
        { gap: 2.5, type: "spike" },
        { gap: 2.5, type: "double" },
        { gap: 3, type: "block" },
        { gap: 2.5, type: "spike" },
        { gap: 3, type: "double" },
        { gap: 2.5, type: "block" },
        { gap: 2.5, type: "spike" },
        { gap: 3, type: "double" },
      ],
      8,
      210,
    ),
  },
];

export function getBeatmap(id: string): Beatmap | undefined {
  return BEATMAPS.find((b) => b.id === id);
}
