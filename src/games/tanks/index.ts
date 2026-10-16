import type { Game } from "../../core/Game";
import { GameLoop } from "../../core/GameLoop";
import { loadJSON, saveJSON } from "../../core/storage";
import { navigate } from "../../router";
import { LocalSeat } from "./controls";
import { DT, Match, type MatchConfig, type MatchEvent, type PlayerConfig } from "./match";
import type { Seat } from "./net";
import { TankRenderer } from "./render";
import { Sfx } from "./sfx";
import { UPGRADES, UPGRADE_KINDS } from "./upgrades";

const ACCENT = "#ff9f43";
const SETTINGS_KEY = "tanks.settings";
const MAX_STEPS = 12;

export const COLORS = ["#ff5b5b", "#4da3ff", "#5be37d", "#ffd84d", "#c77dff", "#ff9f43", "#4de3d3", "#ff7ac8"];

const WINDS = [
  { label: "Calm", value: 0 },
  { label: "Breezy", value: 45 },
  { label: "Stormy", value: 100 },
];
const UPGRADE_RATES = [
  { label: "Off", value: 0 },
  { label: "Rare", value: 40 },
  { label: "Normal", value: 22 },
  { label: "Lots", value: 12 },
];
const TIMERS = [0, 15, 30, 45, 60];

interface Settings {
  count: number;
  players: PlayerConfig[];
  movement: boolean;
  castles: boolean;
  wind: number;
  crateEvery: number;
  turnTime: number;
}

const DEFAULTS: Settings = {
  count: 2,
  players: COLORS.slice(0, 4).map((color, i) => ({ name: `Player ${i + 1}`, color })),
  movement: true,
  castles: true,
  wind: 45,
  crateEvery: 22,
  turnTime: 0,
};

type State = "menu" | "playing" | "paused" | "over";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

class CastleBusters implements Game {
  private root!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private overlay!: HTMLElement;
  private topbar!: HTMLElement;
  private turnPill!: HTMLElement;
  private barHost!: HTMLElement;
  private renderer!: TankRenderer;
  private loop!: GameLoop;
  private readonly sfx = new Sfx();
  private settings: Settings = loadSettings();

  private match: Match | null = null;
  private seats: Seat[] = [];
  private localSeat: LocalSeat | null = null;
  private accumulator = 0;
  private state: State = "menu";
  private lastTick = -1;

  mount(container: HTMLElement): void {
    this.root = document.createElement("div");
    this.root.className = "game-root tanks";
    this.root.style.setProperty("--accent", ACCENT);
    this.root.innerHTML = `
      <canvas></canvas>
      <div class="tb-host"></div>
      <div class="game-topbar hidden">
        <button class="icon-btn" data-act="menu" aria-label="Back">‹</button>
        <span class="pill tb-turn" data-turn></span>
        <button class="icon-btn" data-act="pause" aria-label="Pause">II</button>
      </div>
      <div class="game-overlay"></div>`;
    container.appendChild(this.root);
    this.canvas = this.root.querySelector("canvas")!;
    this.overlay = this.root.querySelector(".game-overlay")!;
    this.topbar = this.root.querySelector(".game-topbar")!;
    this.turnPill = this.root.querySelector("[data-turn]")!;
    this.barHost = this.root.querySelector(".tb-host")!;
    this.renderer = new TankRenderer(this.canvas, this.canvas.getContext("2d", { alpha: false })!);
    this.loop = new GameLoop((dt) => this.tick(dt));
    this.topbar.addEventListener("click", this.onTopbar);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.resize();
    this.showSetup();
  }

  unmount(): void {
    this.loop.stop();
    this.endMatch();
    this.sfx.close();
    this.topbar.removeEventListener("click", this.onTopbar);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.root.remove();
  }

  resize(): void {
    this.renderer.resize(this.canvas.clientWidth || window.innerWidth, this.canvas.clientHeight || window.innerHeight);
    if (this.match && this.state !== "playing") this.renderer.draw(this.match, 0);
  }

  // ------------------------------------------------------------ match

  private config(): MatchConfig {
    const st = this.settings;
    return {
      players: st.players.slice(0, st.count).map((p, i) => ({ name: p.name.trim() || `Player ${i + 1}`, color: p.color })),
      seed: (Math.random() * 2 ** 32) >>> 0,
      movement: st.movement,
      castles: st.castles,
      wind: st.wind,
      crateEvery: st.crateEvery,
      turnTime: st.turnTime,
    };
  }

  private startMatch(): void {
    saveJSON(SETTINGS_KEY, this.settings);
    this.sfx.unlock();
    this.endMatch();
    const match = new Match(this.config());
    this.match = match;
    this.localSeat = new LocalSeat(this.barHost);
    // Hot-seat: every player shares the one local seat. An online version
    // would put a RemoteSeat here for players on other devices.
    this.seats = match.config.players.map(() => this.localSeat!);
    this.root.classList.add("tanks--playing");
    this.resize();
    this.renderer.reset(match);
    this.accumulator = 0;
    this.lastTick = -1;
    this.state = "playing";
    this.hideOverlay();
    this.topbar.classList.remove("hidden");
    this.drainEvents(match);
    this.loop.start();
  }

