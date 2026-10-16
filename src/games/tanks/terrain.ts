import { Rng } from "./rng";

/** World size in world units. One terrain cell = one world unit. */
export const W = 1200;
export const H = 720;

export const AIR = 0;
export const DIRT = 1;
/** Dirt at the rim of a crater (darker, otherwise identical to dirt). */
export const SCORCH = 2;
/** Castle walls: only the inner part of a blast can break stone. */
export const STONE = 3;
/** Indestructible floor so tanks can never fall out of the world. */
export const BEDROCK = 4;

const BEDROCK_ROWS = 10;
/** Castle walls stand this far from each tank: low shots still clear your own wall. */
export const WALL_OFFSET = 60;
/** Fraction of the blast radius that breaks stone. */
const STONE_RESIST = 0.55;
const SCORCH_RING = 4;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Destructible terrain as a W×H material mask. Pure data (no DOM), so the
 * sim and tests use it directly; the renderer paints it into an ImageData.
 */
export class Terrain {
  readonly cells = new Uint8Array(W * H);

  get(x: number, y: number): number {
    x = Math.floor(x);
    y = Math.floor(y);
    if (y >= H) return BEDROCK;
    if (x < 0 || x >= W || y < 0) return AIR;
    return this.cells[y * W + x];
  }

  solid(x: number, y: number): boolean {
    return this.get(x, y) !== AIR;
  }

  /** Top-most solid row in column `x` at or below `fromY` (H if none). */
  surfaceBelow(x: number, fromY = 0): number {
    x = Math.floor(x);
    if (x < 0 || x >= W) return H;
    for (let y = Math.max(0, Math.floor(fromY)); y < H; y++) {
      if (this.cells[y * W + x] !== AIR) return y;
    }
    return H;
  }

  /** Blow a round hole; returns the touched area so the renderer can repaint it. */
  carve(cx: number, cy: number, r: number): Rect {
    const outer = r + SCORCH_RING;
    const x0 = Math.max(0, Math.floor(cx - outer));
    const x1 = Math.min(W - 1, Math.ceil(cx + outer));
    const y0 = Math.max(0, Math.floor(cy - outer));
    const y1 = Math.min(H - 1, Math.ceil(cy + outer));
    const r2 = r * r;
    const s2 = (r * STONE_RESIST) ** 2;
    const o2 = outer * outer;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const d2 = dx * dx + dy * dy;
        if (d2 > o2) continue;
        const i = y * W + x;
        const m = this.cells[i];
        if (m === DIRT || m === SCORCH) this.cells[i] = d2 <= r2 ? AIR : SCORCH;
        else if (m === STONE && d2 <= s2) this.cells[i] = AIR;
      }
    }
    return { x0, y0, x1, y1 };
  }

  fillRect(x0: number, y0: number, x1: number, y1: number, m: number): void {
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) this.cells[y * W + x] = m;
    }
  }
}

/** Evenly spaced starting columns for `n` tanks. */
export function spawnColumns(n: number): number[] {
  const margin = 90;
  if (n <= 1) return [W / 2];
  return Array.from({ length: n }, (_, i) => Math.round(margin + (i * (W - 2 * margin)) / (n - 1)));
}

/**
 * Rolling hills from a few random sine waves, flat pads under each tank and,
 * optionally, a small stone castle wall shielding each tank from its neighbours.
 */
