/**
 * Shared types for Slime Sports.
 *
 * Coordinates are in abstract world units with **y pointing up** and the floor
 * at y = 0. The renderer maps them to the screen; physics never sees pixels.
 */

/** 0 = left player, 1 = right player. */
export type Side = 0 | 1;

export const other = (s: Side): Side => (s === 0 ? 1 : 0);
/** +1 when this side attacks to the right, −1 when it attacks to the left. */
export const attackDir = (s: Side): number => (s === 0 ? 1 : -1);

/**
 * What a controller (touch, keyboard, AI, or — later — a network peer) wants a
 * slime to do this tick. Intents are plain data so a future online mode can
 * ship them over the wire and replay them deterministically.
 */
export interface Intent {
  /** Absolute world-x to steer toward (touch drag / AI). Overrides `moveX`. */
  targetX: number | null;
  /** −1..1 run direction (keyboard), used when `targetX` is null. */
  moveX: number;
  /** Jump if grounded this tick. */
  jump: boolean;
  /** 0..1 fraction of the character's full jump velocity. */
  jumpPower: number;
  /** Auxiliary action button held (grab / set — depends on the sport). */
  aux: boolean;
}

export const idleIntent = (): Intent => ({ targetX: null, moveX: 0, jump: false, jumpPower: 1, aux: false });

/** Anything that can drive a slime. */
export interface Controller {
  getIntent(world: import("./world").World, side: Side): Intent;
  /** Optional per-frame hook for visuals (e.g. a finger marker). */
  dispose?(): void;
}
