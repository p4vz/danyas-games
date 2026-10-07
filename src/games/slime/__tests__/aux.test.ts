import { describe, expect, it } from "vitest";
import { getCharacter } from "../characters";
import { basketball } from "../modes/basketball";
import type { SlimeMode } from "../modes/mode";
import { soccer } from "../modes/soccer";
import { volleyball } from "../modes/volleyball";
import { FIXED_DT } from "../physics";
import { idleIntent, type Intent } from "../types";
import { World } from "../world";

const blue = getCharacter("classic");

function playing(mode: SlimeMode): World {
  const w = new World({ mode, chars: [blue, getCharacter("ember")], ballSpeed: 1, winScore: 99, seed: 3 });
  w.phase = "play";
  return w;
}

/** Put the ball resting just above slime 0's dome. */
function ballOnHead(w: World): void {
  const s = w.slimes[0];
  w.ball.x = s.x;
  w.ball.y = s.y + s.char.radius + w.mode.ball.radius + 4;
  w.ball.vx = 0;
  w.ball.vy = 0;
}

const intents = (p0: Partial<Intent> = {}, p1: Partial<Intent> = {}): [Intent, Intent] => [
  { ...idleIntent(), ...p0 },
  { ...idleIntent(), ...p1 },
];

function run(w: World, seconds: number, input: [Intent, Intent]): void {
  for (let t = 0; t < seconds; t += FIXED_DT) w.step(input);
}

describe("pop (volleyball SET / soccer FLICK)", () => {
  it("tapping aux pops a ball on your head straight up", () => {
    const w = playing(volleyball);
    ballOnHead(w);
    w.step(intents({ aux: true }));
    expect(w.ball.vy).toBeGreaterThan(volleyball.aux!.launchSpeed * 0.95);
    expect(Math.abs(w.ball.vx)).toBeLessThan(20);
    expect(w.events.some((e) => e.type === "launch" && e.side === 0)).toBe(true);
    expect(w.rally.touches[0]).toBe(1);
  });

  it("the stick tilts the pop", () => {
    const w = playing(soccer);
    ballOnHead(w);
    w.step(intents({ aux: true, moveX: 1 }));
    expect(w.ball.vx).toBeGreaterThan(soccer.aux!.aimSpeed * 0.9);
  });

  it("does nothing when the ball is out of reach, and needs a fresh tap", () => {
    const w = playing(volleyball);
    w.ball.x = w.slimes[0].x + 200;
    w.ball.y = 300;
    w.step(intents({ aux: true }));
    expect(w.events.some((e) => e.type === "launch")).toBe(false);
    // Still holding the button as the ball arrives: no pop without a new press.
    ballOnHead(w);
    w.step(intents({ aux: true }));
    expect(w.events.some((e) => e.type === "launch")).toBe(false);
  });

  it("is ignored outside live play", () => {
    const w = playing(volleyball);
    w.phase = "ready";
    ballOnHead(w);
    w.step(intents({ aux: true }));
    expect(w.events.some((e) => e.type === "launch")).toBe(false);
  });
});

describe("grab (basketball)", () => {
  it("holding aux catches the ball and carries it on your head", () => {
    const w = playing(basketball);
    ballOnHead(w);
    w.step(intents({ aux: true }));
    expect(w.holder).toBe(0);
    run(w, 0.5, intents({ aux: true, moveX: 1 }));
    const s = w.slimes[0];
    expect(w.holder).toBe(0);
    expect(w.ball.x).toBeCloseTo(s.x, 6);
    expect(w.ball.y).toBeGreaterThan(s.y + s.char.radius);
  });

  it("letting go throws it up, aimed by the stick", () => {
    const w = playing(basketball);
    ballOnHead(w);
    run(w, 0.2, intents({ aux: true }));
    w.step(intents({ aux: false, moveX: -1 }));
    expect(w.holder).toBeNull();
    expect(w.ball.vy).toBeGreaterThan(basketball.aux!.launchSpeed * 0.9);
    expect(w.ball.vx).toBeLessThan(-basketball.aux!.aimSpeed * 0.9);
  });

  it("auto-throws after the max hold, and won't re-grab until released", () => {
    const w = playing(basketball);
    ballOnHead(w);
    let threw = false;
    for (let t = 0; t < basketball.aux!.maxHold! + 0.2; t += FIXED_DT) {
      w.step(intents({ aux: true }));
      threw ||= w.events.some((e) => e.type === "launch");
      w.events.length = 0;
    }
    expect(threw).toBe(true);
    // The ball comes back down onto the still-held button: no instant re-grab.
    run(w, 1.5, intents({ aux: true }));
    expect(w.holder).toBeNull();
  });

  it("the other slime can knock it loose", () => {
    const w = playing(basketball);
    ballOnHead(w);
    w.step(intents({ aux: true }));
    expect(w.holder).toBe(0);
    // Opponent jumps into the carried ball from the side.
    const thief = w.slimes[1];
    thief.x = w.slimes[0].x + 70;
    let stolen = false;
    for (let t = 0; t < 1 && !stolen; t += FIXED_DT) {
      w.step(intents({ aux: true }, { targetX: w.slimes[0].x, jump: true }));
      stolen = w.events.some((e) => e.type === "steal" && e.side === 1);
      w.events.length = 0;
    }
    expect(stolen).toBe(true);
    expect(w.holder).not.toBe(0);
  });

  it("the ball can't score while carried", () => {
    const w = playing(basketball);
    ballOnHead(w);
    run(w, 1, intents({ aux: true }));
    expect(w.phase).toBe("play");
    expect(w.scores).toEqual([0, 0]);
  });
});

it("sports without an aux action ignore the button", () => {
  const plain: SlimeMode = { ...soccer, id: "plain", aux: undefined };
  const w = playing(plain);
  ballOnHead(w);
  w.step(intents({ aux: true }));
  expect(w.holder).toBeNull();
  expect(w.events.some((e) => e.type === "launch" || e.type === "grab")).toBe(false);
});
