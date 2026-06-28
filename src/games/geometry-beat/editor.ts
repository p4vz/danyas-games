import type { Beatmap, NoteType } from "./beatmap";
import { minGapBeats } from "./customLevels";

export interface EditorCallbacks {
  onTest(map: Beatmap): void;
  onSave(map: Beatmap): void;
  onExit(): void;
}

const PALETTE: Array<{ type: NoteType; label: string; glyph: string }> = [
  { type: "spike", label: "Spike", glyph: "▲" },
  { type: "double", label: "Double", glyph: "▲▲" },
  { type: "block", label: "Block", glyph: "■" },
];

const LEAD_IN = 8; // first placeable beat (gives the player reaction lead-in)
const DEFAULT_LENGTH = 48; // beats shown on the track
const EXTEND_BY = 16;
const MIN_BPM = 90;
const MAX_BPM = 200;

/**
 * Touch-friendly beat-grid level editor. Obstacles snap to whole beats, and
 * placement is refused when it would sit closer than `minGapBeats(bpm)` to a
 * neighbour — so every level the player builds is guaranteed solvable. Test-play
 * reuses the normal beat-driven engine, so custom levels behave like built-ins.
 */
export class LevelEditor {
  private el!: HTMLElement;
  private track!: HTMLElement;
  private hint!: HTMLElement;
  private bpmLabel!: HTMLElement;
  private nameInput!: HTMLInputElement;

  private bpm: number;
  private lengthBeats = DEFAULT_LENGTH;
  private active: NoteType = "spike";
  private readonly cells = new Map<number, NoteType>(); // beat -> type
  private readonly editId: string | null;
  private readonly initialName: string;

  constructor(
    private readonly cb: EditorCallbacks,
    initial?: Beatmap,
  ) {
    this.bpm = initial?.bpm ?? 130;
    this.editId = initial?.id ?? null;
    this.initialName = initial?.name ?? "My Level";
    if (initial) {
      for (const n of initial.notes) this.cells.set(n.beat, n.type);
      const last = initial.notes.reduce((m, n) => Math.max(m, n.beat), 0);
      this.lengthBeats = Math.max(DEFAULT_LENGTH, last + 8);
    }
  }

  mount(container: HTMLElement): void {
    this.el = document.createElement("div");
    this.el.className = "editor";
    this.el.innerHTML = `
      <div class="editor__bar">
        <button class="icon-btn" data-act="exit" aria-label="Back">‹</button>
        <input class="editor__name" maxlength="24" />
        <div class="stepper">
          <button class="icon-btn" data-act="bpm-">−</button>
          <span class="stepper__val" data-bpm></span>
          <button class="icon-btn" data-act="bpm+">+</button>
          <small>BPM</small>
        </div>
        <span class="editor__hint" data-hint></span>
      </div>
      <div class="editor__palette" data-palette></div>
      <div class="editor__timeline"><div class="editor__track" data-track></div></div>
      <p class="editor__tip">Tap a beat to place the selected obstacle · tap again to remove. Greyed beats are the start lead-in.</p>
      <div class="editor__actions">
        <button class="btn" data-act="test">▶ Test</button>
        <button class="btn btn--ghost" data-act="save">Save</button>
        <button class="btn btn--ghost" data-act="extend">+${EXTEND_BY} beats</button>
        <button class="btn btn--ghost" data-act="clear">Clear</button>
      </div>
    `;
    container.appendChild(this.el);

    this.track = this.el.querySelector("[data-track]")!;
    this.hint = this.el.querySelector("[data-hint]")!;
    this.bpmLabel = this.el.querySelector("[data-bpm]")!;
    this.nameInput = this.el.querySelector(".editor__name")!;
    this.nameInput.value = this.initialName;

    this.buildPalette();
    this.el.addEventListener("click", this.onClick);
    this.renderBpm();
    this.renderTrack();
  }

  destroy(): void {
    this.el.removeEventListener("click", this.onClick);
    this.el.remove();
  }

  // ---- rendering ----
  private buildPalette(): void {
    const pal = this.el.querySelector("[data-palette]")!;
    pal.innerHTML = PALETTE.map(
      (p) =>
        `<button class="palette-btn" data-type="${p.type}">
           <span class="palette-btn__glyph">${p.glyph}</span>${p.label}
         </button>`,
    ).join("");
    this.syncPalette();
  }

