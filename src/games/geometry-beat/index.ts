import type { Game } from "../../core/Game";
import { GameLoop } from "../../core/GameLoop";
import { loadNumber, saveBest } from "../../core/storage";
import { navigate } from "../../router";
import { BEATMAPS, type Beatmap } from "./beatmap";
import { GameAudio } from "./audio";
import { Engine } from "./engine";
import { Input } from "./input";
import { Renderer } from "./render";
import { LevelEditor } from "./editor";
import { deleteCustom, listCustom, saveCustom } from "./customLevels";

const ACCENT = "#46e3ff";
type State = "menu" | "playing" | "paused" | "gameover" | "complete";

class GeometryBeat implements Game {
  private root!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private overlay!: HTMLElement;
  private topbar!: HTMLElement;
  private scorePill!: HTMLElement;

  private renderer!: Renderer;
  private input!: Input;
  private loop!: GameLoop;

  private audio: GameAudio | null = null;
  private engine: Engine | null = null;
  private current: Beatmap | null = null;

  private editor: LevelEditor | null = null;
  /** When true, a play session was launched from the editor's Test button, so
   *  exiting the run returns to the editor (with the draft) instead of the menu. */
  private fromEditor = false;
  private editorDraft: Beatmap | null = null;

  private state: State = "menu";
  private deathTimer = 0;

  mount(container: HTMLElement): void {
    this.root = document.createElement("div");
    this.root.className = "game-root";
    this.root.innerHTML = `
      <canvas></canvas>
      <div class="game-topbar hidden">
        <button class="icon-btn" data-act="menu" aria-label="Back">‹</button>
        <span class="pill" data-score>0</span>
        <button class="icon-btn" data-act="pause" aria-label="Pause">II</button>
      </div>
      <div class="game-overlay"></div>
    `;
    container.appendChild(this.root);

    this.canvas = this.root.querySelector("canvas")!;
    this.overlay = this.root.querySelector(".game-overlay")!;
    this.topbar = this.root.querySelector(".game-topbar")!;
    this.scorePill = this.root.querySelector("[data-score]")!;
    this.root.style.setProperty("--accent", ACCENT);

    const ctx = this.canvas.getContext("2d", { alpha: false })!;
    this.renderer = new Renderer(this.canvas, ctx, ACCENT);
    this.input = new Input(this.canvas);
    this.loop = new GameLoop((dt) => this.tick(dt));

    this.topbar.addEventListener("click", this.onTopbar);
    document.addEventListener("visibilitychange", this.onVisibility);

    this.resize();
    this.showMenu();
  }

