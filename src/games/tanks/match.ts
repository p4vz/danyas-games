import { Rng } from "./rng";
import { H, W, generateTerrain, spawnColumns, type Rect, type Terrain } from "./terrain";
import { ATTACK_STEP, HEAL, MAX_HP_STEP, SPEED_STEP, UPGRADE_KINDS, type UpgradeKind } from "./upgrades";

/**
 * Authoritative turn-based artillery sim. Fixed-step and fully deterministic
 * for a given config + seed + per-step inputs, with no DOM access:
 *
 *   - the shell feeds it one `TurnInput` per step (from whoever's turn it is),
 *   - the renderer reads its state, and drains `events` for effects and sound,
 *   - `snapshot()` / `Match.restore()` serialise the whole match as JSON
 *     (terrain is rebuilt from the seed plus the list of craters).
 *
 * That split is what lets online play slot in later: a remote seat just
 * provides the inputs instead of the on-screen buttons.
 */

export const DT = 1 / 120;
export const GRAVITY = 420;
export const MAX_SHOT_SPEED = 820;
/** Degrees per second while an aim button is held. */
export const AIM_SPEED = 55;
export const MOVE_SPEED = 55;
/** World units a tank may drive per turn (before speed upgrades). */
export const FUEL = 140;
export const MAX_CLIMB = 6;
export const BLAST_R = 36;
export const BASE_DAMAGE = 34;
export const START_HP = 100;
export const BARREL = 24;
/** Tank hit circle, centred TANK_MID above its bottom-centre. */
export const TANK_R = 15;
export const TANK_MID = 9;
export const CRATE_R = 12;
export const MAX_CRATES = 3;
const CRATE_FALL = 70;
const SAFE_FALL = 40;
const SETTLE_TIME = 0.7;
const TURN_INTRO = 0.6;

export interface PlayerConfig {
  name: string;
  color: string;
}

export interface MatchConfig {
  players: PlayerConfig[];
  seed: number;
  /** Allow driving left/right (limited by fuel each turn). */
  movement: boolean;
  castles: boolean;
  /** Max wind acceleration (0 = calm). */
  wind: number;
  /** Mean seconds of turn time between crate drops (0 = no upgrades). */
  crateEvery: number;
  /** Seconds per turn (0 = no timer). */
  turnTime: number;
}

export interface TurnInput {
  move: -1 | 0 | 1;
  aim: -1 | 0 | 1;
  /** Current charge (0..1) while the fire button is held, else null. */
  charge: number | null;
  /** Fire this step with this power (0..1). */
  fire: number | null;
}

export const IDLE: TurnInput = { move: 0, aim: 0, charge: null, fire: null };

export interface Tank {
  x: number;
  /** Bottom of the treads (the row it stands on). */
  y: number;
  vy: number;
  falling: boolean;
  fallFrom: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  facing: 1 | -1;
  /** Barrel elevation in degrees from the facing direction (0..180). */
  elev: number;
  /** Power of the last shot, for the "same again" marker. */
  lastPower: number;
  fuel: number;
  ups: Record<UpgradeKind, number>;
  /** Total damage dealt to others, for the end screen. */
  dealt: number;
}

export interface Shell {
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: number;
  age: number;
}

export interface Crate {
  id: number;
  x: number;
  y: number;
  kind: UpgradeKind;
  landed: boolean;
}

export type Phase = "aim" | "flight" | "settle" | "over";

export type MatchEvent =
  | { type: "turn"; player: number }
  | { type: "fire"; player: number; x: number; y: number; power: number }
  | { type: "explode"; x: number; y: number; r: number; rect: Rect }
  | { type: "damage"; player: number; amount: number; x: number; y: number }
  | { type: "death"; player: number; x: number; y: number }
  | { type: "crate"; crate: Crate }
  | { type: "pickup"; player: number; kind: UpgradeKind; x: number; y: number }
  | { type: "land"; player: number }
  | { type: "timeout"; player: number }
  | { type: "over"; winner: number | null };

export interface Snapshot {
  tanks: Tank[];
  crates: Crate[];
  shell: Shell | null;
  phase: Phase;
  phaseTime: number;
  current: number;
  turn: number;
  turnLeft: number;
  wind: number;
  charge: number | null;
  crateClock: number;
  nextCrateId: number;
  rng: number;
  time: number;
  winner: number | null;
  craters: [number, number, number][];
}

export class Match {
  readonly terrain: Terrain;
  tanks: Tank[];
  crates: Crate[] = [];
  shell: Shell | null = null;
  phase: Phase = "aim";
  phaseTime = 0;
  current = 0;
  turn = 0;
  turnLeft = 0;
  wind = 0;
  /** The active player's live charge (so spectators can see it too). */
  charge: number | null = null;
  crateClock = 0;
  nextCrateId = 1;
  time = 0;
  winner: number | null = null;
  /** Every explosion so far, in order — enough to rebuild the terrain. */
  craters: [number, number, number][] = [];
  events: MatchEvent[] = [];
  private readonly rng: Rng;

