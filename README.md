# Danya's Games

Lightweight, ad-free clones of Danya's favorite games — built to run smoothly on
low-end tablets. Prototypes are built for the **browser first**, then packaged to
**Android** with [Capacitor](https://capacitorjs.com/).

No ads. No tracking. No bulk.

**Play it:** https://p4vz.github.io/danyas-games/

## Stack

- **Vite + TypeScript** — fast dev server, tiny production bundles.
- **Vanilla HTML5 Canvas** — no heavy game engine, minimal CPU/GPU load.
- **Capacitor** — wraps the built web app in a native Android WebView.

## Project layout

```
src/
├── main.ts              # boots the router
├── router.ts            # minimal hash router (#/ and #/game/<id>)
├── core/                # shared building blocks
│   ├── Game.ts          #   interface every game implements
│   ├── GameLoop.ts      #   rAF loop, clamped delta, auto-pause when hidden
│   └── storage.ts       #   localStorage helpers (best scores)
├── pages/landing.ts     # the game-grid landing page
└── games/
    ├── registry.ts      # single source of truth for the collection
    └── geometry-beat/   # first game (Geometry Dash clone, beat-synced)
```

### Adding a game

1. Create `src/games/<id>/index.ts` exporting a factory that returns a `Game`
   (`mount` / `unmount` / `resize`).
2. Add one entry to `src/games/registry.ts`.

The landing grid and router pick it up automatically.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm run typecheck  # tsc --noEmit
npm run build      # type-check + production build to dist/
npm run preview    # serve the built dist/
```

## Deploy

The web build is deployed to **GitHub Pages via GitHub Actions**
(`.github/workflows/deploy.yml`). Every push to the deploy branch builds `dist/`
and publishes it — no build artifacts are committed to git.

One-time setup: in the repo, go to **Settings → Pages → Build and deployment** and
set **Source** to **"GitHub Actions"**.

The relative `base: './'` in `vite.config.ts` makes the app work both at the Pages
project subpath (`/danyas-games/`) and from `file://` inside the Capacitor WebView,
so the same build serves web and Android.

## Geometry Beat — how beat-sync works

The soundtrack is **synthesized at runtime via the Web Audio API** (kick, bass and
lead arpeggio derived from the BPM) — there are no audio files to ship, and no
licensing concerns. Because the game owns the audio clock, gameplay reads the
current beat straight from the audio playhead (`AudioContext.currentTime`).

Obstacle positions are a pure function of the beat:

```
x = playerX + (note.beat − currentBeat) × pixelsPerBeat
```

So every obstacle reaches the player exactly on its beat, and the game stays in
sync even if the render loop drops frames on a weak device. Levels are authored as
beatmaps (BPM + a list of `{ beat, type }` notes) in
`src/games/geometry-beat/beatmap.ts`.

The soundtrack itself is layered (limiter, feedback-delay lead, kick/snare/hats,
8th-note bassline, melodic motifs) and each level carries an `intensity` that scales
the mix, plus an optional `speed` scroll multiplier used for the harder levels.

Beyond the flat-ground spike/block obstacles, levels can include **terrain** via a
`segments` array: **floor gaps** (jump across), **ramps** (the cube follows the slope),
**ceilings / tunnels** (low-ceiling no-jump corridors — jumping into one is fatal), and
**inclined tunnels** (a ramp with a parallel ceiling). There is also a **top-spike**
obstacle that hangs from above — stay grounded to pass under it. See the "Cavern" level
in `beatmap.ts` for an example using all of them.

**Flight mode**: a `fly` segment switches the cube into a ship between two dashed
portals — hold to ascend, release to descend; floor and ceiling are safe to slide
along, but the spikes still kill. The Expert ("Hyperbeat") and Insane ("Mayhem")
levels are hand-authored compositions that sequence rhythm-cube sections, tunnel
runs, flight-weave corridors, and gap gauntlets.

### Level editor

From the Geometry Beat menu, **＋ Create level** opens a touch-friendly editor: tap a
beat on the timeline to place the selected obstacle (spike / double / block). Obstacles
snap to whole beats, and placement is **refused when it would sit closer than the
solvable minimum gap** (`minGapBeats(bpm)` in `customLevels.ts`, derived from the fixed
jump airtime) — so every level you build stays beatable. Test-play reuses the normal
beat-driven engine; saved levels are stored in `localStorage` and appear under
"Your levels" with edit/delete.

## Android build

Capacitor config lives in `capacitor.config.ts` (app id `com.danyasgames.app`).

```bash
# one-time, generates the native android/ project
npx cap add android

# build web + copy into the native project
npm run cap:sync

# open in Android Studio to run on a device/emulator or build an APK
npm run cap:android
```

> The `android/` project is committed, but generated build artifacts
> (`android/build/`, `android/.gradle/`, `local.properties`, copied web assets)
> are git-ignored. Building an APK requires the Android SDK / Android Studio.

## License / assets

Game *clones* are reimplementations; no copyrighted assets are bundled. The
Geometry Beat soundtrack is procedurally generated, not sampled.
