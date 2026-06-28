/**
 * Reusable requestAnimationFrame loop.
 *
 * - Passes a clamped delta (seconds) so a long stall (tab switch, GC pause on a
 *   weak tablet) never produces a huge physics jump.
 * - Auto-pauses when the document is hidden to save battery/CPU on mobile.
 */
export class GameLoop {
  private rafId = 0;
  private running = false;
  private lastTime = 0;
  private readonly maxDelta: number;

  constructor(
    private readonly update: (dt: number) => void,
    maxDeltaMs = 50,
  ) {
    this.maxDelta = maxDeltaMs / 1000;
  }

  private readonly onVisibility = () => {
    if (document.hidden) {
      this.pause();
    } else if (this.running) {
      // Resume cleanly without a delta spike.
      this.lastTime = performance.now();
      this.tick(this.lastTime);
    }
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    document.addEventListener("visibilitychange", this.onVisibility);
    this.rafId = requestAnimationFrame(this.tick);
  }

  /** Pause the rAF callback without forgetting we are "running". */
  private pause(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  stop(): void {
    this.running = false;
    this.pause();
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  private readonly tick = (now: number): void => {
    if (!this.running || document.hidden) return;
    const dt = Math.min((now - this.lastTime) / 1000, this.maxDelta);
    this.lastTime = now;
    this.update(dt);
    this.rafId = requestAnimationFrame(this.tick);
  };
}