  constructor(readonly config: MatchConfig) {
    const n = config.players.length;
    this.rng = new Rng(config.seed);
    this.terrain = generateTerrain(config.seed, n, config.castles);
    const cols = spawnColumns(n);
    this.tanks = cols.map((x) => ({
      x,
      y: this.terrain.surfaceBelow(x),
      vy: 0,
      falling: false,
      fallFrom: 0,
      hp: START_HP,
      maxHp: START_HP,
      alive: true,
      facing: x < W / 2 ? 1 : -1,
      elev: 45,
      lastPower: 0.6,
      fuel: 0,
      ups: { attack: 0, health: 0, speed: 0 },
      dealt: 0,
    }));
    this.current = this.rng.int(n);
    this.resetCrateClock();
    this.beginTurn();
  }

  get active(): Tank {
    return this.tanks[this.current];
  }

  /** Absolute barrel angle in radians (0 = right, π/2 = up). */
  barrelAngle(t: Tank): number {
    const deg = t.facing > 0 ? t.elev : 180 - t.elev;
    return (deg * Math.PI) / 180;
  }

  barrelTip(t: Tank): { x: number; y: number } {
    const a = this.barrelAngle(t);
    return { x: t.x + Math.cos(a) * BARREL, y: t.y - 14 - Math.sin(a) * BARREL };
  }

  /** Can the active player still act (move / aim / fire) this step? */
  get canAct(): boolean {
    return this.phase === "aim" && this.phaseTime >= TURN_INTRO && !this.active.falling;
  }

  step(input: TurnInput): void {
    this.time += DT;
    this.phaseTime += DT;
    this.updateCrates();
    this.updateFalls();

    switch (this.phase) {
      case "aim":
        this.stepAim(input);
        break;
      case "flight":
        this.stepShell();
        break;
      case "settle":
        if (this.phaseTime >= SETTLE_TIME && !this.tanks.some((t) => t.falling) && this.crates.every((c) => c.landed)) {
          this.endTurn();
        }
        break;
      case "over":
        break;
    }
  }

  // ------------------------------------------------------------- aiming

  private stepAim(input: TurnInput): void {
    const t = this.active;
    if (this.config.crateEvery > 0) {
      this.crateClock -= DT;
      if (this.crateClock <= 0) {
        this.spawnCrate();
        this.resetCrateClock();
      }
    }
    if (!this.canAct) {
      this.charge = null;
      return;
    }
    if (this.config.turnTime > 0) this.turnLeft = Math.max(0, this.turnLeft - DT);

    if (input.move && this.config.movement) this.drive(t, input.move);
    if (input.aim) t.elev = Math.min(180, Math.max(0, t.elev + input.aim * AIM_SPEED * DT));
    this.charge = input.charge;

    if (input.fire !== null) this.fire(input.fire);
    else if (this.config.turnTime > 0 && this.turnLeft <= 0) {
      // Out of time: a held shot goes off as it is, otherwise the turn is lost.
      if (input.charge !== null) this.fire(input.charge);
      else {
        this.events.push({ type: "timeout", player: this.current });
        this.endTurn();
      }
    }
  }

  private solidRow(x: number, y: number): boolean {
    const tr = this.terrain;
    return tr.solid(x - 9, y) || tr.solid(x, y) || tr.solid(x + 9, y);
  }

  private drive(t: Tank, dir: -1 | 1): void {
    t.facing = dir;
    if (t.fuel <= 0) return;
    const speed = MOVE_SPEED * (1 + SPEED_STEP * t.ups.speed);
    const dx = Math.min(speed * DT, t.fuel);
    const nx = Math.min(W - 16, Math.max(16, t.x + dir * dx));
    if (nx === t.x) return;
    let ny = t.y;
    if (this.solidRow(nx, t.y - 1)) {
      // Climb a small step, or stop at a wall.
      let found = false;
      for (let k = 1; k <= MAX_CLIMB; k++) {
        if (!this.solidRow(nx, t.y - 1 - k)) {
          ny = t.y - k;
          found = true;
          break;
        }
      }
      if (!found) return;
    }
    t.fuel -= Math.abs(nx - t.x);
    t.x = nx;
    t.y = ny;
    this.collectTouching(this.current);
  }

