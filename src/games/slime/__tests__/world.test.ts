import { describe, expect, it } from "vitest";
import { AiController } from "../ai";
import { getCharacter } from "../characters";
import type { SlimeMode } from "../modes/mode";
import { soccer } from "../modes/soccer";
import { volleyball } from "../modes/volleyball";
import { FIXED_DT, jumpVelocity } from "../physics";
import { BallPath, predictBall } from "../predict";
import { idleIntent, other, type Intent } from "../types";
import { READY_TIME, World } from "../world";

const blue = getCharacter("classic");
const idle: [Intent, Intent] = [idleIntent(), idleIntent()];

function world(mode: SlimeMode, seed = 1): World {
  return new World({ mode, chars: [blue, getCharacter("ember")], ballSpeed: 1, winScore: 99, seed });
}

function snapshot(w: World) {
  return JSON.stringify({ b: w.ball, s: w.slimes.map((s) => [s.x, s.y, s.vx, s.vy]), sc: w.scores, t: w.time });
}

describe("determinism", () => {
  it("the same seed and inputs produce the exact same match", () => {
    const runs = [1, 2].map(() => {
      const w = world(soccer, 42);
      const ai = [new AiController(0, "hard"), new AiController(1, "medium")];
      for (let i = 0; i < 240 * 20; i++) w.step([ai[0].getIntent(w), ai[1].getIntent(w)]);
      return snapshot(w);
    });
    expect(runs[0]).toBe(runs[1]);
  });
});

describe("prediction", () => {
  it("the predictor matches the live simulation while nobody touches the ball", () => {
    const w = world(soccer);
    while (w.phase === "ready") w.step(idle);
    const path = predictBall(w.ball, soccer.ball, soccer.arena, w.ballSpeed, 1.5, new BallPath(400), 0, 1);
    for (let i = 1; i < path.length; i++) {
      w.step(idle);
      expect(w.ball.x).toBeCloseTo(path.x[i], 9);
      expect(w.ball.y).toBeCloseTo(path.y[i], 9);
    }
  });
});

describe("rally state", () => {
  it("counts each pop off a head as a separate touch", () => {
    // The volleyball serve drops onto the idle server's head and keeps popping.
    const w = world(volleyball);
    const server = w.server!;
    for (let i = 0; i < 240 * 2.5; i++) w.step(idle);
    expect(w.rally.touches[server]).toBeGreaterThanOrEqual(2);
    expect(w.rally.touches[other(server)]).toBe(0);
    expect(w.rally.streak).toBe(w.rally.touches[server]);
    expect(w.rally.bounces).toBe(0);
  });

  it("separates distinct touches from a ball resting on a head", () => {
    const w = world(soccer);
    w.ball.x = w.slimes[0].x;
    w.ball.y = blue.radius + soccer.ball.radius;
    w.phase = "play";
    for (let i = 0; i < 240 * 2; i++) w.step(idle);
    // Soccer has no min-pop: the ball settles on the head as one long touch.
    expect(w.rally.touches[0]).toBeLessThanOrEqual(3);
    expect(w.rally.lastTouch?.side).toBe(0);
  });

  it("resets every rally", () => {
    const w = world(volleyball);
    w.rally.touches[0] = 5;
    w.resetRally();
    expect(w.rally.touches).toEqual([0, 0]);
    expect(w.rally.bounces).toBe(0);
  });

  it("lets a mode write touch rules (a one-touch volleyball variant)", () => {
    const oneTouch: SlimeMode = {
      ...volleyball,
      id: "one-touch",
      createRallyData: () => ({ faults: 0 }),
      onTouch(w, side) {
        if (w.rally.streak < 2) return null;
        w.rally.data.faults++;
        return { scorer: other(side), points: 1, label: "TWO TOUCHES!" };
      },
    };
    // Serve drops on the idle server's head; the second bounce off it is a fault.
    const w = world(oneTouch);
    const server = w.server!;
    for (let i = 0; i < 240 * 5 && w.phase !== "scored"; i++) w.step(idle);
    expect(w.phase).toBe("scored");
    expect(w.lastScore?.label).toBe("TWO TOUCHES!");
    expect(w.lastScore?.scorer).toBe(other(server));
    expect(w.rally.data.faults).toBe(1);
  });

  it("counts floor bounces on each half since the last touch", () => {
    const w = world(soccer);
    w.ball.x = 800;
    w.ball.y = 200;
    w.slimes[1].x = 300; // keep everyone away from the ball
    w.phase = "play";
    for (let i = 0; i < 240 * 1.5; i++) w.step(idle);
    expect(w.rally.bounces).toBeGreaterThanOrEqual(2);
    expect(w.rally.bouncesBySide[1]).toBe(w.rally.bounces);
    expect(w.rally.bouncesBySide[0]).toBe(0);
  });
});

describe("mode-level slime physics", () => {
  const ice: SlimeMode = { ...soccer, id: "ice", slimePhysics: { traction: 0.15, gravity: 1200 } };

  it("merges overrides over the defaults", () => {
    const w = world(ice);
    expect(w.physics.traction).toBe(0.15);
    expect(w.physics.gravity).toBe(1200);
    expect(w.physics.airControl).toBe(0.7);
  });

  it("low traction makes slimes slow to start and slow to stop", () => {
    const timeToTopSpeed = (mode: SlimeMode) => {
      const w = world(mode);
      const run: [Intent, Intent] = [{ ...idleIntent(), moveX: 1 }, idleIntent()];
      let t = 0;
      while (w.slimes[0].vx < blue.maxSpeed * 0.99 && t < 5) {
        w.step(run);
        t += FIXED_DT;
      }
      return t;
    };
    expect(timeToTopSpeed(ice)).toBeGreaterThan(timeToTopSpeed(soccer) * 5);
  });

  it("gravity overrides change jump height", () => {
    const apex = (mode: SlimeMode) => {
      const w = world(mode);
      const jump: [Intent, Intent] = [{ ...idleIntent(), jump: true }, idleIntent()];
      let top = 0;
      for (let i = 0; i < 240 * 2; i++) {
        w.step(i === 0 ? jump : idle);
        top = Math.max(top, w.slimes[0].y);
      }
      return top;
    };
    const v = jumpVelocity(blue, 1);
    expect(apex(soccer)).toBeCloseTo((v * v) / (2 * 2400), -1);
    expect(apex(ice)).toBeCloseTo((v * v) / (2 * 1200), -1);
  });
});

describe("serve", () => {
  it("holds the ball for the ready time, then releases it", () => {
    const w = world(soccer);
    const y0 = w.ball.y;
    for (let t = 0; t < READY_TIME - 0.05; t += FIXED_DT) w.step(idle);
    expect(w.ball.y).toBe(y0);
    for (let t = 0; t < 0.3; t += FIXED_DT) w.step(idle);
    expect(w.ball.y).toBeLessThan(y0);
  });
});
