import type { Ball } from "../physics";
import type { BallPath } from "../predict";
import { other, type Side } from "../types";
import type { World } from "../world";
import { clamp, disc, inOpponentHalf, type SlimeMode } from "./mode";

const W = 1000;
const H = 600;
const NET_X = W / 2;
const NET_H = 50;
const NET_R = 4;
/** Touches in a row allowed (like volleyball's three); the next is a fault. */
const MAX_STREAK = 3;
/** How high a slime can usefully play the ball (jump apex + dome + ball). */
const PLAYABLE_HEIGHT = 230;

export const tennis: SlimeMode = {
  id: "tennis",
  name: "Tennis",
  tagline: "One bounce, then hit it back.",
  howTo:
    "Hit the ball over the low net into their court. Volley it or let it bounce once — two bounces on your side and you lose the point. A shot that drops back on your side can be played again (three touches max).",
  accent: "#d9f24a",
  ball: {
    radius: 12,
    mass: 0.8,
    gravity: 1600,
    groundRestitution: 0.82,
    wallRestitution: 0.75,
    rollFriction: 0.8,
    slimeRestitution: 1.05,
    // A firm minimum pop so even a low, skidding ball can be lifted back
    // over the net.
    minPop: 800,
    maxSpeed: 1800,
  },
  arena: {
    width: W,
    height: H,
    statics: [{ ax: NET_X, ay: 0, bx: NET_X, by: NET_H, r: NET_R, restitution: 0.35 }],
  },
  theme: { skyTop: "#3b7dd8", skyBottom: "#a6dcff", ground: "#3f8f5a", groundLine: "#2e6e44" },
  winScores: [7, 11, 15],
  /** Bounces allowed on your side before you must have hit it. */
  bouncesAllowed: 1,
  speedUp: { perTouch: 0.05, max: 1.8 },
  aux: {
    kind: "pop",
    label: "LOB",
    launchSpeed: 760,
    aimSpeed: 300,
    hint: "LOB pops the ball up off your head — tilt the stick to lob it over, or pop it to yourself and smash.",
  },

  slimeRange(side, radius) {
    return side === 0 ? [radius, NET_X - NET_R - radius] : [NET_X + NET_R + radius, W - radius];
  },
  startX: (side) => (side === 0 ? 200 : W - 200),
  nextServer: (scorer) => scorer ?? 0,
  serve(ball: Ball, server) {
    ball.x = server === 1 ? W - 200 : 200;
    ball.y = 330;
    ball.vx = 0;
    ball.vy = 0;
  },
  checkRules({ world }) {
    const r = world.rally;
    const hitter: Side = r.lastTouch?.side ?? world.server ?? 0;
    const receiver = other(hitter);
    // It landed in their court and they didn't get it back: a second bounce,
    // or it skipped back over the net untouched.
    if (r.bouncesBySide[receiver] >= 2 || (r.bouncesBySide[receiver] >= 1 && r.lastBounce === hitter)) {
      return { scorer: hitter, points: 1, label: "POINT!" };
    }
    // Your own shot may drop once on your side (play it again!), not twice.
    if (r.bouncesBySide[hitter] >= 2) return { scorer: receiver, points: 1, label: "FAULT!" };
    return null;
  },
  onTouch(world, side) {
    if (world.rally.streak > MAX_STREAK) return { scorer: other(side), points: 1, label: "DOUBLE HIT!" };
    return null;
  },

  evaluate(path: BallPath, side: Side, world: World) {
    const t0 = path.t[0];
    const opp = world.slimes[other(side)];
    const r = world.rally;
    // Touches in a row we'll have used once this hit lands.
    const used = (r.lastTouch?.side === side ? r.streak : 0) + 1;
    if (used > MAX_STREAK) return -3; // this touch is itself a double hit
    let own = 0;
    let first = -1;
    let end = path.length - 1;
    for (let i = 1; i < path.length; i++) {
      if (!path.floor[i]) continue;
      if (!inOpponentHalf(path.x[i], side, W)) {
        // Back on our side after landing in theirs: they missed it.
        if (first >= 0) {
          end = i;
          break;
        }
        // Dropping in our own court once is legal, but we must play it
        // again — twice (or with no touches left) is a fault.
        if (++own >= 2 || used >= MAX_STREAK) return -2 - (1 - Math.min(path.t[i] - t0, 1));
      } else if (first < 0) {
        first = i;
      } else {
        end = i;
        break;
      }
    }
    const last = path.length - 1;
    if (first < 0) {
      if (own > 0) return -0.8; // our own mess to clean up
      return inOpponentHalf(path.x[last], side, W) ? 0.3 : -0.5;
    }
    // Could they get a dome on it — volley or after the bounce — before the
    // second bounce? Bigger margin = less returnable.
    let margin = Infinity;
    for (let i = 1; i <= end; i++) {
      if (!inOpponentHalf(path.x[i], side, W) || path.y[i] > PLAYABLE_HEIGHT) continue;
      const reach = opp.char.maxSpeed * (path.t[i] - t0) * 0.85 + opp.char.radius;
      margin = Math.min(margin, Math.abs(path.x[i] - opp.x) - reach);
    }
    const pace = Math.min(1, Math.abs(path.vx[first]) / 900);
    const score = 1 + clamp((margin === Infinity ? 400 : margin) / 200, -0.6, 1.2) + pace * 0.3;
    return own > 0 ? score - 0.4 : score;
  },
  homeX: (_world, side) => (side === 0 ? W * 0.27 : W * 0.73),

  drawArena(ctx) {
    // Court lines on the floor band.
    ctx.fillStyle = "#ffffffcc";
    for (const x of [6, W * 0.25, W * 0.75, W - 10]) ctx.fillRect(x - 2, -40, 4, 40);
    // Net post + band.
    ctx.fillStyle = "#e8e8e8";
    ctx.fillRect(NET_X - NET_R, 0, NET_R * 2, NET_H);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(NET_X - NET_R - 2, NET_H - 6, NET_R * 2 + 4, 8);
  },
  drawForeground(ctx) {
    ctx.strokeStyle = "#00000044";
    ctx.lineWidth = 1;
    for (let y = 8; y < NET_H - 6; y += 9) {
      ctx.beginPath();
      ctx.moveTo(NET_X - NET_R, y);
      ctx.lineTo(NET_X + NET_R, y);
      ctx.stroke();
    }
  },
  drawBall(ctx, x, y, r, angle) {
    disc(ctx, x, y, r, "#d9f24a");
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeStyle = "#ffffffdd";
    ctx.lineWidth = r * 0.18;
    ctx.beginPath();
    ctx.arc(-r * 1.1, 0, r * 0.85, -0.9, 0.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(r * 1.1, 0, r * 0.85, Math.PI - 0.9, Math.PI + 0.9);
    ctx.stroke();
    ctx.restore();
  },
};
