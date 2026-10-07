import { floatingZone, resolve, type ControlSettings, type LayoutId, type Rect } from "./controls";

/** What one player's on-screen controls are doing right now. */
export interface PadState {
  /** Stick deflection, unit circle; y is up-positive. */
  x: number;
  y: number;
  /** Stick currently touched. */
  active: boolean;
  aux: boolean;
}

interface StickParts {
  hit: HTMLElement;
  base: HTMLElement;
  knob: HTMLElement;
  zone: HTMLElement | null;
  home: Rect;
  /** Current base centre (moves in floating mode). */
  cx: number;
  cy: number;
  pointer: number | null;
}

/** Fraction of the radius the knob may travel. */
const KNOB_TRAVEL = 1;

/**
 * Virtual joystick(s) + aux button(s) overlaid on the game, one set per local
 * player. Each control captures its own pointer, so two players (or a thumb on
 * the stick and a thumb on the button) work simultaneously.
 */
export class TouchPads {
  readonly state: PadState[];
  private readonly root: HTMLElement;
  private readonly sticks: (StickParts | null)[] = [];
  private readonly auxes: (HTMLElement | null)[] = [];
  private readonly cleanup: (() => void)[] = [];

  constructor(
    container: HTMLElement,
    private readonly settings: ControlSettings,
    private readonly layout: LayoutId,
    /** Accent colour per local player. */
    private readonly colors: string[],
    auxLabel: string | null,
  ) {
    const players = layout === "one" ? 1 : 2;
    this.state = Array.from({ length: players }, () => ({ x: 0, y: 0, active: false, aux: false }));
    this.root = document.createElement("div");
    this.root.className = "pads";
    this.root.style.setProperty("--pad-opacity", String(settings.opacity));
    container.appendChild(this.root);

    for (let i = 0; i < players; i++) {
      this.sticks.push(settings.style === "joystick" ? this.buildStick(i) : null);
      this.auxes.push(auxLabel ? this.buildAux(i, auxLabel) : null);
    }
    this.layoutControls();
  }

  dispose(): void {
    for (const fn of this.cleanup) fn();
    this.root.remove();
  }

  /** Release everything (e.g. on pause, so no button sticks down). */
  reset(): void {
    this.state.forEach((st, i) => {
      st.x = st.y = 0;
      st.active = st.aux = false;
      const stick = this.sticks[i];
      if (stick) {
        stick.pointer = null;
        this.placeBase(stick, stick.home.cx, stick.home.cy);
        this.moveKnob(stick, 0, 0);
        stick.base.classList.remove("pad-base--live");
      }
      this.auxes[i]?.classList.remove("pad-aux--down");
    });
  }

  setAuxLabel(player: number, text: string): void {
    const el = this.auxes[player];
    if (el && el.textContent !== text) el.textContent = text;
  }

  /** Re-place everything for the current screen size. */
  layoutControls(): void {
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    const players = this.layout === "one" ? this.settings.layouts.one : this.settings.layouts.two;
    players.forEach((pc, i) => {
      const stick = this.sticks[i];
      if (stick) {
        stick.home = resolve(pc.stick, "stick", this.layout, i, w, h);
        const s = stick.home.size;
        const hitSize = s * 1.35;
        Object.assign(stick.hit.style, {
          width: `${hitSize}px`,
          height: `${hitSize}px`,
          left: `${stick.home.cx - hitSize / 2}px`,
          top: `${stick.home.cy - hitSize / 2}px`,
        });
        Object.assign(stick.base.style, { width: `${s}px`, height: `${s}px` });
        Object.assign(stick.knob.style, { width: `${s * 0.44}px`, height: `${s * 0.44}px` });
        if (stick.zone) {
          const z = floatingZone(this.layout, i, w, h);
          Object.assign(stick.zone.style, {
            left: `${z.left}px`,
            top: `${z.top}px`,
            width: `${z.width}px`,
            height: `${z.height}px`,
          });
        }
        if (stick.pointer === null) this.placeBase(stick, stick.home.cx, stick.home.cy);
      }
      const aux = this.auxes[i];
      if (aux) {
        const r = resolve(pc.aux, "aux", this.layout, i, w, h);
        Object.assign(aux.style, {
          width: `${r.size}px`,
          height: `${r.size}px`,
          left: `${r.cx - r.size / 2}px`,
          top: `${r.cy - r.size / 2}px`,
          fontSize: `${Math.max(11, r.size * 0.2)}px`,
        });
      }
    });
  }

  // ------------------------------------------------------------ stick

