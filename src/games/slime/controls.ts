import { loadJSON, saveJSON } from "../../core/storage";

/**
 * On-screen control settings: style, joystick behaviour, opacity, and the
 * player-customised layout of every button (saved per 1P / 2P layout, like
 * the HUD editors in most mobile action games).
 */

export type ControlStyle = "joystick" | "drag";
export type ControlKind = "stick" | "aux";
export type LayoutId = "one" | "two";

/**
 * Where one control sits. `fx`/`fy` are the centre as a fraction of the screen
 * (null = default spot, so defaults keep adapting to the screen until the
 * player moves the control); `scale` multiplies the default size.
 */
export interface Placement {
  fx: number | null;
  fy: number | null;
  scale: number;
}

export interface PlayerControls {
  stick: Placement;
  aux: Placement;
}

export interface ControlSettings {
  style: ControlStyle;
  /** Joystick appears wherever your thumb lands (vs. fixed in place). */
  floating: boolean;
  /** 0.25..1 */
  opacity: number;
  layouts: { one: [PlayerControls]; two: [PlayerControls, PlayerControls] };
}

export const CONTROLS_KEY = "slime.controls";
export const MIN_SCALE = 0.6;
export const MAX_SCALE = 1.6;
/**
 * Default gaps from the screen edges. Kept clear of the OS gesture zones: on
 * Android gesture navigation a swipe starting within ~24dp of a side edge is
 * "Back", and a swipe up from the bottom edge is "Home" on Android and iPad —
 * exactly what a thumb pushing the stick up to jump would do.
 */
const SIDE_GAP = 36;
const BOTTOM_GAP = 30;

/** Device safe-area insets (notches, rounded corners, home indicator), CSS px. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

const freshPlacement = (): Placement => ({ fx: null, fy: null, scale: 1 });
const freshPlayer = (): PlayerControls => ({ stick: freshPlacement(), aux: freshPlacement() });

export function defaultControls(): ControlSettings {
  return {
    style: "joystick",
    floating: false,
    opacity: 0.7,
    layouts: { one: [freshPlayer()], two: [freshPlayer(), freshPlayer()] },
  };
}

/** Load settings, repairing anything missing or malformed from older saves. */
export function loadControls(): ControlSettings {
  const d = defaultControls();
  const raw = loadJSON<Partial<ControlSettings>>(CONTROLS_KEY, {});
  const num = (v: unknown, lo: number, hi: number): number | null =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null;
  const place = (p: Partial<Placement> | undefined): Placement => ({
    fx: num(p?.fx, 0, 1),
    fy: num(p?.fy, 0, 1),
    scale: num(p?.scale, MIN_SCALE, MAX_SCALE) ?? 1,
  });
  const player = (p: Partial<PlayerControls> | undefined): PlayerControls => ({
    stick: place(p?.stick),
    aux: place(p?.aux),
  });
  return {
    style: raw.style === "drag" ? "drag" : d.style,
    floating: typeof raw.floating === "boolean" ? raw.floating : d.floating,
    opacity: num(raw.opacity, 0.25, 1) ?? d.opacity,
    layouts: {
      one: [player(raw.layouts?.one?.[0])],
      two: [player(raw.layouts?.two?.[0]), player(raw.layouts?.two?.[1])],
    },
  };
}

export function saveControls(s: ControlSettings): void {
  saveJSON(CONTROLS_KEY, s);
}

export function playersFor(s: ControlSettings, layout: LayoutId): PlayerControls[] {
  return layout === "one" ? s.layouts.one : s.layouts.two;
}

/** A control resolved to CSS pixels: centre and diameter. */
export interface Rect {
  cx: number;
  cy: number;
  size: number;
}

/**
 * Default diameter for a control kind on this screen, before scaling. On
 * tablets the stick comes out ~23–29 mm and the aux button ~14–18 mm; phones
 * get a 108 px floor (~17 mm) so a jump push is still a deliberate ~4 mm.
 */
export function baseSize(kind: ControlKind, w: number, h: number): number {
  const stick = Math.round(Math.max(108, Math.min(150, Math.min(w, h) * 0.24)));
  return kind === "stick" ? stick : Math.round(stick * 0.62);
}

/** Default centre: sticks at the outer edges, aux buttons inboard (2P) or opposite (1P). */
function defaultCentre(
  kind: ControlKind,
  layout: LayoutId,
  player: number,
  w: number,
  h: number,
  safe: Insets,
): [number, number] {
  const stick = baseSize("stick", w, h);
  const aux = baseSize("aux", w, h);
  const cy = h - safe.bottom - BOTTOM_GAP - stick / 2;
  const left = safe.left + SIDE_GAP;
  const right = w - safe.right - SIDE_GAP;
  if (layout === "one") {
    return kind === "stick" ? [left + stick / 2, cy] : [right - aux / 2, cy];
  }
  const inboard = stick + 24 + aux / 2;
  if (player === 0) return [kind === "stick" ? left + stick / 2 : left + inboard, cy];
  return [kind === "stick" ? right - stick / 2 : right - inboard, cy];
}

/** Resolve a placement to pixels, kept fully inside the safe area. */
export function resolve(
  p: Placement,
  kind: ControlKind,
  layout: LayoutId,
  player: number,
  w: number,
  h: number,
  safe: Insets = NO_INSETS,
): Rect {
  const size = baseSize(kind, w, h) * p.scale;
  const [dx, dy] = defaultCentre(kind, layout, player, w, h, safe);
  const half = size / 2 + 4;
  const cx = Math.max(safe.left + half, Math.min(w - safe.right - half, p.fx === null ? dx : p.fx * w));
  const cy = Math.max(safe.top + half, Math.min(h - safe.bottom - half, p.fy === null ? dy : p.fy * h));
  return { cx, cy, size };
}

/** Where a floating joystick can be summoned: the player's side, lower 70%. */
export function floatingZone(layout: LayoutId, player: number, w: number, h: number, safe: Insets = NO_INSETS) {
  const x0 = safe.left;
  const x1 = w - safe.right;
  const mid = (x0 + x1) / 2;
  const left = layout === "one" || player === 0 ? x0 : mid;
  const right = layout === "one" ? x0 + (x1 - x0) * 0.55 : player === 0 ? mid : x1;
  const top = h * 0.3;
  return { left, top, width: right - left, height: h - safe.bottom - top };
}

/**
 * Room the bottom controls need, so the renderer can keep slimes from ever
 * hiding under a thumb — either by lifting the floor above them (`inset`, the
 * strip height) or by narrowing the field until they sit in the side margins
 * (`margin`, how far they reach in from the nearest side edge). The renderer
 * picks whichever leaves the bigger field. Controls the player moved up into
 * the sky don't count.
 */
export interface Footprint {
  inset: number;
  margin: number;
}

export function footprint(
  s: ControlSettings,
  layout: LayoutId,
  w: number,
  h: number,
  withStick: boolean,
  safe: Insets = NO_INSETS,
): Footprint {
  let inset = 0;
  let margin = 0;
  playersFor(s, layout).forEach((pc, i) => {
    for (const kind of ["stick", "aux"] as const) {
      if (kind === "stick" && !withStick) continue;
      const r = resolve(pc[kind], kind, layout, i, w, h, safe);
      if (r.cy < h * 0.6) continue;
      inset = Math.max(inset, h - (r.cy - r.size / 2) + 6);
      margin = Math.max(margin, r.cx < w / 2 ? r.cx + r.size / 2 : w - (r.cx - r.size / 2));
    }
  });
  return { inset: Math.min(inset, h * 0.32), margin: margin + 6 };
}
