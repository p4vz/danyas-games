import type { SlimeCharacter } from "./characters";
import type { ScoreEvent, SlimeMode } from "./modes/mode";
import {
  FIXED_DT,
  applyIntent,
  collideBallSlime,
  collideSlimes,
  integrateSlime,
  stepBall,
  type Ball,
  type BallStepResult,
  type Contact,
  type SlimeBody,
  type Velocities,
} from "./physics";
import type { Intent, Side } from "./types";

export type Phase = "ready" | "play" | "scored" | "over";

export type WorldEvent =
  | { type: "hit"; side: Side; strength: number }
  | { type: "bounce"; strength: number }
  | { type: "score"; score: ScoreEvent }
  | { type: "reserve" };

export interface MatchConfig {
  mode: SlimeMode;
  chars: [SlimeCharacter, SlimeCharacter];
  /** Ball time-scale: 1 = normal, 1.5 = turbo. */
  ballSpeed: number;
  winScore: number;
  seed: number;
}

/** Ball frozen in place before each rally. */
export const READY_TIME = 0.9;
/** Celebration pause after a point. */
export const SCORED_TIME = 1.6;
const STALL_TIME = 3.5;
const STALL_RADIUS = 60;

/** Small deterministic PRNG so a match can be replayed / synced from a seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The authoritative match simulation. It only consumes per-side `Intent`s and
 * advances in fixed steps, so it is deterministic for a given seed + input
 * stream — the foundation for future online play.
 */
export class World {
  readonly mode: SlimeMode;
  readonly ballSpeed: number;
  readonly winScore: number;
  readonly rng: () => number;

  time = 0;
  phase: Phase = "ready";
  phaseTime = 0;
  scores: [number, number] = [0, 0];
  server: Side | null = null;
  winner: Side | null = null;
  lastScore: ScoreEvent | null = null;
  lastTouch: { side: Side; x: number } | null = null;

  readonly ball: Ball = { x: 0, y: 0, vx: 0, vy: 0 };
  /** Visual spin angle (radians). */
  ballAngle = 0;
  readonly slimes: [SlimeBody, SlimeBody];
  /** Drained by the UI each frame (sounds, banners). */
  events: WorldEvent[] = [];

  private stall = 0;
  private stallX = 0;
  private stallY = 0;
  private readonly stepOut: BallStepResult = { floor: false };
  private readonly contact: Contact = { nx: 0, ny: 0, depth: 0 };
  private readonly vel: Velocities = { bvx: 0, bvy: 0, svx: 0, svy: 0 };

  constructor(cfg: MatchConfig) {
    this.mode = cfg.mode;
    this.ballSpeed = cfg.ballSpeed;
    this.winScore = cfg.winScore;
    this.rng = mulberry32(cfg.seed);
    this.slimes = [this.makeSlime(0, cfg.chars[0]), this.makeSlime(1, cfg.chars[1])];
    this.server = this.mode.nextServer(null);
    this.resetRally();
  }

  get width(): number {
    return this.mode.arena.width;
  }

  /** Seconds until the ball is released (0 once in play). */
  holdRemaining(): number {
    return this.phase === "ready" ? Math.max(0, READY_TIME - this.phaseTime) : 0;
  }

  private makeSlime(side: Side, char: SlimeCharacter): SlimeBody {
    const [minX, maxX] = this.mode.slimeRange(side, char.radius);
    return { side, char, x: 0, y: 0, vx: 0, vy: 0, grounded: true, minX, maxX };
  }

  resetRally(): void {
    for (const s of this.slimes) {
      s.x = Math.max(s.minX, Math.min(s.maxX, this.mode.startX(s.side)));
      s.y = 0;
      s.vx = 0;
      s.vy = 0;
      s.grounded = true;
    }
    this.mode.serve(this.ball, this.server, this.rng);
    this.phase = "ready";
    this.phaseTime = 0;
    this.lastTouch = null;
    this.stall = 0;
  }

  step(intents: [Intent, Intent]): void {
    const dt = FIXED_DT;
    this.time += dt;
    this.phaseTime += dt;
    const [a, b] = this.slimes;

    for (const s of this.slimes) {
      if (this.phase !== "over") applyIntent(s, intents[s.side], dt);
      else s.vx *= 0.9;
      integrateSlime(s, dt);
      this.mode.constrainSlime?.(s);
    }
    collideSlimes(a, b);

    if (this.phase === "ready") {
      if (this.phaseTime >= READY_TIME) {
        this.phase = "play";
        this.phaseTime = 0;
      }
      return;
    }

    const ball = this.ball;
    const spec = this.mode.ball;
    const prevX = ball.x;
    const prevY = ball.y;
    const prevVy = ball.vy;
    stepBall(ball, spec, this.mode.arena, dt, this.ballSpeed, this.stepOut);
    if (this.stepOut.floor && prevVy < -250) {
      this.events.push({ type: "bounce", strength: Math.min(1, -prevVy / 1200) });
    }

    let touching = false;
    for (const s of this.slimes) {
      const impact = collideBallSlime(s, ball, spec, this.contact, this.vel);
      if (impact > 0) {
        this.lastTouch = { side: s.side, x: s.x };
        if (impact > 120) this.events.push({ type: "hit", side: s.side, strength: Math.min(1, impact / 1200) });
      }
      if (impact > 0 || this.contactNow(s)) touching = true;
    }
    this.ballAngle -= (ball.vx * dt * this.ballSpeed) / spec.radius;

    if (this.phase === "play") {
      const ev = this.mode.checkRules({ world: this, ball, prevX, prevY, floor: this.stepOut.floor });
      if (ev) {
        this.award(ev);
        return;
      }
      // Re-serve a ball that's stuck: parked on a crossbar / rim / net top, or
      // wedged against a wall by slimes. A loose ball lying on open floor is
      // fine — somebody just has to go and get it.
      if (Math.hypot(ball.x - this.stallX, ball.y - this.stallY) > STALL_RADIUS) {
        this.stallX = ball.x;
        this.stallY = ball.y;
        this.stall = 0;
      } else if (ball.y > spec.radius + 2 || touching || this.nearSlime()) {
        this.stall += dt;
      }
      if (this.stall > STALL_TIME) {
        this.events.push({ type: "reserve" });
        this.resetRally();
      }
    } else if (this.phase === "scored" && this.phaseTime >= SCORED_TIME) {
      if (this.winner !== null) {
        this.phase = "over";
        this.phaseTime = 0;
      } else {
        this.resetRally();
      }
    }
  }

  private nearSlime(): boolean {
    const r = this.mode.ball.radius;
    return this.slimes.some((s) => Math.hypot(this.ball.x - s.x, this.ball.y - s.y) < s.char.radius + r + 12);
  }

  private contactNow(s: SlimeBody): boolean {
    const R = s.char.radius + this.mode.ball.radius + 1;
    return Math.hypot(this.ball.x - s.x, this.ball.y - s.y) < R && this.ball.y >= s.y;
  }

  private award(ev: ScoreEvent): void {
    this.scores[ev.scorer] += ev.points;
    this.lastScore = ev;
    this.server = this.mode.nextServer(ev.scorer);
    this.phase = "scored";
    this.phaseTime = 0;
    this.events.push({ type: "score", score: ev });
    if (this.scores[ev.scorer] >= this.winScore) this.winner = ev.scorer;
  }
}
