import { describe, expect, it } from "vitest";
import { getCharacter } from "../characters";
import { basketball } from "../modes/basketball";
import {
  DEFAULT_SLIME_PHYSICS,
  FIXED_DT,
  applyIntent,
  ballSlimeImpulse,
  collideBallSlime,
  collideSlimes,
  integrateSlime,
  stepBall,
  type Ball,
  type SlimeBody,
  type Velocities,
} from "../physics";
import { idleIntent } from "../types";

function slime(id: string, x: number, y = 0, side: 0 | 1 = 0): SlimeBody {
  return { side, char: getCharacter(id), x, y, vx: 0, vy: 0, grounded: y === 0, onSlime: false, minX: 0, maxX: 1000 };
}

function stepSlimes(a: SlimeBody, b: SlimeBody, seconds: number): void {
  const idle = idleIntent();
  for (let t = 0; t < seconds; t += FIXED_DT) {
    for (const s of [a, b]) {
      applyIntent(s, idle, FIXED_DT, DEFAULT_SLIME_PHYSICS);
      integrateSlime(s, FIXED_DT, DEFAULT_SLIME_PHYSICS);
    }
    collideSlimes(a, b, FIXED_DT, DEFAULT_SLIME_PHYSICS);
  }
}

describe("ball ↔ slime impulse", () => {
  const hit = (e: number, minPop = 0): Velocities => {
    const v = { bvx: 0, bvy: -600, svx: 0, svy: 0 };
    ballSlimeImpulse(v, 0, 1, 1, 5, e, minPop);
    return v;
  };

  it("conserves momentum", () => {
    const v = { bvx: 300, bvy: -500, svx: -100, svy: 50 };
    const before = { x: 1 * v.bvx + 5 * v.svx, y: 1 * v.bvy + 5 * v.svy };
    ballSlimeImpulse(v, 0.6, 0.8, 1, 5, 0.5, 0);
    expect(1 * v.bvx + 5 * v.svx).toBeCloseTo(before.x, 6);
    expect(1 * v.bvy + 5 * v.svy).toBeCloseTo(before.y, 6);
  });

  it("restitution sets the separating speed (partially inelastic)", () => {
    for (const e of [0, 0.35, 0.8, 1]) {
      const v = hit(e);
      expect(v.bvy - v.svy).toBeCloseTo(600 * e, 6);
    }
  });

  it("enforces the minimum pop", () => {
    const v = hit(0, 420);
    expect(v.bvy - v.svy).toBeCloseTo(420, 6);
  });

  it("ignores bodies that are already separating", () => {
    const v = { bvx: 0, bvy: 300, svx: 0, svy: 0 };
    expect(ballSlimeImpulse(v, 0, 1, 1, 5, 0.5, 0)).toBe(false);
    expect(v.bvy).toBe(300);
  });

  it("heavier slimes flinch less when hit", () => {
    const light = { bvx: 0, bvy: -800, svx: 0, svy: 0 };
    const heavy = { ...light };
    ballSlimeImpulse(light, 0, 1, 1, getCharacter("zip").mass, 0.5, 0);
    ballSlimeImpulse(heavy, 0, 1, 1, getCharacter("tank").mass, 0.5, 0);
    expect(Math.abs(heavy.svy)).toBeLessThan(Math.abs(light.svy));
  });
});

describe("slime ↔ slime", () => {
  it("heavy slimes shove light ones", () => {
    const tank = slime("tank", 400);
    const zip = slime("zip", 400 + 66 + 38 - 10, 0, 1);
    tank.vx = 200;
    zip.vx = -200;
    collideSlimes(tank, zip, FIXED_DT, DEFAULT_SLIME_PHYSICS);
    expect(Math.abs(zip.vx - -200)).toBeGreaterThan(Math.abs(tank.vx - 200));
  });

  it("an off-centre slime slides off another's head", () => {
    const lower = slime("classic", 500);
    const upper = slime("classic", 520, 50, 1);
    stepSlimes(lower, upper, 1.5);
    expect(upper.y).toBe(0);
  });

  it("a slime can land on a head and jump off it", () => {
    const lower = slime("tank", 500);
    const upper = slime("zip", 500, 120, 1);
    upper.grounded = false;
    let stoodOnHead = false;
    for (let t = 0; t < 0.8 && !stoodOnHead; t += FIXED_DT) {
      stepSlimes(lower, upper, FIXED_DT);
      stoodOnHead = upper.grounded && upper.y > 50;
    }
    expect(stoodOnHead).toBe(true);
    // …and can take off from there.
    applyIntent(upper, { ...idleIntent(), jump: true }, FIXED_DT, DEFAULT_SLIME_PHYSICS);
    expect(upper.vy).toBeGreaterThan(500);
  });
});

describe("ball statics", () => {
  const spec = basketball.ball;
  const arena = basketball.arena;
  const run = (b: Ball, seconds: number) => {
    const out = { floor: false };
    let minY = Infinity;
    let maxY = -Infinity;
    for (let t = 0; t < seconds; t += FIXED_DT) {
      stepBall(b, spec, arena, FIXED_DT, 1, out);
      minY = Math.min(minY, b.y);
      maxY = Math.max(maxY, b.y);
    }
    return { minY, maxY };
  };

  it("a ball can't come up through the hoop from below", () => {
    const b: Ball = { x: 68, y: 200, vx: 0, vy: 900 };
    const { maxY } = run(b, 0.6);
    expect(maxY).toBeLessThanOrEqual(300 - spec.radius + 1e-6);
  });

  it("a ball dropped into the hoop falls through", () => {
    const b: Ball = { x: 68, y: 420, vx: 0, vy: 0 };
    const { minY } = run(b, 0.8);
    expect(minY).toBeLessThan(250);
  });
});

describe("ball pinned under a slime", () => {
  it("a slime landing on a grounded ball slides off instead of sitting on it", () => {
    const s = slime("tank", 500, 60);
    s.grounded = false;
    const ball: Ball = { x: 500, y: basketball.ball.radius, vx: 0, vy: 0 };
    const contact = { nx: 0, ny: 0, depth: 0 };
    const vel = { bvx: 0, bvy: 0, svx: 0, svy: 0 };
    const out = { floor: false };
    const idle = idleIntent();
    for (let t = 0; t < 1; t += FIXED_DT) {
      applyIntent(s, idle, FIXED_DT, DEFAULT_SLIME_PHYSICS);
      integrateSlime(s, FIXED_DT, DEFAULT_SLIME_PHYSICS);
      stepBall(ball, basketball.ball, basketball.arena, FIXED_DT, 1, out);
      collideBallSlime(s, ball, basketball.ball, contact, vel);
    }
    expect(s.y).toBe(0);
    expect(Math.abs(ball.x - s.x)).toBeGreaterThan(s.char.radius);
  });
});
