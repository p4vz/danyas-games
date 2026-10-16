import { describe, expect, it } from "vitest";
import {
  BASE_DAMAGE,
  DT,
  FUEL,
  IDLE,
  Match,
  START_HP,
  TANK_MID,
  type MatchConfig,
  type TurnInput,
} from "../match";
import { AIR, DIRT, H, STONE, Terrain, W, WALL_OFFSET, generateTerrain, spawnColumns } from "../terrain";

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, color: "#ff0000" }));

function config(over: Partial<MatchConfig> = {}): MatchConfig {
  return { players: players(2), seed: 7, movement: true, castles: false, wind: 0, crateEvery: 0, turnTime: 0, ...over };
}

const input = (over: Partial<TurnInput>): TurnInput => ({ ...IDLE, ...over });

/** Step until `done` or the time budget runs out. */
function run(m: Match, seconds: number, inp: (m: Match) => TurnInput = () => IDLE, done?: (m: Match) => boolean): void {
  for (let i = 0; i < seconds / DT; i++) {
    if (done?.(m)) return;
    m.step(inp(m));
  }
}

const waitForAim = (m: Match) => run(m, 5, undefined, (mm) => mm.canAct);

/** Drop a shell straight down onto a point, as if someone had shot it there. */
function dropShellOn(m: Match, x: number, y: number, owner = m.current): void {
  m.shell = { x, y: y - 3, vx: 0, vy: 50, owner, age: 1 };
  m.phase = "flight";
  m.phaseTime = 0;
}

describe("terrain", () => {
  it("generates the same map for the same seed", () => {
    const a = generateTerrain(3, 3, true);
    const b = generateTerrain(3, 3, true);
    expect(Buffer.from(a.cells).equals(Buffer.from(b.cells))).toBe(true);
  });

  it("gives every tank a flat pad and walls when castles are on", () => {
    const t = generateTerrain(11, 3, true);
    for (const x of spawnColumns(3)) {
      const y = t.surfaceBelow(x);
      expect(Math.abs(t.surfaceBelow(x - 10) - y)).toBeLessThanOrEqual(1);
      expect(Math.abs(t.surfaceBelow(x + 10) - y)).toBeLessThanOrEqual(1);
    }
    expect(t.cells.includes(STONE)).toBe(true);
    expect(generateTerrain(11, 3, false).cells.includes(STONE)).toBe(false);
  });

  it("craters dirt fully but stone only near the centre", () => {
    const t = new Terrain();
    t.fillRect(0, 500, W, H, DIRT);
    t.fillRect(400, 500, 500, H, STONE);
    t.carve(200, 500, 30);
    t.carve(450, 500, 30);
    expect(t.get(200, 520)).toBe(AIR);
    expect(t.get(450, 505)).toBe(AIR);
    expect(t.get(450, 525)).toBe(STONE);
  });
});

