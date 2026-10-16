import { DT, FUEL, IDLE, type Match, type TurnInput } from "./match";
import type { Seat } from "./net";
import { powerColor } from "./render";
import { SPEED_STEP } from "./upgrades";

/** Charge per second while FIRE is held (full power in ~1.4 s). */
const CHARGE_RATE = 0.7;

type Hold = "left" | "right" | "up" | "down" | "fire";

/**
 * The shared on-screen control bar + keyboard. In hot-seat play every player
 * uses this same seat; it always drives whoever's turn it is.
 *
 *   ◀ ▶  drive (if movement is on)   ▼ ▲  tilt cannon   FIRE  hold to charge,
 *   release to shoot.
 *
 * Keyboard: A/D or ←/→ drive, W/S or ↑/↓ tilt, Space (hold) fire.
 */
export class LocalSeat implements Seat {
  readonly kind = "local" as const;
  readonly el: HTMLElement;
  private readonly held = new Set<Hold>();
  private readonly keys = new Set<Hold>();
  private charge: number | null = null;
  private pendingFire: number | null = null;
  private readonly angleEl: HTMLElement;
  private readonly fuelEl: HTMLElement;
  private readonly powerEl: HTMLElement;
  private readonly lastEl: HTMLElement;
  private readonly fireBtn: HTMLElement;

  constructor(host: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "tb-bar";
    this.el.innerHTML = `
      <div class="tb-group tb-move">
        <button class="tb-btn" data-hold="left" aria-label="Drive left">◀</button>
        <div class="tb-meter tb-fuel"><span></span><small>Fuel</small></div>
        <button class="tb-btn" data-hold="right" aria-label="Drive right">▶</button>
      </div>
      <div class="tb-group">
        <button class="tb-btn" data-hold="down" aria-label="Lower cannon">▼</button>
        <div class="tb-angle"><b>45°</b><small>Angle</small></div>
        <button class="tb-btn" data-hold="up" aria-label="Raise cannon">▲</button>
      </div>
      <div class="tb-group">
        <div class="tb-meter tb-power"><span></span><i></i><small>Power</small></div>
        <button class="tb-btn tb-fire" data-hold="fire">FIRE</button>
      </div>`;
    host.appendChild(this.el);
    this.angleEl = this.el.querySelector(".tb-angle b")!;
    this.fuelEl = this.el.querySelector(".tb-fuel span")!;
    this.powerEl = this.el.querySelector(".tb-power span")!;
    this.lastEl = this.el.querySelector(".tb-power i")!;
    this.fireBtn = this.el.querySelector(".tb-fire")!;

    this.el.querySelectorAll<HTMLElement>("[data-hold]").forEach((btn) => {
      const hold = btn.dataset.hold as Hold;
      const down = (e: PointerEvent) => {
        e.preventDefault();
        btn.setPointerCapture?.(e.pointerId);
        this.press(hold, this.held);
        btn.classList.add("tb-btn--down");
      };
      const up = () => {
        if (!this.held.has(hold)) return;
        this.release(hold, this.held);
        btn.classList.remove("tb-btn--down");
      };
      btn.addEventListener("pointerdown", down);
      btn.addEventListener("pointerup", up);
      btn.addEventListener("pointercancel", up);
      btn.addEventListener("lostpointercapture", up);
      btn.addEventListener("contextmenu", (e) => e.preventDefault());
    });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  private press(h: Hold, set: Set<Hold>): void {
    set.add(h);
    if (h === "fire" && this.charge === null) this.charge = 0;
  }

  private release(h: Hold, set: Set<Hold>): void {
    set.delete(h);
    if (h === "fire" && !this.isHeld("fire") && this.charge !== null) {
      this.pendingFire = this.charge;
      this.charge = null;
    }
  }

  private isHeld(h: Hold): boolean {
    return this.held.has(h) || this.keys.has(h);
  }

  private static keyFor(code: string): Hold | null {
    switch (code) {
      case "KeyA":
      case "ArrowLeft":
        return "left";
      case "KeyD":
      case "ArrowRight":
        return "right";
      case "KeyW":
      case "ArrowUp":
        return "up";
      case "KeyS":
      case "ArrowDown":
        return "down";
      case "Space":
      case "Enter":
        return "fire";
      default:
        return null;
    }
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement | null)?.closest?.("input, textarea")) return;
    const h = LocalSeat.keyFor(e.code);
    if (!h) return;
    e.preventDefault();
    if (e.repeat || this.keys.has(h)) return;
    this.press(h, this.keys);
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    const h = LocalSeat.keyFor(e.code);
    if (!h || !this.keys.has(h)) return;
    this.release(h, this.keys);
  };

  read(match: Match): TurnInput {
    if (!match.canAct) {
      // Ignore anything pressed during the turn intro or mid-flight.
      this.pendingFire = null;
      if (this.charge !== null) this.charge = 0;
      return IDLE;
    }
    if (this.charge !== null) this.charge = Math.min(1, this.charge + CHARGE_RATE * DT);
    const fire = this.pendingFire;
    this.pendingFire = null;
    const dir = (a: Hold, b: Hold): -1 | 0 | 1 => ((this.isHeld(a) ? 1 : 0) - (this.isHeld(b) ? 1 : 0)) as -1 | 0 | 1;
    return { move: dir("right", "left"), aim: dir("up", "down"), charge: this.charge, fire };
  }

  reset(): void {
    this.held.clear();
    this.keys.clear();
    this.charge = null;
    this.pendingFire = null;
    this.el.querySelectorAll(".tb-btn--down").forEach((b) => b.classList.remove("tb-btn--down"));
  }

  /** Refresh readouts and theme the bar in the active player's colour. */
  sync(match: Match): void {
    const t = match.active;
    const color = match.config.players[match.current].color;
    this.el.style.setProperty("--pc", color);
    this.el.classList.toggle("tb-bar--idle", !match.canAct);
    this.el.classList.toggle("tb-bar--nomove", !match.config.movement);
    this.angleEl.textContent = `${Math.round(t.elev)}°`;
    const maxFuel = FUEL * (1 + SPEED_STEP * t.ups.speed);
    this.fuelEl.style.width = `${Math.max(0, Math.min(1, t.fuel / maxFuel)) * 100}%`;
    const p = this.charge ?? 0;
    this.powerEl.style.width = `${p * 100}%`;
    this.powerEl.style.background = powerColor(p);
    this.lastEl.style.left = `${t.lastPower * 100}%`;
    this.fireBtn.textContent = this.charge !== null ? `${Math.round(p * 100)}%` : "FIRE";
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.el.remove();
  }
}
