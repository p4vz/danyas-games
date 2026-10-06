import {
  FIXED_DT,
  SLIME_GRAVITY,
  ballSlimeImpulse,
  ballSlimeRestitution,
  type Ball,
  type SlimeBody,
  type Velocities,
} from "./physics";
import { BallPath, predictBall } from "./predict";
import { attackDir, idleIntent, type Controller, type Intent, type Side } from "./types";
import type { World } from "./world";

export type Difficulty = "easy" | "medium" | "hard";

interface AiProfile {
  /** Seconds between re-plans (reaction time). */
  reaction: number;
  /** How far ahead the AI looks (s). */
  horizon: number;
  /** Contact offsets tried, as a fraction of (slime + ball) radius. */
  offsets: number[];
  /** Random aim error (fraction of radius). */
  aimNoise: number;
  /** Random position error (world units). */
  posNoise: number;
  /** Multiplier on its own estimated travel time (>1 = cautious). */
  travelSlack: number;
  /** Whether it plans jump hits (spikes, headers, shots, blocks). */
  jumps: boolean;
  /** Chance per plan to just play it safe with the first idea. */
  sloppiness: number;
}

const PROFILES: Record<Difficulty, AiProfile> = {
  easy: {
    reaction: 0.28,
    horizon: 1.6,
    offsets: [0.1, 0.35, 0.6],
    aimNoise: 0.25,
    posNoise: 22,
    travelSlack: 1.35,
    jumps: false,
    sloppiness: 0.5,
  },
  medium: {
    reaction: 0.14,
    horizon: 2.2,
    offsets: [-0.15, 0.1, 0.3, 0.5, 0.7],
    aimNoise: 0.1,
    posNoise: 8,
    travelSlack: 1.12,
    jumps: true,
    sloppiness: 0.15,
  },
  hard: {
    reaction: 0.07,
    horizon: 2.6,
    offsets: [-0.25, -0.1, 0.05, 0.2, 0.35, 0.5, 0.65, 0.8],
    aimNoise: 0.02,
    posNoise: 1,
    travelSlack: 1.02,
    jumps: true,
    sloppiness: 0,
  },
};

/** Time to cover `d` from rest with accel-limited, speed-capped motion. */
function travelTime(d: number, s: SlimeBody): number {
  const { maxSpeed: v, accel: a } = s.char;
  if (d * a < v * v) return 2 * Math.sqrt(d / a);
  return d / v + v / a;
}

interface Plan {
  targetX: number;
  /** Absolute world time to take off, or null for no jump. */
  jumpAt: number | null;
  /** Debug/visual: predicted contact point. */
  contactX: number;
  contactY: number;
}

/**
 * Trajectory-predicting AI.
 *
 * Every re-plan it:
 *  1. simulates the ball forward with the real physics (ignoring slimes),
 *  2. for a fan of contact angles finds the earliest moment it can meet the
 *     ball — on the ground or with a timed jump — given its own speed, accel
 *     and jump arc,
 *  3. for each candidate computes the post-hit ball velocity with the same
 *     impulse maths the game uses (mass + bounciness), predicts *that* path,
 *     and asks the mode how good the outcome is (lands on their side? goes in
 *     the goal? swishes?),
 *  4. picks the best, then steers there and jumps on the computed beat.
 */
export class AiController implements Controller {
  private readonly p: AiProfile;
  private readonly path = new BallPath(800);
  private readonly outcome = new BallPath(400);
  private readonly vel: Velocities = { bvx: 0, bvy: 0, svx: 0, svy: 0 };
  private readonly tmpBall: Ball = { x: 0, y: 0, vx: 0, vy: 0 };
  private plan: Plan | null = null;
  private nextPlan = 0;
  private readonly intent: Intent = idleIntent();

  constructor(
    private readonly side: Side,
    difficulty: Difficulty,
  ) {
    this.p = PROFILES[difficulty];
  }

  /** Last planned contact point (for the optional trajectory overlay). */
  get contact(): { x: number; y: number } | null {
    return this.plan && this.plan.contactY > 0 ? { x: this.plan.contactX, y: this.plan.contactY } : null;
  }

  getIntent(world: World): Intent {
    const s = world.slimes[this.side];
    const intent = this.intent;
    intent.moveX = 0;
    intent.jump = false;
    intent.jumpPower = 1;

    if (world.phase === "over" || world.phase === "scored") {
      intent.targetX = world.mode.homeX(world, this.side);
      return intent;
    }

    if (world.time >= this.nextPlan || !this.plan) {
      this.plan = this.replan(world, s);
      this.nextPlan = world.time + this.p.reaction * (0.75 + world.rng() * 0.5);
    }
    const plan = this.plan;
    intent.targetX = plan.targetX;

    if (plan.jumpAt !== null && s.grounded && world.time >= plan.jumpAt) {
      if (Math.abs(s.x - plan.targetX) < s.char.radius * 0.7) intent.jump = true;
      plan.jumpAt = null;
    }

    // Hop over a low ball that sits between us and where we need to be,
    // rather than bulldozing it the wrong way.
    const b = world.ball;
    const r = world.mode.ball.radius;
    const dx = plan.targetX - s.x;
    const ahead = (b.x - s.x) * Math.sign(dx);
    if (
      world.phase === "play" &&
      s.grounded &&
      Math.abs(dx) > s.char.radius &&
      ahead > 0 &&
      ahead < s.char.radius + r + 25 &&
      b.y < s.char.radius + r &&
      Math.sign(plan.targetX - b.x) === Math.sign(dx)
    ) {
      intent.jump = true;
    }
    return intent;
  }