describe("match", () => {
  it("is deterministic for the same seed and inputs", () => {
    const script = (m: Match): TurnInput => {
      const k = Math.floor(m.time * 2) % 4;
      return input({ move: k === 0 ? 1 : 0, aim: k === 1 ? 1 : 0, fire: m.canAct && m.phaseTime > 1.5 ? 0.6 : null });
    };
    const snaps = [1, 2].map(() => {
      const m = new Match(config({ players: players(3), wind: 80, crateEvery: 3, castles: true }));
      run(m, 40, script);
      return JSON.stringify(m.snapshot());
    });
    expect(snaps[0]).toBe(snaps[1]);
  });

  it("restores from a snapshot and carries on identically", () => {
    const cfg = config({ wind: 60, crateEvery: 4, castles: true });
    const script = (m: Match) => input({ aim: 1, fire: m.canAct && m.phaseTime > 1 ? 0.5 : null });
    const a = new Match(cfg);
    run(a, 12, script);
    const b = Match.restore(cfg, a.snapshot());
    expect(Buffer.from(b.terrain.cells).equals(Buffer.from(a.terrain.cells))).toBe(true);
    run(a, 15, script);
    run(b, 15, script);
    expect(JSON.stringify(b.snapshot())).toBe(JSON.stringify(a.snapshot()));
  });

  it("only lets the active player act after the turn intro", () => {
    const m = new Match(config());
    const before = m.active.elev;
    m.step(input({ aim: 1 }));
    expect(m.active.elev).toBe(before);
    waitForAim(m);
    run(m, 0.5, () => input({ aim: 1 }));
    expect(m.active.elev).toBeGreaterThan(before);
  });

  it("a shell fired off the map ends the turn and passes to the next player", () => {
    const m = new Match(config());
    waitForAim(m);
    const first = m.current;
    // Point straight up at full power with a gale: it lands off the map.
    m.wind = 2000;
    m.active.elev = 90;
    m.step(input({ fire: 1 }));
    expect(m.phase).toBe("flight");
    run(m, 10, undefined, (mm) => mm.phase === "aim");
    expect(m.current).toBe(1 - first);
  });

  it("a direct hit deals full damage, scaled by attack upgrades", () => {
    const m = new Match(config());
    waitForAim(m);
    const enemy = 1 - m.current;
    const t = m.tanks[enemy];
    dropShellOn(m, t.x, t.y - TANK_MID);
    m.step(IDLE);
    expect(t.hp).toBe(START_HP - BASE_DAMAGE);

    const m2 = new Match(config());
    waitForAim(m2);
    m2.active.ups.attack = 2;
    const t2 = m2.tanks[1 - m2.current];
    dropShellOn(m2, t2.x, t2.y - TANK_MID);
    m2.step(IDLE);
    expect(t2.hp).toBe(START_HP - Math.round(BASE_DAMAGE * 1.5));
  });

  it("splash damage fades with distance", () => {
    const m = new Match(config());
    waitForAim(m);
    const t = m.tanks[1 - m.current];
    dropShellOn(m, t.x + 30, m.terrain.surfaceBelow(t.x + 30));
    run(m, 0.1);
    expect(t.hp).toBeLessThan(START_HP);
    expect(t.hp).toBeGreaterThan(START_HP - BASE_DAMAGE);
  });

  it("tanks fall into craters and the last tank standing wins", () => {
    const m = new Match(config());
    waitForAim(m);
    const shooter = m.current;
    const enemy = 1 - shooter;
    const t = m.tanks[enemy];
    const y0 = t.y;
    m.terrain.carve(t.x, t.y + 20, 40);
    run(m, 2, undefined, () => !t.falling && t.y > y0);
    expect(t.y).toBeGreaterThan(y0);

    t.hp = 5;
    dropShellOn(m, t.x, t.y - TANK_MID);
    run(m, 5, undefined, (mm) => mm.phase === "over");
    expect(t.alive).toBe(false);
    expect(m.phase).toBe("over");
    expect(m.winner).toBe(shooter);
  });

  it("skips dead players in the turn order", () => {
    const m = new Match(config({ players: players(3) }));
    waitForAim(m);
    const next = (m.current + 1) % 3;
    m.tanks[next].alive = false;
    m.step(input({ fire: 0.05 }));
    run(m, 10, undefined, (mm) => mm.phase === "aim" && mm.turn === 1);
    expect(m.current).toBe((next + 1) % 3);
  });

  it("driving uses fuel, is capped per turn, and is disabled when movement is off", () => {
    const m = new Match(config());
    waitForAim(m);
    const t = m.active;
    const dir = t.x < W / 2 ? 1 : -1;
    const x0 = t.x;
    run(m, 30, () => input({ move: dir as 1 | -1 }));
    expect(t.fuel).toBeLessThanOrEqual(0.001);
    expect(Math.abs(t.x - x0)).toBeLessThanOrEqual(FUEL + 0.01);
    expect(Math.abs(t.x - x0)).toBeGreaterThan(5);

    const still = new Match(config({ movement: false }));
    waitForAim(still);
    const sx = still.active.x;
    run(still, 2, () => input({ move: 1 }));
    expect(still.active.x).toBe(sx);
  });

  it("castle walls stop a tank driving through them", () => {
    const m = new Match(config({ castles: true }));
    waitForAim(m);
    const t = m.active;
    const dir = t.x < W / 2 ? 1 : -1;
    const x0 = t.x;
    run(m, 30, () => input({ move: dir as 1 | -1 }));
    expect(Math.abs(t.x - x0)).toBeLessThan(WALL_OFFSET);
    expect(t.fuel).toBeGreaterThan(0);
  });

  it("the turn timer passes the turn, or fires a held shot", () => {
    const m = new Match(config({ turnTime: 2 }));
    waitForAim(m);
    const first = m.current;
    run(m, 2.5, undefined, (mm) => mm.current !== first);
    expect(m.current).toBe(1 - first);

    waitForAim(m);
    run(m, 2.5, () => input({ charge: 0.4 }), (mm) => mm.phase !== "aim");
    expect(m.phase).toBe("flight");
    expect(m.active.lastPower).toBeCloseTo(0.4);
  });

  it("drops crates over time and tanks collect them", () => {
    const m = new Match(config({ crateEvery: 2 }));
    waitForAim(m);
    run(m, 4, undefined, (mm) => mm.crates.length > 0);
    expect(m.crates.length).toBe(1);
    const c = m.crates[0];
    run(m, 20, undefined, () => c.landed);
    expect(c.landed).toBe(true);

    // Put the crate just ahead of the active tank and drive into it.
    const t = m.active;
    const kind = c.kind;
    const dir = t.x < W / 2 ? 1 : -1;
    c.x = t.x + dir * 36;
    c.y = m.terrain.surfaceBelow(c.x);
    run(m, 3, () => input({ move: dir as 1 | -1 }), (mm) => !mm.crates.includes(c));
    expect(m.crates.includes(c)).toBe(false);
    expect(t.ups[kind]).toBe(1);
  });

  it("the shooter collects a crate caught in their blast", () => {
    const m = new Match(config({ crateEvery: 1 }));
    waitForAim(m);
    run(m, 3, undefined, (mm) => mm.crates.length > 0);
    const c = m.crates[0];
    run(m, 20, undefined, () => c.landed);
    const shooter = m.current;
    dropShellOn(m, c.x + 20, m.terrain.surfaceBelow(c.x + 20));
    run(m, 1, undefined, (mm) => mm.phase !== "flight");
    expect(m.crates.includes(c)).toBe(false);
    expect(m.tanks[shooter].ups[c.kind]).toBe(1);
  });

  it("health crates heal and raise max HP", () => {
    const m = new Match(config({ crateEvery: 1 }));
    waitForAim(m);
    run(m, 3, undefined, (mm) => mm.crates.length > 0);
    const c = m.crates[0];
    c.kind = "health";
    run(m, 20, undefined, () => c.landed);
    const t = m.active;
    t.hp = 50;
    dropShellOn(m, c.x, c.y - 40);
    m.shell!.y = c.y - 12;
    m.step(IDLE);
    expect(t.maxHp).toBe(START_HP + 15);
    expect(t.hp).toBeGreaterThanOrEqual(50 + 35 - BASE_DAMAGE);
  });

  it("a low shot clears your own castle wall", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const m = new Match(config({ seed, castles: true }));
      waitForAim(m);
      const t = m.active;
      t.elev = 30;
      m.step(input({ fire: 0.7 }));
      run(m, 10, undefined, (mm) => mm.phase !== "flight");
      for (const [x] of m.craters) expect(Math.abs(x - t.x)).toBeGreaterThan(WALL_OFFSET + 20);
    }
  });

  it("a whole game between two random shooters always finishes", () => {
    for (const seed of [10, 20, 30]) {
      const m = new Match(config({ seed, players: players(4), castles: true, wind: 45, crateEvery: 10, turnTime: 20 }));
      let plan = { elev: 45, power: 0.5 };
      let lastTurn = -1;
      const bot = (mm: Match): TurnInput => {
        if (mm.turn !== lastTurn) {
          lastTurn = mm.turn;
          plan = { elev: 20 + ((seed * 7 + mm.turn * 13) % 70), power: 0.3 + ((seed + mm.turn * 17) % 60) / 100 };
        }
        if (!mm.canAct) return IDLE;
        const t = mm.active;
        if (Math.abs(t.elev - plan.elev) > 1) return input({ aim: t.elev < plan.elev ? 1 : -1 });
        return input({ fire: plan.power });
      };
      run(m, 60 * 30, bot, (mm) => mm.phase === "over");
      expect(m.phase).toBe("over");
    }
  });
});
