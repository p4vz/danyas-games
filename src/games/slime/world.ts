import type { SlimeCharacter } from "./characters";
import type { AuxAction, ScoreEvent, SlimeMode } from "./modes/mode";
import {
  DEFAULT_SLIME_PHYSICS,
  FIXED_DT,
  applyIntent,
  collideBallSlime,
  collideSlimes,
  integrateSlime,
  slimeBallContact,
  stepBall,
  type Ball,
  type BallStepResult,
  type Contact,
  type SlimeBody,
  type SlimePhysics,
  type Velocities,
} from "./physics";
import { other, type Intent, type Side } from "./types";

export type Phase = "ready" | "play" | "scored" | "over";

export type WorldEvent =
  | { type: "hit"; side: Side; strength: number }
  | { type: "bounce"; strength: number }
  | { type: "score"; score: ScoreEvent }
  | { type: "grab"; side: Side }
  | { type: "launch"; side: Side }
  | { type: "steal"; side: Side }
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

/**
 * Facts about the current rally, reset at every serve. The world keeps these
 * up to date so modes can express rules like "one bounce per side" (tennis)
 * or "three touches max" (volleyball) without tracking anything themselves.
 */
export interface RallyState {
  /** Separate touches this rally, per side. */
  touches: [number, number];
  /** Consecutive touches by whoever touched last. */
  streak: number;
  lastTouch: { side: Side; x: number; y: number; time: number } | null;
  /** Floor bounces since the last slime touch… */
  bounces: number;
  /** …and on which half of the court they landed. */
  bouncesBySide: [number, number];
  /** Mode-specific counters, from `mode.createRallyData()`. */
  data: Record<string, number>;
}

/** Contacts closer together than this are one touch (a carry / roll). */
const TOUCH_GAP = 0.12;
/** How far beyond the dome the aux button can reach the ball. */
const AUX_REACH = 22;
/** Pause after a pop / throw before the aux button works again (s). */
const AUX_COOLDOWN = 0.35;
/** Default auto-throw time for grab sports. */
const DEFAULT_MAX_HOLD = 2.5;
/** Carrying the ball slows you down, so defenders can catch up. */
const CARRY_SPEED = 0.75;
/** A bumped carrier fumbles: the ball pops up, nudged toward the thief. */
const FUMBLE_POP = 320;
const FUMBLE_NUDGE = 140;

/** Is the ball on / just above this slime's dome (within aux-button reach)? */
export function inAuxReach(s: SlimeBody, ball: Ball, ballRadius: number): boolean {
  const R = s.char.radius;
  return ball.y >= s.y + R * 0.25 && Math.hypot(ball.x - s.x, ball.y - s.y) < R + ballRadius + AUX_REACH;
}

/**
 * Set the ball up as thrown / popped by slime `s`: sat on top of the dome,
 * launched straight up and tilted by the stick (`moveX`), plus some of the
 * slime's own motion. Shared by the world and the AI's throw planning.
 */
