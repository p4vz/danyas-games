import { safeAreaInsets } from "./touchpad";
import {
  MAX_SCALE,
  MIN_SCALE,
  defaultControls,
  floatingZone,
  playersFor,
  resolve,
  saveControls,
  type ControlKind,
  type ControlSettings,
  type LayoutId,
  type Placement,
} from "./controls";

interface Widget {
  el: HTMLElement;
  player: number;
  kind: ControlKind;
}

export interface EditorOptions {
  layout: LayoutId;
  /** Accent colour per player. */
  colors: [string, string];
  /** Aux button label for the current sport. */
  auxLabel: string;
  onDone(settings: ControlSettings): void;
}

/**
 * Full-screen HUD layout editor: drag any control to move it, tap to select
 * and resize it, plus global opacity, joystick behaviour and control style.
 * Separate layouts for 1 and 2 players; "Reset" restores the defaults.
 */
export class ControlsEditor {
  private readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly settings: ControlSettings;
  private layout: LayoutId;
  private widgets: Widget[] = [];
  private zones: HTMLElement[] = [];
  private selected: { player: number; kind: ControlKind } = { player: 0, kind: "stick" };

  constructor(
    container: HTMLElement,
    settings: ControlSettings,
    private readonly opts: EditorOptions,
  ) {
    this.settings = JSON.parse(JSON.stringify(settings)) as ControlSettings;
    this.layout = opts.layout;
    this.root = document.createElement("div");
    this.root.className = "pads-editor";
    this.root.innerHTML = `
      <div class="pads-editor__stage"></div>
      <div class="pads-editor__panel">
        <div class="pads-editor__row">
          <strong>Controls</strong>
          <div class="seg" data-seg="layout">
            <button class="seg__btn" data-value="one">1 Player</button>
            <button class="seg__btn" data-value="two">2 Players</button>
          </div>
        </div>
        <div class="pads-editor__row">
          <div class="seg" data-seg="style">
            <button class="seg__btn" data-value="joystick">Joystick</button>
            <button class="seg__btn" data-value="drag">Drag slime</button>
          </div>
          <div class="seg" data-seg="floating">
            <button class="seg__btn" data-value="0">Fixed</button>
            <button class="seg__btn" data-value="1">Floating</button>
          </div>
        </div>
        <label class="pads-editor__slider"><span data-size-label>Size</span>
          <input type="range" data-input="size" min="${MIN_SCALE}" max="${MAX_SCALE}" step="0.05" /></label>
        <label class="pads-editor__slider"><span>Opacity</span>
          <input type="range" data-input="opacity" min="0.25" max="1" step="0.05" /></label>
        <p class="pads-editor__hint">Drag a control to move it · tap to select and resize</p>
        <div class="pads-editor__row">
          <button class="btn btn--ghost" data-act="reset">Reset</button>
          <button class="btn" data-act="done">Done</button>
        </div>
      </div>
    `;
    container.appendChild(this.root);
    this.stage = this.root.querySelector(".pads-editor__stage")!;

    this.root.querySelectorAll<HTMLElement>("[data-seg]").forEach((seg) =>
      seg.addEventListener("click", (e) => {
        const v = (e.target as HTMLElement).closest<HTMLElement>("[data-value]")?.dataset.value;
        if (!v) return;
        if (seg.dataset.seg === "layout") {
          this.layout = v as LayoutId;
          this.selected = { player: 0, kind: "stick" };
        } else if (seg.dataset.seg === "style") this.settings.style = v as ControlSettings["style"];
        else if (seg.dataset.seg === "floating") this.settings.floating = v === "1";
        this.render();
      }),
    );
    this.input("size").addEventListener("input", (e) => {
      this.placement(this.selected.player, this.selected.kind).scale = Number((e.target as HTMLInputElement).value);
      this.positionWidgets();
    });
    this.input("opacity").addEventListener("input", (e) => {
      this.settings.opacity = Number((e.target as HTMLInputElement).value);
      this.stage.style.setProperty("--pad-opacity", String(this.settings.opacity));
    });
    this.root.querySelector('[data-act="reset"]')!.addEventListener("click", () => this.reset());
    this.root.querySelector('[data-act="done"]')!.addEventListener("click", () => {
      saveControls(this.settings);
      this.destroy();
      this.opts.onDone(this.settings);
    });
    window.addEventListener("resize", this.onResize);
    this.render();
  }

  destroy(): void {
    window.removeEventListener("resize", this.onResize);
    this.root.remove();
  }

  private readonly onResize = () => this.positionWidgets();

  private input(name: string): HTMLInputElement {
    return this.root.querySelector<HTMLInputElement>(`[data-input="${name}"]`)!;
  }

  private placement(player: number, kind: ControlKind): Placement {
    return playersFor(this.settings, this.layout)[player][kind];
  }

  private reset(): void {
    const fresh = defaultControls();
    if (this.layout === "one") this.settings.layouts.one = fresh.layouts.one;
    else this.settings.layouts.two = fresh.layouts.two;
    this.render();
  }

