import {
  FIXED_DT,
  applyIntent,
  ballSlimeImpulse,
  ballSlimeRestitution,
  groundAccel,
  integrateSlime,
  slimeBallContact,
  type Ball,
  type Contact,
  type SlimeBody,
  type SlimePhysics,
  type Velocities,
} from "./physics";
import { CHARACTERS } from "./characters";
import { bouncesLeft, isNetSport, type AuxAction } from "./modes/mode";
import { BallPath, predictBall } from "./predict";
import { attackDir, idleIntent, other, type Controller, type Intent, type Side } from "./types";
import { auxLaunch, type World } from "./world";

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
  /** Score penalty on jump plans — higher = prefers staying grounded. */
  jumpPenalty: number;
  /** Jump take-off options tried per contact angle. */
  jumpOptions: number;
  /** Random error on take-off time (s). */
  timingNoise: number;
  /** Polish the chosen plan with small position / timing nudges. */
  refine: boolean;
  /** Uses the aux button: GRAB (catch, carry to a shooting spot, throw), or a pop when it beats the hit. */
  usesAux: boolean;
  /** Random error on the throw's stick aim (−1..1 units). */
  throwNoise: number;
  /** How often it looks for a pop / shot while the ball is in reach (s). */
  popCheck: number;
  /** Goal sports: drops back to defend when the opponent will clearly get there first. */
  defends: boolean;
  /** Chance per plan to just play it safe with the first idea. */
  sloppiness: number;
}

const PROFILES: Record<Difficulty, AiProfile> = {
  easy: {
    reaction: 0.28,
    horizon: 1.6,
    offsets: [-0.3, 0.1, 0.35, 0.6],
    aimNoise: 0.25,
    posNoise: 22,
    travelSlack: 1.35,
    jumps: true,
    jumpPenalty: 0.6,
    jumpOptions: 1,
    timingNoise: 0.05,
    refine: false,
    usesAux: false,
    throwNoise: 0.3,
    defends: false,
    popCheck: 0.3,
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
    jumpPenalty: 0.25,
    jumpOptions: 2,
    timingNoise: 0.02,
    refine: false,
    usesAux: true,
    throwNoise: 0.6,
    defends: false,
    popCheck: 0.18,
    sloppiness: 0.15,
  },
  hard: {
    reaction: 0.08,
    horizon: 2.6,
    offsets: [-0.25, -0.1, 0.05, 0.2, 0.35, 0.5, 0.65, 0.8],
    aimNoise: 0.02,
    posNoise: 1,
    travelSlack: 1.02,
    jumps: true,
    jumpPenalty: 0.15,
    jumpOptions: 3,
    timingNoise: 0,
    refine: true,
    usesAux: true,
    throwNoise: 0.02,
    defends: true,
    popCheck: 0.04,
    sloppiness: 0,
  },
};

/** How far past a hit the AI judges where the ball ends up (s). */
const OUTCOME_HORIZON = 1.7;
/** Plan scores at or above this predict a score (see each mode's `evaluate`). */
const SCORING = 2.5;
/** Stick aims tried for a throw. */
// (Straightest first: on a tie the first wins, and a left-first order would
// favour one side of the court.)
const THROW_AIMS = [0, -0.3, 0.3, -0.6, 0.6, -1, 1];
/** A shot only has a direction: default (attack), left, right. */
const SHOT_AIMS = [0, -1, 1];
/** Defend instead of chasing when the opponent gets there this much sooner (s). */
const DEFEND_MARGIN = 0.2;
/** A pop must beat the planned hit by this much for the CPU to use it. */
const POP_MARGIN = 0.3;
/** Spacing of candidate shooting spots (world units). */
const SPOT_STEP = 45;
/** How far past the contact point a "swing through" plan aims (world units). */
const SWING_THROUGH = 90;
/** Shooting spots rated per AI call while carrying (spreads the CPU cost over frames). */
const SPOTS_PER_CALL = 3;

