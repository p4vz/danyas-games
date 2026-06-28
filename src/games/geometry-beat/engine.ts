import type { Beatmap, Note } from "./beatmap";
import type { Input } from "./input";

export interface ObstacleRect {
  type: Note["type"];
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

export interface EngineCallbacks {
  onScore(score: number): void;
  onDeath(): void;
  onComplete(): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Geometry Beat simulation. All gameplay is driven by the musical `beat`
 * (supplied from the audio playhead), so obstacle positions are a pure function
 * of beat and stay locked to the track regardless of frame rate.
 */
export class Engine {
  // Layout (recomputed on resize).
  width = 0;
  height = 0;
  groundY = 0;
  playerX = 0;
  playerSize = 0;
  pxPerBeat = 0;

  // Physics.
  private gravity = 0;
  private jumpVel = 0;
  private playerTopOnGround = 0;

  // Player state.
  playerY = 0;
  private vy = 0;
  private grounded = true;
  rotation = 0;

  // Run state.
  dead = false;
  complete = false;
  score = 0;
  private passed = 0;
  private readonly lastBeat: number;

  readonly particles: Particle[] = [];

  constructor(
    readonly beatmap: Beatmap,
    private readonly input: Input,
    private readonly cb: EngineCallbacks,
  ) {
    const notes = beatmap.notes;
    this.lastBeat = notes.length ? notes[notes.length - 1].beat : 0;
  }

  layout(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.playerSize = clamp(height * 0.085, 26, 56);
    this.groundY = height * 0.8;
    this.playerX = clamp(width * 0.22, 70, width * 0.4);
    this.pxPerBeat = Math.max(width * 0.32, 150) * (this.beatmap.speed ?? 1);

    const jumpHeight = this.playerSize * 3.1;
    const apex = 0.36; // seconds to top of jump
    this.gravity = (2 * jumpHeight) / (apex * apex);
    this.jumpVel = -this.gravity * apex;

    this.playerTopOnGround = this.groundY - this.playerSize;
    if (this.grounded) this.playerY = this.playerTopOnGround;
  }

  /** Visual rectangle for an obstacle at the current beat. */
  obstacleRect(note: Note, beat: number): ObstacleRect {
    const centerX = this.playerX + this.playerSize / 2 + (note.beat - beat) * this.pxPerBeat;
    const s = this.playerSize;
    switch (note.type) {
      case "spike":
        return { type: note.type, x: centerX - s * 0.45, y: this.groundY - s, w: s * 0.9, h: s };
      case "double":
        return { type: note.type, x: centerX - s * 0.9, y: this.groundY - s, w: s * 1.8, h: s };
      case "block": {
        const bs = s * 1.1;
        return { type: note.type, x: centerX - bs / 2, y: this.groundY - bs, w: bs, h: bs };
      }
    }
  }

  update(dt: number, beat: number): void {
    if (this.dead) {
      this.updateParticles(dt);
      return;
    }

    // Jump (grounded + tap or hold).
    if (this.grounded && (this.input.consumeJump() || this.input.held)) {
      this.vy = this.jumpVel;
      this.grounded = false;
      this.spawnDust();
    }

    // Integrate.
    this.vy += this.gravity * dt;
    const prevBottom = this.playerY + this.playerSize;
    this.playerY += this.vy * dt;

    if (!this.grounded) {
      this.rotation += dt * (Math.PI / 0.36); // ~half turn per jump arc
    }

    this.grounded = false;

    // Floor.
    if (this.playerY >= this.playerTopOnGround) {
      this.playerY = this.playerTopOnGround;
      this.vy = 0;
      this.grounded = true;
      this.rotation = Math.round(this.rotation / (Math.PI / 2)) * (Math.PI / 2);
    }

    // Scoring: advance a cursor as obstacles pass the player.
    const notes = this.beatmap.notes;
    while (this.passed < notes.length && notes[this.passed].beat < beat) {
      this.passed++;
    }
    if (this.passed !== this.score) {
      this.score = this.passed;
      this.cb.onScore(this.score);
    }

    // Obstacles: collision + landing.
    const pInset = this.playerSize * 0.12;
    const pl = this.playerX + pInset;
    const pr = this.playerX + this.playerSize - pInset;
    const pt = this.playerY + pInset;
    const pb = this.playerY + this.playerSize;

    for (const note of notes) {
      const r = this.obstacleRect(note, beat);
      if (r.x + r.w < this.playerX - this.playerSize || r.x > this.width) continue;

      if (r.type === "block") {
        const horiz = pr > r.x + 2 && pl < r.x + r.w - 2;
        const landing =
          this.vy >= 0 &&
          horiz &&
          prevBottom <= r.y + this.playerSize * 0.45 &&
          pb >= r.y;
        if (landing) {
          this.playerY = r.y - this.playerSize;
          this.vy = 0;
          this.grounded = true;
          this.rotation = Math.round(this.rotation / (Math.PI / 2)) * (Math.PI / 2);
          continue;
        }
        if (horiz && pb > r.y + 2 && pt < r.y + r.h) {
          this.die();
          return;
        }
      } else {
        // Spike / double: forgiving triangular hitbox.
        const hx = r.x + r.w * 0.18;
        const hr = r.x + r.w * 0.82;
        const hy = r.y + r.h * 0.2;
        if (pr > hx && pl < hr && pb > hy) {
          this.die();
          return;
        }
      }
    }

    if (!this.complete && beat > this.lastBeat + 4) {
      this.complete = true;
      this.cb.onComplete();
    }

    this.updateParticles(dt);
  }

  private die(): void {
    this.dead = true;
    this.spawnBurst();
    this.cb.onDeath();
  }

  private spawnDust(): void {
    const cx = this.playerX + this.playerSize / 2;
    const cy = this.playerY + this.playerSize;
    for (let i = 0; i < 5; i++) {
      this.particles.push({
        x: cx,
        y: cy,
        vx: -60 - Math.random() * 80,
        vy: -20 - Math.random() * 40,
        life: 0.4,
        maxLife: 0.4,
        size: 2 + Math.random() * 3,
      });
    }
  }

  private spawnBurst(): void {
    const cx = this.playerX + this.playerSize / 2;
    const cy = this.playerY + this.playerSize / 2;
    for (let i = 0; i < 26; i++) {
      const a = (Math.PI * 2 * i) / 26 + Math.random() * 0.3;
      const sp = 120 + Math.random() * 240;
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.7,
        maxLife: 0.7,
        size: 3 + Math.random() * 4,
      });
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += this.gravity * 0.4 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }
}
