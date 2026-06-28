import { loadJSON, saveJSON } from "../../core/storage";
import type { Beatmap } from "./beatmap";

const KEY = "geobeat.custom";

/**
 * Minimum spacing (in whole beats) the editor enforces between obstacles so a
 * level stays solvable. Jump airtime is fixed at ~0.72s (apex 0.36s), so the
 * re-jump cadence in beats is `0.72 * bpm/60`; we use 0.73 for a small buffer
 * and floor at 2 (adjacent beats are never jumpable in practice). Matches the
 * spacing of the hand-authored levels, which the clearability sim confirms.
 */
export function minGapBeats(bpm: number): number {
  return Math.max(2, Math.ceil((0.73 * bpm) / 60));
}

/** All saved custom levels, newest first. */
export function listCustom(): Beatmap[] {
  return loadJSON<Beatmap[]>(KEY, []);
}

/** Insert or update a custom level (matched by id). */
export function saveCustom(map: Beatmap): void {
  const all = listCustom();
  const i = all.findIndex((m) => m.id === map.id);
  if (i >= 0) all[i] = map;
  else all.unshift(map);
  saveJSON(KEY, all);
}

export function deleteCustom(id: string): void {
  saveJSON(
    KEY,
    listCustom().filter((m) => m.id !== id),
  );
}
