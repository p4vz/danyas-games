import type { Arena, Ball, BallSpec, SlimeBody, SlimePhysics } from "../physics";
import type { BallPath } from "../predict";
import type { Side } from "../types";
import type { World } from "../world";

export interface ScoreEvent {
  scorer: Side;
  points: number;
  /** Big banner text, e.g. "GOAL!" */
  label: string;
}

/**
 * The sport's auxiliary-button action.
 *  - "grab": hold the button to catch and carry the ball on your head; let go
 *    to throw it straight up (tilted by the stick). Opponents can knock it loose.
 *  - "pop": tap to flick a ball that's on/near your head straight up.
 */
export interface AuxAction {
  /**
   * grab: hold to catch and carry, release to throw up.
   * pop: tap to pop a ball on your head straight up.
   * shot: tap to strike a ball beside you (or flick it over your head)
   *   toward the stick direction — your attack direction by default.
   */
  kind: "grab" | "pop" | "shot";
  /** Button label. */
  label: string;
  /** Label while holding the ball (grab). */
  holdLabel?: string;
  /** Upward launch speed (ball-time units). */
  launchSpeed: number;
  /** Extra sideways speed at full stick deflection. */
  aimSpeed: number;
  /** Shot: speed toward the aim direction. */
  shotSpeed?: number;
  /** Grab: auto-throw after holding this long (s). */
  maxHold?: number;
  /** One-line explanation for the menu. */
  hint: string;
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
  /** What the auxiliary button does in this sport (none if absent). */
  aux?: AuxAction;
  /** Overrides for how slimes move in this sport (ice, low gravity…). */
  slimePhysics?: Partial<SlimePhysics>;
  /** Ball touching the floor ends the rally (volleyball) — the AI stops looking past it. */
  floorEndsRally?: boolean;
  /** Bounces allowed on your side before you must hit it (tennis: 1). */
  bouncesAllowed?: number;
  /**
   * Pong-style: the ball plays this much faster after every touch in a rally
   * (×(1 + perTouch·n), up to ×max), so long rallies come to a head.
   */
  speedUp?: { perTouch: number; max: number };
  /** Points to win for Short / Standard / Long matches. */
  winScores: [number, number, number];
  /** If set, matches can be played on the clock instead: seconds for Short / Standard / Long. */
  timeLimits?: [number, number, number];

  /** Allowed x range for a slime's centre on this side. */
  slimeRange(side: Side, radius: number): [number, number];
  startX(side: Side): number;
  /** Extra per-step constraints for slimes (e.g. goal crossbars). */
  constrainSlime?(s: SlimeBody): void;

  /** Who serves after `scorer` won the point (null = neutral kick-off). */
  nextServer(scorer: Side | null): Side | null;
  /** Place the ball for a new rally. */
  serve(ball: Ball, server: Side | null, rng: () => number): void;
  /** Check scoring after a physics step (`world.rally` has touch/bounce counts). */
  checkRules(ctx: RuleContext): ScoreEvent | null;
  /** Called when a slime starts a new touch (after `world.rally` is updated). */
  onTouch?(world: World, side: Side): ScoreEvent | null;
  /** Initial mode-specific counters for `world.rally.data` each rally. */
  createRallyData?(): Record<string, number>;

  // ---- AI hooks ----
  /**
   * Score a predicted ball path (from just after a hypothetical hit) from
   * `side`'s point of view. Higher is better; roughly −4..+4.
   */
  evaluate(path: BallPath, side: Side, world: World): number;
  /**
   * Goal sports: the CPU drops back to defend (to `homeX`) instead of racing
   * an opponent who'll clearly reach the ball first.
   */
  aiDefends?: boolean;
  /** Where to wait when there is nothing to hit. */
  homeX(world: World, side: Side): number;

  // ---- art (world coordinates, y-up) ----
  /** Static arena art. Rendered once per layout and cached, so it must not animate. */
  drawArena(ctx: CanvasRenderingContext2D): void;
  /** Foreground pieces drawn over the ball/slimes (nets, goal mesh). */
  drawForeground?(ctx: CanvasRenderingContext2D, world: World): void;
  drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, angle: number): void;
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** How many more floor bounces on `side`'s half the rally allows (Infinity = no limit). */
export function bouncesLeft(mode: SlimeMode, world: World, side: Side): number {
  if (mode.floorEndsRally) return 0;
  if (mode.bouncesAllowed === undefined) return Infinity;
  return mode.bouncesAllowed - world.rally.bouncesBySide[side];
}

/** Net sports (volleyball, tennis): the floor ends rallies, so never back off. */
export const isNetSport = (mode: SlimeMode) => mode.floorEndsRally === true || mode.bouncesAllowed !== undefined;

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
