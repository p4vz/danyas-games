import type { Footprint } from "./controls";
import type { Finger } from "./input";
import type { SlimeMode } from "./modes/mode";
import { FIXED_DT, type SlimeBody } from "./physics";
import { BallPath, predictBall } from "./predict";
import { attackDir } from "./types";
import { READY_TIME, type World } from "./world";

/** World units of floor drawn below y = 0. */
const GROUND_DEPTH = 46;

export interface Banner {
  text: string;
  sub?: string;
  color: string;
  alpha: number;
}

export interface DrawExtras {
  fingers: readonly (Finger | null)[];
  showPath: boolean;
  banner: Banner | null;
}

/**
 * Canvas renderer. Physics is y-up world units; one transform flips/scales it
 * onto the screen with letterboxing, so every resolution plays identically.
 * Kept cheap for low-end tablets: flat fills, gradients cached per resize.
 */
export class SlimeRenderer {
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;
  /** World→CSS-pixel scale and offsets. */
  private k = 1;
  private ox = 0;
  private floorY = 0;
  /** Space the on-screen controls need, and the strip actually reserved. */
  private footprint: Footprint | null = null;
  private bottomInset = 0;
  /** Static backdrop (sky, floor, arena art) pre-rendered once per layout. */
  private bg: HTMLCanvasElement | null = null;
  private bgKey = "";
  private layoutMode: SlimeMode | null = null;
  private readonly preview = new BallPath(120);

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
  ) {}

  resize(cssW: number, cssH: number, mode: SlimeMode | null): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = cssW;
    this.cssH = cssH;
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    if (mode) this.layout(mode);
  }

  /** Keep the field clear of the on-screen controls (see `Footprint`). */
  setControlsFootprint(fp: Footprint | null, mode: SlimeMode): void {
    const same = fp?.inset === this.footprint?.inset && fp?.margin === this.footprint?.margin;
    if (same && this.layoutMode === mode) return;
    this.footprint = fp;
    this.bgKey = "";
    this.layout(mode);
  }

  private layout(mode: SlimeMode): void {
    const { width: W, height: H } = mode.arena;
    const full = Math.min(this.cssW / W, this.cssH / (H + GROUND_DEPTH));
    this.k = full;
    this.bottomInset = 0;
    const fp = this.footprint;
    if (fp && fp.inset > GROUND_DEPTH * full) {
      // Either lift the floor above the controls, or narrow the field so they
      // sit in the side margins — whichever keeps the field bigger.
      const lifted = Math.min(this.cssW / W, (this.cssH - fp.inset) / H);
      const beside = Math.min(full, (this.cssW - 2 * fp.margin) / W);
      if (lifted > beside) {
        this.k = lifted;
        this.bottomInset = fp.inset;
      } else {
        this.k = beside;
      }
    }
    this.ox = (this.cssW - W * this.k) / 2;
    this.floorY = this.cssH - Math.max(GROUND_DEPTH * this.k, this.bottomInset);
    this.layoutMode = mode;
  }

  /**
   * Gradients and arena art are slow to rasterise on weak tablets, and they
   * never move — draw them once into an offscreen canvas and blit it.
   */
  private background(mode: SlimeMode): HTMLCanvasElement {
    const key = `${mode.id}:${this.canvas.width}x${this.canvas.height}:${this.bottomInset}`;
    if (this.bg && this.bgKey === key) return this.bg;
    if (this.layoutMode !== mode) this.layout(mode);
    const bg = this.bg ?? document.createElement("canvas");
    bg.width = this.canvas.width;
    bg.height = this.canvas.height;
    const ctx = bg.getContext("2d", { alpha: false })!;
    const { dpr } = this;
    const W = mode.arena.width;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sky = ctx.createLinearGradient(0, 0, 0, this.floorY);
    sky.addColorStop(0, mode.theme.skyTop);
    sky.addColorStop(1, mode.theme.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.cssW, this.floorY);
    ctx.fillStyle = mode.theme.ground;
    ctx.fillRect(0, this.floorY, this.cssW, this.cssH - this.floorY);
    ctx.fillStyle = mode.theme.groundLine;
    ctx.fillRect(0, this.floorY, this.cssW, Math.max(2, 3 * this.k));
    // Dim the area outside the walls.
    if (this.ox > 1) {
      ctx.fillStyle = "#00000040";
      ctx.fillRect(0, 0, this.ox, this.cssH);
      ctx.fillRect(this.ox + W * this.k, 0, this.ox + 1, this.cssH);
    }
    ctx.setTransform(dpr * this.k, 0, 0, -dpr * this.k, dpr * this.ox, dpr * this.floorY);
    mode.drawArena(ctx);

    this.bg = bg;
    this.bgKey = key;
    return bg;
  }

  /** Canvas CSS pixels → world units. */
  readonly toWorld = (px: number, py: number) => ({
    x: (px - this.ox) / this.k,
    y: (this.floorY - py) / this.k,
  });

  draw(world: World, extras: DrawExtras): void {
    const { ctx, dpr } = this;
    const mode = world.mode;

    // --- static backdrop ---
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.background(mode), 0, 0);

    // --- world space (y-up) ---
    ctx.setTransform(dpr * this.k, 0, 0, -dpr * this.k, dpr * this.ox, dpr * this.floorY);

    const ball = world.ball;
    const r = mode.ball.radius;
    if (extras.showPath && world.phase !== "over") this.drawPath(world);

    // Shadows.
    ctx.fillStyle = "#00000030";
    for (const s of world.slimes) this.shadow(s.x, s.y, s.char.radius);
    this.shadow(ball.x, ball.y - r, r);

    for (const s of world.slimes) this.drawSlime(s, world);

    // Rally speed-up (Pong-style modes): a trail that grows as the ball heats up.
    const heat = world.rally.speed - 1;
    if (heat > 0.01 && world.phase === "play") {
      const k = world.ballTimeScale * 0.018;
      ctx.fillStyle = mode.accent;
      for (let i = 3; i >= 1; i--) {
        ctx.globalAlpha = Math.min(0.5, heat * 0.7) * (1 - i / 4);
        ctx.beginPath();
        ctx.arc(ball.x - ball.vx * k * i, ball.y - ball.vy * k * i, r * (1 - i * 0.15), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    mode.drawBall(ctx, ball.x, ball.y, r, world.ballAngle);
    // Carried ball: ring runs down until the auto-throw.
    if (world.holder !== null && mode.aux?.maxHold) {
      const left = Math.max(0, 1 - world.holdTime / mode.aux.maxHold);
      ctx.strokeStyle = world.slimes[world.holder].char.color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, r + 7, Math.PI / 2, Math.PI / 2 + left * Math.PI * 2);
      ctx.stroke();
    }
    // Hold-ring while the ball waits to drop.
    const hold = world.holdRemaining();
    if (hold > 0) {
      ctx.strokeStyle = "#ffffffcc";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, r + 8, Math.PI / 2, Math.PI / 2 + (hold / READY_TIME) * Math.PI * 2);
      ctx.stroke();
    }
    mode.drawForeground?.(ctx);

    // Finger targets.
    for (let i = 0; i < extras.fingers.length; i++) {
      const f = extras.fingers[i];
      if (!f) continue;
      const w = this.toWorld(f.px, f.py);
      ctx.strokeStyle = world.slimes[i].char.color;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(w.x, w.y, 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // --- screen-space overlays ---
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (extras.banner && extras.banner.alpha > 0) this.drawBanner(extras.banner);
  }

  private shadow(x: number, height: number, r: number): void {
    const f = Math.max(0.35, 1 - height / 500);
    this.ctx.beginPath();
    this.ctx.ellipse(x, 0, r * f, 6 * f, 0, 0, Math.PI * 2);
    this.ctx.fill();
  }

  private drawSlime(s: SlimeBody, world: World): void {
    const { ctx } = this;
    const c = s.char;
    const R = c.radius;
    // A little squash & stretch from vertical speed.
    const stretch = 1 + Math.max(-0.1, Math.min(0.12, s.vy / 5000));
    const sx = 1 / Math.sqrt(stretch);

    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.scale(sx, stretch);
    ctx.beginPath();
    ctx.moveTo(-R, 0);
    ctx.arc(0, 0, R, 0, Math.PI);
    ctx.closePath();
    ctx.fillStyle = c.color;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = c.rim;
    ctx.stroke();
    // Highlight.
    ctx.beginPath();
    ctx.arc(-R * 0.25, R * 0.55, R * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff40";
    ctx.fill();

    // Eye, facing the opponent, pupil tracking the ball.
    const dir = attackDir(s.side);
    const ex = dir * R * 0.45;
    const ey = R * 0.58;
    const er = Math.max(6, R * 0.2);
    ctx.beginPath();
    ctx.arc(ex, ey, er, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    const bx = world.ball.x - (s.x + ex);
    const by = world.ball.y - (s.y + ey);
    const bd = Math.hypot(bx, by) || 1;
    ctx.beginPath();
    ctx.arc(ex + (bx / bd) * er * 0.45, ey + (by / bd) * er * 0.45, er * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = "#111";
    ctx.fill();
    ctx.restore();
  }

  private drawPath(world: World): void {
    const mode = world.mode;
    const path = predictBall(
      world.ball,
      mode.ball,
      mode.arena,
      world.ballTimeScale,
      1.1,
      this.preview,
      0,
      Math.round(0.035 / FIXED_DT),
    );
    const { ctx } = this;
    ctx.fillStyle = "#ffffff";
    for (let i = 1; i < path.length; i++) {
      ctx.globalAlpha = 0.55 * (1 - i / path.length);
      ctx.beginPath();
      ctx.arc(path.x[i], path.y[i], 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawBanner(b: Banner): void {
    const { ctx } = this;
    const size = Math.max(28, Math.min(this.cssW * 0.09, 84));
    ctx.globalAlpha = b.alpha;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${size}px system-ui, sans-serif`;
    ctx.lineWidth = size * 0.12;
    ctx.strokeStyle = "#000000aa";
    const y = this.cssH * 0.34;
    ctx.strokeText(b.text, this.cssW / 2, y);
    ctx.fillStyle = b.color;
    ctx.fillText(b.text, this.cssW / 2, y);
    if (b.sub) {
      ctx.font = `700 ${size * 0.36}px system-ui, sans-serif`;
      ctx.lineWidth = size * 0.06;
      ctx.strokeText(b.sub, this.cssW / 2, y + size * 0.75);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(b.sub, this.cssW / 2, y + size * 0.75);
    }
    ctx.globalAlpha = 1;
  }
}
