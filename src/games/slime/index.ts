import type { Game } from "../../core/Game";
import { GameLoop } from "../../core/GameLoop";
import { loadJSON, saveJSON } from "../../core/storage";
import { navigate } from "../../router";
import { AiController, type Difficulty } from "./ai";
import { CHARACTERS, characterStats, getCharacter, type SlimeCharacter } from "./characters";
import { footprint, loadControls, type ControlSettings, type LayoutId } from "./controls";
import { ControlsEditor } from "./controlsEditor";
import { HumanInput } from "./input";
import { MODES, getMode } from "./modes";
import type { SlimeMode } from "./modes/mode";
import { FIXED_DT } from "./physics";
import { SlimeRenderer, type Banner } from "./render";
import { Sfx } from "./sfx";
import { TouchPads, hasTouch, safeAreaInsets } from "./touchpad";
import type { Controller, Side } from "./types";
import { SCORED_TIME, World } from "./world";

const ACCENT = "#5be37d";
const SETTINGS_KEY = "slime.settings";
/** Never simulate more than this many steps per frame (spiral-of-death guard). */
const MAX_STEPS = 16;

interface Settings {
  mode: string;
  /** 1 = vs CPU, 2 = two players on one device. */
  players: 1 | 2;
  chars: [string, string];
  difficulty: Difficulty;
  ballSpeed: number;
  length: 0 | 1 | 2;
  showPath: boolean;
}

const DEFAULTS: Settings = {
  mode: "volleyball",
  players: 1,
  chars: ["classic", "ember"],
  difficulty: "medium",
  ballSpeed: 1,
  length: 0,
  showPath: false,
};

const BALL_SPEEDS: { label: string; value: number }[] = [
  { label: "Slow", value: 0.75 },
  { label: "Normal", value: 1 },
  { label: "Fast", value: 1.25 },
  { label: "Turbo", value: 1.5 },
];
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const LENGTHS = ["Short", "Standard", "Long"];

type State = "menu" | "playing" | "paused" | "over";

class SlimeSports implements Game {
  private root!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private overlay!: HTMLElement;
  private padHost!: HTMLElement;
  private topbar!: HTMLElement;
  private scorePill!: HTMLElement;

  private renderer!: SlimeRenderer;
  private loop!: GameLoop;
  private readonly sfx = new Sfx();
  private settings: Settings = { ...DEFAULTS, ...loadJSON<Partial<Settings>>(SETTINGS_KEY, {}) };

  private world: World | null = null;
  private input: HumanInput | null = null;
  private controllers: [Controller, Controller] | null = null;
  private controls: ControlSettings = loadControls();
  private pads: TouchPads | null = null;
  private editor: ControlsEditor | null = null;
  private accumulator = 0;
  private state: State = "menu";
  private notice: { text: string; until: number } | null = null;

  mount(container: HTMLElement): void {
    this.root = document.createElement("div");
    this.root.className = "game-root slime";
    this.root.innerHTML = `
      <canvas></canvas>
      <div class="pads-host"></div>
      <div class="game-topbar hidden">
        <button class="icon-btn" data-act="menu" aria-label="Back">‹</button>
        <span class="pill" data-score>0 : 0</span>
        <button class="icon-btn" data-act="pause" aria-label="Pause">II</button>
      </div>
      <div class="game-overlay"></div>
    `;
    container.appendChild(this.root);
    this.canvas = this.root.querySelector("canvas")!;
    this.overlay = this.root.querySelector(".game-overlay")!;
    this.padHost = this.root.querySelector(".pads-host")!;
    this.topbar = this.root.querySelector(".game-topbar")!;
    this.scorePill = this.root.querySelector("[data-score]")!;
    this.root.style.setProperty("--accent", ACCENT);

    const ctx = this.canvas.getContext("2d", { alpha: false })!;
    this.renderer = new SlimeRenderer(this.canvas, ctx);
    this.loop = new GameLoop((dt) => this.tick(dt));
    this.topbar.addEventListener("click", this.onTopbar);
    document.addEventListener("visibilitychange", this.onVisibility);

    this.resize();
    this.showModeSelect();
  }

