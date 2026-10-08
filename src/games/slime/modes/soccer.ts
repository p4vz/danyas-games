import { FIXED_DT, type Ball, type SlimeBody } from "../physics";
import type { BallPath } from "../predict";
import { attackDir, other, type Side } from "../types";
import type { World } from "../world";
import { clamp, disc, type SlimeMode } from "./mode";

const W = 1000;
const H = 520;
/** Goal depth (from each wall) and crossbar height. */
const GOAL_D = 72;
const BAR_Y = 150;
const BAR_R = 5;
/** Parked in your own goal this long (s) and the other side gets a goal. */
export const HANG_LIMIT = 4;
/** When the goal-hanging countdown shows over the slime. */
const HANG_WARN = 1.5;

/** Is this slime parked in its own goal mouth? */
function inOwnGoal(s: SlimeBody): boolean {
  return s.y < BAR_Y && (s.side === 0 ? s.x < GOAL_D : s.x > W - GOAL_D);
}

const HANG_KEYS = ["hang0", "hang1"] as const;

/** Which side scores if the ball centre is at (x, y)? */
function goalAt(x: number, y: number, r: number): Side | null {
  if (y >= BAR_Y) return null;
  if (x + r * 0.6 < GOAL_D) return 1; // in the left goal → right scores
  if (x - r * 0.6 > W - GOAL_D) return 0;
  return null;
}

