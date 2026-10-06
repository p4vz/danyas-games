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

/**
 * Human input for one device: drag-to-move touch (one finger per side in
 * same-device 2P), plus keyboard (WASD for left, arrows for right — or both
 * for the left player in 1P).
 *
 * Touch model: the slime chases your finger's x at its own top speed and
 * acceleration, so a fast drag leaves it lagging behind. Drag above the slime
 * to jump — the higher your finger, the higher the jump.
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

    const map = this.twoPlayer ? (side === 0 ? WASD : ARROWS) : BOTH;
    const left = map.left.some((k) => this.keys.has(k));
    const right = map.right.some((k) => this.keys.has(k));
    intent.moveX = (right ? 1 : 0) - (left ? 1 : 0);
    intent.jump = map.up.some((k) => this.keys.has(k));
    return intent;
  }
}

interface KeyMap {
  left: string[];
  right: string[];
  up: string[];
}
const WASD: KeyMap = { left: ["KeyA"], right: ["KeyD"], up: ["KeyW"] };
const ARROWS: KeyMap = { left: ["ArrowLeft"], right: ["ArrowRight"], up: ["ArrowUp"] };
const BOTH: KeyMap = {
  left: [...WASD.left, ...ARROWS.left],
  right: [...WASD.right, ...ARROWS.right],
  up: [...WASD.up, ...ARROWS.up, "Space"],
};
const KEY_CODES = new Set([...BOTH.left, ...BOTH.right, ...BOTH.up]);
