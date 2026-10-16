import type { Match, MatchConfig, Snapshot, TurnInput } from "./match";

/**
 * Seams for online play (not wired up yet — everything is local for now).
 *
 * Every player owns a *seat*, and on each sim step the shell asks the seat of
 * whoever's turn it is for a `TurnInput`. Today every seat is a `LocalSeat`
 * (the shared on-screen buttons / keyboard). Adding online play later means:
 *
 *   1. One device hosts. It owns the authoritative `Match` and sends the
 *      `MatchConfig` (incl. seed) to everyone, so all devices generate the
 *      same terrain.
 *   2. On your turn, your device streams its inputs `{ step, input }` over the
 *      transport; everyone else plays them through a `RemoteSeat`.
 *   3. At the end of each turn the host sends `match.snapshot()`; clients call
 *      `Match.restore()` to fix up any floating-point drift. A snapshot is
 *      small: terrain is rebuilt from the seed plus the crater list.
 *
 * The transport can be anything that moves JSON: a WebSocket relay or WebRTC.
 */
export interface Seat {
  readonly kind: "local" | "remote";
  /** Input for one sim step while this seat's player has the turn. */
  read(match: Match): TurnInput;
  /** Drop held buttons / charge (turn change, pause). */
  reset(): void;
  dispose(): void;
}

/** Messages a future online transport would carry. */
export type NetMessage =
  | { type: "start"; config: MatchConfig }
  | { type: "input"; step: number; input: TurnInput }
  | { type: "sync"; snapshot: Snapshot };

export interface Transport {
  send(msg: NetMessage): void;
  onMessage(cb: (msg: NetMessage) => void): void;
  close(): void;
}