  unmount(): void {
    this.loop.stop();
    this.editor?.destroy();
    this.endMatch();
    this.sfx.close();
    this.topbar.removeEventListener("click", this.onTopbar);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.root.remove();
  }

  resize(): void {
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    const mode = this.world?.mode ?? getMode(this.settings.mode);
    this.renderer.resize(w, h, mode);
    this.pads?.layoutControls();
    // Keep the field clear of the on-screen controls so no slime hides under a thumb.
    const withStick = this.controls.style === "joystick";
    const fp = this.pads ? footprint(this.controls, this.layoutId(), w, h, withStick, safeAreaInsets()) : null;
    this.renderer.setControlsFootprint(fp, mode);
    if (this.world && this.state !== "playing") this.draw();
  }

  // ------------------------------------------------------------ match

  private startMatch(): void {
    const st = this.settings;
    saveJSON(SETTINGS_KEY, st);
    this.sfx.unlock();
    this.endMatch();
    const mode = getMode(st.mode);
    const chars: [SlimeCharacter, SlimeCharacter] = [getCharacter(st.chars[0]), getCharacter(st.chars[1])];
    this.world = new World({
      mode,
      chars,
      ballSpeed: st.ballSpeed,
      winScore: mode.winScores[st.length],
      seed: (Math.random() * 2 ** 32) >>> 0,
    });
    const humans: [boolean, boolean] = [true, st.players === 2];
    this.input = new HumanInput(this.canvas, this.renderer.toWorld, humans);
    this.buildPads();
    this.controllers = [
      this.input.controller(0),
      humans[1] ? this.input.controller(1) : new AiController(1, st.difficulty),
    ];
    this.accumulator = 0;
    this.notice = null;
    this.resize();
    this.state = "playing";
    this.hideOverlay();
    this.topbar.classList.remove("hidden");
    this.updateScore();
    this.loop.start();
  }

  private endMatch(): void {
    this.input?.dispose();
    this.input = null;
    this.pads?.dispose();
    this.pads = null;
    this.controllers = null;
    this.world = null;
  }