export function auxLaunch(
  s: Pick<SlimeBody, "x" | "y" | "vx" | "vy" | "char">,
  ball: Ball,
  ballRadius: number,
  moveX: number,
  aux: AuxAction,
): void {
  const R = s.char.radius;
  const off = Math.max(-R * 0.5, Math.min(R * 0.5, ball.x - s.x));
  ball.x = s.x + off;
  ball.y = s.y + Math.sqrt((R + ballRadius + 1) ** 2 - off * off);
  ball.vx = moveX * aux.aimSpeed + s.vx * 0.4;
  ball.vy = aux.launchSpeed + Math.max(0, s.vy) * 0.5;
}

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
  /** Slime movement rules for this match (defaults + mode overrides). */
  readonly physics: SlimePhysics;
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
  rally: RallyState = World.freshRally(null);
  /** Who is carrying the ball (grab sports), and for how long. */
  holder: Side | null = null;
  holdTime = 0;

  readonly ball: Ball = { x: 0, y: 0, vx: 0, vy: 0 };
  /** Visual spin angle (radians). */
  ballAngle = 0;
  readonly slimes: [SlimeBody, SlimeBody];
  /** Drained by the UI each frame (sounds, banners). */
  events: WorldEvent[] = [];

  private stall = 0;
  private ballOnFloor = false;
  /** The two slimes bumped this step. */
  private slimesTouching = false;
  private readonly prevAux: [boolean, boolean] = [false, false];
  private readonly auxCooldown: [number, number] = [0, 0];
  /** After an auto-throw the button must be released before grabbing again. */
  private readonly auxLocked: [boolean, boolean] = [false, false];
  private stallX = 0;
  private stallY = 0;
  private readonly stepOut: BallStepResult = { floor: false };
  private readonly contact: Contact = { nx: 0, ny: 0, depth: 0 };
  private readonly vel: Velocities = { bvx: 0, bvy: 0, svx: 0, svy: 0 };

  constructor(cfg: MatchConfig) {
    this.mode = cfg.mode;
    this.physics = { ...DEFAULT_SLIME_PHYSICS, ...cfg.mode.slimePhysics };
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
    return { side, char, x: 0, y: 0, vx: 0, vy: 0, grounded: true, onSlime: false, minX, maxX };
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
    this.rally = World.freshRally(this.mode);
    this.ballOnFloor = false;
    this.stall = 0;
    this.holder = null;
    this.holdTime = 0;
  }

  private static freshRally(mode: SlimeMode | null): RallyState {
    return {
      touches: [0, 0],
      streak: 0,
      lastTouch: null,
      bounces: 0,
      bouncesBySide: [0, 0],
      data: mode?.createRallyData?.() ?? {},
    };
  }

  step(intents: [Intent, Intent]): void {
    const dt = FIXED_DT;
    this.time += dt;
    this.phaseTime += dt;
    const [a, b] = this.slimes;

    for (const s of this.slimes) {
      if (this.phase !== "over") applyIntent(s, intents[s.side], dt, this.physics);
      else s.vx *= 0.9;
      if (this.holder === s.side) {
        const cap = s.char.maxSpeed * CARRY_SPEED;
        s.vx = Math.max(-cap, Math.min(cap, s.vx));
      }
      integrateSlime(s, dt, this.physics);
      this.mode.constrainSlime?.(s);
    }
    this.slimesTouching = collideSlimes(a, b, dt, this.physics);

    if (this.phase === "ready") {
      if (this.phaseTime >= READY_TIME) {
        this.phase = "play";
        this.phaseTime = 0;
      }
      return;
    }

    const ball = this.ball;
    const spec = this.mode.ball;
    const aux = this.mode.aux;
    if (aux) {
      this.updateAux(intents, aux);
      if (this.holder !== null && this.carry()) return;
    }
    const prevX = ball.x;
    const prevY = ball.y;
    const prevVy = ball.vy;
    stepBall(ball, spec, this.mode.arena, dt, this.ballSpeed, this.stepOut);
    if (this.stepOut.floor && prevVy < -250) {
      this.events.push({ type: "bounce", strength: Math.min(1, -prevVy / 1200) });
    }
    if (this.stepOut.floor && !this.ballOnFloor) {
      this.rally.bounces++;
      this.rally.bouncesBySide[ball.x < this.width / 2 ? 0 : 1]++;
    }
    this.ballOnFloor = this.stepOut.floor;

    let touching = false;
    let touchEvent: ScoreEvent | null = null;
    for (const s of this.slimes) {
      const impact = collideBallSlime(s, ball, spec, this.contact, this.vel);
      if (impact > 0) {
        if (this.registerTouch(s) && this.phase === "play") touchEvent ??= this.mode.onTouch?.(this, s.side) ?? null;
        if (impact > 120) this.events.push({ type: "hit", side: s.side, strength: Math.min(1, impact / 1200) });
      }
      if (impact > 0 || this.contactNow(s)) touching = true;
    }
    this.ballAngle -= (ball.vx * dt * this.ballSpeed) / spec.radius;

    if (this.phase === "play") {
      const ev = touchEvent ?? this.mode.checkRules({ world: this, ball, prevX, prevY, floor: this.stepOut.floor });
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

  /** Aux button: grab / carry / throw, or pop. Only during live play. */
  private updateAux(intents: [Intent, Intent], aux: AuxAction): void {
    const dt = FIXED_DT;
    for (const s of this.slimes) {
      const side = s.side;
      const pressed = intents[side].aux && this.phase === "play";
      const edge = pressed && !this.prevAux[side];
      this.prevAux[side] = pressed;
      if (!pressed) this.auxLocked[side] = false;
      this.auxCooldown[side] = Math.max(0, this.auxCooldown[side] - dt);
      const ready = this.auxCooldown[side] === 0 && !this.auxLocked[side];

      if (aux.kind === "grab") {
        if (this.holder === side) {
          this.holdTime += dt;
          const timeUp = this.holdTime >= (aux.maxHold ?? DEFAULT_MAX_HOLD);
          if (!pressed || timeUp) {
            if (timeUp) this.auxLocked[side] = true;
            this.launch(s, intents[side], aux);
          }
        } else if (this.holder === null && pressed && ready && this.inAuxReach(s)) {
          this.holder = side;
          this.holdTime = 0;
          this.registerTouch(s);
          this.events.push({ type: "grab", side });
        }
      } else if (edge && ready && this.inAuxReach(s)) {
        this.launch(s, intents[side], aux);
      }
    }
  }

  /** Can this slime reach the ball with its aux button right now? */
  inAuxReach(s: SlimeBody): boolean {
    return inAuxReach(s, this.ball, this.mode.ball.radius);
  }

  /** Throw / pop the ball straight up, tilted by the stick. */
  private launch(s: SlimeBody, intent: Intent, aux: AuxAction): void {
    auxLaunch(s, this.ball, this.mode.ball.radius, intent.moveX, aux);
    if (this.holder === s.side) this.holder = null;
    this.auxCooldown[s.side] = AUX_COOLDOWN;
    this.registerTouch(s);
    this.events.push({ type: "launch", side: s.side });
  }

  /**
   * Keep a held ball on its carrier's head. Returns true while it stays held
   * (the ball skips its own physics and the rules); false if the other slime
   * just knocked it loose, so this step's normal ball physics runs.
   */
  private carry(): boolean {
    const holder = this.holder!;
    const s = this.slimes[holder];
    const b = this.ball;
    b.x = s.x;
    b.y = s.y + s.char.radius + this.mode.ball.radius + 0.5;
    b.vx = s.vx;
    b.vy = s.vy;
    const thief = this.slimes[other(holder)];
    const touchedBall = slimeBallContact(thief, b, this.mode.ball.radius, this.contact);
    if (touchedBall || this.slimesTouching) {
      // Knocked loose: a bump on the carrier pops the ball up toward the thief.
      this.holder = null;
      this.auxCooldown[holder] = AUX_COOLDOWN;
      if (!touchedBall) {
        b.vx = Math.sign(thief.x - s.x) * FUMBLE_NUDGE + s.vx * 0.5;
        b.vy = FUMBLE_POP;
      }
      this.events.push({ type: "steal", side: thief.side });
      return false;
    }
    return true;
  }

  /** Update rally touch counters. Returns true if this began a new touch. */
  private registerTouch(s: SlimeBody): boolean {
    const r = this.rally;
    const last = r.lastTouch;
    const fresh = !last || last.side !== s.side || this.time - last.time > TOUCH_GAP;
    if (fresh) {
      r.touches[s.side]++;
      r.streak = last && last.side === s.side ? r.streak + 1 : 1;
      r.bounces = 0;
      r.bouncesBySide[0] = r.bouncesBySide[1] = 0;
    }
    // Updated in place: this runs every step while a ball rests on a head.
    if (!last) r.lastTouch = { side: s.side, x: s.x, y: s.y, time: this.time };
    else {
      last.side = s.side;
      last.x = s.x;
      last.y = s.y;
      last.time = this.time;
    }
    return fresh;
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