  unmount(): void {
    this.loop.stop();
    this.audio?.stop();
    this.editor?.destroy();
    this.input.dispose();
    this.topbar.removeEventListener("click", this.onTopbar);
    document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.deathTimer) clearTimeout(this.deathTimer);
    this.root.remove();
  }

  resize(): void {
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    this.renderer.resize(w, h);
    this.engine?.layout(w, h);
    if (this.engine && this.state !== "playing") {
      // Redraw a static frame so menus over a level still look right.
      this.renderer.draw(this.engine, this.audio?.beat ?? 0);
    }
  }

  // ---- loop ----
  private tick(dt: number): void {
    if (!this.engine || !this.audio) return;
    const beat = this.audio.beat;
    this.engine.update(dt, beat);
    this.renderer.draw(this.engine, beat);
    this.scorePill.textContent = String(this.engine.score);
  }

  // ---- state transitions ----
  private startLevel(beatmap: Beatmap): void {
    this.current = beatmap;
    this.audio?.stop();
    this.audio = new GameAudio(beatmap.bpm, beatmap.intensity);
    this.engine = new Engine(beatmap, this.input, {
      onScore: () => {},
      onDeath: () => this.onDeath(),
      onComplete: () => this.onComplete(),
    });
    this.resize();
    this.input.reset();
    this.state = "playing";
    this.hideOverlay();
    this.topbar.classList.remove("hidden");
    void this.audio.start();
    this.loop.start();
  }

  private onDeath(): void {
    this.audio?.stop();
    const best = this.persistBest();
    // Let the death burst play before the overlay drops.
    this.deathTimer = window.setTimeout(() => {
      this.state = "gameover";
      this.loop.stop();
      this.showGameOver(this.engine?.score ?? 0, best);
    }, 650);
  }

  private onComplete(): void {
    this.loop.stop();
    this.audio?.stop();
    const best = this.persistBest();
    this.state = "complete";
    this.showComplete(this.engine?.score ?? 0, best);
  }

  private pause(): void {
    if (this.state !== "playing") return;
    this.state = "paused";
    this.loop.stop();
    void this.audio?.pause();
    this.showPause();
  }

  private resume(): void {
    if (this.state !== "paused") return;
    this.state = "playing";
    this.hideOverlay();
    this.input.reset();
    void this.audio?.resume();
    this.loop.start();
  }

  private persistBest(): number {
    if (!this.current || !this.engine) return 0;
    return saveBest(`geobeat.best.${this.current.id}`, this.engine.score);
  }

  // ---- handlers ----
  private readonly onTopbar = (e: Event) => {
    const act = (e.target as HTMLElement).closest("[data-act]")?.getAttribute("data-act");
    if (act === "pause") this.pause();
    else if (act === "menu") this.exitHub();
  };

  /** Leave a run: back to the editor if we came from it, else the level menu. */
  private exitHub(): void {
    if (this.fromEditor && this.editorDraft) this.openEditor(this.editorDraft);
    else this.showMenu();
  }

  private hubLabel(): string {
    return this.fromEditor ? "Editor" : "Levels";
  }

  private readonly onVisibility = () => {
    if (document.hidden && this.state === "playing") this.pause();
  };

  // ---- overlays ----
  private hideOverlay(): void {
    this.overlay.classList.add("hidden");
    this.overlay.innerHTML = "";
  }

  private showOverlay(html: string): void {
    this.overlay.innerHTML = html;
    this.overlay.classList.remove("hidden");
  }

  private showMenu(): void {
    this.state = "menu";
    this.loop.stop();
    this.audio?.stop();
    this.closeEditor();
    this.fromEditor = false;
    this.editorDraft = null;
    if (this.deathTimer) clearTimeout(this.deathTimer);
    this.engine = null;
    this.topbar.classList.add("hidden");

    // Clear the canvas behind the menu.
    const ctx = this.canvas.getContext("2d", { alpha: false })!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0a0a12";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const levels = BEATMAPS.map((b) => {
      const best = loadNumber(`geobeat.best.${b.id}`);
      return `<button class="btn btn--ghost" data-level="${b.id}">
          ${b.name} · <small>${b.difficulty}${best ? ` · best ${best}` : ""}</small>
        </button>`;
    }).join("");

    const custom = listCustom();
    const customRows = custom
      .map(
        (b) => `<div class="level-row">
          <button class="btn btn--ghost level-row__play" data-level="${b.id}">
            ${escapeHtml(b.name)} · <small>${b.notes.length} obstacles</small>
          </button>
          <button class="icon-btn" data-edit="${b.id}" aria-label="Edit">✎</button>
          <button class="icon-btn" data-delete="${b.id}" aria-label="Delete">✕</button>
        </div>`,
      )
      .join("");
    const customSection = custom.length
      ? `<h3 class="menu-subhead">Your levels</h3><div class="level-list">${customRows}</div>`
      : "";

    this.showOverlay(`
      <h2>Geometry Beat</h2>
      <p>Tap or press Space to jump. Obstacles arrive on the beat — find the rhythm.</p>
      <div class="level-list">${levels}</div>
      <button class="btn" data-act="create">＋ Create level</button>
      ${customSection}
      <button class="btn btn--ghost" data-act="home">← All games</button>
    `);

    this.overlay.querySelectorAll<HTMLElement>("[data-level]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.level!;
        const map = BEATMAPS.find((b) => b.id === id) ?? custom.find((b) => b.id === id);
        if (map) this.startLevel(map);
      });
    });
    this.overlay.querySelectorAll<HTMLElement>("[data-edit]").forEach((el) => {
      el.addEventListener("click", () => {
        const map = custom.find((b) => b.id === el.dataset.edit);
        if (map) this.openEditor(map);
      });
    });
    this.overlay.querySelectorAll<HTMLElement>("[data-delete]").forEach((el) => {
      el.addEventListener("click", () => {
        deleteCustom(el.dataset.delete!);
        this.showMenu();
      });
    });
    this.overlay
      .querySelector('[data-act="create"]')
      ?.addEventListener("click", () => this.openEditor());
    this.overlay
      .querySelector('[data-act="home"]')
      ?.addEventListener("click", () => navigate("#/"));
  }

  // ---- editor ----
  private openEditor(initial?: Beatmap): void {
    this.state = "menu";
    this.loop.stop();
    this.audio?.stop();
    if (this.deathTimer) clearTimeout(this.deathTimer);
    this.engine = null;
    this.topbar.classList.add("hidden");
    this.hideOverlay();
    this.closeEditor();

    this.editor = new LevelEditor(
      {
        onTest: (map) => {
          this.fromEditor = true;
          this.editorDraft = map;
          this.closeEditor();
          this.startLevel(map);
        },
        onSave: (map) => {
          saveCustom(map);
          this.showMenu();
        },
        onExit: () => this.showMenu(),
      },
      initial,
    );
    this.editor.mount(this.root);
  }

  private closeEditor(): void {
    this.editor?.destroy();
    this.editor = null;
  }

  private showPause(): void {
    this.showOverlay(`
      <h2>Paused</h2>
      <div class="btn-row">
        <button class="btn" data-act="resume">Resume</button>
        <button class="btn btn--ghost" data-act="retry">Restart</button>
        <button class="btn btn--ghost" data-act="menu">${this.hubLabel()}</button>
      </div>
    `);
    this.wireResultButtons();
  }

  private showGameOver(score: number, best: number): void {
    this.showOverlay(`
      <h2>Game Over</h2>
      <p>Cleared <strong>${score}</strong> obstacles · best <strong>${best}</strong></p>
      <div class="btn-row">
        <button class="btn" data-act="retry">Retry</button>
        <button class="btn btn--ghost" data-act="menu">${this.hubLabel()}</button>
      </div>
    `);
    this.wireResultButtons();
  }

  private showComplete(score: number, best: number): void {
    this.showOverlay(`
      <h2>Level Complete!</h2>
      <p>Score <strong>${score}</strong> · best <strong>${best}</strong></p>
      <div class="btn-row">
        <button class="btn" data-act="retry">Play again</button>
        <button class="btn btn--ghost" data-act="menu">${this.hubLabel()}</button>
      </div>
    `);
    this.wireResultButtons();
  }

  private wireResultButtons(): void {
    this.overlay.querySelectorAll<HTMLElement>("[data-act]").forEach((el) => {
      el.addEventListener("click", () => {
        const act = el.dataset.act;
        if (act === "resume") this.resume();
        else if (act === "retry" && this.current) this.startLevel(this.current);
        else if (act === "menu") this.exitHub();
      });
    });
  }
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

export function createGeometryBeat(): Game {
  return new GeometryBeat();
}
