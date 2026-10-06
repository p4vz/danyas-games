import type { Ball } from "../physics";
import type { BallPath } from "../predict";
import { other, type Side } from "../types";
import type { World } from "../world";
import { clamp, disc, inOpponentHalf, type SlimeMode } from "./mode";

const W = 1000;
const H = 600;
const NET_X = W / 2;
const NET_H = 105;
const NET_R = 5;

export const volleyball: SlimeMode = {
  id: "volleyball",
  name: "Volleyball",
  tagline: "Keep it off your sand.",
  howTo: "Hit the ball over the net. If it lands on your side, they score.",
  accent: "#ffd23f",
  ball: {
    radius: 16,
    mass: 1,
    gravity: 1050,
    groundRestitution: 0.45,
    wallRestitution: 0.8,
    rollFriction: 2,
    slimeRestitution: 1.1,
    minPop: 420,
    maxSpeed: 1400,
  },
  arena: {
    width: W,
    height: H,
    statics: [{ ax: NET_X, ay: 0, bx: NET_X, by: NET_H, r: NET_R, restitution: 0.5 }],
  },
  theme: { skyTop: "#2b6cb8", skyBottom: "#8fd3ff", ground: "#e8c98a", groundLine: "#c9a463" },
  winScores: [7, 11, 15],
  floorEndsRally: true,
  aux: {
    kind: "pop",
    label: "SET",
    launchSpeed: 700,
    aimSpeed: 200,
    hint: "SET pops a ball off your head straight up — then spike it.",
  },

  slimeRange(side, radius) {
    return side === 0 ? [radius, NET_X - NET_R - radius] : [NET_X + NET_R + radius, W - radius];
  },
  startX: (side) => (side === 0 ? 200 : W - 200),
  nextServer: (scorer) => scorer ?? 0,
  serve(ball: Ball, server) {
    ball.x = server === 1 ? W - 200 : 200;
    ball.y = 360;
    ball.vx = 0;
    ball.vy = 0;
  },
  checkRules({ ball, floor }) {
    if (!floor) return null;
    const scorer: Side = ball.x < NET_X ? 1 : 0;
    return { scorer, points: 1, label: "POINT!" };
  },

  evaluate(path: BallPath, side: Side, world: World) {
    const r = this.ball.radius;
    const t0 = path.t[0];
    for (let i = 1; i < path.length; i++) {
      if (!path.floor[i] && path.y[i] > r + 0.5) continue;
      const lx = path.x[i];
      const t = path.t[i] - t0;
      if (!inOpponentHalf(lx, side, W)) return -1.5 - (1 - Math.min(t, 1));
      // Lands on their side: better the further it is from what they can reach.
      const o = world.slimes[other(side)];
      const reach = o.char.maxSpeed * t * 0.85 + o.char.radius * 0.6;
      const gap = Math.abs(lx - o.x) - reach;
      const spike = Math.min(1, Math.abs(path.vy[i]) / 1400);
      return 1 + clamp(gap / 250, -0.7, 1) + spike * 0.3;
    }
    const last = path.length - 1;
    return inOpponentHalf(path.x[last], side, W) ? 0.4 : -0.4;
  },
  homeX: (_world, side) => (side === 0 ? W * 0.26 : W * 0.74),

  drawArena(ctx) {
    // Net post + mesh.
    ctx.fillStyle = "#f4f4f4";
    ctx.fillRect(NET_X - NET_R, 0, NET_R * 2, NET_H);
    disc(ctx, NET_X, NET_H, NET_R + 1, "#ffffff");
    ctx.strokeStyle = "#00000022";
    ctx.lineWidth = 1;
    for (let y = 10; y < NET_H; y += 12) {
      ctx.beginPath();
      ctx.moveTo(NET_X - NET_R, y);
      ctx.lineTo(NET_X + NET_R, y);
      ctx.stroke();
    }
  },
  drawBall(ctx, x, y, r, angle) {
    disc(ctx, x, y, r, "#fff7d6");
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = "#e0a91f";
    ctx.lineWidth = r * 0.18;
    for (let k = 0; k < 3; k++) {
      ctx.rotate((Math.PI * 2) / 3);
      ctx.beginPath();
      ctx.arc(r * 0.9, 0, r * 0.95, Math.PI * 0.62, Math.PI * 1.38);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = "#00000040";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  },
};