export const soccer: SlimeMode = {
  id: "soccer",
  name: "Soccer",
  tagline: "Push, header, score.",
  howTo:
    "Get the ball into the goal on the other side. Defend your own — but no parking in it: stay in your own goal for 4 seconds and they get a goal!",
  accent: "#5be37d",
  ball: {
    radius: 15,
    mass: 1.2,
    gravity: 1500,
    groundRestitution: 0.6,
    wallRestitution: 0.65,
    rollFriction: 0.45,
    slimeRestitution: 0.95,
    minPop: 0,
    maxSpeed: 1500,
  },
  arena: {
    width: W,
    height: H,
    statics: [
      { ax: 0, ay: BAR_Y, bx: GOAL_D, by: BAR_Y, r: BAR_R, restitution: 0.5 },
      { ax: W - GOAL_D, ay: BAR_Y, bx: W, by: BAR_Y, r: BAR_R, restitution: 0.5 },
    ],
  },
  theme: { skyTop: "#123a6b", skyBottom: "#3d7fc0", ground: "#3fa34d", groundLine: "#2d7d39" },
  winScores: [3, 5, 9],
  timeLimits: [60, 120, 240],
  aux: {
    kind: "pop",
    label: "FLICK",
    launchSpeed: 780,
    aimSpeed: 260,
    hint: "FLICK pops the ball up off your head for a header.",
  },

  slimeRange: (_side, radius) => [radius, W - radius],
  startX: (side) => (side === 0 ? 260 : W - 260),
  constrainSlime(s: SlimeBody) {
    const R = s.char.radius;
    const inGoal = s.x < GOAL_D || s.x > W - GOAL_D;
    if (!inGoal) return;
    if (s.y < BAR_Y) {
      // Under the crossbar: it's a ceiling.
      const ceil = BAR_Y - BAR_R - R;
      if (s.y > ceil) {
        s.y = Math.max(0, ceil);
        if (s.vy > 0) s.vy = 0;
      }
    } else if (s.y < BAR_Y + BAR_R) {
      // Landing on top of the crossbar.
      s.y = BAR_Y + BAR_R;
      if (s.vy < 0) s.vy = 0;
      s.grounded = true;
    }
  },
  nextServer: () => null,
  serve(ball: Ball, _server, rng) {
    ball.x = W / 2;
    ball.y = 300;
    ball.vx = (rng() - 0.5) * 40;
    ball.vy = 0;
  },
  createRallyData: () => ({ hang0: 0, hang1: 0 }),
  checkRules({ world, ball }) {
    const scorer = goalAt(ball.x, ball.y, this.ball.radius);
    if (scorer !== null) return { scorer, points: 1, label: "GOAL!" };
    // No goal-hanging: camp in your own goal too long and it's their goal.
    const data = world.rally.data;
    for (const s of world.slimes) {
      const key = HANG_KEYS[s.side];
      data[key] = inOwnGoal(s) ? data[key] + FIXED_DT : 0;
      if (data[key] >= HANG_LIMIT) return { scorer: other(s.side), points: 1, label: "GOAL HANGING!" };
    }
    return null;
  },

  evaluate(path: BallPath, side: Side, _world: World) {
    const r = this.ball.radius;
    const t0 = path.t[0];
    for (let i = 1; i < path.length; i++) {
      const who = goalAt(path.x[i], path.y[i], r);
      if (who === side) return 3 - (path.t[i] - t0) * 0.4;
      if (who === other(side)) return -4;
    }
    const dir = attackDir(side);
    const last = path.length - 1;
    const end = (dir * (path.x[last] - W / 2)) / (W / 2); // −1 own goal … +1 their goal
    // Mean field position over the path: keep the ball away from our goal.
    let sum = 0;
    for (let i = 0; i < path.length; i += 8) sum += (dir * (path.x[i] - W / 2)) / (W / 2);
    const mean = sum / Math.ceil(path.length / 8);
    return clamp(end * 0.8 + mean * 0.6, -2, 2);
  },
  aiDefends: true,
  homeX(world: World, side: Side) {
    // Guard the goal from just outside it: no goal-hanging.
    const R = world.slimes[side].char.radius;
    const mouth = side === 0 ? GOAL_D + R * 0.3 : W - GOAL_D - R * 0.3;
    return mouth + (world.ball.x - mouth) * 0.45;
  },

  drawArena(ctx) {
    // Centre line + circle.
    ctx.fillStyle = "#ffffff55";
    ctx.fillRect(W / 2 - 2, -40, 4, 40);
    // Goal back mesh.
    for (const gx of [0, W - GOAL_D]) {
      ctx.fillStyle = "#ffffff18";
      ctx.fillRect(gx, 0, GOAL_D, BAR_Y);
    }
  },
  drawForeground(ctx, world) {
    // Goal-hanging countdown over a slime parked in its own goal.
    for (const s of world.slimes) {
      const t = world.rally.data[HANG_KEYS[s.side]] ?? 0;
      if (t < HANG_WARN || world.phase !== "play") continue;
      const left = 1 - (t - HANG_WARN) / (HANG_LIMIT - HANG_WARN);
      const y = s.y + s.char.radius + 30;
      ctx.lineWidth = 5;
      ctx.strokeStyle = "#00000055";
      ctx.beginPath();
      ctx.arc(s.x, y, 17, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#ff5a4f";
      ctx.beginPath();
      ctx.arc(s.x, y, 17, Math.PI / 2, Math.PI / 2 + left * Math.PI * 2);
      ctx.stroke();
    }
    for (const [gx, post] of [
      [0, GOAL_D],
      [W - GOAL_D, W - GOAL_D],
    ] as const) {
      ctx.strokeStyle = "#ffffff44";
      ctx.lineWidth = 1.5;
      for (let y = 18; y < BAR_Y; y += 18) {
        ctx.beginPath();
        ctx.moveTo(gx, y);
        ctx.lineTo(gx + GOAL_D, y);
        ctx.stroke();
      }
      for (let x = gx + 12; x < gx + GOAL_D; x += 14) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, BAR_Y);
        ctx.stroke();
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(gx, BAR_Y - BAR_R, GOAL_D, BAR_R * 2);
      ctx.fillRect(post - 3, 0, 6, BAR_Y);
    }
  },
  drawBall(ctx, x, y, r, angle) {
    disc(ctx, x, y, r, "#ffffff");
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();
    disc(ctx, 0, 0, r * 0.36, "#1a1a1a");
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      disc(ctx, Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95, r * 0.3, "#1a1a1a");
    }
    ctx.restore();
    ctx.strokeStyle = "#00000055";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  },
};
