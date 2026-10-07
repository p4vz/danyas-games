import { describe, expect, it } from "vitest";
import { baseSize, defaultControls, footprint, loadControls, resolve } from "../controls";

const W = 1024;
const H = 640;

describe("control layout", () => {
  it("defaults: 1P stick bottom-left, aux bottom-right", () => {
    const s = defaultControls();
    const stick = resolve(s.layouts.one[0].stick, "stick", "one", 0, W, H);
    const aux = resolve(s.layouts.one[0].aux, "aux", "one", 0, W, H);
    expect(stick.cx).toBeLessThan(W * 0.2);
    expect(aux.cx).toBeGreaterThan(W * 0.8);
    expect(stick.cy).toBeGreaterThan(H * 0.7);
    expect(aux.cy).toBeCloseTo(stick.cy, 6);
  });

  it("defaults: 2P layouts mirror each other on their own halves", () => {
    const s = defaultControls();
    for (const kind of ["stick", "aux"] as const) {
      const p1 = resolve(s.layouts.two[0][kind], kind, "two", 0, W, H);
      const p2 = resolve(s.layouts.two[1][kind], kind, "two", 1, W, H);
      expect(p1.cx).toBeLessThan(W / 2);
      expect(p2.cx).toBeGreaterThan(W / 2);
      expect(p1.cx + p2.cx).toBeCloseTo(W, 6);
    }
  });

  it("custom placements stay fully on screen and scale the size", () => {
    const p = { fx: 1, fy: 1, scale: 1.5 };
    const r = resolve(p, "stick", "one", 0, W, H);
    expect(r.size).toBeCloseTo(baseSize("stick", W, H) * 1.5, 6);
    expect(r.cx + r.size / 2).toBeLessThanOrEqual(W);
    expect(r.cy + r.size / 2).toBeLessThanOrEqual(H);
  });

  it("measures the bottom strip the controls need, capped, ignoring ones moved up", () => {
    const s = defaultControls();
    const fp = footprint(s, "one", W, H, true);
    expect(fp.inset).toBeGreaterThan(baseSize("stick", W, H));
    expect(fp.inset).toBeLessThanOrEqual(H * 0.32);
    s.layouts.one[0].stick = { fx: 0.2, fy: 0.2, scale: 1 };
    s.layouts.one[0].aux = { fx: 0.8, fy: 0.2, scale: 1 };
    expect(footprint(s, "one", W, H, true).inset).toBe(0);
  });

  it("measures how far controls reach in from the side edges", () => {
    const s = defaultControls();
    const stick = baseSize("stick", W, H);
    // 1P: stick hugs the left edge, aux the right — margin ≈ the stick's reach.
    expect(footprint(s, "one", W, H, true).margin).toBeCloseTo(stick + 18 + 6, 0);
    // 2P: aux buttons sit inboard, so they reach further in.
    expect(footprint(s, "two", W, H, true).margin).toBeGreaterThan(footprint(s, "one", W, H, true).margin);
  });

  it("drag style only reserves room for the aux button", () => {
    const s = defaultControls();
    expect(footprint(s, "one", W, H, false).inset).toBeLessThan(footprint(s, "one", W, H, true).inset);
  });

  it("loading with no storage falls back to defaults", () => {
    expect(loadControls()).toEqual(defaultControls());
  });
});