/** Time to cover `d` from rest with accel-limited, speed-capped motion. */
function travelTime(d: number, s: SlimeBody, env: SlimePhysics): number {
  const v = s.char.maxSpeed;
  const a = groundAccel(s.char, env);
  if (d * a < v * v) return 2 * Math.sqrt(d / a);
  return d / v + v / a;
}

/** The slime state a throw / pop / shot is planned from. */
type ThrowSlime = Pick<SlimeBody, "side" | "x" | "y" | "vx" | "vy" | "char">;

interface RolloutResult {
  score: number;
  /** When and where the first touch happens. */
  t: number;
  x: number;
  y: number;
}

interface Plan {
  /** What the plan is, and how good the AI thinks the result will be. */
  kind: "ground" | "jump" | "chase" | "home" | "leave";
  score: number;
  /** When the planned hit happens (s from now; 0 for non-hits). */
  t: number;
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
 *  2. for a fan of contact angles finds the earliest moment it could meet the
 *     ball — on the ground or with a timed jump — given its own speed, accel
 *     and jump arc,
 *  3. verifies each idea by replaying its own steering and jump through the
 *     game's movement + collision code, so the contact point, angle and
 *     velocities are the ones that will really happen,
 *  4. applies the game's impulse maths (mass + bounciness) at that contact,
 *     predicts *that* ball path, and asks the mode how good the outcome is
 *     (lands on their side? goes in the goal? swishes?),
 *  5. executes the best plan; difficulty adds reaction delay and noise.
 */
export class AiController implements Controller {
  private readonly p: AiProfile;
  private readonly path = new BallPath(800);
  private readonly outcome = new BallPath(400);
  private readonly vel: Velocities = { bvx: 0, bvy: 0, svx: 0, svy: 0 };
  private readonly tmpBall: Ball = { x: 0, y: 0, vx: 0, vy: 0 };
  private readonly contactScratch: Contact = { nx: 0, ny: 0, depth: 0 };
  private readonly cands: { targetX: number; takeoff: number | null }[] = [];
  /** Scratch slime / intent for rollouts. */
  private readonly sim: SlimeBody;
  private readonly simIntent: Intent = idleIntent();
  private readonly res: RolloutResult = { score: 0, t: 0, x: 0, y: 0 };
  /** First path sample at which the rally is over for us (too many bounces). */
  private rallyEnd = 0;
  private plan: Plan | null = null;
  private nextPlan = 0;
  private readonly intent: Intent = idleIntent();
  /** Shooting-spot search while carrying: best so far, and the next spot to rate. */
  private shotX: number | null = null;
  private shotScore = -Infinity;
  private spotNext = 0;
  private spotEnd = 0;
  private nextThrowCheck = 0;
  private readonly throwSlime: ThrowSlime;
  // Unstick: notice when we're jammed (against a wall or the other slime, ball
  // going nowhere) and back off for a moment instead of pushing forever.
  private stuckFor = 0;
  private stuckX = 0;
  private stuckY = 0;
  private retreatUntil = 0;
  private digOut = false;

  constructor(
    private readonly side: Side,
    difficulty: Difficulty,
  ) {
    this.p = PROFILES[difficulty];
    this.sim = { side, char: CHARACTERS[0], x: 0, y: 0, vx: 0, vy: 0, grounded: true, onSlime: false, minX: 0, maxX: 0 };
    this.throwSlime = { side, x: 0, y: 0, vx: 0, vy: 0, char: CHARACTERS[0] };
  }

  /** Current plan, for debugging / tuning tools. */
  get currentPlan(): Readonly<Plan> | null {
    return this.plan;
  }