  private tick(dt: number): void {
    const world = this.world;
    const ctrls = this.controllers;
    if (!world || !ctrls) return;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS) {
      world.step([ctrls[0].getIntent(world, 0), ctrls[1].getIntent(world, 1)]);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS) this.accumulator = 0;
    this.syncAuxLabels(world);
    this.drainEvents(world);
    this.draw();
    if (world.phase === "over" && this.state === "playing") this.onMatchOver(world);
  }

  private drainEvents(world: World): void {
    for (const ev of world.events) {
      if (ev.type === "hit") this.sfx.hit(ev.strength);
      else if (ev.type === "bounce") this.sfx.bounce(ev.strength);
      else if (ev.type === "score") {
        this.updateScore();
        if (world.winner !== null) this.sfx.win();
        else this.sfx.score();
      } else if (ev.type === "grab") this.sfx.grab();
      else if (ev.type === "launch") this.sfx.launch();
      else if (ev.type === "steal") this.sfx.hit(0.6);
      else if (ev.type === "reserve") {
        this.notice = { text: "Re-serve", until: world.time + 1.2 };
      }
    }
    world.events.length = 0;
  }

  // ------------------------------------------------------------ controls

  private layoutId(): LayoutId {
    return this.settings.players === 2 ? "two" : "one";
  }

  /** (Re)build the on-screen joystick + aux buttons for the current match. */
  private buildPads(): void {
    this.pads?.dispose();
    this.pads = null;
    const world = this.world;
    if (!world) return;
    if (hasTouch()) {
      const colors = world.slimes.map((s) => s.char.color);
      this.pads = new TouchPads(this.padHost, this.controls, this.layoutId(), colors, world.mode.aux?.label ?? null);
    }
    const drag = !this.pads || this.controls.style === "drag";
    this.input?.setPads(this.pads, drag);
    this.resize();
  }

  /** Grab sports: the button reads THROW while you carry the ball. */
  private syncAuxLabels(world: World): void {
    const aux = world.mode.aux;
    if (!this.pads || aux?.kind !== "grab") return;
    const humans = this.settings.players === 2 ? [0, 1] : [0];
    humans.forEach((side, i) => {
      this.pads!.setAuxLabel(i, world.holder === side ? (aux.holdLabel ?? aux.label) : aux.label);
    });
  }

  /** Open the HUD layout editor; `back` re-shows whatever screen opened it. */
  private openControls(back: () => void): void {
    const mode = getMode(this.settings.mode);
    const chars = this.settings.chars.map((id) => getCharacter(id).color) as [string, string];
    this.hideOverlay();
    this.editor = new ControlsEditor(this.root, this.controls, {
      layout: this.layoutId(),
      colors: chars,
      auxLabel: mode.aux?.label ?? "ACTION",
      onDone: (settings) => {
        this.editor = null;
        this.controls = settings;
        if (this.world) this.buildPads();
        back();
      },
    });
  }

  private draw(): void {
    const world = this.world;
    if (!world) return;
    this.renderer.draw(world, {
      fingers: this.input?.fingers ?? [],
      showPath: this.settings.showPath,
      banner: this.banner(world),
    });
  }

  private banner(world: World): Banner | null {
    if (world.phase === "scored" && world.lastScore) {
      const s = world.lastScore;
      const char = world.slimes[s.scorer].char;
      return {
        text: s.label,
        sub: `${this.playerName(s.scorer)} +${s.points}`,
        color: char.color,
        alpha: Math.min(1, (SCORED_TIME - world.phaseTime) * 2.5),
      };
    }
    if (this.notice && world.time < this.notice.until) {
      return { text: this.notice.text, color: "#ffffff", alpha: Math.min(1, (this.notice.until - world.time) * 2) };
    }
    if (world.phase === "ready" && world.scores[0] + world.scores[1] === 0 && world.time < 1.2) {
      return {
        text: world.mode.name,
        sub: `First to ${world.winScore}`,
        color: world.mode.accent,
        alpha: Math.min(1, (1.2 - world.time) * 3),
      };
    }
    return null;
  }

  private playerName(side: Side): string {
    const name = this.world?.slimes[side].char.name ?? "";
    if (this.settings.players === 2) return `P${side + 1} ${name}`;
    return side === 0 ? `You (${name})` : `CPU (${name})`;
  }

  private updateScore(): void {
    const w = this.world;
    if (!w) return;
    this.scorePill.innerHTML = `
      <span style="color:${w.slimes[0].char.color}">${w.scores[0]}</span>
      <span class="slime-score__sep">:</span>
      <span style="color:${w.slimes[1].char.color}">${w.scores[1]}</span>`;
  }

  private onMatchOver(world: World): void {
    this.state = "over";
    this.loop.stop();
    const winner = world.winner ?? 0;
    const youWon = this.settings.players === 1 && winner === 0;
    const title = this.settings.players === 2 ? `${this.playerName(winner)} wins!` : youWon ? "You win!" : "CPU wins";
    this.showOverlay(`
      <h2 style="color:${world.slimes[winner].char.color}">${title}</h2>
      <p>${world.mode.name} · ${world.scores[0]} – ${world.scores[1]}</p>
      <div class="btn-row">
        <button class="btn" data-act="rematch">Rematch</button>
        <button class="btn btn--ghost" data-act="setup">Change setup</button>
      </div>
    `);
    this.wireActs();
  }

  // ------------------------------------------------------------ pause

  private pause(): void {
    if (this.state !== "playing") return;
    this.state = "paused";
    this.loop.stop();
    this.input?.reset();
    this.showOverlay(`
      <h2>Paused</h2>
      <div class="btn-row">
        <button class="btn" data-act="resume">Resume</button>
        <button class="btn btn--ghost" data-act="rematch">Restart</button>
        <button class="btn btn--ghost" data-act="pause-controls">Controls</button>
        <button class="btn btn--ghost" data-act="setup">Quit match</button>
      </div>
    `);
    this.wireActs();
  }

  /** Pause screen again after editing controls mid-match. */
  private repause(): void {
    this.state = "playing";
    this.pause();
  }

  private resume(): void {
    if (this.state !== "paused") return;
    this.state = "playing";
    this.hideOverlay();
    this.accumulator = 0;
    this.loop.start();
  }

  private readonly onTopbar = (e: Event) => {
    const act = (e.target as HTMLElement).closest("[data-act]")?.getAttribute("data-act");
    if (act === "pause") this.pause();
    else if (act === "menu") this.backToSetup();
  };

  private readonly onVisibility = () => {
    if (document.hidden && this.state === "playing") this.pause();
  };

  private backToSetup(): void {
    this.loop.stop();
    this.endMatch();
    this.showSetup();
  }

  private wireActs(): void {
    this.overlay.querySelectorAll<HTMLElement>("[data-act]").forEach((el) => {
      el.addEventListener("click", () => {
        const act = el.dataset.act;
        if (act === "resume") this.resume();
        else if (act === "rematch") this.startMatch();
        else if (act === "setup") this.backToSetup();
        else if (act === "modes") this.showModeSelect();
        else if (act === "home") navigate("#/");
        else if (act === "start") this.startMatch();
        else if (act === "controls") this.openControls(() => this.showSetup());
        else if (act === "pause-controls") this.openControls(() => this.repause());
      });
    });
  }

  // ------------------------------------------------------------ menus

  private hideOverlay(): void {
    this.overlay.classList.add("hidden");
    this.overlay.classList.remove("game-overlay--scroll");
    this.overlay.innerHTML = "";
  }

  private showOverlay(html: string, scroll = false): void {
    this.overlay.innerHTML = html;
    this.overlay.classList.toggle("game-overlay--scroll", scroll);
    this.overlay.classList.remove("hidden");
    this.overlay.scrollTop = 0;
  }

  private clearCanvas(mode: SlimeMode): void {
    const ctx = this.canvas.getContext("2d", { alpha: false })!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = mode.theme.skyTop;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private showModeSelect(): void {
    this.state = "menu";
    this.loop.stop();
    this.endMatch();
    this.topbar.classList.add("hidden");
    this.clearCanvas(getMode(this.settings.mode));

    const cards = MODES.map(
      (m) => `
        <button class="slime-mode" data-mode="${m.id}" style="--mode:${m.accent}">
          <span class="slime-mode__art">${modeArt(m.id)}</span>
          <span class="slime-mode__name">${m.name}</span>
          <span class="slime-mode__tag">${m.tagline}</span>
        </button>`,
    ).join("");

    this.showOverlay(
      `
      <h2 class="slime-title">Slime Sports</h2>
      <p>Pick a sport. ${
        hasTouch() ? "Move with the joystick, push it up to jump." : "Move with A/D or ←/→, jump with W or ↑."
      }</p>
      <p class="slime-rotate">Tip: turn your device sideways for a bigger field.</p>
      <div class="slime-modes">
        ${cards}
        <div class="slime-mode slime-mode--soon"><span class="slime-mode__name">More soon</span>
          <span class="slime-mode__tag">Hockey · Tennis · Online</span></div>
      </div>
      <button class="btn btn--ghost" data-act="home">← All games</button>
    `,
      true,
    );
    this.overlay.querySelectorAll<HTMLElement>("[data-mode]").forEach((el) => {
      el.addEventListener("click", () => {
        this.settings.mode = el.dataset.mode!;
        this.showSetup();
      });
    });
    this.wireActs();
  }

  private showSetup(): void {
    this.state = "menu";
    this.topbar.classList.add("hidden");
    const st = this.settings;
    const mode = getMode(st.mode);
    this.clearCanvas(mode);
    const vsCpu = st.players === 1;

    const seg = (name: string, options: { label: string; value: string }[], current: string) =>
      `<div class="seg" data-seg="${name}">${options
        .map(
          (o) =>
            `<button class="seg__btn${o.value === current ? " seg__btn--on" : ""}" data-value="${o.value}">${o.label}</button>`,
        )
        .join("")}</div>`;

    this.showOverlay(
      `
      <h2 class="slime-title" style="color:${mode.accent}">${mode.name}</h2>
      <p>${mode.howTo}</p>
      ${mode.aux ? `<p class="slime-aux-hint">${mode.aux.hint}</p>` : ""}
      <div class="slime-setup">
        <div class="slime-setup__row">
          <span class="slime-setup__label">Players</span>
          ${seg(
            "players",
            [
              { label: "vs CPU", value: "1" },
              { label: "2 Players", value: "2" },
            ],
            String(st.players),
          )}
        </div>
        <div class="slime-pickers">
          ${this.pickerHtml(0, vsCpu ? "You" : "Player 1 · left")}
          ${this.pickerHtml(1, vsCpu ? "CPU" : "Player 2 · right")}
        </div>
        ${
          vsCpu
            ? `<div class="slime-setup__row"><span class="slime-setup__label">CPU</span>${seg(
                "difficulty",
                DIFFICULTIES.map((d) => ({ label: d[0].toUpperCase() + d.slice(1), value: d })),
                st.difficulty,
              )}</div>`
            : ""
        }
        <div class="slime-setup__row">
          <span class="slime-setup__label">Ball speed</span>
          ${seg(
            "ballSpeed",
            BALL_SPEEDS.map((b) => ({ label: b.label, value: String(b.value) })),
            String(st.ballSpeed),
          )}
        </div>
        <div class="slime-setup__row">
          <span class="slime-setup__label">Match</span>
          ${seg(
            "length",
            LENGTHS.map((l, i) => ({ label: `${l} · ${mode.winScores[i]}`, value: String(i) })),
            String(st.length),
          )}
        </div>
        <div class="slime-setup__row">
          <span class="slime-setup__label">Controls</span>
          <span class="slime-keys">${this.keysHint(mode)}</span>
          <button class="btn btn--ghost btn--small" data-act="controls">Customize ⚙</button>
        </div>
        <div class="slime-setup__row">
          <span class="slime-setup__label">Ball path</span>
          ${seg(
            "showPath",
            [
              { label: "Hidden", value: "0" },
              { label: "Show", value: "1" },
            ],
            st.showPath ? "1" : "0",
          )}
        </div>
      </div>
      <button class="btn" data-act="start">Play ▶</button>
      <button class="btn btn--ghost" data-act="modes">← Sports</button>
    `,
      true,
    );

    this.overlay.querySelectorAll<HTMLElement>("[data-seg]").forEach((group) => {
      group.addEventListener("click", (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-value]");
        if (!btn) return;
        const v = btn.dataset.value!;
        switch (group.dataset.seg) {
          case "players":
            st.players = v === "2" ? 2 : 1;
            break;
          case "difficulty":
            st.difficulty = v as Difficulty;
            break;
          case "ballSpeed":
            st.ballSpeed = Number(v);
            break;
          case "length":
            st.length = Number(v) as 0 | 1 | 2;
            break;
          case "showPath":
            st.showPath = v === "1";
            break;
        }
        saveJSON(SETTINGS_KEY, st);
        const keep = this.overlay.scrollTop;
        this.showSetup();
        this.overlay.scrollTop = keep;
      });
    });
    this.overlay.querySelectorAll<HTMLElement>("[data-char]").forEach((el) => {
      el.addEventListener("click", () => {
        const side = Number(el.dataset.side) as Side;
        st.chars[side] = el.dataset.char!;
        saveJSON(SETTINGS_KEY, st);
        const keep = this.overlay.scrollTop;
        this.showSetup();
        this.overlay.scrollTop = keep;
      });
    });
    this.wireActs();
  }

  private keysHint(mode: SlimeMode): string {
    const label = mode.aux?.label;
    if (hasTouch()) {
      const style = this.controls.style === "joystick" ? "Joystick" : "Drag slime";
      return label ? `${style} + ${label} button` : style;
    }
    if (this.settings.players === 2) return `P1: A D W${label ? " S" : ""} · P2: ← → ↑${label ? " ↓" : ""}`;
    return `A/D or ←/→ move · W/↑ jump${label ? ` · S/↓ ${label}` : ""}`;
  }

  private pickerHtml(side: Side, label: string): string {
    const selected = getCharacter(this.settings.chars[side]);
    const chips = CHARACTERS.map(
      (c) => `
        <button class="slime-chip${c.id === selected.id ? " slime-chip--on" : ""}"
          data-char="${c.id}" data-side="${side}" aria-label="${c.name}">
          ${slimeIcon(c, side)}
        </button>`,
    ).join("");
    const stats = characterStats(selected)
      .map(
        (s) => `<div class="slime-stat"><span>${s.label}</span>
          <span class="slime-stat__bar"><span style="width:${Math.round(s.value * 100)}%;background:${selected.color}"></span></span></div>`,
      )
      .join("");
    return `
      <div class="slime-picker">
        <div class="slime-picker__head">
          <span class="slime-setup__label">${label}</span>
          <strong style="color:${selected.color}">${selected.name}</strong>
        </div>
        <div class="slime-chips">${chips}</div>
        <p class="slime-picker__blurb">${selected.blurb}</p>
        <div class="slime-stats">${stats}</div>
      </div>`;
  }
}

