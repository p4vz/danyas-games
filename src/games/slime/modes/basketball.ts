import type { Ball } from "../physics";
import type { BallPath } from "../predict";
import { attackDir, other, type Side } from "../types";
import type { World } from "../world";
import { clamp, disc, type SlimeMode } from "./mode";

const W = 1000;
const H = 600;
const BOARD_X = 18;
const BOARD_R = 6;
const BOARD_BOTTOM = 250;
const BOARD_TOP = 410;
const RIM_Y = 300;
const RIM_FRONT = 118;
const RIM_R = 5;
/** Shots released further than this from the target rim count for 3. */
const THREE_DIST = 430;

/** Rim opening (ball-centre x range) for each hoop, by the side that *defends* it. */
const OPENING: [number, number][] = [
  [BOARD_X + BOARD_R, RIM_FRONT - RIM_R],
  [W - (RIM_FRONT - RIM_R), W - (BOARD_X + BOARD_R)],
];
const rimCentre = (defender: Side) => (OPENING[defender][0] + OPENING[defender][1]) / 2;

/** Side that scores if the ball moved down through a rim between two samples. */
function basketBetween(px: number, py: number, x: number, y: number): Side | null {
  if (!(py > RIM_Y && y <= RIM_Y)) return null;
  const k = (py - RIM_Y) / (py - y || 1);
  const cx = px + (x - px) * k;
  for (const defender of [0, 1] as const) {
    const [lo, hi] = OPENING[defender];
    if (cx > lo && cx < hi) return other(defender);
  }
  return null;
}

function hoopStatics(mirror: boolean) {
  const m = (x: number) => (mirror ? W - x : x);
  return [
    { ax: m(BOARD_X), ay: BOARD_BOTTOM, bx: m(BOARD_X), by: BOARD_TOP, r: BOARD_R, restitution: 0.55 },
    { ax: m(RIM_FRONT), ay: RIM_Y, bx: m(RIM_FRONT), by: RIM_Y, r: RIM_R, restitution: 0.45 },
  ];
}

export const basketball: SlimeMode = {
  id: "basketball",
  name: "Basketball",
  tagline: "Swish from downtown.",
  howTo: "Bounce the ball through the hoop on the other side. Shots from your own half count 3!",
  accent: "#ff8a3d",
  ball: {
    radius: 18,
    mass: 1.4,
    gravity: 1400,
    groundRestitution: 0.78,
    wallRestitution: 0.7,
    rollFriction: 0.6,
    slimeRestitution: 1.0,
    minPop: 220,
    maxSpeed: 1500,
  },
  arena: { width: W, height: H, statics: [...hoopStatics(false), ...hoopStatics(true)] },
  theme: { skyTop: "#1c1530", skyBottom: "#3b2c5a", ground: "#c98a4b", groundLine: "#a46a33" },
  winScores: [11, 21, 31],

  slimeRange: (_side, radius) => [radius, W - radius],
  startX: (side) => (side === 0 ? 260 : W - 260),
  nextServer: (scorer) => (scorer === null ? null : other(scorer)),
  serve(ball: Ball, server, rng) {
    ball.x = server === null ? W / 2 : server === 0 ? 300 : W - 300;
    ball.y = 340;
    ball.vx = server === null ? (rng() - 0.5) * 60 : 0;
    ball.vy = 0;
  },
  checkRules({ world, ball, prevX, prevY }) {
    const scorer = basketBetween(prevX, prevY, ball.x, ball.y);
    if (scorer === null) return null;
    const t = world.lastTouch;
    const three = t !== null && t.side === scorer && Math.abs(t.x - rimCentre(other(scorer))) > THREE_DIST;
    return { scorer, points: three ? 3 : 2, label: three ? "THREE!" : "SWISH!" };
  },

  evaluate(path: BallPath, side: Side, _world: World) {
    const t0 = path.t[0];
    const target = rimCentre(other(side));
    let best = Infinity;
    for (let i = 1; i < path.length; i++) {
      const who = basketBetween(path.x[i - 1], path.y[i - 1], path.x[i], path.y[i]);
      if (who === side) return 3.2 - (path.t[i] - t0) * 0.2;
      if (who === other(side)) return -4;
      if (path.vy[i] < 0 && path.y[i] > RIM_Y - 40) {
        best = Math.min(best, Math.hypot(path.x[i] - target, path.y[i] - RIM_Y));
      }
    }
    const last = path.length - 1;
    const progress = (attackDir(side) * (path.x[last] - W / 2)) / (W / 2);
    const near = best === Infinity ? 0 : 1 - Math.min(1, best / 380);
    return clamp(near * 1.6 + progress * 0.4, -1, 2);
  },
  homeX(world: World, side: Side) {
    const hoop = rimCentre(side);
    return hoop + (world.ball.x - hoop) * 0.5;
  },

  drawArena(ctx) {
    // Three-point marks (≈ half court).
    ctx.fillStyle = "#ffffff66";
    for (const d of [0, 1] as const) {
      const x = rimCentre(d) + (d === 0 ? THREE_DIST : -THREE_DIST);
      ctx.fillRect(x - 2, -40, 4, 40);
    }
    for (const mirror of [false, true]) {
      const m = (x: number) => (mirror ? W - x : x);
      // Pole + backboard.
      ctx.fillStyle = "#555a66";
      ctx.fillRect(Math.min(m(2), m(10)), 0, 8, BOARD_BOTTOM);
      ctx.fillStyle = "#f0f0f0";
      ctx.fillRect(m(BOARD_X) - BOARD_R, BOARD_BOTTOM, BOARD_R * 2, BOARD_TOP - BOARD_BOTTOM);
      ctx.strokeStyle = "#e0442b";
      ctx.lineWidth = 2;
      ctx.strokeRect(m(BOARD_X) - BOARD_R + 1, RIM_Y + 8, BOARD_R * 2 - 2, 40);
    }
  },
  drawForeground(ctx) {
    for (const mirror of [false, true]) {
      const m = (x: number) => (mirror ? W - x : x);
      const a = m(BOARD_X + BOARD_R);
      const b = m(RIM_FRONT);
      // Net.
      ctx.strokeStyle = "#ffffffaa";
      ctx.lineWidth = 1.5;
      const inset = (b - a) * 0.18;
      for (let k = 0; k <= 4; k++) {
        const top = a + ((b - a) * k) / 4;
        const bot = a + inset + ((b - a - 2 * inset) * k) / 4;
        ctx.beginPath();
        ctx.moveTo(top, RIM_Y);
        ctx.lineTo(bot, RIM_Y - 46);
        ctx.stroke();
      }
      for (let y = RIM_Y - 15; y > RIM_Y - 46; y -= 15) {
        const f = (RIM_Y - y) / 46;
        ctx.beginPath();
        ctx.moveTo(a + inset * f, y);
        ctx.lineTo(b - inset * f, y);
        ctx.stroke();
      }
      // Rim.
      ctx.strokeStyle = "#ff5a1f";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(a, RIM_Y);
      ctx.lineTo(b, RIM_Y);
      ctx.stroke();
      disc(ctx, b, RIM_Y, RIM_R, "#ff5a1f");
    }
  },
  drawBall(ctx, x, y, r, angle) {
    disc(ctx, x, y, r, "#f07a2a");
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeStyle = "#3a1d0a";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.lineTo(r, 0);
    ctx.moveTo(0, -r);
    ctx.lineTo(0, r);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-r * 1.25, 0, r * 0.95, -0.85, 0.85);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(r * 1.25, 0, r * 0.95, Math.PI - 0.85, Math.PI + 0.85);
    ctx.stroke();
    ctx.restore();
  },
};
