import type { TouchPads } from "./touchpad";
import { idleIntent, type Controller, type Intent, type Side } from "./types";
import type { World } from "./world";

export interface Finger {
  id: number;
  /** CSS pixel position relative to the canvas. */
  px: number;
  py: number;
}

/** Converts canvas CSS pixels to world coordinates (provided by the renderer). */
export type ToWorld = (px: number, py: number) => { x: number; y: number };

/** Stick dead-zone and the deflection that counts as "up = jump". */
const STICK_DEADZONE = 0.12;
const STICK_JUMP = 0.5;

/**
 * Human input for one device, for one or two local players:
 *  - on-screen joystick + aux button per player (`TouchPads`): the stick's
 *    sideways deflection sets run speed, pushing it up jumps;
 *  - or "drag slime": the slime chases your finger's x at its own top speed
 *    (a fast drag leaves it lagging); drag above it to jump, higher = higher;
 *  - keyboard: A/D/W + S (aux) for the left player, arrows + ↓ for the right
 *    (either set in 1P).
 */
export class HumanInput {
  readonly fingers: [Finger | null, Finger | null] = [null, null];
  private readonly keys = new Set<string>();
  private readonly intents: [Intent, Intent] = [idleIntent(), idleIntent()];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly toWorld: ToWorld,
    /** Which sides are human-controlled. */
    private readonly humans: [boolean, boolean],
    /** On-screen controls (one set per human, in side order), if shown. */
    private pads: TouchPads | null = null,
    /** Allow drag-the-slime touch steering on the canvas. */
    private dragEnabled = true,
  ) {
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  reset(): void {
    this.fingers[0] = this.fingers[1] = null;
    this.keys.clear();
    this.pads?.reset();
  }

  /** Swap in rebuilt on-screen controls (after editing the layout). */
  setPads(pads: TouchPads | null, dragEnabled: boolean): void {
    this.pads = pads;
    this.dragEnabled = dragEnabled;
    this.fingers[0] = this.fingers[1] = null;
  }

  controller(side: Side): Controller {
    return { getIntent: (world) => this.intentFor(world, side) };
  }

  private get twoPlayer(): boolean {
    return this.humans[0] && this.humans[1];
  }

  private sideForPointer(px: number): Side | null {
    if (this.twoPlayer) return px < this.canvas.clientWidth / 2 ? 0 : 1;
    if (this.humans[0]) return 0;
    if (this.humans[1]) return 1;
    return null;
  }

  private local(e: PointerEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  private readonly onDown = (e: PointerEvent) => {
    if (!this.dragEnabled) return;
    const [px, py] = this.local(e);
    const side = this.sideForPointer(px);
    if (side === null) return;
    e.preventDefault();
    // The newest finger on a side takes over (handles a lost pointerup).
    this.fingers[side] = { id: e.pointerId, px, py };
  };

  private readonly onMove = (e: PointerEvent) => {
    for (const f of this.fingers) {
      if (f && f.id === e.pointerId) {
        [f.px, f.py] = this.local(e);
      }
    }
  };

  private readonly onUp = (e: PointerEvent) => {
    for (const s of [0, 1] as const) {
      if (this.fingers[s]?.id === e.pointerId) this.fingers[s] = null;
    }
  };

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (KEY_CODES.has(e.code)) e.preventDefault();
    this.keys.add(e.code);
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private intentFor(world: World, side: Side): Intent {
    const intent = this.intents[side];
    const s = world.slimes[side];
    intent.targetX = null;
    intent.moveX = 0;
    intent.jump = false;
    intent.jumpPower = 1;

    const map = this.twoPlayer ? (side === 0 ? WASD : ARROWS) : BOTH;
    const held = (keys: string[]) => keys.some((k) => this.keys.has(k));
    // Pads are created one per human, in side order.
    const pad = this.pads?.state[this.twoPlayer ? side : 0] ?? null;
    intent.aux = held(map.aux) || (pad?.aux ?? false);

    const f = this.fingers[side];
    if (f) {
      const w = this.toWorld(f.px, f.py);
      intent.targetX = Math.max(s.minX, Math.min(s.maxX, w.x));
      // Finger marks where the middle of the dome should go; above a small
      // dead-zone that means "jump this high".
      const wantBase = w.y - s.char.radius * 0.5 - s.y;
      if (wantBase > 28) {
        intent.jump = true;
        intent.jumpPower = Math.sqrt(2 * world.physics.gravity * wantBase) / s.char.jump;
      }
      return intent;
    }

    if (pad?.active) {
      const ax = Math.abs(pad.x);
      intent.moveX = ax < STICK_DEADZONE ? 0 : (Math.sign(pad.x) * (ax - STICK_DEADZONE)) / (1 - STICK_DEADZONE);
      intent.jump = pad.y > STICK_JUMP;
    }
    const keyX = (held(map.right) ? 1 : 0) - (held(map.left) ? 1 : 0);
    if (keyX !== 0) intent.moveX = keyX;
    if (held(map.up)) intent.jump = true;
    return intent;
  }
}

interface KeyMap {
  left: string[];
  right: string[];
  up: string[];
  aux: string[];
}
const WASD: KeyMap = { left: ["KeyA"], right: ["KeyD"], up: ["KeyW"], aux: ["KeyS"] };
const ARROWS: KeyMap = { left: ["ArrowLeft"], right: ["ArrowRight"], up: ["ArrowUp"], aux: ["ArrowDown"] };
const BOTH: KeyMap = {
  left: [...WASD.left, ...ARROWS.left],
  right: [...WASD.right, ...ARROWS.right],
  up: [...WASD.up, ...ARROWS.up, "Space"],
  aux: [...WASD.aux, ...ARROWS.aux],
};
const KEY_CODES = new Set([...BOTH.left, ...BOTH.right, ...BOTH.up, ...BOTH.aux]);
