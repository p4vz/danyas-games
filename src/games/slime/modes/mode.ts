import type { Arena, Ball, BallSpec, SlimeBody } from "../physics";
import type { BallPath } from "../predict";
import type { Side } from "../types";
import type { World } from "../world";

export interface ScoreEvent {
  scorer: Side;
  points: number;
  /** Big banner text, e.g. "GOAL!" */
  label: string;
}

export interface Theme {
  skyTop: string;
  skyBottom: string;
  ground: string;
  groundLine: string;
}

/** Everything a rule check may look at after a physics step. */
export interface RuleContext {
  world: World;
  ball: Ball;
  prevX: number;
  prevY: number;
  /** Ball touched the floor this step. */
  floor: boolean;
}

/**
 * A slime sport. Modes own their arena geometry, ball, rules, AI scoring and
 * arena artwork; the world, physics, controllers and renderer are shared.
 * Adding a new sport (hockey, tennis, …) = one new file + a registry entry.
 */
export interface SlimeMode {
  id: string;
  name: string;
  tagline: string;
  accent: string;
  /** Short how-to-play line for the menu. */
  howTo: string;
  ball: BallSpec;
  arena: Arena;
  theme: Theme;
  /** Ball touching the floor ends the rally (volleyball) — the AI stops looking past it. */
  floorEndsRally?: boolean;
  /** Points to win for Short / Standard / Long matches. */
  winScores: [number, number, number];

  /** Allowed x range for a slime's centre on this side. */
  slimeRange(side: Side, radius: number): [number, number];
  startX(side: Side): number;
  /** Extra per-step constraints for slimes (e.g. goal crossbars). */
  constrainSlime?(s: SlimeBody): void;

  /** Who serves after `scorer` won the point (null = neutral kick-off). */
  nextServer(scorer: Side | null): Side | null;
  /** Place the ball for a new rally. */
  serve(ball: Ball, server: Side | null, rng: () => number): void;
  /** Check scoring after a physics step. */
  checkRules(ctx: RuleContext): ScoreEvent | null;

  // ---- AI hooks ----
  /**
   * Score a predicted ball path (from just after a hypothetical hit) from
   * `side`'s point of view. Higher is better; roughly −4..+4.
   */
  evaluate(path: BallPath, side: Side, world: World): number;
  /** Where to wait when there is nothing to hit. */
  homeX(world: World, side: Side): number;

  // ---- art (world coordinates, y-up) ----
  drawArena(ctx: CanvasRenderingContext2D): void;
  /** Foreground pieces drawn over the ball/slimes (nets, goal mesh). */
  drawForeground?(ctx: CanvasRenderingContext2D): void;
  drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, angle: number): void;
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** True when x is in `side`'s attacking (opponent's) half. */
export function inOpponentHalf(x: number, side: Side, width: number): boolean {
  return side === 0 ? x > width / 2 : x < width / 2;
}

/** Draw a filled circle in world coordinates. */
export function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}
