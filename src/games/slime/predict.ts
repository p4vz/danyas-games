import { FIXED_DT, stepBall, type Arena, type Ball, type BallSpec, type BallStepResult } from "./physics";

/**
 * A recorded ball trajectory in preallocated typed arrays, so the AI can run
 * dozens of look-aheads per second without feeding the garbage collector on a
 * low-end tablet.
 */
export class BallPath {
  readonly t: Float64Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly floor: Uint8Array;
  length = 0;

  constructor(readonly capacity: number) {
    this.t = new Float64Array(capacity);
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.vx = new Float64Array(capacity);
    this.vy = new Float64Array(capacity);
    this.floor = new Uint8Array(capacity);
  }
}

const scratchBall: Ball = { x: 0, y: 0, vx: 0, vy: 0 };
const scratchStep: BallStepResult = { floor: false };

/**
 * Simulate the ball alone (no slimes) using the exact same step function as
 * the live game, so predictions match reality until someone touches it.
 *
 * Sample i is the state after i × stride steps; times are in real seconds
 * offset by `t0` (e.g. the remaining serve-hold time). A coarser `dt` trades
 * a little accuracy for speed (used for the AI's what-if outcomes).
 */
export function predictBall(
  start: Ball,
  spec: BallSpec,
  arena: Arena,
  timeScale: number,
  horizon: number,
  out: BallPath,
  t0 = 0,
  stride = 1,
  dt = FIXED_DT,
): BallPath {
  const b = scratchBall;
  b.x = start.x;
  b.y = start.y;
  b.vx = start.vx;
  b.vy = start.vy;
  const steps = Math.min(Math.ceil(horizon / dt), (out.capacity - 1) * stride);
  let n = 0;
  out.t[0] = t0;
  out.x[0] = b.x;
  out.y[0] = b.y;
  out.vx[0] = b.vx;
  out.vy[0] = b.vy;
  out.floor[0] = 0;
  n = 1;
  let floorSinceSample = false;
  for (let i = 1; i <= steps; i++) {
    stepBall(b, spec, arena, dt, timeScale, scratchStep);
    if (scratchStep.floor) floorSinceSample = true;
    if (i % stride !== 0) continue;
    out.t[n] = t0 + i * dt;
    out.x[n] = b.x;
    out.y[n] = b.y;
    out.vx[n] = b.vx;
    out.vy[n] = b.vy;
    out.floor[n] = floorSinceSample ? 1 : 0;
    floorSinceSample = false;
    n++;
  }
  out.length = n;
  return out;
}
