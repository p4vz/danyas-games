import { describe, expect, it } from "vitest";
import { AiController } from "../ai";
import { CHARACTERS, getCharacter } from "../characters";
import { runHeadlessMatch } from "../headless";
import { MODES } from "../modes";
import { basketball } from "../modes/basketball";
import { FIXED_DT } from "../physics";
import { idleIntent } from "../types";
import { World } from "../world";

/**
 * Seeded CPU-vs-CPU matches. Everything is deterministic, so these are stable
 * regression checks for physics + AI changes, not flaky statistics.
 */
describe.each(MODES.map((m) => [m.id, m] as const))("%s: Hard vs Easy", (_id, mode) => {
  const games = [0, 1, 2].map((g) =>
    runHeadlessMatch({
      mode,
      chars: [CHARACTERS[(g * 2) % CHARACTERS.length], CHARACTERS[(g * 3 + 1) % CHARACTERS.length]],
      difficulties: ["hard", "easy"],
      ballSpeed: [1, 1.25, 0.75][g],
      seed: 100 + g,
      maxSeconds: 600,
    }),
  );

  it("every match finishes with sane numbers", () => {
    for (const st of games) {
      expect(st.nan).toBe(false);
      expect(st.finished).toBe(true);
    }
  });

  it("the ball rarely gets stuck", () => {
    const rallies = games.reduce((n, st) => n + st.rallies, 0);
    const reserves = games.reduce((n, st) => n + st.reserves, 0);
    expect(reserves / (rallies + reserves)).toBeLessThan(0.12);
  });

  it("Hard beats Easy", () => {
    expect(games.filter((st) => st.winner === 0).length).toBeGreaterThanOrEqual(2);
  });

  it("both difficulties use jumps", () => {
    expect(games.reduce((n, st) => n + st.jumps[0], 0)).toBeGreaterThan(0);
    expect(games.reduce((n, st) => n + st.jumps[1], 0)).toBeGreaterThan(0);
  });
});

describe("basketball shooting", () => {
  it("an unguarded Hard CPU scores quickly", () => {
    const w = new World({
      mode: basketball,
      chars: [getCharacter("zip"), getCharacter("classic")],
      ballSpeed: 1,
      winScore: 999,
      seed: 7,
    });
    const ai = new AiController(0, "hard");
    // Opponent parked in the far corner, out of the way.
    const parked = { ...idleIntent(), targetX: 0 };
    let baskets = 0;
    for (let i = 0; i < 240 * 60; i++) {
      if (w.phase === "ready") w.slimes[1].x = w.slimes[1].minX;
      w.step([ai.getIntent(w), parked]);
      for (const e of w.events) if (e.type === "score" && e.score.scorer === 0) baskets++;
      w.events.length = 0;
    }
    expect(baskets).toBeGreaterThanOrEqual(5);
  });
});

describe("CPU and the GRAB button", () => {
  const unguarded = (difficulty: "hard" | "medium") => {
    const w = new World({
      mode: basketball,
      chars: [getCharacter("classic"), getCharacter("classic")],
      ballSpeed: 1,
      winScore: 999,
      seed: 11,
    });
    const ai = new AiController(0, difficulty);
    const parked = { ...idleIntent(), targetX: 0 };
    let grabs = 0;
    let throws = 0;
    let baskets = 0;
    for (let i = 0; i < 240 * 40; i++) {
      if (w.phase === "ready") w.slimes[1].x = w.slimes[1].minX;
      w.step([ai.getIntent(w), parked]);
      for (const e of w.events) {
        if (e.type === "grab" && e.side === 0) grabs++;
        if (e.type === "launch" && e.side === 0) throws++;
        if (e.type === "score" && e.score.scorer === 0) baskets++;
      }
      w.events.length = 0;
      expect(w.holdTime).toBeLessThanOrEqual(basketball.aux!.maxHold! + FIXED_DT);
    }
    return { grabs, throws, baskets };
  };

  it("Hard catches, carries and throws, and keeps scoring", () => {
    const r = unguarded("hard");
    expect(r.grabs).toBeGreaterThan(3);
    expect(r.throws).toBe(r.grabs);
    expect(r.baskets).toBeGreaterThanOrEqual(5);
  });

  it("a CPU defender goes after a carrier and steals the ball", () => {
    const w = new World({
      mode: basketball,
      chars: [getCharacter("classic"), getCharacter("classic")],
      ballSpeed: 1,
      winScore: 999,
      seed: 3,
    });
    w.phase = "play";
    const carrier = w.slimes[0];
    w.ball.x = carrier.x;
    w.ball.y = carrier.char.radius + basketball.ball.radius + 4;
    w.ball.vx = w.ball.vy = 0;
    const ai = new AiController(1, "hard");
    let stolen = false;
    for (let i = 0; i < 240 * 2.4 && !stolen; i++) {
      // A human carrier just standing there, holding GRAB.
      w.step([{ ...idleIntent(), aux: true }, ai.getIntent(w)]);
      stolen = w.events.some((e) => e.type === "steal" && e.side === 1);
      w.events.length = 0;
    }
    expect(stolen).toBe(true);
  });
});
