import type { Engine } from "./engine";

/**
 * Canvas renderer for Geometry Beat. Kept deliberately cheap for low-end GPUs:
 * flat fills, no per-frame gradients/shadows in the hot path, a single beat
 * pulse value reused across elements.
 */
export class Renderer {
  private dpr = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
    private accent: string,
  ) {}

  /** Size the backing store for the current CSS box, clamping DPR for perf. */
  resize(cssW: number, cssH: number): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
  }

  draw(engine: Engine, beat: number): void {
    const { ctx } = this;
    const { width: w, height: h, groundY } = engine;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Beat pulse: 1 right on the beat, decaying toward the next.
    const pulse = 1 - (beat - Math.floor(beat));

    // Background.
    ctx.fillStyle = "#0a0a12";
    ctx.fillRect(0, 0, w, h);

    // Subtle pulsing glow band behind the action.
    ctx.globalAlpha = 0.06 + pulse * 0.06;
    ctx.fillStyle = this.accent;
    ctx.fillRect(0, groundY - h * 0.5, w, h * 0.5);
    ctx.globalAlpha = 1;

    this.drawScrollingGrid(w, groundY, beat);

    this.drawTerrain(engine, beat, pulse);
    this.drawFlyZones(engine, beat, pulse);
    this.drawObstacles(engine, beat);
    this.drawParticles(engine);
    this.drawPlayer(engine, beat);
  }

  /** Tint fly-mode ranges and mark their entry/exit portals. */
  private drawFlyZones(engine: Engine, beat: number, pulse: number): void {
    const segs = engine.beatmap.segments;
    if (!segs) return;
    const { ctx } = this;
    const { width: w, height: h } = engine;
    for (const s of segs) {
      if (s.kind !== "fly") continue;
      const x0 = engine.xAtBeat(s.from, beat);
      const x1 = engine.xAtBeat(s.to, beat);
      if (x1 < 0 || x0 > w) continue;

      ctx.globalAlpha = 0.05;
      ctx.fillStyle = "#7a5cff";
      ctx.fillRect(Math.max(0, x0), 0, Math.min(w, x1) - Math.max(0, x0), h);
      ctx.globalAlpha = 1;

      ctx.strokeStyle = "#7a5cff";
      ctx.lineWidth = 3;
      ctx.setLineDash([12, 10]);
      ctx.globalAlpha = 0.5 + pulse * 0.5;
      for (const x of [x0, x1]) {
        if (x < -4 || x > w + 4) continue;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  private drawScrollingGrid(w: number, groundY: number, beat: number): void {
    const { ctx } = this;
    const spacing = 64;
    const offset = (beat * 40) % spacing;
    ctx.strokeStyle = "#ffffff0c";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -offset; x < w; x += spacing) {
      ctx.moveTo(x, groundY);
      ctx.lineTo(x, 0);
    }
    ctx.stroke();
  }

  /** Floor (with ramps + gaps) and ceilings, sampled per column. */
  private drawTerrain(engine: Engine, beat: number, pulse: number): void {
    const { ctx } = this;
    const { width: w, height: h } = engine;
    const step = 8;
    const lineAlpha = 0.5 + pulse * 0.5;
    for (let x = 0; x < w; x += step) {
      const b = engine.beatAtX(x + step / 2, beat);

      const top = engine.floorTopAt(b);
      if (top !== Infinity) {
        ctx.fillStyle = "#15151f";
        ctx.fillRect(x, top, step + 1, h - top);
        ctx.globalAlpha = lineAlpha;
        ctx.fillStyle = this.accent;
        ctx.fillRect(x, top - 2, step + 1, 3);
        ctx.globalAlpha = 1;
      }

      const ceil = engine.ceilingAt(b);
      if (ceil !== -Infinity) {
        ctx.fillStyle = "#15151f";
        ctx.fillRect(x, 0, step + 1, ceil);
        ctx.globalAlpha = lineAlpha;
        ctx.fillStyle = this.accent;
        ctx.fillRect(x, ceil - 1, step + 1, 3);
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawObstacles(engine: Engine, beat: number): void {
    const { ctx } = this;
    ctx.fillStyle = this.accent;
    for (const note of engine.beatmap.notes) {
      const r = engine.obstacleRect(note, beat);
      if (r.x + r.w < 0 || r.x > engine.width) continue;

      if (r.type === "block") {
        ctx.fillStyle = "#ff5c7a";
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = "#ffffff22";
        ctx.fillRect(r.x, r.y, r.w, r.h * 0.25);
      } else if (r.type === "topspike") {
        ctx.fillStyle = "#ff5c7a";
        this.spikeDown(r.x, r.y, r.w, r.h);
      } else if (r.type === "double") {
        ctx.fillStyle = this.accent;
        this.spike(r.x, r.y, r.w / 2, r.h);
        this.spike(r.x + r.w / 2, r.y, r.w / 2, r.h);
      } else {
        ctx.fillStyle = this.accent;
        this.spike(r.x, r.y, r.w, r.h);
      }
    }
  }

  private spike(x: number, y: number, w: number, h: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x + w / 2, y);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fill();
  }

  /** Spike hanging from the ceiling: base on top, tip pointing down. */
  private spikeDown(x: number, y: number, w: number, h: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w / 2, y + h);
    ctx.closePath();
    ctx.fill();
  }

  private drawPlayer(engine: Engine, beat: number): void {
    const { ctx } = this;
    const s = engine.playerSize;
    const cx = engine.playerX + s / 2;
    const cy = engine.playerY + s / 2;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(engine.rotation);

    if (engine.thrusting) {
      // Ship thruster flame, flickering with the beat subdivision.
      const flicker = 0.5 + ((beat * 8) % 1) * 0.5;
      ctx.fillStyle = "#ffb84d";
      ctx.beginPath();
      ctx.moveTo(-s / 2, -s * 0.18);
      ctx.lineTo(-s / 2 - s * 0.55 * flicker, 0);
      ctx.lineTo(-s / 2, s * 0.18);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = engine.dead ? "#ff5c7a" : this.accent;
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.fillStyle = "#0a0a12";
    ctx.fillRect(-s * 0.22, -s * 0.22, s * 0.44, s * 0.44);

    if (engine.flying) {
      // A little nose fin so ship mode reads at a glance.
      ctx.fillStyle = this.accent;
      ctx.beginPath();
      ctx.moveTo(s / 2, -s * 0.3);
      ctx.lineTo(s * 0.95, 0);
      ctx.lineTo(s / 2, s * 0.3);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  private drawParticles(engine: Engine): void {
    const { ctx } = this;
    ctx.fillStyle = this.accent;
    for (const p of engine.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }
}
