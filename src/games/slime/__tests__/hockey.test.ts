import { describe, expect, it } from "vitest";
import { AiController } from "../ai";
import { getCharacter } from "../characters";
import { hockey } from "../modes/hockey";
import { volleyball } from "../modes/volleyball";
import { FIXED_DT } from "../physics";
import { idleIntent, type Intent } from "../types";
import { World, inAuxReach } from "../world";

const classic = getCharacter("classic");

function playing(mode = hockey): World {
  const w = new World({ mode, chars: [classic, getCharacter("ember")], ballSpeed: 1, winScore: 99, seed: 4 });
  w.phase = "play";
  return w;
}

const intents = (p0: Partial<Intent> = {}, p1: Partial<Intent> = {}): [Intent, Intent] => [
  { ...idleIntent(), ...p0 },
  { ...idleIntent(), ...p1 },
];

/** Puck resting on the ice `dx` from slime 0's centre. */
function puckBeside(w: World, dx: number): void {
  const s = w.slimes[0];
  w.ball.x = s.x + dx;
  w.ball.y = hockey.ball.radius;
  w.ball.vx = 0;
  w.ball.vy = 0;
}

describe("hockey SLAP", () => {
  it("reaches a puck on the ice beside you (a pop couldn't)", () => {
    const w = playing();
    const s = w.slimes[0];
    puckBeside(w, s.char.radius + hockey.ball.radius + 10);
    expect(inAuxReach(s, w.ball, hockey.ball.radius, hockey.aux)).toBe(true);
    expect(inAuxReach(s, w.ball, hockey.ball.radius, volleyball.aux)).toBe(false);
  });

  it("fires the puck at their goal by default, and the stick turns it around", () => {
    const w = playing();
    const s = w.slimes[0];
    puckBeside(w, s.char.radius + 15);
    w.step(intents({ aux: true }));
    expect(w.events.some((e) => e.type === "launch" && e.side === 0)).toBe(true);
    expect(w.ball.vx).toBeGreaterThan(hockey.aux!.shotSpeed! * 0.9);
    expect(w.ball.vy).toBeGreaterThan(0);

    const back = playing();
    const b = back.slimes[0];
    back.ball.x = b.x - (b.char.radius + 15);
    back.ball.y = hockey.ball.radius;
    back.step(intents({ aux: true, moveX: -1 }));
    expect(back.ball.vx).toBeLessThan(-hockey.aux!.shotSpeed! * 0.9);
  });

  it("hooks a puck from behind up over your head", () => {
    const w = playing();
    const s = w.slimes[0];
    puckBeside(w, -(s.char.radius + 15)); // behind us (we attack to the right)
    w.step(intents({ aux: true }));
    expect(w.ball.vx).toBeGreaterThan(0);
    expect(w.ball.y).toBeGreaterThan(s.char.radius);
  });
});

describe("hockey rink", () => {
  it("slimes can't go into the goals", () => {
    const w = playing();
    for (let t = 0; t < 3; t += FIXED_DT) w.step(intents({ targetX: 0 }, { targetX: 1000 }));
    for (const s of w.slimes) {
      expect(s.x - s.char.radius).toBeGreaterThanOrEqual(50);
      expect(s.x + s.char.radius).toBeLessThanOrEqual(950);
    }
  });

  it("is ice: a slime slides on after you let go", () => {
    const glide = (mode: typeof hockey) => {
      const w = playing(mode);
      const s = w.slimes[0];
      s.x = 300;
      for (let t = 0; t < 1; t += FIXED_DT) w.step(intents({ moveX: 1, targetX: null }));
      const x0 = s.x;
      for (let t = 0; t < 1; t += FIXED_DT) w.step(intents({ moveX: 0, targetX: null }));
      return s.x - x0;
    };
    expect(glide(hockey)).toBeGreaterThan(glide({ ...hockey, slimePhysics: undefined }) + 50);
  });
});

describe("hockey CPU", () => {
  it("Hard drops back to guard its goal when the other slime will get there first", () => {
    const w = playing();
    const [me, them] = w.slimes;
    me.x = 420;
    them.x = 760;
    // Puck sliding gently toward them, deep in their end.
    w.ball.x = 700;
    w.ball.y = hockey.ball.radius;
    w.ball.vx = 60;
    const ai = new AiController(0, "hard");
    ai.getIntent(w);
    expect(ai.currentPlan?.kind).toBe("home");
    expect(ai.currentPlan!.targetX).toBeLessThan(me.x);
  });

  it("uses SLAP", () => {
    const w = new World({ mode: hockey, chars: [classic, classic], ballSpeed: 1, winScore: 99, seed: 8 });
    const ai = [new AiController(0, "hard"), new AiController(1, "medium")];
    let slaps = 0;
    for (let t = 0; t < 40; t += FIXED_DT) {
      w.step([ai[0].getIntent(w), ai[1].getIntent(w)]);
      slaps += w.events.filter((e) => e.type === "launch" && e.side === 0).length;
      w.events.length = 0;
    }
    expect(slaps).toBeGreaterThan(0);
  });
});

it("two slimes pressing aux on the same step: the nearer one gets the ball", () => {
  for (const nearer of [0, 1] as const) {
    const w = playing();
    const [a, b] = w.slimes;
    // Puck on the ice between them, a touch nearer one.
    a.x = 440;
    b.x = 560;
    w.ball.x = nearer === 0 ? 496 : 504;
    w.ball.y = hockey.ball.radius;
    w.ball.vx = w.ball.vy = 0;
    expect(w.inAuxReach(a) && w.inAuxReach(b)).toBe(true);
    w.step(intents({ aux: true }, { aux: true }));
    const launches = w.events.filter((e) => e.type === "launch");
    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({ side: nearer });
  }
});
