import type { Ball } from "../physics";
import type { BallPath } from "../predict";
import { attackDir, other, type Side } from "../types";
import type { World } from "../world";
import { clamp, type SlimeMode } from "./mode";

const W = 1000;
const H = 460;
/** Goal depth (from each end board) and crossbar height. */
const GOAL_D = 56;
const BAR_Y = 120;
const BAR_R = 4;

/** Which side scores if the puck centre is at (x, y)? */
function goalAt(x: number, y: number, r: number): Side | null {
  if (y >= BAR_Y) return null;
  if (x + r * 0.6 < GOAL_D) return 1; // in the left goal → right scores
  if (x - r * 0.6 > W - GOAL_D) return 0;
  return null;
}

export const hockey: SlimeMode = {
  id: "hockey",
  name: "Hockey",
  tagline: "Slide, slap, score.",
  howTo:
    "Knock the puck into the goal on the other side. It's ice: you slide, so start and stop early! Slimes can't go in the goals.",
  accent: "#7fd3ff",
  ball: {
    radius: 11,
    mass: 0.9,
    gravity: 2200,
    groundRestitution: 0.2,
    wallRestitution: 0.8,
    rollFriction: 0.12,
    slimeRestitution: 0.4,
    minPop: 0,
    maxSpeed: 1700,
  },
  arena: {
    width: W,
    height: H,
    statics: [
      { ax: 0, ay: BAR_Y, bx: GOAL_D, by: BAR_Y, r: BAR_R, restitution: 0.4 },
      { ax: W - GOAL_D, ay: BAR_Y, bx: W, by: BAR_Y, r: BAR_R, restitution: 0.4 },
    ],
  },
  // Ice: little grip, so slimes take a while to get going and to stop.
  slimePhysics: { traction: 0.3, airControl: 0.5 },
  theme: { skyTop: "#14202e", skyBottom: "#33506b", ground: "#e9f5ff", groundLine: "#a9cde8" },
  winScores: [3, 5, 9],
  timeLimits: [60, 120, 240],
  aux: {
    kind: "shot",
    label: "SLAP",
    launchSpeed: 800,
    aimSpeed: 0,
    shotSpeed: 800,
    hint: "SLAP fires the puck at their goal when it's next to you — tilt the stick to shoot the other way.",
  },

  // Slimes stay out of the goals: no parking in front of the line.
  slimeRange: (_side, radius) => [GOAL_D + radius, W - GOAL_D - radius],
  startX: (side) => (side === 0 ? 170 : W - 170),
  nextServer: () => null,
  serve(ball: Ball, _server, rng) {
    // Face-off: dropped at centre ice.
    ball.x = W / 2;
    ball.y = 40;
    ball.vx = (rng() - 0.5) * 40;
    ball.vy = 0;
  },
  checkRules({ ball }) {
    const scorer = goalAt(ball.x, ball.y, this.ball.radius);
    return scorer === null ? null : { scorer, points: 1, label: "GOAL!" };
  },

  evaluate(path: BallPath, side: Side, world: World) {
    const r = this.ball.radius;
    const t0 = path.t[0];
    // Their slime, where it stands now: a shot straight into it is no shot.
    const o = world.slimes[other(side)];
    const block = o.char.radius + r;
    const dir = attackDir(side);
    let last = path.length - 1;
    for (let i = 1; i < path.length; i++) {
      const who = goalAt(path.x[i], path.y[i], r);
      if (who === side) return 3 - (path.t[i] - t0) * 0.4;
      if (who === other(side)) return -4;
      const dx = path.x[i] - o.x;
      if (dx * dir < 0 && Math.hypot(dx, path.y[i] - o.y) < block) {
        last = i; // stopped (the rest of the path is fiction)
        break;
      }
    }
    const end = (dir * (path.x[last] - W / 2)) / (W / 2); // −1 own goal … +1 their goal
    let sum = 0;
    let n = 0;
    for (let i = 0; i <= last; i += 8, n++) sum += (dir * (path.x[i] - W / 2)) / (W / 2);
    const mean = sum / n;
    // A puck still flying at their end at the horizon is a shot on goal.
    const pace = last === path.length - 1 ? clamp((dir * path.vx[last]) / 900, -1, 1) : 0;
    return clamp(end * 0.8 + mean * 0.6 + pace * 0.3, -2, 2);
  },
  aiDefends: true,
  homeX(world: World, side: Side) {
    // Guard the crease, drifting out toward the puck.
    const R = world.slimes[side].char.radius;
    const crease = side === 0 ? GOAL_D + R : W - GOAL_D - R;
    return crease + (world.ball.x - crease) * 0.15;
  },

  drawArena(ctx) {
    // Rink markings under the ice surface line: centre red line, blue lines.
    ctx.fillStyle = "#e0393e";
    ctx.fillRect(W / 2 - 3, -40, 6, 40);
    ctx.fillStyle = "#2f6fd6";
    for (const x of [W * 0.33, W * 0.67]) ctx.fillRect(x - 4, -40, 8, 40);
    // Goal lines + creases.
    ctx.fillStyle = "#e0393e";
    for (const x of [GOAL_D, W - GOAL_D]) ctx.fillRect(x - 1.5, -40, 3, 40);
    ctx.fillStyle = "#7fb8f055";
    ctx.fillRect(GOAL_D, -40, 70, 40);
    ctx.fillRect(W - GOAL_D - 70, -40, 70, 40);
    // Boards along the far side.
    ctx.fillStyle = "#ffffff10";
    ctx.fillRect(0, 0, W, 34);
    ctx.fillStyle = "#f2c94c66";
    ctx.fillRect(0, 32, W, 3);
    // Net backs.
    for (const gx of [0, W - GOAL_D]) {
      ctx.fillStyle = "#ffffff1c";
      ctx.fillRect(gx, 0, GOAL_D, BAR_Y);
    }
  },
  drawForeground(ctx) {
    for (const [gx, post] of [
      [0, GOAL_D],
      [W - GOAL_D, W - GOAL_D],
    ] as const) {
      ctx.strokeStyle = "#ffffff55";
      ctx.lineWidth = 1.2;
      for (let y = 14; y < BAR_Y; y += 14) {
        ctx.beginPath();
        ctx.moveTo(gx, y);
        ctx.lineTo(gx + GOAL_D, y);
        ctx.stroke();
      }
      for (let x = gx + 10; x < gx + GOAL_D; x += 12) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, BAR_Y);
        ctx.stroke();
      }
      ctx.fillStyle = "#e0393e";
      ctx.fillRect(gx, BAR_Y - BAR_R, GOAL_D, BAR_R * 2);
      ctx.fillRect(post - 3, 0, 6, BAR_Y);
    }
  },
  drawBall(ctx, x, y, r) {
    // A puck seen from the side: a short black cylinder resting on the ice.
    const top = y - r + r * 1.1;
    ctx.fillStyle = "#111418";
    ctx.beginPath();
    ctx.ellipse(x, y - r + r * 0.25, r * 1.2, r * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x - r * 1.2, y - r + r * 0.25, r * 2.4, r * 0.85);
    ctx.fillStyle = "#3a4048";
    ctx.beginPath();
    ctx.ellipse(x, top, r * 1.2, r * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
  },
};
