import { AiController, type Difficulty } from "./ai";
import type { SlimeCharacter } from "./characters";
import type { SlimeMode } from "./modes/mode";
import { FIXED_DT } from "./physics";
import type { Controller, Intent } from "./types";
import { World } from "./world";

export interface HeadlessMatch {
  mode: SlimeMode;
  chars: [SlimeCharacter, SlimeCharacter];
  difficulties: [Difficulty, Difficulty];
  ballSpeed?: number;
  winScore?: number;
  seed?: number;
  /** Give up after this much simulated time (seconds). */
  maxSeconds?: number;
}

export interface MatchStats {
  scores: [number, number];
  winner: 0 | 1 | null;
  finished: boolean;
  /** Simulated seconds. */
  seconds: number;
  /** Points scored (rallies that ended in a score). */
  rallies: number;
  /** Rallies restarted because the ball got stuck. */
  reserves: number;
  /** Ball↔slime hits hard enough to make a sound. */
  hits: number;
  jumps: [number, number];
  /** Simulated seconds per scored rally (excludes serve/celebration pauses). */
  rallyTimes: number[];
  /** Non-finite position/velocity ever seen. */
  nan: boolean;
}

/**
 * Run a CPU-vs-CPU match with no rendering, as fast as the CPU allows. Used by
 * the test-suite for balance / robustness checks, and handy for tuning.
 */
export function runHeadlessMatch(m: HeadlessMatch): MatchStats {
  const world = new World({
    mode: m.mode,
    chars: m.chars,
    ballSpeed: m.ballSpeed ?? 1,
    winScore: m.winScore ?? m.mode.winScores[0],
    seed: m.seed ?? 1,
  });
  const ai: Controller[] = [new AiController(0, m.difficulties[0]), new AiController(1, m.difficulties[1])];
  const maxSteps = Math.ceil((m.maxSeconds ?? 600) / FIXED_DT);
  const stats: MatchStats = {
    scores: world.scores,
    winner: null,
    finished: false,
    seconds: 0,
    rallies: 0,
    reserves: 0,
    hits: 0,
    jumps: [0, 0],
    rallyTimes: [],
    nan: false,
  };
  let rallyStart = 0;
  let steps = 0;
  while (world.phase !== "over" && steps < maxSteps) {
    const intents: [Intent, Intent] = [ai[0].getIntent(world, 0), ai[1].getIntent(world, 1)];
    for (const s of world.slimes) if (intents[s.side].jump && s.grounded) stats.jumps[s.side]++;
    const wasPlaying = world.phase === "play";
    world.step(intents);
    if (!wasPlaying && world.phase === "play") rallyStart = world.time;
    for (const e of world.events) {
      if (e.type === "hit") stats.hits++;
      else if (e.type === "reserve") stats.reserves++;
      else if (e.type === "score") {
        stats.rallies++;
        stats.rallyTimes.push(world.time - rallyStart);
      }
    }
    world.events.length = 0;
    const b = world.ball;
    const [s0, s1] = world.slimes;
    if (!Number.isFinite(b.x + b.y + b.vx + b.vy + s0.x + s0.y + s1.x + s1.y)) {
      stats.nan = true;
      break;
    }
    steps++;
  }
  stats.seconds = world.time;
  stats.winner = world.winner;
  stats.finished = world.phase === "over";
  return stats;
}
