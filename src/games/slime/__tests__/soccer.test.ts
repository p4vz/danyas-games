import { describe, expect, it } from "vitest";
import { CHARACTERS, getCharacter } from "../characters";
import { runHeadlessMatch } from "../headless";
import { HANG_LIMIT, soccer } from "../modes/soccer";
import { FIXED_DT } from "../physics";
import { idleIntent, type Intent } from "../types";
import { World, type WorldEvent } from "../world";

const idle: [Intent, Intent] = [idleIntent(), idleIntent()];

function match(timeLimit?: number): World {
  return new World({
    mode: soccer,
    chars: [getCharacter("classic"), getCharacter("ember")],
    ballSpeed: 1,
    winScore: 3,
    timeLimit,
    seed: 2,
  });
}

/** Step until `pred`, collecting events; fails the test if it never happens. */
function runUntil(w: World, seconds: number, pred: () => boolean): WorldEvent[] {
  const seen: WorldEvent[] = [];
  for (let t = 0; t < seconds && !pred(); t += FIXED_DT) {
    w.step(idle);
    seen.push(...w.events);
    w.events.length = 0;
  }
  expect(pred()).toBe(true);
  return seen;
}

/** Keep the ball up out of everyone's way (hopping about, so it never counts as stuck). */
function parkBall(w: World): void {
  w.ball.x = w.ball.x === 400 ? 600 : 400;
  w.ball.y = 400;
  w.ball.vx = w.ball.vy = 0;
}

describe("timed matches", () => {
  it("the clock only runs during live play", () => {
    const w = match(30);
    expect(w.clock).toBe(30);
    w.step(idle); // serve countdown: still 30
    expect(w.clock).toBe(30);
    runUntil(w, 3, () => w.phase === "play");
    for (let t = 0; t < 1; t += FIXED_DT) {
      parkBall(w);
      w.step(idle);
    }
    expect(w.clock!).toBeCloseTo(29, 1);
  });

  it("whoever leads at the whistle wins", () => {
    const w = match(5);
    w.scores = [2, 1];
    runUntil(w, 3, () => w.phase === "play");
    const events = runUntil(w, 10, () => {
      parkBall(w);
      return w.phase === "over";
    });
    expect(w.winner).toBe(0);
    expect(events).toContainEqual({ type: "whistle", golden: false });
  });

  it("level at the whistle: golden goal, and the next goal wins", () => {
    const w = match(2);
    w.scores = [1, 1];
    runUntil(w, 3, () => w.phase === "play");
    const events = runUntil(w, 10, () => {
      parkBall(w);
      return w.goldenGoal;
    });
    expect(events).toContainEqual({ type: "whistle", golden: true });
    expect(w.phase).toBe("play");
    expect(w.winner).toBeNull();
    // Roll the ball into the left goal: side 1 scores and wins.
    w.ball.x = 30;
    w.ball.y = 20;
    w.step(idle);
    expect(w.scores).toEqual([1, 2]);
    expect(w.winner).toBe(1);
  });

  it("first-to-N is unaffected without a clock", () => {
    const w = match();
    expect(w.clock).toBeNull();
    w.scores = [2, 0];
    runUntil(w, 3, () => w.phase === "play");
    w.ball.x = 970;
    w.ball.y = 20;
    w.step(idle);
    expect(w.winner).toBe(0);
  });
});

describe("goal-hanging", () => {
  it(`camping in your own goal for ${HANG_LIMIT}s gives them a goal`, () => {
    const w = match();
    runUntil(w, 3, () => w.phase === "play");
    const s = w.slimes[0];
    const events = runUntil(w, HANG_LIMIT + 1, () => {
      s.x = s.minX; // parked deep in the left goal
      parkBall(w);
      return w.phase !== "play";
    });
    expect(w.scores).toEqual([0, 1]);
    const score = events.find((e) => e.type === "score");
    expect(score).toMatchObject({ score: { scorer: 1, label: "GOAL HANGING!" } });
  });

  it("stepping out resets the count", () => {
    const w = match();
    runUntil(w, 3, () => w.phase === "play");
    const s = w.slimes[0];
    for (let t = 0; t < HANG_LIMIT * 2; t += FIXED_DT) {
      // In the goal most of the time, popping out every couple of seconds.
      s.x = t % 2 < 1.8 ? s.minX : 300;
      parkBall(w);
      w.step(idle);
    }
    expect(w.phase).toBe("play");
    expect(w.scores).toEqual([0, 0]);
  });

  it("the CPU doesn't goal-hang", () => {
    for (let g = 0; g < 2; g++) {
      for (const d of ["hard", "medium"] as const) {
        const st = runHeadlessMatch({
          mode: { ...soccer, winScores: [9, 9, 9] },
          chars: [CHARACTERS[g * 2], CHARACTERS[g * 2 + 1]],
          difficulties: [d, d],
          seed: 30 + g,
          maxSeconds: 120,
        });
        expect(st.nan).toBe(false);
        expect(st.labels["GOAL HANGING!"] ?? 0).toBe(0);
      }
    }
  });
});
