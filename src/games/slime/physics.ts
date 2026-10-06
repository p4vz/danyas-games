import type { SlimeCharacter } from "./characters";
import type { Intent, Side } from "./types";

/**
 * Pure physics for Slime Sports. Everything here operates on plain mutable
 * objects so the same functions drive the live simulation, the AI's
 * look-ahead predictor, and (later) rollback/lockstep netcode.
 *
 * World units, y-up, floor at y = 0. Fixed timestep.
 */

/** Simulation step (seconds). Small enough that a fast ball can't tunnel. */
export const FIXED_DT = 1 / 240;
export const SLIME_GRAVITY = 2400;
/** Sideways speed used to un-wedge a slime that lands on a grounded ball. */
const SQUIRT = 260;

// ---------------------------------------------------------------- bodies

export interface SlimeBody {
  side: Side;
  char: SlimeCharacter;
  /** Centre of the dome's flat base. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  /** Allowed range for `x` (already shrunk by the radius). */
  minX: number;
  maxX: number;
}

/**
 * The ball. Its velocity is stored in **ball-time** units: every step it
 * advances `dt × timeScale`. The ball-speed setting therefore plays the exact
 * same arcs faster or slower, without changing how hits feel.
 */
export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface BallSpec {
  radius: number;
  mass: number;
  gravity: number;
  /** Restitution against floor / walls / ceiling. */
  groundRestitution: number;
  wallRestitution: number;
  /** Exponential horizontal damping while rolling on the floor (1/s). */
  rollFriction: number;
  /** Multiplier on the slime's bounciness for ball↔slime hits. */
  slimeRestitution: number;
  /** Minimum separating speed after a slime hit (keeps volleys alive). */
  minPop: number;
  maxSpeed: number;
}

/** A static rounded segment (net, crossbar, backboard, rim…). */
export interface Capsule {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
  restitution: number;
}

export interface Arena {
  width: number;
  height: number;
  statics: Capsule[];
}

// ---------------------------------------------------------------- slimes

/** Take-off velocity for a given intent power. */
export function jumpVelocity(c: SlimeCharacter, power: number): number {
  return c.jump * Math.max(0.35, Math.min(1, power));
}

/**
 * Velocity that reaches `target` as fast as possible yet still stops on it
 * (bang-bang braking curve). Prevents overshoot when following a finger.
 */
function steerVelocity(dx: number, c: SlimeCharacter): number {
  const d = Math.abs(dx);
  if (d < 0.5) return 0;
  const v = Math.min(c.maxSpeed, Math.sqrt(2 * c.accel * d) * 0.92);
  return Math.sign(dx) * v;
}

export function applyIntent(s: SlimeBody, intent: Intent, dt: number): void {
  const c = s.char;
  const desired =
    intent.targetX !== null ? steerVelocity(intent.targetX - s.x, c) : intent.moveX * c.maxSpeed;
  // Reduced air control: you commit to a jump.
  const maxDv = c.accel * (s.grounded ? 1 : 0.7) * dt;
  const dv = desired - s.vx;
  s.vx += Math.max(-maxDv, Math.min(maxDv, dv));
  if (intent.jump && s.grounded) {
    s.vy = jumpVelocity(c, intent.jumpPower);
    s.grounded = false;
  }
}

export function integrateSlime(s: SlimeBody, dt: number): void {
  s.vy -= SLIME_GRAVITY * dt;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  s.grounded = false;
  if (s.y <= 0) {
    s.y = 0;
    if (s.vy < 0) s.vy = 0;
    s.grounded = true;
  }
  if (s.x < s.minX) {
    s.x = s.minX;
    if (s.vx < 0) s.vx = 0;
  } else if (s.x > s.maxX) {
    s.x = s.maxX;
    if (s.vx > 0) s.vx = 0;
  }
}

/**
 * Slime↔slime contact. Domes are semicircles, so we test the *lower* slime's
 * dome against the *upper* slime's flat base: side-by-side this degenerates to
 * a horizontal push, and one landing on another's head gets a vertical normal
 * (and may stand / jump off it). Partially inelastic, mass-weighted.
 */
