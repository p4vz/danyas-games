/**
 * Tiny namespaced localStorage helpers. Safe in private-mode / no-storage
 * environments (falls back to no-op behaviour instead of throwing).
 */
const PREFIX = "danyas-games:";

export function loadNumber(key: string, fallback = 0): number {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

export function saveNumber(key: string, value: number): void {
  try {
    localStorage.setItem(PREFIX + key, String(value));
  } catch {
    /* storage unavailable — ignore */
  }
}

/** Persist `value` only if it beats the stored value. Returns the new best. */
export function saveBest(key: string, value: number): number {
  const best = Math.max(loadNumber(key), value);
  saveNumber(key, best);
  return best;
}