  private fire(power: number): void {
    const t = this.active;
    power = Math.min(1, Math.max(0.05, power));
    t.lastPower = power;
    const a = this.barrelAngle(t);
    const tip = this.barrelTip(t);
    const v = power * MAX_SHOT_SPEED;
    this.shell = { x: tip.x, y: tip.y, vx: Math.cos(a) * v, vy: -Math.sin(a) * v, owner: this.current, age: 0 };
    this.charge = null;
    this.events.push({ type: "fire", player: this.current, x: tip.x, y: tip.y, power });
    this.setPhase("flight");
  }

  // ------------------------------------------------------------- shell

  private stepShell(): void {
    const s = this.shell;
    if (!s) {
      this.setPhase("settle");
      return;
    }
    s.age += DT;
    s.vx += this.wind * DT;
    s.vy += GRAVITY * DT;
    const dist = Math.hypot(s.vx, s.vy) * DT;
    const n = Math.max(1, Math.ceil(dist / 2));
    for (let i = 0; i < n; i++) {
      s.x += (s.vx * DT) / n;
      s.y += (s.vy * DT) / n;
      if (s.x < -400 || s.x > W + 400 || s.y > H + 20) {
        // Sailed off the map.
        this.shell = null;
        this.setPhase("settle");
        return;
      }
      if (this.hitsSomething(s)) {
        this.explode(s.x, s.y, s.owner);
        this.shell = null;
        this.setPhase("settle");
        return;
      }
    }
  }

  private hitsSomething(s: Shell): boolean {
    if (s.y >= 0 && this.terrain.solid(s.x, s.y)) return true;
    for (let i = 0; i < this.tanks.length; i++) {
      const t = this.tanks[i];
      if (!t.alive || (i === s.owner && s.age < 0.15)) continue;
      if (Math.hypot(s.x - t.x, s.y - (t.y - TANK_MID)) < TANK_R) return true;
    }
    for (const c of this.crates) {
      if (Math.hypot(s.x - c.x, s.y - (c.y - CRATE_R)) < CRATE_R) return true;
    }
    return false;
  }

  private explode(x: number, y: number, owner: number): void {
    const r = BLAST_R;
    const rect = this.terrain.carve(x, y, r);
    this.craters.push([x, y, r]);
    this.events.push({ type: "explode", x, y, r, rect });

    const base = BASE_DAMAGE * (1 + ATTACK_STEP * this.tanks[owner].ups.attack);
    const reach = r + TANK_R;
    this.tanks.forEach((t, i) => {
      if (!t.alive) return;
      const d = Math.hypot(x - t.x, y - (t.y - TANK_MID));
      if (d >= reach) return;
      // Full damage on a direct hit, fading to nothing at the edge of the blast.
      const amount = Math.round(base * Math.min(1, (reach - d) / r));
      if (amount <= 0) return;
      this.hurt(i, amount);
      if (i !== owner) this.tanks[owner].dealt += amount;
    });

    // The shooter collects any crate caught in the blast.
    for (const c of [...this.crates]) {
      if (Math.hypot(x - c.x, y - (c.y - CRATE_R)) < r + CRATE_R) this.pickup(owner, c);
    }
  }

  private hurt(i: number, amount: number): void {
    const t = this.tanks[i];
    t.hp = Math.max(0, t.hp - amount);
    this.events.push({ type: "damage", player: i, amount, x: t.x, y: t.y - 30 });
    if (t.hp <= 0 && t.alive) {
      t.alive = false;
      this.events.push({ type: "death", player: i, x: t.x, y: t.y - TANK_MID });
    }
  }

  // ------------------------------------------------------------- gravity

  private updateFalls(): void {
    this.tanks.forEach((t, i) => {
      if (!t.alive) return;
      if (!t.falling) {
        if (this.solidRow(t.x, t.y)) return;
        t.falling = true;
        t.fallFrom = t.y;
        t.vy = 0;
      }
      t.vy += GRAVITY * DT;
      const target = t.y + t.vy * DT;
      while (t.y < target) {
        if (this.solidRow(t.x, t.y)) {
          this.land(i);
          return;
        }
        t.y = Math.min(target, Math.floor(t.y) + 1);
      }
      if (this.solidRow(t.x, t.y)) this.land(i);
    });
  }

  private land(i: number): void {
    const t = this.tanks[i];
    t.y = Math.floor(t.y);
    t.falling = false;
    t.vy = 0;
    const drop = t.y - t.fallFrom;
    this.events.push({ type: "land", player: i });
    if (drop > SAFE_FALL) this.hurt(i, Math.round((drop - SAFE_FALL) * 0.3));
    if (t.alive) this.collectTouching(i);
  }

  // ------------------------------------------------------------- crates

  private resetCrateClock(): void {
    const mean = this.config.crateEvery;
    this.crateClock = mean > 0 ? this.rng.range(mean * 0.5, mean * 1.5) : 0;
  }