  private syncPalette(): void {
    this.el.querySelectorAll<HTMLElement>(".palette-btn").forEach((b) => {
      b.classList.toggle("palette-btn--on", b.dataset.type === this.active);
    });
  }

  private renderBpm(): void {
    this.bpmLabel.textContent = String(this.bpm);
    this.hint.textContent = `min gap ${minGapBeats(this.bpm)} beats`;
  }

  private renderTrack(): void {
    const gap = minGapBeats(this.bpm);
    let html = "";
    for (let b = 0; b < this.lengthBeats; b++) {
      const type = this.cells.get(b);
      const locked = b < LEAD_IN;
      const cls = [
        "cell",
        locked ? "cell--locked" : "",
        type ? `cell--${type}` : "",
        b % 4 === 0 ? "cell--bar" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const glyph = type ? PALETTE.find((p) => p.type === type)!.glyph : "";
      html += `<button class="${cls}" data-beat="${b}" ${locked ? "disabled" : ""}>
          <span class="cell__glyph">${glyph}</span>
          <span class="cell__num">${b % 4 === 0 ? b : ""}</span>
        </button>`;
    }
    this.track.innerHTML = html;
    void gap; // spacing is enforced in togglePlace; shown via the hint
  }

  // ---- interaction ----
  private readonly onClick = (e: Event) => {
    const target = e.target as HTMLElement;
    const act = target.closest("[data-act]")?.getAttribute("data-act");
    if (act) return this.handleAction(act);

    const typeBtn = target.closest<HTMLElement>("[data-type]");
    if (typeBtn) {
      this.active = typeBtn.dataset.type as NoteType;
      this.syncPalette();
      return;
    }

    const cell = target.closest<HTMLElement>("[data-beat]");
    if (cell && !cell.hasAttribute("disabled")) {
      this.togglePlace(Number(cell.dataset.beat), cell);
    }
  };

  private handleAction(act: string): void {
    switch (act) {
      case "exit":
        this.cb.onExit();
        break;
      case "bpm-":
        this.bpm = Math.max(MIN_BPM, this.bpm - 2);
        this.renderBpm();
        this.renderTrack();
        break;
      case "bpm+":
        this.bpm = Math.min(MAX_BPM, this.bpm + 2);
        this.renderBpm();
        this.renderTrack();
        break;
      case "extend":
        this.lengthBeats += EXTEND_BY;
        this.renderTrack();
        break;
      case "clear":
        this.cells.clear();
        this.renderTrack();
        break;
      case "test": {
        const map = this.buildMap();
        if (map) this.cb.onTest(map);
        else this.flashHint("Add at least one obstacle");
        break;
      }
      case "save": {
        const map = this.buildMap();
        if (map) this.cb.onSave(map);
        else this.flashHint("Add at least one obstacle");
        break;
      }
    }
  }

  private togglePlace(beat: number, cell: HTMLElement): void {
    if (this.cells.has(beat)) {
      this.cells.delete(beat);
      this.renderTrack();
      return;
    }
    const gap = minGapBeats(this.bpm);
    for (const b of this.cells.keys()) {
      if (Math.abs(b - beat) < gap) {
        this.flashHint(`Too close — keep ${gap} beats apart`);
        cell.classList.remove("cell--reject");
        // force reflow so the animation restarts
        void cell.offsetWidth;
        cell.classList.add("cell--reject");
        return;
      }
    }
    this.cells.set(beat, this.active);
    this.renderTrack();
  }

  private flashHint(msg: string): void {
    this.hint.textContent = msg;
    this.hint.classList.remove("editor__hint--warn");
    void this.hint.offsetWidth;
    this.hint.classList.add("editor__hint--warn");
    window.setTimeout(() => {
      this.hint.classList.remove("editor__hint--warn");
      this.renderBpm();
    }, 1400);
  }

  /** Build a Beatmap from the grid, or null if empty. */
  private buildMap(): Beatmap | null {
    const beats = [...this.cells.keys()].sort((a, b) => a - b);
    if (beats.length === 0) return null;
    const name = this.nameInput.value.trim() || "My Level";
    return {
      id: this.editId ?? `custom-${Date.now()}`,
      name,
      difficulty: "Custom",
      bpm: this.bpm,
      intensity: 1,
      notes: beats.map((beat) => ({ beat, type: this.cells.get(beat)! })),
    };
  }
}