  private replan(world: World, s: SlimeBody): Plan {
    const mode = world.mode;
    const spec = mode.ball;
    const r = spec.radius;
    const R = s.char.radius;
    const reach = R + r;
    const dir = attackDir(this.side);
    const rng = world.rng;
    const p = this.p;

    const hold = world.holdRemaining();
    predictBall(world.ball, spec, mode.arena, world.ballSpeed, p.horizon, this.path, hold, 2);
    const path = this.path;

    const v0 = s.char.jump;
    const apex = (v0 * v0) / (2 * SLIME_GRAVITY);
    const now = world.time;

    let best: Plan | null = null;
    let bestScore = -Infinity;
    const sloppy = rng() < p.sloppiness;

    for (const f0 of p.offsets) {
      const f = f0 + (rng() - 0.5) * 2 * p.aimNoise;
      const ox = dir * f * reach; // ball is this far *ahead* of slime centre
      const dy = Math.sqrt(Math.max(0, reach * reach - ox * ox));

      let groundDone = false;
      let jumpDone = !p.jumps;
      for (let i = 0; i < path.length && !(groundDone && jumpDone); i++) {
        if (mode.floorEndsRally && path.floor[i]) break;
        const bx = path.x[i];
        const by = path.y[i];
        const t = path.t[i];
        const sx = bx - ox;
        if (sx < s.minX || sx > s.maxX) continue;
        const tMove = travelTime(Math.abs(sx - s.x), s) * p.travelSlack;
        const base = by - dy;

        if (!groundDone && base <= 1 && path.vy[i] <= 0) {
          if (tMove <= t) {
            groundDone = true;
            const score = this.score(world, s, i, ox, dy, 0, 0, sx) - 0.05 * t;
            if (score > bestScore) {
              bestScore = score;
              best = { targetX: sx, jumpAt: null, contactX: bx, contactY: by };
            }
          }
        } else if (!jumpDone && base > 1 && base < apex * 0.97) {
          const disc = v0 * v0 - 2 * SLIME_GRAVITY * base;
          const tUp = (v0 - Math.sqrt(disc)) / SLIME_GRAVITY;
          const takeoff = t - tUp;
          if (takeoff >= 0 && tMove <= takeoff + 0.02) {
            jumpDone = true;
            const svy = Math.sqrt(disc);
            // Jumps are a commitment — small risk penalty.
            const score = this.score(world, s, i, ox, dy, 0, svy, sx) - 0.2 - 0.05 * t;
            if (score > bestScore) {
              bestScore = score;
              best = { targetX: sx, jumpAt: now + takeoff, contactX: bx, contactY: by };
            }
          }
        }
      }
      if (sloppy && best) break;
    }

    if (best) {
      best.targetX += (rng() - 0.5) * 2 * p.posNoise;
      return best;
    }

    // Nothing reachable: shadow the ball where it comes down low, else go home.
    for (let i = 0; i < path.length; i++) {
      if (path.y[i] < reach && path.x[i] >= s.minX - R && path.x[i] <= s.maxX + R) {
        const sx = path.x[i] - dir * reach * 0.3;
        return { targetX: Math.max(s.minX, Math.min(s.maxX, sx)), jumpAt: null, contactX: 0, contactY: 0 };
      }
    }
    return { targetX: mode.homeX(world, this.side), jumpAt: null, contactX: 0, contactY: 0 };
  }

  /** Simulate hitting the ball at path sample `i` and rate the result. */
  private score(
    world: World,
    s: SlimeBody,
    i: number,
    ox: number,
    dy: number,
    svx: number,
    svy: number,
    sx: number,
  ): number {
    const mode = world.mode;
    const spec = mode.ball;
    const reach = s.char.radius + spec.radius;
    const path = this.path;
    const nx = ox / reach;
    const ny = dy / reach;
    const v = this.vel;
    v.bvx = path.vx[i];
    v.bvy = path.vy[i];
    v.svx = svx;
    v.svy = svy;
    ballSlimeImpulse(v, nx, ny, spec.mass, s.char.mass, ballSlimeRestitution(s, spec), spec.minPop);
    const b = this.tmpBall;
    b.x = path.x[i];
    b.y = path.y[i];
    b.vx = v.bvx;
    b.vy = v.bvy;
    predictBall(b, spec, mode.arena, world.ballSpeed, 2, this.outcome, path.t[i], 1, FIXED_DT * 2);
    let score = mode.evaluate(this.outcome, this.side, world);

    // Don't plan through the ball: if it rolls between us and the spot, the
    // approach itself would knock it backwards.
    const bNow = world.ball;
    if (bNow.y < reach && (bNow.x - s.x) * (sx - bNow.x) > 0 && Math.abs(sx - s.x) > reach * 0.5) {
      score -= 1.2;
    }
    return score;
  }
}