  private buildStick(i: number): StickParts {
    const hit = document.createElement("div");
    hit.className = "pad-stick";
    const base = document.createElement("div");
    base.className = "pad-base";
    base.style.setProperty("--pc", this.colors[i]);
    const knob = document.createElement("div");
    knob.className = "pad-knob";
    base.appendChild(knob);

    let zone: HTMLElement | null = null;
    if (this.settings.floating) {
      zone = document.createElement("div");
      zone.className = "pad-zone";
      this.root.appendChild(zone);
    }
    this.root.appendChild(hit);
    // The visual base lives directly in the root so it can roam (floating).
    this.root.appendChild(base);

    const parts: StickParts = { hit, base, knob, zone, home: { cx: 0, cy: 0, size: 100 }, cx: 0, cy: 0, pointer: null };
    const st = this.state[i];

    const update = (e: PointerEvent) => {
      const [px, py] = this.local(e);
      const radius = parts.home.size / 2;
      let dx = px - parts.cx;
      let dy = py - parts.cy;
      const d = Math.hypot(dx, dy);
      if (zone && d > radius) {
        // Floating sticks follow a thumb that slides past the edge.
        const pull = d - radius;
        this.placeBase(parts, parts.cx + (dx / d) * pull, parts.cy + (dy / d) * pull);
        dx = px - parts.cx;
        dy = py - parts.cy;
      }
      const len = Math.hypot(dx, dy);
      const k = len > radius ? radius / len : 1;
      dx *= k;
      dy *= k;
      st.x = dx / radius;
      st.y = -dy / radius;
      this.moveKnob(parts, dx * KNOB_TRAVEL, dy * KNOB_TRAVEL);
    };
    const down = (e: PointerEvent) => {
      if (parts.pointer !== null) return;
      e.preventDefault();
      parts.pointer = e.pointerId;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      if (zone) {
        const [px, py] = this.local(e);
        this.placeBase(parts, px, py);
      }
      st.active = true;
      base.classList.add("pad-base--live");
      update(e);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId === parts.pointer) update(e);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== parts.pointer) return;
      parts.pointer = null;
      st.active = false;
      st.x = st.y = 0;
      base.classList.remove("pad-base--live");
      this.moveKnob(parts, 0, 0);
      this.placeBase(parts, parts.home.cx, parts.home.cy);
    };
    for (const el of zone ? [hit, zone] : [hit]) {
      this.listen(el, "pointerdown", down);
      this.listen(el, "pointermove", move);
      this.listen(el, "pointerup", up);
      this.listen(el, "pointercancel", up);
      this.listen(el, "lostpointercapture", up);
    }
    return parts;
  }

  private placeBase(parts: StickParts, cx: number, cy: number): void {
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    const half = parts.home.size / 2;
    parts.cx = Math.max(half, Math.min(w - half, cx));
    parts.cy = Math.max(half, Math.min(h - half, cy));
    parts.base.style.transform = `translate(${parts.cx - half}px, ${parts.cy - half}px)`;
  }

  private moveKnob(parts: StickParts, dx: number, dy: number): void {
    parts.knob.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px)`;
  }

  // ------------------------------------------------------------ aux

  private buildAux(i: number, label: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "pad-aux";
    el.textContent = label;
    el.style.setProperty("--pc", this.colors[i]);
    this.root.appendChild(el);
    const st = this.state[i];
    let pointer: number | null = null;
    this.listen(el, "pointerdown", (e) => {
      if (pointer !== null) return;
      e.preventDefault();
      pointer = e.pointerId;
      el.setPointerCapture(e.pointerId);
      st.aux = true;
      el.classList.add("pad-aux--down");
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      st.aux = false;
      el.classList.remove("pad-aux--down");
    };
    this.listen(el, "pointerup", up);
    this.listen(el, "pointercancel", up);
    this.listen(el, "lostpointercapture", up);
    return el;
  }

  // ------------------------------------------------------------ helpers

  private local(e: PointerEvent): [number, number] {
    const rect = this.root.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  private listen(el: HTMLElement, type: string, fn: (e: PointerEvent) => void): void {
    const h = fn as EventListener;
    el.addEventListener(type, h);
    this.cleanup.push(() => el.removeEventListener(type, h));
  }
}

/** Whether this device has a touchscreen (show on-screen controls by default). */
export function hasTouch(): boolean {
  return (navigator.maxTouchPoints ?? 0) > 0 || window.matchMedia?.("(pointer: coarse)").matches === true;
}