export function generateTerrain(seed: number, players: number, castles: boolean): Terrain {
  const rng = new Rng(seed ^ 0x9e3779b9);
  const t = new Terrain();
  const waves = [
    { a: rng.range(40, 75), f: rng.range(1.2, 2.2), p: rng.range(0, Math.PI * 2) },
    { a: rng.range(15, 35), f: rng.range(3, 5), p: rng.range(0, Math.PI * 2) },
    { a: rng.range(4, 10), f: rng.range(8, 12), p: rng.range(0, Math.PI * 2) },
  ];
  const base = H * rng.range(0.6, 0.68);
  const heights = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    let h = base;
    for (const w of waves) h += w.a * Math.sin((x / W) * Math.PI * 2 * w.f + w.p);
    heights[x] = Math.min(H * 0.86, Math.max(H * 0.32, h));
  }

  // Flatten a pad under each tank, blending smoothly into the hills.
  const cols = spawnColumns(players);
  for (const cx of cols) {
    let sum = 0;
    for (let x = cx - 24; x <= cx + 24; x++) sum += heights[x];
    const pad = sum / 49;
    // Wide enough to seat the castle walls level with the tank.
    const flat = WALL_OFFSET + 14;
    for (let x = cx - flat - 40; x <= cx + flat + 40; x++) {
      if (x < 0 || x >= W) continue;
      const d = Math.abs(x - cx);
      const k = d <= flat ? 1 : 1 - (d - flat) / 40;
      heights[x] = heights[x] * (1 - k) + pad * k;
    }
  }

  for (let x = 0; x < W; x++) {
    const top = Math.round(heights[x]);
    for (let y = top; y < H; y++) t.cells[y * W + x] = DIRT;
  }

  if (castles) {
    cols.forEach((cx, i) => {
      if (i > 0) buildWall(t, cx - WALL_OFFSET);
      if (i < cols.length - 1) buildWall(t, cx + WALL_OFFSET);
    });
  }

  t.fillRect(0, H - BEDROCK_ROWS, W, H, BEDROCK);
  return t;
}

/** A crenellated stone wall centred on column `cx`, sunk into the ground. */
function buildWall(t: Terrain, cx: number): void {
  const half = 9;
  const height = 36;
  let ground = H;
  for (let x = cx - half; x <= cx + half; x++) ground = Math.min(ground, t.surfaceBelow(x));
  const top = ground - height;
  for (let x = cx - half; x <= cx + half; x++) {
    const notch = Math.floor((x - (cx - half)) / 5) % 2 === 1;
    const y0 = notch ? top + 8 : top;
    t.fillRect(x, y0, x + 1, t.surfaceBelow(x) + 6, STONE);
  }
}

// ------------------------------------------------------------------ painting

const rgba = (r: number, g: number, b: number) => (255 << 24) | (b << 16) | (g << 8) | r;
const SKY_CLEAR = 0;

function hash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Paint `rect` of the terrain into a little-endian RGBA pixel buffer (W×H).
 * Air is transparent so the sky shows through.
 */
export function paintTerrain(t: Terrain, px: Uint32Array, rect: Rect = { x0: 0, y0: 0, x1: W - 1, y1: H - 1 }): void {
  const c = t.cells;
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      const i = y * W + x;
      const m = c[i];
      const n = hash(x, y);
      let col = SKY_CLEAR;
      if (m === DIRT) {
        if (isTopEdge(c, x, y)) {
          // Grass on surfaces open to the sky.
          col = rgba(70 + n * 30, 160 + n * 40, 60 + n * 20);
        } else {
          const band = Math.sin(y * 0.05 + x * 0.004) * 10;
          col = rgba(136 + band + n * 22, 94 + band * 0.6 + n * 16, 56 + n * 12);
        }
      } else if (m === SCORCH) {
        col = rgba(70 + n * 18, 46 + n * 12, 30 + n * 8);
      } else if (m === STONE) {
        const row = Math.floor(y / 8);
        const mortar = y % 8 === 0 || (x + (row % 2) * 6) % 12 === 0;
        const g = mortar ? 92 : 150 + n * 26;
        col = rgba(g, g, g + 8);
      } else if (m === BEDROCK) {
        const g = 48 + n * 14;
        col = rgba(g, g, g + 6);
      }
      px[i] = col;
    }
  }
}

/** True when this dirt cell is within the top few rows of an untouched surface. */
function isTopEdge(c: Uint8Array, x: number, y: number): boolean {
  for (let k = 1; k <= 6; k++) {
    const yy = y - k;
    if (yy < 0) return true;
    const m = c[yy * W + x];
    if (m === AIR) return true;
    if (m !== DIRT) return false;
  }
  return false;
}