/** Inline SVG slime, sized by the character's radius. */
function slimeIcon(c: SlimeCharacter, side: Side): string {
  const r = c.radius * 0.42;
  const w = 64;
  const h = 34;
  const cx = w / 2;
  const base = h - 2;
  const ex = cx + (side === 0 ? 1 : -1) * r * 0.45;
  const ey = base - r * 0.58;
  const er = Math.max(3, r * 0.2);
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <path d="M ${cx - r} ${base} A ${r} ${r} 0 0 1 ${cx + r} ${base} Z" fill="${c.color}" stroke="${c.rim}" stroke-width="2"/>
    <circle cx="${ex}" cy="${ey}" r="${er}" fill="#fff"/>
    <circle cx="${ex + (side === 0 ? 1 : -1) * er * 0.35}" cy="${ey}" r="${er * 0.5}" fill="#111"/>
  </svg>`;
}

function modeArt(id: string): string {
  const balls: Record<string, string> = {
    volleyball: `<circle cx="70" cy="18" r="9" fill="#fff7d6" stroke="#e0a91f" stroke-width="2"/>
      <rect x="58" y="34" width="4" height="22" fill="#fff"/>`,
    soccer: `<circle cx="66" cy="22" r="8" fill="#fff" stroke="#111" stroke-width="2"/>
      <path d="M104 56 V30 H120" fill="none" stroke="#fff" stroke-width="3"/>`,
    basketball: `<circle cx="70" cy="16" r="9" fill="#f07a2a" stroke="#3a1d0a" stroke-width="1.5"/>
      <path d="M118 14 V40 M118 30 H100" fill="none" stroke="#ff5a1f" stroke-width="3"/>`,
    tennis: `<circle cx="66" cy="20" r="6" fill="#d9f24a" stroke="#fff" stroke-width="1.5"/>
      <rect x="59" y="44" width="3" height="12" fill="#fff"/><rect x="56" y="43" width="9" height="3" fill="#fff"/>`,
  };
  return `<svg viewBox="0 0 120 60" aria-hidden="true">
    <rect x="0" y="56" width="120" height="4" fill="#ffffff55"/>
    ${balls[id] ?? ""}
    <path d="M14 56 A18 18 0 0 1 50 56 Z" fill="#3fa9ff"/>
    <circle cx="40" cy="45" r="4" fill="#fff"/><circle cx="41.5" cy="45" r="2" fill="#111"/>
    <path d="M76 56 A16 16 0 0 1 108 56 Z" fill="#ff6b3d"/>
    <circle cx="84" cy="46" r="3.5" fill="#fff"/><circle cx="82.5" cy="46" r="1.8" fill="#111"/>
  </svg>`;
}

export function createSlimeSports(): Game {
  return new SlimeSports();
}
