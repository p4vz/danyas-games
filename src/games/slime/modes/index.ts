import { basketball } from "./basketball";
import { hockey } from "./hockey";
import type { SlimeMode } from "./mode";
import { soccer } from "./soccer";
import { tennis } from "./tennis";
import { volleyball } from "./volleyball";

/** All playable sports. New modes plug in here and appear in the menu. */
export const MODES: SlimeMode[] = [volleyball, soccer, basketball, tennis, hockey];

export function getMode(id: string): SlimeMode {
  return MODES.find((m) => m.id === id) ?? MODES[0];
}
