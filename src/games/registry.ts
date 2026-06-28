import type { GameFactory } from "../core/Game";
import { createGeometryBeat } from "./geometry-beat";

export type GameStatus = "playable" | "soon";

export interface GameEntry {
  id: string;
  title: string;
  tagline: string;
  /** Accent color used on the landing card and in-game theming. */
  accent: string;
  status: GameStatus;
  /** Present for playable games; undefined for "coming soon" placeholders. */
  factory?: GameFactory;
}

/**
 * Single source of truth for the collection. The landing grid and the router
 * both read from here, so adding a game = adding one entry (+ its folder).
 */
export const GAMES: GameEntry[] = [
  {
    id: "geometry-beat",
    title: "Geometry Beat",
    tagline: "Jump to the rhythm. Obstacles locked to the music.",
    accent: "#46e3ff",
    status: "playable",
    factory: createGeometryBeat,
  },
  {
    id: "block-stack",
    title: "Block Stack",
    tagline: "Falling-blocks puzzler. Coming soon.",
    accent: "#ffb84d",
    status: "soon",
  },
  {
    id: "snake-dash",
    title: "Snake Dash",
    tagline: "Classic snake with a twist. Coming soon.",
    accent: "#7dff8a",
    status: "soon",
  },
];

export function getGame(id: string): GameEntry | undefined {
  return GAMES.find((g) => g.id === id);
}