  /** Rebuild widgets and sync the panel to the settings. */
  private render(): void {
    const segValue: Record<string, string> = {
      layout: this.layout,
      style: this.settings.style,
      floating: this.settings.floating ? "1" : "0",
    };
    this.root.querySelectorAll<HTMLElement>("[data-seg]").forEach((seg) => {
      seg.querySelectorAll<HTMLElement>("[data-value]").forEach((b) => {
        b.classList.toggle("seg__btn--on", b.dataset.value === segValue[seg.dataset.seg!]);
      });
    });
    this.root.querySelector<HTMLElement>('[data-seg="floating"]')!.hidden = this.settings.style !== "joystick";
    this.input("opacity").value = String(this.settings.opacity);
    this.stage.style.setProperty("--pad-opacity", String(this.settings.opacity));

    this.stage.innerHTML = "";
    this.widgets = [];
    this.zones = [];
    const players = playersFor(this.settings, this.layout).length;
    if (this.settings.style === "joystick" && this.settings.floating) {
      // Show where a floating stick can be summoned.
      for (let p = 0; p < players; p++) {
        const z = document.createElement("div");
        z.className = "pads-editor__zone";
        z.style.setProperty("--pc", this.opts.colors[p]);
        z.textContent = players === 2 ? `P${p + 1} touch area` : "Joystick touch area";
        this.stage.appendChild(z);
        this.zones.push(z);
      }
    }
    for (let p = 0; p < players; p++) {
      for (const kind of ["stick", "aux"] as const) {
        if (kind === "stick" && this.settings.style !== "joystick") continue;
        const el = document.createElement("div");
        el.className = `pads-editor__widget pads-editor__widget--${kind}`;
        el.style.setProperty("--pc", this.opts.colors[p]);
        const who = players === 2 ? `P${p + 1} ` : "";
        el.innerHTML = `<span>${who}${kind === "stick" ? "MOVE" : this.opts.auxLabel}</span>`;
        this.stage.appendChild(el);
        this.widgets.push({ el, player: p, kind });
        this.makeDraggable(el, p, kind);
      }
    }
    if (!this.widgets.some((w) => w.player === this.selected.player && w.kind === this.selected.kind)) {
      this.selected = { player: this.widgets[0].player, kind: this.widgets[0].kind };
    }
    this.positionWidgets();
    this.syncSelection();
  }

  private positionWidgets(): void {
    const w = this.stage.clientWidth || window.innerWidth;
    const h = this.stage.clientHeight || window.innerHeight;
    const safe = safeAreaInsets();
    this.zones.forEach((z, p) => {
      const r = floatingZone(this.layout, p, w, h, safe);
      Object.assign(z.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    });
    for (const wd of this.widgets) {
      const r = resolve(this.placement(wd.player, wd.kind), wd.kind, this.layout, wd.player, w, h, safe);
      Object.assign(wd.el.style, {
        width: `${r.size}px`,
        height: `${r.size}px`,
        left: `${r.cx - r.size / 2}px`,
        top: `${r.cy - r.size / 2}px`,
        fontSize: `${Math.max(11, r.size * 0.16)}px`,
      });
    }
  }

  private syncSelection(): void {
    for (const wd of this.widgets) {
      wd.el.classList.toggle(
        "pads-editor__widget--on",
        wd.player === this.selected.player && wd.kind === this.selected.kind,
      );
    }
    const p = this.placement(this.selected.player, this.selected.kind);
    this.input("size").value = String(p.scale);
    const players = playersFor(this.settings, this.layout).length;
    const who = players === 2 ? ` P${this.selected.player + 1}` : "";
    const what = this.selected.kind === "stick" ? "joystick" : `${this.opts.auxLabel} button`;
    this.root.querySelector("[data-size-label]")!.textContent = `Size${who} ${what}`;
  }

  private makeDraggable(el: HTMLElement, player: number, kind: ControlKind): void {
    let pointer: number | null = null;
    let grabDx = 0;
    let grabDy = 0;
    el.addEventListener("pointerdown", (e) => {
      if (pointer !== null) return;
      e.preventDefault();
      pointer = e.pointerId;
      el.setPointerCapture(e.pointerId);
      const box = el.getBoundingClientRect();
      grabDx = e.clientX - (box.left + box.width / 2);
      grabDy = e.clientY - (box.top + box.height / 2);
      this.selected = { player, kind };
      this.syncSelection();
      el.classList.add("pads-editor__widget--drag");
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerId !== pointer) return;
      const stage = this.stage.getBoundingClientRect();
      const p = this.placement(player, kind);
      p.fx = Math.max(0, Math.min(1, (e.clientX - grabDx - stage.left) / stage.width));
      p.fy = Math.max(0, Math.min(1, (e.clientY - grabDy - stage.top) / stage.height));
      this.positionWidgets();
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      el.classList.remove("pads-editor__widget--drag");
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }
}