export function collideSlimes(a: SlimeBody, b: SlimeBody): void {
  const up = a.y >= b.y ? a : b;
  const lo = up === a ? b : a;
  const R1 = up.char.radius;
  const R2 = lo.char.radius;
  const px = Math.max(up.x - R1, Math.min(up.x + R1, lo.x));
  const py = up.y;
  let dx = px - lo.x;
  let dy = py - lo.y;
  const d = Math.hypot(dx, dy);
  if (d >= R2) return;
  if (d < 1e-6) {
    dx = up.x >= lo.x ? 1 : -1;
    dy = 0;
  } else {
    dx /= d;
    dy /= d;
  }
  const depth = R2 - d;
  const invU = 1 / up.char.mass;
  const invL = 1 / lo.char.mass;
  const sum = invU + invL;

  // Horizontal correction is mass-weighted; vertical goes to the upper slime
  // (the lower one is usually on the floor).
  up.x += dx * depth * (invU / sum);
  lo.x -= dx * depth * (invL / sum);
  up.y += dy * depth;

  const rvn = (up.vx - lo.vx) * dx + (up.vy - lo.vy) * dy;
  if (rvn < 0) {
    const e = (up.char.bounce + lo.char.bounce) / 2;
    const j = (-(1 + e) * rvn) / sum;
    up.vx += j * dx * invU;
    up.vy += j * dy * invU;
    lo.vx -= j * dx * invL;
    if (!lo.grounded) lo.vy -= j * dy * invL;
  }
  if (dy > 0.6) {
    // Standing on the other slime's head.
    up.grounded = true;
    if (up.vy < lo.vy) up.vy = lo.vy;
  }
  for (const s of [up, lo]) {
    s.x = Math.max(s.minX, Math.min(s.maxX, s.x));
  }
}

// ---------------------------------------------------------------- ball

export interface BallStepResult {
  /** True if the ball touched the floor this step. */
  floor: boolean;
}

function capsuleClosest(c: Capsule, x: number, y: number): [number, number] {
  const ex = c.bx - c.ax;
  const ey = c.by - c.ay;
  const len2 = ex * ex + ey * ey;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - c.ax) * ex + (y - c.ay) * ey) / len2)) : 0;
  return [c.ax + ex * t, c.ay + ey * t];
}

/** Advance the ball one step against floor, walls, ceiling and statics. */
export function stepBall(
  b: Ball,
  spec: BallSpec,
  arena: Arena,
  dt: number,
  timeScale: number,
  out: BallStepResult,
): void {
  const h = dt * timeScale;
  const r = spec.radius;
  out.floor = false;

  b.vy -= spec.gravity * h;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > spec.maxSpeed) {
    const k = spec.maxSpeed / sp;
    b.vx *= k;
    b.vy *= k;
  }
  b.x += b.vx * h;
  b.y += b.vy * h;

  // Floor.
  if (b.y <= r) {
    b.y = r;
    out.floor = true;
    if (b.vy < 0) {
      b.vy = -b.vy * spec.groundRestitution;
      if (b.vy < 60) b.vy = 0;
    }
    b.vx *= Math.exp(-spec.rollFriction * h);
  }
  // Ceiling.
  if (b.y > arena.height - r) {
    b.y = arena.height - r;
    if (b.vy > 0) b.vy = -b.vy * spec.wallRestitution;
  }
  // Side walls.
  if (b.x < r) {
    b.x = r;
    if (b.vx < 0) b.vx = -b.vx * spec.wallRestitution;
  } else if (b.x > arena.width - r) {
    b.x = arena.width - r;
    if (b.vx > 0) b.vx = -b.vx * spec.wallRestitution;
  }
  // Static capsules.
  for (const c of arena.statics) {
    const [cx, cy] = capsuleClosest(c, b.x, b.y);
    let nx = b.x - cx;
    let ny = b.y - cy;
    const d = Math.hypot(nx, ny);
    const minD = r + c.r;
    if (d >= minD) continue;
    if (d < 1e-6) {
      nx = 0;
      ny = 1;
    } else {
      nx /= d;
      ny /= d;
    }
    b.x = cx + nx * minD;
    b.y = cy + ny * minD;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= (1 + c.restitution) * vn * nx;
      b.vy -= (1 + c.restitution) * vn * ny;
    }
  }
}