  private spawnCrate(): void {
    if (this.crates.length >= MAX_CRATES) return;
    // Keep drops away from the very edges and off the top of a tank.
    let x = 0;
    for (let tries = 0; tries < 8; tries++) {
      x = Math.round(this.rng.range(60, W - 60));
      if (this.tanks.every((t) => !t.alive || Math.abs(t.x - x) > 40)) break;
    }
    const kind = UPGRADE_KINDS[this.rng.int(UPGRADE_KINDS.length)];
    const crate: Crate = { id: this.nextCrateId++, x, y: -20, kind, landed: false };
    this.crates.push(crate);
    this.events.push({ type: "crate", crate });
  }

  private updateCrates(): void {
    for (const c of this.crates) {
      const ground = this.terrain.surfaceBelow(c.x, Math.max(0, c.y));
      if (c.y >= ground) {
        c.y = ground;
        c.landed = true;
        continue;
      }
      c.landed = false;
      c.y = Math.min(ground, c.y + CRATE_FALL * DT);
    }
    // Falling crates can drop straight onto a tank.
    this.tanks.forEach((t, i) => t.alive && this.collectTouching(i));
  }

  private collectTouching(i: number): void {
    const t = this.tanks[i];
    for (const c of [...this.crates]) {
      if (Math.abs(c.x - t.x) < 18 + CRATE_R && Math.abs(c.y - CRATE_R - (t.y - TANK_MID)) < 12 + CRATE_R) {
        this.pickup(i, c);
      }
    }
  }

  private pickup(i: number, c: Crate): void {
    const idx = this.crates.indexOf(c);
    if (idx < 0) return;
    this.crates.splice(idx, 1);
    const t = this.tanks[i];
    if (!t.alive) return;
    t.ups[c.kind]++;
    if (c.kind === "health") {
      t.maxHp += MAX_HP_STEP;
      t.hp = Math.min(t.maxHp, t.hp + HEAL);
    } else if (c.kind === "speed" && i === this.current && this.phase === "aim") {
      t.fuel += FUEL * SPEED_STEP;
    }
    this.events.push({ type: "pickup", player: i, kind: c.kind, x: c.x, y: c.y - CRATE_R });
  }

  // ------------------------------------------------------------- turns

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseTime = 0;
  }

  private beginTurn(): void {
    const t = this.active;
    t.fuel = this.config.movement ? FUEL * (1 + SPEED_STEP * t.ups.speed) : 0;
    this.turnLeft = this.config.turnTime;
    this.wind = this.config.wind > 0 ? Math.round(this.rng.range(-1, 1) * this.config.wind) : 0;
    this.charge = null;
    this.setPhase("aim");
    this.events.push({ type: "turn", player: this.current });
  }

  private endTurn(): void {
    const alive = this.tanks.map((t, i) => (t.alive ? i : -1)).filter((i) => i >= 0);
    if (alive.length <= 1) {
      this.winner = alive.length === 1 ? alive[0] : null;
      this.setPhase("over");
      this.events.push({ type: "over", winner: this.winner });
      return;
    }
    this.turn++;
    let next = this.current;
    do next = (next + 1) % this.tanks.length;
    while (!this.tanks[next].alive);
    this.current = next;
    this.beginTurn();
  }

  // ------------------------------------------------------------- snapshots

  snapshot(): Snapshot {
    return JSON.parse(
      JSON.stringify({
        tanks: this.tanks,
        crates: this.crates,
        shell: this.shell,
        phase: this.phase,
        phaseTime: this.phaseTime,
        current: this.current,
        turn: this.turn,
        turnLeft: this.turnLeft,
        wind: this.wind,
        charge: this.charge,
        crateClock: this.crateClock,
        nextCrateId: this.nextCrateId,
        rng: this.rng.state,
        time: this.time,
        winner: this.winner,
        craters: this.craters,
      }),
    ) as Snapshot;
  }

  /** Rebuild a match from its config and a snapshot (e.g. sent by the host). */
  static restore(config: MatchConfig, snap: Snapshot): Match {
    const m = new Match(config);
    for (const [x, y, r] of snap.craters) m.terrain.carve(x, y, r);
    const s = JSON.parse(JSON.stringify(snap)) as Snapshot;
    m.tanks = s.tanks;
    m.crates = s.crates;
    m.shell = s.shell;
    m.phase = s.phase;
    m.phaseTime = s.phaseTime;
    m.current = s.current;
    m.turn = s.turn;
    m.turnLeft = s.turnLeft;
    m.wind = s.wind;
    m.charge = s.charge;
    m.crateClock = s.crateClock;
    m.nextCrateId = s.nextCrateId;
    m.rng.state = s.rng;
    m.time = s.time;
    m.winner = s.winner;
    m.craters = s.craters;
    m.events = [];
    return m;
  }
}
