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
 * - fly     — flight mode: hold to ascend, release to descend. Inside a fly range,
 *             floor/ceiling contact is a safe slide (not death); spikes still kill.
 */
export type Segment =
  | { kind: "gap"; from: number; to: number }
  | { kind: "ramp"; from: number; to: number; lift0: number; lift1: number }
  | { kind: "ceiling"; from: number; to: number; clear0: number; clear1: number }
  | { kind: "fly"; from: number; to: number };

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
 * A flight corridor: a fly-mode range with a ceiling `clear` units above the
 * floor forming the corridor. Inside it the ship weaves between floor spikes
 * and ceiling-hung top spikes.
 */
function fly(from: number, to: number, clear = 4.5): Segment[] {
  return [
    { kind: "fly", from, to },
    { kind: "ceiling", from, to, clear0: clear, clear1: clear },
  ];
}

/** Remove generated notes inside the given beat ranges (to make room for terrain). */
function carve(notes: Note[], ranges: Array<[number, number]>): Note[] {
  return notes.filter((n) => !ranges.some(([a, b]) => n.beat >= a && n.beat <= b));
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
    // The rhythm pattern carved around a floor gap and a no-jump tunnel — the
    // first taste of terrain before the Expert/Insane compositions.
    notes: carve(
      buildNotes(
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
      [
        [57.5, 63],
        [97.5, 107.5],
      ],
    ),
    segments: [gap(60, 61.1), tunnel(100, 106, 2)],
  },
  {
    id: "hyperbeat",
    name: "Hyperbeat",
    difficulty: "Expert",
    bpm: 160,
    // Hand-authored composition: rhythm cube → tunnel run → FLIGHT corridor →
    // mixed reprise → finale. Ground jumps keep the 2-beat re-jump cadence at
    // 160bpm; top-spikes sit >= 2.5 beats after any forced jump; gaps are 1.1
    // beats (well under the ~1.9-beat jump airtime).
    speed: 1.35,
    intensity: 2,
    notes: [
      // A — rhythm cube
      { beat: 8, type: "spike" },
      { beat: 10, type: "spike" },
      { beat: 12, type: "double" },
      { beat: 14.5, type: "spike" },
      { beat: 16.5, type: "block" },
      { beat: 19.5, type: "topspike" },
      { beat: 21.5, type: "spike" },
      { beat: 23.5, type: "spike" },
      { beat: 25.5, type: "double" },
      { beat: 31, type: "topspike" },
      { beat: 33, type: "spike" },
      { beat: 35, type: "double" },
      { beat: 37.5, type: "spike" },
      // B — tunnel run (no obstacles inside the tunnel)
      { beat: 53, type: "spike" },
      // C — flight corridor: weave floor spikes and ceiling spikes
      { beat: 58.5, type: "spike" },
      { beat: 61, type: "topspike" },
      { beat: 63.5, type: "spike" },
      { beat: 66, type: "topspike" },
      { beat: 68.5, type: "spike" },
      { beat: 71, type: "topspike" },
      // D — back on the ground
      { beat: 75, type: "spike" },
      { beat: 77.5, type: "double" },
      { beat: 83.5, type: "topspike" },
      { beat: 85.5, type: "spike" },
      { beat: 88, type: "block" },
      { beat: 90.5, type: "spike" },
      { beat: 92.5, type: "double" },
      // A' — tighter reprise
      { beat: 96, type: "spike" },
      { beat: 98, type: "spike" },
      { beat: 100, type: "double" },
      { beat: 102.5, type: "block" },
      { beat: 105.5, type: "topspike" },
      { beat: 108, type: "spike" },
      { beat: 110, type: "double" },
      { beat: 112, type: "spike" },
      { beat: 118, type: "topspike" },
      { beat: 120, type: "spike" },
      { beat: 122, type: "double" },
      { beat: 124.5, type: "spike" },
      // F — finale
      { beat: 127, type: "spike" },
      { beat: 129, type: "double" },
      { beat: 131.5, type: "spike" },
      { beat: 137, type: "topspike" },
      { beat: 139, type: "spike" },
      { beat: 141, type: "double" },
      { beat: 143, type: "spike" },
    ],
    segments: [
      gap(28, 29.1),
      tunnel(42, 48, 2),
      gap(49.5, 50.6),
      ...fly(56, 72, 4.5),
      gap(80, 81.15),
      gap(114.5, 115.6),
      gap(133.5, 134.6),
    ],
  },
  {
    id: "mayhem",
    name: "Mayhem",
    difficulty: "Insane",
    bpm: 176,
    // The everything level: rhythm cube → inclined tunnel → LONG flight weave →
    // gap-and-spike gauntlet. At 176bpm ground jumps need >= 2.5 beats, gaps are
    // 1.3 beats, and the flight weave alternates every 2 beats at 1.6x scroll.
    speed: 1.6,
    intensity: 2,
    notes: [
      // A — rhythm cube
      { beat: 8, type: "spike" },
      { beat: 10.5, type: "spike" },
      { beat: 13, type: "double" },
      { beat: 15.5, type: "block" },
      { beat: 18.5, type: "topspike" },
      { beat: 21, type: "spike" },
      { beat: 23.5, type: "double" },
      { beat: 26, type: "spike" },
      { beat: 32.5, type: "topspike" },
      { beat: 35, type: "spike" },
      { beat: 37.5, type: "double" },
      // B — inclined tunnel, then a gap on the way out
      { beat: 55.5, type: "spike" },
      // C — long flight weave
      { beat: 60, type: "spike" },
      { beat: 62, type: "topspike" },
      { beat: 64, type: "spike" },
      { beat: 66, type: "topspike" },
      { beat: 68, type: "spike" },
      { beat: 70, type: "topspike" },
      { beat: 72, type: "spike" },
      { beat: 74, type: "topspike" },
      { beat: 76, type: "spike" },
      // D — gauntlet
      { beat: 80.5, type: "spike" },
      { beat: 83, type: "double" },
      { beat: 85.5, type: "block" },
      { beat: 92, type: "topspike" },
      { beat: 94.5, type: "spike" },
      { beat: 97, type: "double" },
      { beat: 99.5, type: "spike" },
      { beat: 105.5, type: "topspike" },
      { beat: 108, type: "spike" },
      { beat: 110.5, type: "double" },
      { beat: 113, type: "spike" },
      { beat: 115.5, type: "spike" },
      { beat: 118, type: "double" },
    ],
    segments: [
      gap(28.5, 29.8),
      ...inclinedTunnel(41, 43, 47, 49, 2, 2),
      gap(51, 52.3),
      ...fly(58, 78, 4),
      gap(88, 89.3),
      gap(102, 103.3),
    ],
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
