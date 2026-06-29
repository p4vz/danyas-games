/**
 * A single point obstacle, timed to a musical beat.
 * - spike/double/block sit on the floor (jump over / land on the block).
 * - topspike hangs from the ceiling; avoid it by staying low (don't jump under it).
 */
export type NoteType = "spike" | "double" | "block" | "topspike";

export interface Note {
  /** Beat at which this obstacle reaches the player's X position. */
  beat: number;
  type: NoteType;
}

/**
 * Terrain spanning a beat range. Heights are in **playerSize units** so they are
 * resolution-independent (see engine.ts `floorTopAt` / `ceilingAt`).
 * - gap     — floor is absent; fall in = death, jump across.
 * - ramp    — floor raised by `lift0`→`lift1` (linear); the grounded cube follows it.
 * - ceiling — a ceiling `clear0`→`clear1` units above the floor; jumping into it = death.
 *             A flat ceiling is a "no-jump tunnel"; a ramp + ceiling is an inclined tunnel.
 */
export type Segment =
  | { kind: "gap"; from: number; to: number }
  | { kind: "ramp"; from: number; to: number; lift0: number; lift1: number }
  | { kind: "ceiling"; from: number; to: number; clear0: number; clear1: number };

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
  /** Optional terrain (gaps, ramps, ceilings). Absent = classic flat ground. */
  segments?: Segment[];
}

/** A no-jump tunnel: a flat ceiling `clear` units above the floor over [from,to]. */
function tunnel(from: number, to: number, clear = 2): Segment {
  return { kind: "ceiling", from, to, clear0: clear, clear1: clear };
}

/** A floor gap (hole) over [from,to]. */
function gap(from: number, to: number): Segment {
  return { kind: "gap", from, to };
}

/**
 * An inclined tunnel: floor ramps 0→`lift` (then back to 0) with a ceiling held a
 * constant `clear` above it, so the corridor slopes. Returns the ramp + ceiling.
 */
function inclinedTunnel(
  from: number,
  rampUpTo: number,
  flatTo: number,
  rampDownTo: number,
  lift: number,
  clear = 2,
): Segment[] {
  return [
    { kind: "ramp", from, to: rampUpTo, lift0: 0, lift1: lift },
    { kind: "ramp", from: rampUpTo, to: flatTo, lift0: lift, lift1: lift },
    { kind: "ramp", from: flatTo, to: rampDownTo, lift0: lift, lift1: 0 },
    { kind: "ceiling", from, to: rampDownTo, clear0: clear, clear1: clear },
  ];
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
  {
    id: "cavern",
    name: "Cavern",
    difficulty: "Tunnels",
    bpm: 140,
    speed: 1.1,
    intensity: 1,
    // Showcase of the terrain mechanics. Features are spaced so the cube is always
    // grounded before a no-jump tunnel and has room to land after each jump.
    notes: [
      { beat: 8, type: "spike" },
      { beat: 11, type: "spike" },
      { beat: 18, type: "topspike" }, // after the gap — stay low, don't jump
      { beat: 30, type: "spike" }, // after the flat tunnel
      { beat: 33, type: "spike" },
      { beat: 47, type: "spike" }, // after the inclined tunnel
      { beat: 54, type: "topspike" }, // after the second gap
      { beat: 57, type: "spike" },
      { beat: 60, type: "spike" },
    ],
    segments: [
      gap(14, 15.2), // jump across
      tunnel(22, 28, 2), // flat no-jump tunnel
      ...inclinedTunnel(36, 38, 42, 44, 2, 2), // ramp up, run through, ramp down
      gap(50, 51.1), // jump across
    ],
  },
];

export function getBeatmap(id: string): Beatmap | undefined {
  return BEATMAPS.find((b) => b.id === id);
}
