import type { Ball, SlimeBody } from "../physics";
import type { BallPath } from "../predict";
import { attackDir, other, type Side } from "../types";
import type { World } from "../world";
import { clamp, disc, type SlimeMode } from "./mode";

const W = 1000;
const H = 600;
const BOARD_X = 18;
const BOARD_R = 6;
/**
 * Hoop height is a balance: low enough that a jumping defender can get a
 * dome on a ball dropping toward the rim (the weakest jumper, Tank, reaches a
 * ball centre ~38 above it; Leafy ~110), high enough that nobody can just
 * stand under it.
 */
const RIM_Y = 190;
const BOARD_BOTTOM = RIM_Y - 50;
const BOARD_TOP = RIM_Y + 110;
/** The net hangs this far below the rim; slimes can't jump up through it. */
const NET_DEPTH = 46;
const RIM_FRONT = 100;
const RIM_R = 5;

/** Rim opening (ball-centre x range) for each hoop, by the side that *defends* it. */
const OPENING: [number, number][] = [
  [BOARD_X + BOARD_R, RIM_FRONT - RIM_R],
  [W - (RIM_FRONT - RIM_R), W - (BOARD_X + BOARD_R)],
];
const rimCentre = (defender: Side) => (OPENING[defender][0] + OPENING[defender][1]) / 2;
/** Shots released further than this from the target rim count for 3: your own half. */
const THREE_DIST = W / 2 - rimCentre(0);

/** Hoop geometry, for tests and tools. */
export const HOOP = { rimY: RIM_Y, netDepth: NET_DEPTH, rimFront: RIM_FRONT, opening: OPENING, rimCentre };

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
  arena: {
    width: W,
    height: H,
    statics: [...hoopStatics(false), ...hoopStatics(true)],
    // The net: a ball can drop through the hoop but never come up through it.
    platforms: OPENING.map(([x0, x1]) => ({ x0, x1, y: RIM_Y, restitution: 0.3 })),
  },
  theme: { skyTop: "#1c1530", skyBottom: "#3b2c5a", ground: "#c98a4b", groundLine: "#a46a33" },
  winScores: [11, 21, 31],
  aux: {
    kind: "grab",
    label: "GRAB",
    holdLabel: "THROW",
    launchSpeed: 1000,
    aimSpeed: 150,
    maxHold: 2.5,
    hint: "Hold GRAB to catch and carry the ball (you move slower), let go to toss it up — tilt the stick to lob it a little. Bump a carrier to steal!",
  },

  slimeRange: (_side, radius) => [radius, W - radius],
  startX: (side) => (side === 0 ? 260 : W - 260),
  constrainSlime(s: SlimeBody) {
    // Under the hoop the net is a ceiling: defend from in front of the rim,
    // not by poking up through the net.
    const R = s.char.radius;
    const underHoop = s.x - R * 0.5 < RIM_FRONT || s.x + R * 0.5 > W - RIM_FRONT;
    const netBottom = RIM_Y - NET_DEPTH;
    if (underHoop && s.y < netBottom && s.y + R > netBottom) {
      s.y = Math.max(0, netBottom - R);
      if (s.vy > 0) s.vy = 0;
    }
  },
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
    const t = world.rally.lastTouch;
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
      // A near miss only counts coming down from *above* the rim — a ball
      // bounced off the underside of the net is not a shot.
      if (path.vy[i] < 0 && path.y[i] >= RIM_Y) {
        best = Math.min(best, Math.hypot(path.x[i] - target, path.y[i] - RIM_Y));
      }
    }
    // Otherwise, aim to leave the ball at a good shooting spot in front of
    // their hoop — not jammed in the corner behind it.
    const sweet = target - attackDir(side) * 260;
    const position = 1 - Math.abs(path.x[path.length - 1] - sweet) / 500;
    const near = best === Infinity ? 0 : 1 - Math.min(1, best / 380);
    return clamp(near * 1.6 + position * 0.5, -1, 2);
  },
  homeX(world: World, side: Side) {
    const hoop = rimCentre(side);
    const ballInOurHalf = side === 0 ? world.ball.x < W / 2 : world.ball.x > W / 2;
    if (!ballInOurHalf) return hoop + (world.ball.x - hoop) * 0.5;
    // Guard the rim: stand just in front of it (not under the net), ready to
    // jump at a shot dropping toward the hoop.
    const R = world.slimes[side].char.radius;
    const guard = RIM_FRONT + R * 0.5 + 20;
    return side === 0 ? guard : W - guard;
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
        ctx.lineTo(bot, RIM_Y - NET_DEPTH);
        ctx.stroke();
      }
      for (let y = RIM_Y - 15; y > RIM_Y - NET_DEPTH; y -= 15) {
        const f = (RIM_Y - y) / NET_DEPTH;
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
