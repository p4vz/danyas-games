import { describe, expect, it } from "vitest";
import { AiController } from "../ai";
import { CHARACTERS, getCharacter } from "../characters";
import { tennis } from "../modes/tennis";
import { FIXED_DT } from "../physics";
import { idleIntent, type Intent, type Side } from "../types";
import { World } from "../world";

const idle: [Intent, Intent] = [idleIntent(), idleIntent()];

function playing(): World {
  const w = new World({ mode: tennis, chars: [getCharacter("classic"), getCharacter("ember")], ballSpeed: 1, winScore: 99, seed: 5 });
  w.phase = "play";
  return w;
}

/** Score the rally as if `hitter` hit last and the ball then bounced on `halves` in order. */
function judge(hitter: Side, halves: Side[]) {
  const w = playing();
  w.rally.lastTouch = { side: hitter, x: 0, y: 0, time: 0 };
  for (const h of halves) {
    w.rally.bouncesBySide[h]++;
    w.rally.lastBounce = h;
    const ev = tennis.checkRules({ world: w, ball: w.ball, prevX: 0, prevY: 0, floor: true });
    if (ev) return ev;
  }
  return null;
}

describe("tennis rules", () => {
  it("two bounces in their court wins the point", () => {
    expect(judge(0, [1, 1])).toMatchObject({ scorer: 0, label: "POINT!" });
  });

  it("one bounce in their court is still live", () => {
    expect(judge(0, [1])).toBeNull();
  });

  it("a ball that lands in their court and skips back over untouched wins it", () => {
    expect(judge(0, [1, 0])).toMatchObject({ scorer: 0 });
  });

  it("your own shot may drop once on your side, but not twice", () => {
    expect(judge(0, [0])).toBeNull();
    expect(judge(0, [0, 0])).toMatchObject({ scorer: 1, label: "FAULT!" });
  });

  it("a shot that drops on your side, then carries over the net, is in play", () => {
    expect(judge(0, [0, 1])).toBeNull();
    expect(judge(0, [0, 1, 1])).toMatchObject({ scorer: 0 });
  });

  it("four touches in a row is a double hit", () => {
    const w = playing();
    const s = w.slimes[0];
    s.x = 250;
    let ev = null;
    // Keep popping the ball back up onto our own head.
    for (let i = 0; i < 4 && !ev; i++) {
      w.ball.x = s.x;
      w.ball.y = s.y + s.char.radius + tennis.ball.radius - 1;
      w.ball.vx = 0;
      w.ball.vy = -200;
      w.time += 1; // well apart: separate touches
      w.step(idle);
      ev = w.events.find((e) => e.type === "score") ?? null;
    }
    expect(w.rally.streak).toBe(4);
    expect(ev).toMatchObject({ type: "score", score: { scorer: 1, label: "DOUBLE HIT!" } });
  });
});

describe("rally speed-up", () => {
  it("the ball plays faster with every touch, up to the cap, and resets for the next rally", () => {
    const w = playing();
    expect(w.ballTimeScale).toBe(1);
    const up = tennis.speedUp!;
    w.rally.touches = [3, 2];
    w.rally.lastTouch = { side: 1, x: 0, y: 0, time: -1 };
    // Touch number six, by side 0.
    const s = w.slimes[0];
    w.ball.x = s.x;
    w.ball.y = s.y + s.char.radius + tennis.ball.radius - 1;
    w.ball.vy = -200;
    w.step(idle);
    expect(w.rally.speed).toBeCloseTo(1 + up.perTouch * 5, 9);
    expect(w.ballTimeScale).toBeCloseTo(1 + up.perTouch * 5, 9);
    w.rally.touches = [40, 40];
    w.rally.lastTouch.side = 1;
    w.rally.lastTouch.time = -1;
    w.ball.y = s.y + s.char.radius + tennis.ball.radius - 1;
    w.ball.vy = -200;
    w.step(idle);
    expect(w.ballTimeScale).toBe(up.max);
    w.resetRally();
    expect(w.ballTimeScale).toBe(1);
  });
});

describe("tennis CPU", () => {
  it("uses LOB to dig out balls it can't hit back over", () => {
    let pops = 0;
    for (let g = 0; g < 2; g++) {
      const w = new World({
        mode: tennis,
        chars: [CHARACTERS[g], CHARACTERS[g + 3]],
        ballSpeed: 1,
        winScore: 99,
        seed: 21 + g,
      });
      const ai = [new AiController(0, "hard"), new AiController(1, "medium")];
      for (let i = 0; i < 240 * 60; i++) {
        w.step([ai[0].getIntent(w), ai[1].getIntent(w)]);
        pops += w.events.filter((e) => e.type === "launch").length;
        w.events.length = 0;
      }
    }
    expect(pops).toBeGreaterThan(0);
  });

  it("wins points with shots the other side can't return, not just on their errors", () => {
    let winners = 0;
    for (let g = 0; g < 3; g++) {
      const w = new World({
        mode: tennis,
        chars: [CHARACTERS[g], CHARACTERS[g + 3]],
        ballSpeed: 1,
        winScore: 99,
        seed: 9 + g,
      });
      const ai = [new AiController(0, "hard"), new AiController(1, "easy")];
      for (let t = 0; t < 120; t += FIXED_DT) {
        w.step([ai[0].getIntent(w), ai[1].getIntent(w)]);
        for (const e of w.events) if (e.type === "score" && e.score.scorer === 0 && e.score.label === "POINT!") winners++;
        w.events.length = 0;
      }
    }
    expect(winners).toBeGreaterThanOrEqual(4);
  });
});
