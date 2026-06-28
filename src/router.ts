import type { Game } from "./core/Game";
import { getGame } from "./games/registry";
import { renderLanding } from "./pages/landing";

/**
 * Minimal hash router. Two routes:
 *   #/                       → landing page
 *   #/game/<id>              → mount that game
 *
 * Hash routing (not history API) keeps things working under the file:// scheme
 * inside the Capacitor WebView with no server-side rewrites.
 */
export class Router {
  private activeGame: Game | null = null;

  constructor(private readonly root: HTMLElement) {}

  start(): void {
    window.addEventListener("hashchange", this.handleRoute);
    window.addEventListener("resize", this.handleResize);
    this.handleRoute();
  }

  private readonly handleResize = () => {
    this.activeGame?.resize();
  };

  private teardown(): void {
    if (this.activeGame) {
      this.activeGame.unmount();
      this.activeGame = null;
    }
    this.root.innerHTML = "";
  }

  private readonly handleRoute = () => {
    const hash = window.location.hash.replace(/^#/, "");
    const match = hash.match(/^\/game\/([\w-]+)$/);

    this.teardown();

    if (match) {
      const entry = getGame(match[1]);
      if (entry?.factory) {
        this.activeGame = entry.factory();
        this.activeGame.mount(this.root);
        return;
      }
      // Unknown or not-yet-playable game → fall back to landing.
      window.location.hash = "#/";
      return;
    }

    renderLanding(this.root);
  };
}

export function navigate(hash: string): void {
  window.location.hash = hash;
}
