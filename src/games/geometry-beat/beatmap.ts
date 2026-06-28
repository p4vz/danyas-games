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
];

export function getBeatmap(id: string): Beatmap | undefined {
  return BEATMAPS.find((b) => b.id === id);
}
