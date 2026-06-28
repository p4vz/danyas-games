import { GAMES, type GameEntry } from "../games/registry";

/** Render the landing page (game grid) into `root`. */
export function renderLanding(root: HTMLElement): void {
  const page = document.createElement("div");
  page.className = "landing";

  page.innerHTML = `
    <header class="landing__header">
      <h1 class="landing__title">Danya's Games</h1>
      <p class="landing__subtitle">Lightweight. Ad-free. Built for any tablet.</p>
    </header>
    <main class="landing__grid" id="game-grid"></main>
    <footer class="landing__footer">No ads · No tracking · Just play</footer>
  `;

  const grid = page.querySelector<HTMLElement>("#game-grid")!;
  for (const game of GAMES) {
    grid.appendChild(buildCard(game));
  }

  root.appendChild(page);
}

function buildCard(game: GameEntry): HTMLElement {
  const playable = game.status === "playable";
  const card = document.createElement(playable ? "a" : "div");
  card.className = `card${playable ? "" : " card--soon"}`;
  card.style.setProperty("--accent", game.accent);

  if (playable && card instanceof HTMLAnchorElement) {
    card.href = `#/game/${game.id}`;
  }

  card.innerHTML = `
    <div class="card__thumb" aria-hidden="true">
      <span class="card__glyph">${playable ? "▶" : "soon"}</span>
    </div>
    <div class="card__body">
      <h2 class="card__title">${game.title}</h2>
      <p class="card__tagline">${game.tagline}</p>
    </div>
    ${playable ? `<span class="card__badge">Play</span>` : `<span class="card__badge card__badge--soon">Coming soon</span>`}
  `;

  return card;
}
