import { basketball } from "./basketball";
import type { SlimeMode } from "./mode";
import { soccer } from "./soccer";
import { volleyball } from "./volleyball";

/** All playable sports. New modes plug in here and appear in the menu. */
export const MODES: SlimeMode[] = [volleyball, soccer, basketball];

export function getMode(id: string): SlimeMode {
  return MODES.find((m) => m.id === id) ?? MODES[0];
}