  getIntent(world: World): Intent {
    const s = world.slimes[this.side];
    const intent = this.intent;
    intent.moveX = 0;
    intent.jump = false;
    intent.jumpPower = 1;
    intent.aux = false;

    if (world.phase === "over" || world.phase === "scored") {
      intent.targetX = world.mode.homeX(world, this.side);
      return intent;
    }

    const aux = world.mode.aux;
    const grabbing = aux?.kind === "grab" && this.p.usesAux;
    if (grabbing && world.holder === this.side) return this.carry(world, s, aux, intent);
    this.shotX = null;
    if (world.holder !== null && world.holder !== this.side) {
      // They're carrying it: charge — a bump knocks the ball loose.
      intent.targetX = world.slimes[world.holder].x;
      return intent;
    }

    if (world.time >= this.nextPlan || !this.plan) {
      this.plan = this.replan(world, s);
      this.nextPlan = world.time + this.p.reaction * (0.75 + world.rng() * 0.5);
    }
    if (this.unstick(world, s, intent)) return intent;

    const plan = this.plan;
    intent.targetX = plan.targetX;

    // Ball on our head and no scoring hit lined up: catch it and go shoot.
    if (grabbing && plan.score < SCORING && world.holder === null && world.phase === "play" && world.inAuxReach(s)) {
      intent.aux = true;
    }

    // Pop / shot sports: when the ball is in reach and a pop or shot (aimed
    // with the stick) beats the hit we had lined up, tap the button instead.
    if (
      (aux?.kind === "pop" || aux?.kind === "shot") &&
      this.p.usesAux &&
      plan.kind !== "leave" &&
      world.phase === "play" &&
      world.time >= this.nextThrowCheck &&
      world.inAuxReach(s)
    ) {
      this.nextThrowCheck = world.time + this.p.popCheck;
      const best = this.bestThrow(world, aux, s, world.ball.x, world.ball.y);
      if (best.score > plan.score + POP_MARGIN) {
        intent.aux = true;
        intent.targetX = null;
        // (A shot's direction is all-or-nothing: no aim wobble there.)
        const wobble = aux.kind === "shot" ? 0 : (world.rng() - 0.5) * 2 * this.p.throwNoise;
        intent.moveX = Math.max(-1, Math.min(1, best.aim + wobble));
        return intent;
      }
    }

    if (plan.jumpAt !== null && world.time >= plan.jumpAt - 1e-9) {
      if (s.grounded) intent.jump = true;
      plan.jumpAt = null;
    }

    // Hop over a low ball that sits between us and where we need to be,
    // rather than bulldozing it the wrong way. (Not in net sports: there a
    // low ball is one to play, and jumping into it from below pops it
    // straight up into our own court.)
    const b = world.ball;
    const r = world.mode.ball.radius;
    const dx = plan.targetX - s.x;
    const ahead = (b.x - s.x) * Math.sign(dx);
    if (
      world.phase === "play" &&
      !isNetSport(world.mode) &&
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

  /**
   * Carrying a grabbed ball: head for the best shooting spot and let go as
   * soon as a throw from where we are is predicted to go in (or on arrival /
   * before the auto-throw, with the best aim we've got).
   */
  private carry(world: World, s: SlimeBody, aux: AuxAction, intent: Intent): Intent {
    intent.aux = true;
    if (this.shotX === null) this.startSpotSearch(world, s);
    const searching = this.searchSpots(world, s, aux);
    const shotX = this.shotX ?? s.x;
    const holdLeft = (aux.maxHold ?? 2.5) - world.holdTime;
    const arrived = !searching && Math.abs(s.x - shotX) < 8 && Math.abs(s.vx) < 40;
    // A defender closing in: get the throw off before they bump us.
    const o = world.slimes[this.side === 0 ? 1 : 0];
    const pressured = Math.abs(o.x - s.x) < s.char.radius + o.char.radius + 45;
    if (world.time >= this.nextThrowCheck || holdLeft < 0.3 || pressured) {
      this.nextThrowCheck = world.time + this.p.reaction * 0.5;
      const t = this.throwSlime;
      t.char = s.char;
      t.x = s.x;
      t.y = s.y;
      t.vx = s.vx;
      t.vy = s.vy;
      const best = this.bestThrow(world, aux, t);
      if (best.score >= SCORING || arrived || holdLeft < 0.3 || pressured) {
        // Release: the stick deflection on this step is the aim.
        intent.aux = false;
        intent.targetX = null;
        const noisy = best.aim + (world.rng() - 0.5) * 2 * this.p.throwNoise;
        intent.moveX = Math.max(-1, Math.min(1, noisy));
        this.shotX = null;
        return intent;
      }
    }
    intent.targetX = shotX;
    return intent;
  }

  /** Best stick aim for throwing / popping from slime state `t`, rated by the mode. */
  private bestThrow(
    world: World,
    aux: AuxAction,
    t: ThrowSlime,
    ballX = t.x,
    ballY = 0,
  ): { aim: number; score: number } {
    const spec = world.mode.ball;
    const b = this.tmpBall;
    let aim = 0;
    let score = -Infinity;
    for (const a of aux.kind === "shot" ? SHOT_AIMS : THROW_AIMS) {
      b.x = ballX;
      b.y = ballY;
      auxLaunch(t, b, spec.radius, a, aux);
      predictBall(b, spec, world.mode.arena, world.nextTouchTimeScale, OUTCOME_HORIZON, this.outcome, 0, 1, FIXED_DT * 2);
      const sc = world.mode.evaluate(this.outcome, this.side, world);
      if (sc > score) {
        score = sc;
        aim = a;
      }
    }
    return { aim, score };
  }

  /** Begin looking for a shooting spot: our attacking half, from where we stand. */
  private startSpotSearch(world: World, s: SlimeBody): void {
    const mid = world.width / 2;
    const [lo, hi] = attackDir(this.side) > 0 ? [mid - 100, s.maxX] : [s.minX, mid + 100];
    this.spotNext = Math.max(s.minX, lo);
    this.spotEnd = Math.min(s.maxX, hi);
    this.shotX = s.x;
    this.shotScore = -Infinity;
  }

  /**
   * Rate a few more candidate spots (standing throw, best aim; nearer wins
   * ties). Returns true while the search is still going.
   */
  private searchSpots(world: World, s: SlimeBody, aux: AuxAction): boolean {
    const t = this.throwSlime;
    t.char = s.char;
    t.y = 0;
    t.vx = 0;
    t.vy = 0;
    for (let n = 0; n < SPOTS_PER_CALL && this.spotNext <= this.spotEnd; n++, this.spotNext += SPOT_STEP) {
      t.x = this.spotNext;
      const sc = this.bestThrow(world, aux, t).score - Math.abs(t.x - s.x) / 2000;
      if (sc > this.shotScore) {
        this.shotScore = sc;
        this.shotX = t.x;
      }
    }
    return this.spotNext <= this.spotEnd;
  }

  /** Returns true (and fills `intent`) while backing off from a jam. */
  private unstick(world: World, s: SlimeBody, intent: Intent): boolean {
    const b = world.ball;
    const R = s.char.radius;
    const reach = R + world.mode.ball.radius;
    if (this.digOut) {
      // Pinned at a wall with the ball on the wall side: a grounded tap only
      // knocks it into the wall again, so jump through it instead.
      intent.targetX = s.x;
      if (s.grounded) {
        intent.jump = true;
        this.digOut = false;
      }
      return true;
    }
    if (world.time < this.retreatUntil) {
      // Move away from the ball; if a wall is behind us, squeeze past instead.
      let away = Math.sign(s.x - b.x) || -attackDir(this.side);
      if ((away < 0 && s.x - s.minX < R) || (away > 0 && s.maxX - s.x < R)) away = -away;
      intent.targetX = Math.max(s.minX, Math.min(s.maxX, s.x + away * R * 3));
      // Hop down off another slime's head.
      if (s.grounded && s.y > 1) intent.jump = true;
      return true;
    }
    // Volleyball can't afford to back off: the ball would just land.
    if (world.phase !== "play" || isNetSport(world.mode)) {
      this.stuckFor = 0;
      return false;
    }
    if (Math.hypot(b.x - this.stuckX, b.y - this.stuckY) > 50) {
      this.stuckX = b.x;
      this.stuckY = b.y;
      this.stuckFor = 0;
      return false;
    }
    const o = world.slimes[this.side === 0 ? 1 : 0];
    const jammed =
      s.y > 1 ||
      s.x - s.minX < 1 ||
      s.maxX - s.x < 1 ||
      Math.hypot(s.x - o.x, s.y - o.y) < R + o.char.radius + 4;
    if (jammed && Math.hypot(b.x - s.x, b.y - s.y) < reach * 1.6) this.stuckFor += FIXED_DT;
    if (this.stuckFor > 1) {
      this.stuckFor = 0;
      const wallSide = (s.x - s.minX < 1 && b.x < s.x) || (s.maxX - s.x < 1 && b.x > s.x);
      if (wallSide && b.y > s.y + R * 0.5) this.digOut = true;
      else this.retreatUntil = world.time + 0.6 + world.rng() * 0.3;
    }
    return false;
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
    predictBall(world.ball, spec, mode.arena, world.ballTimeScale, p.horizon, this.path, hold, 1);
    const path = this.path;
    this.rallyEnd = this.findRallyEnd(world);

    const v0 = s.char.jump;
    const g = world.physics.gravity;
    const apex = (v0 * v0) / (2 * g);

    // 1) Cheap analytic pass: for each contact angle, the earliest ground hit
    //    and a few jump hits that our speed / accel / jump arc can make.
    const cands = this.cands;
    cands.length = 0;
    const bounceSports = mode.bouncesAllowed !== undefined;
    for (const f0 of p.offsets) {
      const f = f0 + (rng() - 0.5) * 2 * p.aimNoise;
      const ox = dir * f * reach; // ball is this far *ahead* of slime centre
      const dy = Math.sqrt(Math.max(0, reach * reach - ox * ox));

      let groundDone = false;
      // A few take-off options per angle: the earliest isn't always the best
      // (waiting for the ball to drop can give a better shooting angle).
      let jumpsLeft = p.jumps ? p.jumpOptions : 0;
      let nextJumpT = 0;
      for (let i = 0; i < this.rallyEnd && !(groundDone && jumpsLeft === 0); i += 2) {
        // Where a bounce is allowed (tennis), also try playing it after the
        // bounce rather than only on the way down — usually the better shot.
        if (bounceSports && (path.floor[i] || path.floor[i + 1])) {
          groundDone = false;
          jumpsLeft = Math.max(jumpsLeft, p.jumps ? 1 : 0);
        }
        const bx = path.x[i];
        const by = path.y[i];
        const t = path.t[i];
        let sx = bx - ox;
        let dyi = dy;
        if (sx < s.minX || sx > s.maxX) {
          // Can't stand there (wall / net): hit it from as close as we can get,
          // which tilts the contact — vital for digging a ball out of a corner.
          sx = Math.max(s.minX, Math.min(s.maxX, sx));
          const oxi = bx - sx;
          if (Math.abs(oxi) > reach * 0.92) continue;
          dyi = Math.sqrt(reach * reach - oxi * oxi);
        }
        const tMove = travelTime(Math.abs(sx - s.x), s, world.physics) * p.travelSlack;
        const base = by - dyi;

        if (!groundDone && base <= 1 && path.vy[i] <= 0) {
          if (tMove <= t) {
            groundDone = true;
            this.addCandidate(sx, null);
            // Swing through: aim past the spot so we're still moving when we
            // meet the ball — that's where a stopped dome lacks power.
            if (bounceSports) this.addCandidate(Math.max(s.minX, Math.min(s.maxX, sx + dir * SWING_THROUGH)), null);
          }
        } else if (jumpsLeft > 0 && t >= nextJumpT && base > 1 && base < apex * 0.97) {
          const tUp = (v0 - Math.sqrt(v0 * v0 - 2 * g * base)) / g;
          const takeoff = t - tUp;
          if (takeoff >= 0 && tMove <= takeoff + 0.02) {
            jumpsLeft--;
            nextJumpT = t + 0.15;
            this.addCandidate(sx, takeoff);
          }
        }
      }
      if (cands.length && rng() < p.sloppiness) break;
    }

    // 2) Verify each idea by replaying our own movement with the real physics,
    //    finding the actual contact, and predicting where the ball goes next.
    let best: Plan | null = null;
    const consider = (targetX: number, takeoff: number | null) => {
      const res = this.rollout(world, s, targetX, takeoff, hold);
      if (!res) return;
      // (res is reused scratch — copy what we keep.)
      const score = res.score - (takeoff === null ? 0 : p.jumpPenalty) - 0.05 * res.t;
      if (best && score <= best.score) return;
      best = {
        kind: takeoff === null ? "ground" : "jump",
        score,
        t: res.t,
        targetX,
        jumpAt: takeoff === null ? null : world.time + takeoff,
        contactX: res.x,
        contactY: res.y,
      };
    };
    for (const c of cands) consider(c.targetX, c.takeoff);

    // 3) Hard: polish the winner with small nudges in position and timing.
    if (p.refine && best) {
      const b0: Plan = best;
      const takeoff0 = b0.jumpAt === null ? null : b0.jumpAt - world.time;
      for (const dx of [-6, 6]) consider(b0.targetX + dx, takeoff0);
      if (takeoff0 !== null) {
        for (const dt of [-0.02, 0.02]) if (takeoff0 + dt >= 0) consider(b0.targetX, takeoff0 + dt);
      }
    }

    // Net sports: our own shot that's already doing the job is better left
    // alone than touched again (a wasted touch, or a double hit).
    if (isNetSport(mode) && world.phase === "play" && world.rally.lastTouch?.side === this.side) {
      const leave = mode.evaluate(path, this.side, world);
      if (leave > 0 && (!best || leave >= (best as Plan).score)) {
        return { kind: "leave", score: leave, t: 0, targetX: this.dodgeX(world, s), jumpAt: null, contactX: 0, contactY: 0 };
      }
    }

    // Goal sports: if they'll clearly get there first, don't leave the goal
    // open chasing it — drop back and defend.
    if (
      best &&
      p.defends &&
      mode.aiDefends &&
      world.phase === "play" &&
      (best as Plan).t > this.opponentReach(world) + DEFEND_MARGIN
    ) {
      return { kind: "home", score: 0, t: 0, targetX: mode.homeX(world, this.side), jumpAt: null, contactX: 0, contactY: 0 };
    }

    if (best) {
      const plan: Plan = best;
      plan.targetX += (rng() - 0.5) * 2 * p.posNoise;
      if (plan.jumpAt !== null) plan.jumpAt += (rng() - 0.5) * 2 * p.timingNoise;
      return plan;
    }

    // Nothing reachable: shadow the ball where it comes down low, else go home.
    for (let i = 0; i < path.length; i += 2) {
      if (path.y[i] < reach && path.x[i] >= s.minX - R && path.x[i] <= s.maxX + R) {
        const sx = path.x[i] - dir * reach * 0.3;
        const targetX = Math.max(s.minX, Math.min(s.maxX, sx));
        return { kind: "chase", score: 0, t: 0, targetX, jumpAt: null, contactX: 0, contactY: 0 };
      }
    }
    const targetX = mode.homeX(world, this.side);
    return { kind: "home", score: 0, t: 0, targetX, jumpAt: null, contactX: 0, contactY: 0 };
  }

  /** Rough earliest time the opponent could get a dome on the predicted ball. */
  private opponentReach(world: World): number {
    const o = world.slimes[other(this.side)];
    const path = this.path;
    const reach = o.char.radius + world.mode.ball.radius;
    const v0 = o.char.jump;
    const high = reach + ((v0 * v0) / (2 * world.physics.gravity)) * 0.8;
    for (let i = 0; i < path.length; i += 4) {
      if (path.y[i] > high) continue;
      const t = path.t[i];
      // Where their current momentum carries them (matters on ice).
      const ox = o.x + o.vx * Math.min(t, 0.3);
      const d = Math.max(0, Math.abs(path.x[i] - ox) - reach * 0.6);
      if (travelTime(d, o, world.physics) <= t) return t;
    }
    return Infinity;
  }

  /** A spot on our side that keeps the dome clear of the ball's path, near home. */
  private dodgeX(world: World, s: SlimeBody): number {
    const path = this.path;
    const low = s.char.radius + world.mode.ball.radius + s.char.jump * 0.1;
    const home = world.mode.homeX(world, this.side);
    let bestX = home;
    let bestScore = -Infinity;
    for (const x of [home, s.x, s.minX, s.maxX, (s.minX + s.maxX) / 2]) {
      let clear = 400;
      for (let i = 0; i < path.length; i += 4) {
        if (path.y[i] < low) clear = Math.min(clear, Math.abs(path.x[i] - x));
      }
      const score = clear - Math.abs(x - home) * 0.2;
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
      }
    }
    return bestX;
  }

  /** Where the predicted path stops being playable for us (bounce rules). */
  private findRallyEnd(world: World): number {
    const path = this.path;
    let left = bouncesLeft(world.mode, world, this.side);
    if (left === Infinity) return path.length;
    const mid = world.width / 2;
    for (let i = 1; i < path.length; i++) {
      if (!path.floor[i]) continue;
      const ours = this.side === 0 ? path.x[i] < mid : path.x[i] > mid;
      if (world.mode.floorEndsRally || ours) left--;
      if (left < 0) return i;
    }
    return path.length;
  }

  /** Queue a plan to verify, skipping near-duplicates (common near walls). */
  private addCandidate(targetX: number, takeoff: number | null): void {
    for (const c of this.cands) {
      if (Math.abs(c.targetX - targetX) < 3) {
        if (takeoff === null ? c.takeoff === null : c.takeoff !== null && Math.abs(c.takeoff - takeoff) < 0.012) return;
      }
    }
    this.cands.push({ targetX, takeoff });
  }

  /**
   * Replay "steer to targetX, jump at `takeoff` s from now" with the game's
   * own movement and collision code against the predicted ball path. Returns
   * the rated outcome of the first touch, or null if we'd never touch it (or
   * it would land first, in volleyball).
   */
  private rollout(
    world: World,
    s: SlimeBody,
    targetX: number,
    takeoff: number | null,
    hold: number,
  ): RolloutResult | null {
    const mode = world.mode;
    const spec = mode.ball;
    const env = world.physics;
    const path = this.path;
    const sim = this.sim;
    sim.char = s.char;
    sim.side = s.side;
    sim.x = s.x;
    sim.y = s.y;
    sim.vx = s.vx;
    sim.vy = s.vy;
    sim.grounded = s.grounded;
    sim.onSlime = s.onSlime;
    sim.minX = s.minX;
    sim.maxX = s.maxX;
    const intent = this.simIntent;
    intent.targetX = targetX;
    const holdSteps = Math.round(hold / FIXED_DT);
    const lastK = holdSteps + path.length - 1;
    const ball = this.tmpBall;
    const contact = this.contactScratch;

    for (let k = 1; k <= lastK; k++) {
      const now = (k - 1) * FIXED_DT;
      intent.jump = takeoff !== null && now >= takeoff - 1e-9 && now < takeoff + 0.05;
      applyIntent(sim, intent, FIXED_DT, env);
      integrateSlime(sim, FIXED_DT, env);
      mode.constrainSlime?.(sim);
      const i = k - holdSteps;
      if (i <= 0) continue; // ball still held for the serve
      if (i >= this.rallyEnd) return null;
      ball.x = path.x[i];
      ball.y = path.y[i];
      if (!slimeBallContact(sim, ball, spec.radius, contact)) continue;
      const v = this.vel;
      v.bvx = path.vx[i];
      v.bvy = path.vy[i];
      v.svx = sim.vx;
      v.svy = sim.vy;
      const e = ballSlimeRestitution(sim, spec);
      if (!ballSlimeImpulse(v, contact.nx, contact.ny, spec.mass, sim.char.mass, e, spec.minPop)) continue;
      ball.x += contact.nx * contact.depth;
      ball.y += contact.ny * contact.depth;
      ball.vx = v.bvx;
      ball.vy = v.bvy;
      predictBall(ball, spec, mode.arena, world.nextTouchTimeScale, OUTCOME_HORIZON, this.outcome, path.t[i], 1, FIXED_DT * 2);
      const res = this.res;
      res.score = mode.evaluate(this.outcome, this.side, world);
      res.t = path.t[i];
      res.x = path.x[i];
      res.y = path.y[i];
      return res;
    }
    return null;
  }
}
