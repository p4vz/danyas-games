/**
 * Unified jump input: pointer (touch/mouse) on the canvas + keyboard.
 *
 * - `consumeJump()` returns true once per discrete press (buffered tap).
 * - `held` reflects whether a press is currently being held, enabling the
 *   Geometry-Dash-style "hold to keep jumping" feel.
 */
export class Input {
  private buffered = false;
  held = false;

  constructor(private readonly target: HTMLElement) {
    target.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  private readonly onPointerDown = () => {
    this.buffered = true;
    this.held = true;
  };

  private readonly onPointerUp = () => {
    this.held = false;
  };

  private readonly onKeyDown = (e: KeyboardEvent) => {
    // Don't hijack typing in form fields (e.g. the level-editor name input).
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.code === "Space" || e.code === "ArrowUp") {
      e.preventDefault();
      if (!e.repeat) this.buffered = true;
      this.held = true;
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    if (e.code === "Space" || e.code === "ArrowUp") {
      this.held = false;
    }
  };

  /** Consume a buffered discrete jump press. */
  consumeJump(): boolean {
    if (this.buffered) {
      this.buffered = false;
      return true;
    }
    return false;
  }

  reset(): void {
    this.buffered = false;
    this.held = false;
  }

  dispose(): void {
    this.target.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }
}
