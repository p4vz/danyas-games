/**
 * Small seeded PRNG (mulberry32). The whole state is one uint32, so it can be
 * copied into a snapshot and restored exactly — needed for replays and, later,
 * for keeping every device in an online match on the same random stream.
 */
export class Rng {
  constructor(public state: number) {
    this.state = state >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
}