export interface Contact {
  nx: number;
  ny: number;
  depth: number;
}

/** Ball vs. slime dome (or its flat base when the ball is underneath). */
export function slimeBallContact(s: SlimeBody, b: Ball, r: number, out: Contact): boolean {
  const R = s.char.radius;
  let px: number;
  let py: number;
  let reach: number;
  if (b.y >= s.y) {
    px = s.x;
    py = s.y;
    reach = R + r;
  } else {
    px = Math.max(s.x - R, Math.min(s.x + R, b.x));
    py = s.y;
    reach = r;
  }
  const dx = b.x - px;
  const dy = b.y - py;
  const d = Math.hypot(dx, dy);
  if (d >= reach) return false;
  if (d < 1e-6) {
    out.nx = 0;
    out.ny = b.y >= s.y ? 1 : -1;
  } else {
    out.nx = dx / d;
    out.ny = dy / d;
  }
  out.depth = reach - d;
  return true;
}

export interface Velocities {
  bvx: number;
  bvy: number;
  svx: number;
  svy: number;
}

/**
 * Impulse exchange for a ball↔slime hit along normal n (slime → ball).
 * Shared by the simulation and the AI's "what if I hit it here?" search.
 * Returns false if the bodies are already separating.
 */
export function ballSlimeImpulse(
  v: Velocities,
  nx: number,
  ny: number,
  ballMass: number,
  slimeMass: number,
  e: number,
  minPop: number,
): boolean {
  const rvn = (v.bvx - v.svx) * nx + (v.bvy - v.svy) * ny;
  if (rvn >= 0) return false;
  const invB = 1 / ballMass;
  const invS = 1 / slimeMass;
  const j = (-(1 + e) * rvn) / (invB + invS);
  v.bvx += j * nx * invB;
  v.bvy += j * ny * invB;
  v.svx -= j * nx * invS;
  v.svy -= j * ny * invS;
  const sep = (v.bvx - v.svx) * nx + (v.bvy - v.svy) * ny;
  if (sep < minPop) {
    const add = minPop - sep;
    v.bvx += add * nx;
    v.bvy += add * ny;
  }
  return true;
}

export function ballSlimeRestitution(s: SlimeBody, spec: BallSpec): number {
  return Math.min(1, s.char.bounce * spec.slimeRestitution);
}

/** Resolve one ball↔slime collision in place. Returns impact speed (0 = none). */
export function collideBallSlime(s: SlimeBody, b: Ball, spec: BallSpec, scratch: Contact, v: Velocities): number {
  if (!slimeBallContact(s, b, spec.radius, scratch)) return 0;
  const { nx, ny, depth } = scratch;
  // Separate. The light ball moves — unless it's pinned on the floor and being
  // pushed down, in which case the slime is lifted off it instead.
  if (ny < 0 && b.y <= spec.radius + 0.5) {
    s.x -= nx * depth;
    s.y -= ny * depth;
    // A slime sitting on a floor-pinned ball would deadlock; make it slide
    // off and squeeze the ball out the other way, like a wet bar of soap.
    const away = Math.sign(s.x - b.x) || (s.side === 0 ? -1 : 1);
    if (s.vx * away < SQUIRT) s.vx = away * SQUIRT;
    if (b.vx * -away < SQUIRT) b.vx = -away * SQUIRT;
  } else {
    b.x += nx * depth;
    b.y += ny * depth;
  }
  v.bvx = b.vx;
  v.bvy = b.vy;
  v.svx = s.vx;
  v.svy = s.vy;
  const impact = -((v.bvx - v.svx) * nx + (v.bvy - v.svy) * ny);
  if (!ballSlimeImpulse(v, nx, ny, spec.mass, s.char.mass, ballSlimeRestitution(s, spec), spec.minPop)) {
    return 0;
  }
  b.vx = v.bvx;
  b.vy = v.bvy;
  s.vx = v.svx;
  if (!s.grounded || v.svy > 0) s.vy = v.svy;
  return impact;
}