  private endMatch(): void {
    this.localSeat?.dispose();
    this.localSeat = null;
    this.seats = [];
    this.match = null;
    this.root.classList.remove("tanks--playing");
  }

  private tick(dt: number): void {
    const match = this.match;
    if (!match) return;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= DT && steps < MAX_STEPS) {
      const seat = this.seats[match.current];
      match.step(seat.read(match));
      this.accumulator -= DT;
      steps++;
      if (match.events.length) this.drainEvents(match);
    }
    if (steps === MAX_STEPS) this.accumulator = 0;
    this.localSeat?.sync(match);
    this.updateHud(match);
    this.renderer.draw(match, dt);
    if (match.phase === "over" && this.state === "playing") this.onMatchOver(match);
  }

  private drainEvents(match: Match): void {
    for (const ev of match.events) {
      this.renderer.onEvent(match, ev);
      this.sound(ev);
      if (ev.type === "turn") this.localSeat?.reset();
    }
    match.events.length = 0;
  }

  private sound(ev: MatchEvent): void {
    switch (ev.type) {
      case "fire":
        this.sfx.fire(ev.power);
        break;
      case "explode":
        this.sfx.explode();
        break;
      case "pickup":
        this.sfx.pickup();
        break;
      case "crate":
        this.sfx.crate();
        break;
      case "turn":
        this.sfx.turn();
        break;
      case "over":
        this.sfx.win();
        break;
      default:
        break;
    }
  }

  private updateHud(match: Match): void {
    const p = match.config.players[match.current];
    let timer = "";
    if (match.config.turnTime > 0 && match.phase === "aim") {
      const secs = Math.ceil(match.turnLeft);
      timer = `<span class="tb-timer${secs <= 5 ? " tb-timer--low" : ""}">⏱ ${secs}</span>`;
      if (secs <= 5 && secs > 0 && secs !== this.lastTick && match.canAct) this.sfx.tick();
      this.lastTick = secs;
    }
    const w = match.wind;
    const wind = w === 0 ? "Calm" : `${w < 0 ? "←" : ""} ${Math.abs(w)} ${w > 0 ? "→" : ""}`;
    const html = `<span style="color:${p.color}">${esc(p.name)}</span>${timer}<span class="tb-wind">💨 ${wind}</span>`;
    if (this.turnPill.innerHTML !== html) this.turnPill.innerHTML = html;
  }

  private onMatchOver(match: Match): void {
    this.state = "over";
    this.loop.stop();
    const players = match.config.players;
    const w = match.winner;
    const title = w === null ? "It's a draw!" : `${esc(players[w].name)} wins!`;
    const rows = match.tanks
      .map((t, i) => {
        const ups = UPGRADE_KINDS.filter((k) => t.ups[k] > 0)
          .map((k) => `${UPGRADES[k].icon}${t.ups[k]}`)
          .join(" ");
        return `<div class="tb-result" style="--pc:${players[i].color}">
          <b>${i === w ? "🏆 " : ""}${esc(players[i].name)}</b>
          <span>${t.dealt} damage dealt${ups ? ` · ${ups}` : ""}</span></div>`;
      })
      .join("");
    this.showOverlay(`
      <h2 style="color:${w === null ? "#fff" : players[w].color}">${title}</h2>
      <div class="tb-results">${rows}</div>
      <div class="btn-row">
        <button class="btn" data-act="rematch">Rematch</button>
        <button class="btn btn--ghost" data-act="setup">Change setup</button>
      </div>`);
    this.wireActs();
  }

  // ------------------------------------------------------------ pause

  private pause(): void {
    if (this.state !== "playing") return;
    this.state = "paused";
    this.loop.stop();
    this.localSeat?.reset();
    this.showOverlay(`
      <h2>Paused</h2>
      <div class="btn-row">
        <button class="btn" data-act="resume">Resume</button>
        <button class="btn btn--ghost" data-act="rematch">Restart</button>
        <button class="btn btn--ghost" data-act="setup">Quit match</button>
      </div>`);
    this.wireActs();
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
        else if (act === "rematch" || act === "start") this.startMatch();
        else if (act === "setup") this.backToSetup();
        else if (act === "home") navigate("#/");
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

  private showSetup(): void {
    this.state = "menu";
    this.topbar.classList.add("hidden");
    const st = this.settings;
    const ctx = this.canvas.getContext("2d", { alpha: false })!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#1b2a3a";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const seg = (name: string, options: { label: string; value: string }[], current: string) =>
      `<div class="seg" data-seg="${name}">${options
        .map((o) => `<button class="seg__btn${o.value === current ? " seg__btn--on" : ""}" data-value="${o.value}">${o.label}</button>`)
        .join("")}</div>`;
    const row = (label: string, body: string) =>
      `<div class="slime-setup__row"><span class="slime-setup__label">${label}</span>${body}</div>`;

    const players = st.players
      .slice(0, st.count)
      .map(
        (p, i) => `
        <div class="tb-player" style="--pc:${p.color}">
          <input class="tb-name" data-name="${i}" maxlength="12" value="${esc(p.name)}" aria-label="Player ${i + 1} name" />
          <div class="tb-colors">${COLORS.map(
            (c) =>
              `<button class="tb-color${c === p.color ? " tb-color--on" : ""}" data-player="${i}" data-color="${c}" style="background:${c}" aria-label="Colour"></button>`,
          ).join("")}</div>
        </div>`,
      )
      .join("");

    this.showOverlay(
      `
      <h2 class="slime-title" style="color:${ACCENT}">Castle Busters</h2>
      <p class="tb-howto">Take turns blasting each other's tanks. Tilt the cannon, hold <b>FIRE</b> to charge, let go to shoot.
      Grab falling crates for upgrades: ${UPGRADE_KINDS.map((k) => `${UPGRADES[k].icon} ${UPGRADES[k].label.toLowerCase()}`).join(", ")}.</p>
      <p class="slime-rotate">Tip: turn your device sideways for a bigger battlefield.</p>
      <div class="slime-setup">
        ${row("Players", seg("count", [2, 3, 4].map((n) => ({ label: `${n} players`, value: String(n) })), String(st.count)))}
        <div class="tb-players">${players}</div>
        ${row("Driving", seg("movement", [{ label: "Off", value: "0" }, { label: "On", value: "1" }], st.movement ? "1" : "0"))}
        ${row("Castles", seg("castles", [{ label: "Off", value: "0" }, { label: "On", value: "1" }], st.castles ? "1" : "0"))}
        ${row("Wind", seg("wind", WINDS.map((w) => ({ label: w.label, value: String(w.value) })), String(st.wind)))}
        ${row("Upgrades", seg("crateEvery", UPGRADE_RATES.map((u) => ({ label: u.label, value: String(u.value) })), String(st.crateEvery)))}
        ${row("Turn timer", seg("turnTime", TIMERS.map((t) => ({ label: t ? `${t}s` : "Off", value: String(t) })), String(st.turnTime)))}
        ${row("Online", `<span class="tb-soon">Play from separate devices — coming soon</span>`)}
      </div>
      <button class="btn" data-act="start">Play ▶</button>
      <button class="btn btn--ghost" data-act="home">← All games</button>
    `,
      true,
    );

    this.overlay.querySelectorAll<HTMLElement>("[data-seg]").forEach((group) => {
      group.addEventListener("click", (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-value]");
        if (!btn) return;
        const v = Number(btn.dataset.value);
        switch (group.dataset.seg) {
          case "count":
            st.count = v;
            break;
          case "movement":
            st.movement = v === 1;
            break;
          case "castles":
            st.castles = v === 1;
            break;
          case "wind":
            st.wind = v;
            break;
          case "crateEvery":
            st.crateEvery = v;
            break;
          case "turnTime":
            st.turnTime = v;
            break;
        }
        saveJSON(SETTINGS_KEY, st);
        this.refreshSetup();
      });
    });
    this.overlay.querySelectorAll<HTMLInputElement>("[data-name]").forEach((input) => {
      input.addEventListener("input", () => {
        st.players[Number(input.dataset.name)].name = input.value;
        saveJSON(SETTINGS_KEY, st);
      });
    });
    this.overlay.querySelectorAll<HTMLElement>("[data-color]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.player);
        const color = btn.dataset.color!;
        // Swap with whoever already has that colour so tanks stay distinct.
        const other = st.players.findIndex((p, j) => j !== i && j < st.count && p.color === color);
        if (other >= 0) st.players[other].color = st.players[i].color;
        st.players[i].color = color;
        saveJSON(SETTINGS_KEY, st);
        this.refreshSetup();
      });
    });
    this.wireActs();
  }

  /** Re-render the setup screen without jumping back to the top. */
  private refreshSetup(): void {
    const scroll = this.overlay.scrollTop;
    this.showSetup();
    this.overlay.scrollTop = scroll;
  }
}

function loadSettings(): Settings {
  const saved = loadJSON<Partial<Settings>>(SETTINGS_KEY, {});
  const st: Settings = { ...DEFAULTS, ...saved, players: DEFAULTS.players.map((p) => ({ ...p })) };
  saved.players?.slice(0, 4).forEach((p, i) => {
    if (p && typeof p.name === "string" && COLORS.includes(p.color)) st.players[i] = { name: p.name, color: p.color };
  });
  st.count = Math.min(4, Math.max(2, Math.round(Number(st.count)) || 2));
  return st;
}

export function createCastleBusters(): Game {
  return new CastleBusters();
}
