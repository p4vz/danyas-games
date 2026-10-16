import { BLAST_R, CRATE_R, type Match, type MatchEvent, type Tank } from "./match";
import { H, W, paintTerrain } from "./terrain";
import { UPGRADES } from "./upgrades";

interface Blast {
  x: number;
  y: number;
  r: number;
  t: number;
}

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  t: number;
}

const TURN_BANNER = 1.4;

/**
 * Canvas renderer. The world (W×H) is letterboxed into the canvas; terrain
 * lives in an offscreen bitmap that is repainted only where craters land.
 * Explosions, debris and floating numbers are purely cosmetic and live here,
 * not in the sim.
 */
export class TankRenderer {
  private readonly terrainCanvas = document.createElement("canvas");
  private readonly tctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly px: Uint32Array;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private dpr = 1;
  private blasts: Blast[] = [];
  private bits: Bit[] = [];
  private floaters: Floater[] = [];
  private trail: { x: number; y: number }[] = [];
  private clouds = Array.from({ length: 5 }, (_, i) => ({ x: (i * W) / 5 + 80, y: 70 + ((i * 53) % 140), s: 0.7 + ((i * 37) % 5) / 8 }));
  private banner: { text: string; color: string; t: number } | null = null;
  private shake = 0;
  private clock = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
  ) {
    this.terrainCanvas.width = W;
    this.terrainCanvas.height = H;
    this.tctx = this.terrainCanvas.getContext("2d")!;
    this.image = this.tctx.createImageData(W, H);
    this.px = new Uint32Array(this.image.data.buffer);
  }

  resize(cssW: number, cssH: number): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(cssW * this.dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * this.dpr));
    this.scale = Math.min(this.canvas.width / W, this.canvas.height / H);
    this.ox = (this.canvas.width - W * this.scale) / 2;
    this.oy = this.canvas.height - H * this.scale;
  }

  /** New match: paint the whole terrain and clear effects. */
  reset(match: Match): void {
    paintTerrain(match.terrain, this.px);
    this.tctx.putImageData(this.image, 0, 0);
    this.blasts = [];
    this.bits = [];
    this.floaters = [];
    this.trail = [];
    this.banner = null;
  }

  /** React to sim events (craters, numbers, debris). */
  onEvent(match: Match, ev: MatchEvent): void {
    switch (ev.type) {
      case "explode": {
        const { x0, y0, x1, y1 } = ev.rect;
        paintTerrain(match.terrain, this.px, ev.rect);
        this.tctx.putImageData(this.image, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
        this.blasts.push({ x: ev.x, y: ev.y, r: ev.r, t: 0 });
        this.debris(ev.x, ev.y, 18, ["#8a5a36", "#6b4428", "#ffb347", "#555"]);
        this.shake = Math.max(this.shake, 0.25);
        this.trail = [];
        break;
      }
      case "damage":
        this.floaters.push({ x: ev.x, y: ev.y, text: `-${ev.amount}`, color: "#ff6b5b", t: 0 });
        break;
      case "death":
        this.blasts.push({ x: ev.x, y: ev.y, r: BLAST_R * 1.4, t: 0 });
        this.debris(ev.x, ev.y, 30, [match.config.players[ev.player].color, "#333", "#ffb347"]);
        this.shake = 0.5;
        break;
      case "pickup": {
        const u = UPGRADES[ev.kind];
        this.floaters.push({ x: ev.x, y: ev.y, text: `${u.icon} ${u.label}!`, color: u.color, t: 0 });
        break;
      }
      case "turn":
        this.banner = { text: `${match.config.players[ev.player].name}'s turn`, color: match.config.players[ev.player].color, t: 0 };
        break;
      case "timeout":
        this.floaters.push({ x: match.tanks[ev.player].x, y: match.tanks[ev.player].y - 60, text: "Time's up!", color: "#fff", t: 0 });
        break;
      case "fire":
        this.trail = [];
        break;
      default:
        break;
    }
  }

  private debris(x: number, y: number, n: number, colors: string[]): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 80 + Math.random() * 220;
      this.bits.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 120,
        life: 0.6 + Math.random() * 0.6,
        color: colors[i % colors.length],
        size: 2 + Math.random() * 3,
      });
    }
  }

  draw(match: Match, dt: number): void {
    this.clock += dt;
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const sky = ctx.createLinearGradient(0, 0, 0, ch);
    sky.addColorStop(0, "#5aa9e6");
    sky.addColorStop(0.65, "#a8d8f0");
    sky.addColorStop(1, "#f3e6c8");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, cw, ch);

    let sx = 0;
    let sy = 0;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const m = this.shake * 14 * this.scale;
      sx = (Math.random() - 0.5) * m;
      sy = (Math.random() - 0.5) * m;
    }
    ctx.setTransform(this.scale, 0, 0, this.scale, this.ox + sx, this.oy + sy);

    this.drawClouds(match, dt);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrainCanvas, 0, 0);
    ctx.imageSmoothingEnabled = true;

    for (const c of match.crates) this.drawCrate(c.x, c.y, c.kind, c.landed);
    match.tanks.forEach((t, i) => this.drawTank(match, t, i));
    this.drawShell(match);
    this.drawEffects(dt);
    this.drawBanner(dt);
  }

  private drawClouds(match: Match, dt: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#ffffffcc";
    for (const c of this.clouds) {
      c.x += (6 + match.wind * 0.4) * dt * c.s;
      if (c.x > W + 120) c.x = -120;
      if (c.x < -120) c.x = W + 120;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 50 * c.s, 18 * c.s, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x + 30 * c.s, c.y - 10 * c.s, 34 * c.s, 18 * c.s, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x - 28 * c.s, c.y - 4 * c.s, 28 * c.s, 14 * c.s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawCrate(x: number, y: number, kind: keyof typeof UPGRADES, landed: boolean): void {
    const ctx = this.ctx;
    const u = UPGRADES[kind];
    const s = CRATE_R * 2;
    if (!landed) {
      ctx.strokeStyle = "#ffffffaa";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - CRATE_R, y - s);
      ctx.lineTo(x - 18, y - s - 26);
      ctx.moveTo(x + CRATE_R, y - s);
      ctx.lineTo(x + 18, y - s - 26);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(x, y - s - 26, 22, 14, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = u.color;
      ctx.fillRect(x - 22, y - s - 28, 44, 3);
    }
    ctx.fillStyle = "#8b5e34";
    ctx.fillRect(x - CRATE_R, y - s, s, s);
    ctx.strokeStyle = "#5c3a1e";
    ctx.lineWidth = 2;
    ctx.strokeRect(x - CRATE_R + 1, y - s + 1, s - 2, s - 2);
    ctx.fillStyle = u.color;
    ctx.font = "bold 15px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(u.icon, x, y - CRATE_R + 1);
  }

  private drawTank(match: Match, t: Tank, i: number): void {
    const ctx = this.ctx;
    const color = match.config.players[i].color;
    const { x, y } = t;

    if (!t.alive) {
      ctx.fillStyle = "#3a3a40";
      roundRect(ctx, x - 17, y - 9, 34, 9, 4);
      ctx.fill();
      ctx.fillStyle = "#2a2a2e";
      ctx.beginPath();
      ctx.arc(x, y - 9, 7, Math.PI, 0);
      ctx.fill();
      // Smoke puffs.
      ctx.fillStyle = "#55555588";
      for (let k = 0; k < 3; k++) {
        const ph = (this.clock * 0.6 + k / 3) % 1;
        ctx.beginPath();
        ctx.arc(x + Math.sin(ph * 6 + k) * 4, y - 14 - ph * 40, 4 + ph * 8, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }

    // Barrel.
    const tip = match.barrelTip(t);
    ctx.strokeStyle = "#2b2b33";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, y - 14);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    ctx.strokeStyle = shade(color, -0.25);
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Dome and hull.
    ctx.fillStyle = shade(color, -0.1);
    ctx.beginPath();
    ctx.arc(x, y - 13, 8, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - 18, y - 7);
    ctx.lineTo(x - 13, y - 14);
    ctx.lineTo(x + 13, y - 14);
    ctx.lineTo(x + 18, y - 7);
    ctx.closePath();
    ctx.fill();
    // Treads.
    ctx.fillStyle = "#2b2b33";
    roundRect(ctx, x - 18, y - 8, 36, 8, 4);
    ctx.fill();
    ctx.fillStyle = "#6b6b78";
    for (let k = -12; k <= 12; k += 8) {
      ctx.beginPath();
      ctx.arc(x + k, y - 4, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Name, HP and upgrades.
    const isActive = i === match.current && match.phase !== "over";
    const name = match.config.players[i].name;
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#000000aa";
    ctx.strokeText(name, x, y - 50);
    ctx.fillStyle = "#fff";
    ctx.fillText(name, x, y - 50);
    const bw = 40;
    ctx.fillStyle = "#000000aa";
    ctx.fillRect(x - bw / 2 - 1, y - 45, bw + 2, 7);
    const frac = t.hp / t.maxHp;
    ctx.fillStyle = frac > 0.5 ? "#5be37d" : frac > 0.25 ? "#ffd84d" : "#ff5b5b";
    ctx.fillRect(x - bw / 2, y - 44, bw * frac, 5);
    const ups = (["attack", "health", "speed"] as const)
      .filter((k) => t.ups[k] > 0)
      .map((k) => `${UPGRADES[k].icon}${t.ups[k]}`)
      .join(" ");
    if (ups) {
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.strokeText(ups, x, y - 64);
      ctx.fillStyle = "#ffe9a8";
      ctx.fillText(ups, x, y - 64);
    }

    if (isActive && match.phase === "aim") {
      // Bobbing marker over the active tank.
      const by = y - (ups ? 78 : 66) - Math.abs(Math.sin(this.clock * 4)) * 6;
      ctx.fillStyle = color;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 8, by - 10);
      ctx.lineTo(x + 8, by - 10);
      ctx.lineTo(x, by);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      if (match.canAct) {
        // Aim guide: a short dotted line, longer for the last shot's power.
        const a = match.barrelAngle(t);
        const len = 30 + t.lastPower * 60;
        ctx.strokeStyle = "#ffffffcc";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(tip.x + Math.cos(a) * len, tip.y - Math.sin(a) * len);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (match.charge !== null) {
        // Power meter under the tank so everyone can watch the charge.
        ctx.fillStyle = "#000000aa";
        ctx.fillRect(x - 26, y + 6, 52, 8);
        ctx.fillStyle = powerColor(match.charge);
        ctx.fillRect(x - 25, y + 7, 50 * match.charge, 6);
        ctx.fillStyle = "#fff";
        ctx.fillRect(x - 25 + 50 * t.lastPower - 1, y + 5, 2, 10);
      }
    }
  }

  private drawShell(match: Match): void {
    const s = match.shell;
    const ctx = this.ctx;
    if (s) {
      this.trail.push({ x: s.x, y: s.y });
      if (this.trail.length > 40) this.trail.shift();
    }
    if (this.trail.length > 1) {
      ctx.strokeStyle = "#ffffff88";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.trail[0].x, this.trail[0].y);
      for (const p of this.trail) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    if (!s) return;
    if (s.y < 0) {
      // Off the top: show an arrow at the edge so you can follow it.
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(s.x, 4);
      ctx.lineTo(s.x - 7, 16);
      ctx.lineTo(s.x + 7, 16);
      ctx.closePath();
      ctx.fill();
      return;
    }
    ctx.fillStyle = "#1d1d24";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  private drawEffects(dt: number): void {
    const ctx = this.ctx;
    this.blasts = this.blasts.filter((b) => (b.t += dt) < 0.5);
    for (const b of this.blasts) {
      const k = b.t / 0.5;
      ctx.fillStyle = `rgba(255, ${Math.round(200 - k * 120)}, 60, ${1 - k})`;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * (0.5 + k * 0.7), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 255, 220, ${Math.max(0, 1 - k * 2)})`;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    this.bits = this.bits.filter((p) => (p.life -= dt) > 0);
    for (const p of this.bits) {
      p.vy += 500 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    this.floaters = this.floaters.filter((f) => (f.t += dt) < 1.4);
    ctx.textAlign = "center";
    ctx.font = "bold 18px system-ui, sans-serif";
    for (const f of this.floaters) {
      const a = Math.min(1, (1.4 - f.t) * 2);
      ctx.globalAlpha = a;
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#000000aa";
      ctx.strokeText(f.text, f.x, f.y - f.t * 30);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - f.t * 30);
    }
    ctx.globalAlpha = 1;
  }

  private drawBanner(dt: number): void {
    const b = this.banner;
    if (!b) return;
    b.t += dt;
    if (b.t > TURN_BANNER) {
      this.banner = null;
      return;
    }
    const ctx = this.ctx;
    const a = Math.min(1, b.t * 5, (TURN_BANNER - b.t) * 3);
    ctx.globalAlpha = a;
    ctx.fillStyle = "#06060c99";
    roundRect(ctx, W / 2 - 220, 120, 440, 64, 18);
    ctx.fill();
    ctx.font = "800 34px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = b.color;
    ctx.fillText(b.text, W / 2, 153);
    ctx.globalAlpha = 1;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Lighten (amt > 0) or darken (amt < 0) a #rrggbb colour. */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(Math.min(255, Math.max(0, amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `rgb(${r}, ${g}, ${b})`;
}

export function powerColor(p: number): string {
  return p < 0.5 ? "#5be37d" : p < 0.8 ? "#ffd84d" : "#ff6b5b";
}
