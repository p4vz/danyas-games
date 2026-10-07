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
    ├── geometry-beat/   # first game (Geometry Dash clone, beat-synced)
    └── slime/           # Slime Sports: volleyball, soccer, basketball
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
npm test           # vitest: physics, simulation and CPU-vs-CPU tests
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

## Slime Sports — how it works

A remake of the old Slime Volleyball / Soccer / Basketball flash games, built
to grow more sports and online play later.

```
src/games/slime/
├── index.ts        # shell: sport select, setup (characters, CPU, ball speed), match flow
├── world.ts        # authoritative match sim: fixed 240 Hz steps, phases, scoring
├── physics.ts      # pure functions: slime/ball/static collisions, impulses
├── characters.ts   # playable slimes (size, mass, speed, accel, jump, bounce)
├── ai.ts           # trajectory-predicting CPU
├── predict.ts      # ball look-ahead into preallocated typed arrays
├── headless.ts     # CPU-vs-CPU matches with no rendering (tests / tuning)
├── input.ts        # maps joystick / drag / keyboard to per-player intents
├── touchpad.ts     # on-screen joystick + aux button per local player
├── controls.ts     # control settings, default layouts, placement maths
├── controlsEditor.ts # drag-to-customise HUD layout editor
├── render.ts       # canvas renderer, letterboxed world → screen
├── sfx.ts          # synthesized hit / score sounds
├── modes/          # one file per sport + registry
└── __tests__/      # physics, world and CPU-vs-CPU match tests (vitest)
```

**Characters** differ in radius, mass, top speed, acceleration, jump and
bounciness. Every collision (ball↔slime, slime↔slime) is an impulse exchange
weighted by mass with a coefficient of restitution from the slimes' bounciness,
so heavy slimes shove light ones and a bouncy slime launches the ball. Slimes
can land on each other's heads, but domes are slippery: off centre you slide
off.

**Touch controls**: each local player gets a virtual joystick (sideways
deflection = run speed, push up = jump) and an aux button. In 2-player mode the
sets are mirrored on each half of the screen, and every control captures its
own finger, so co-op on one tablet just works. The joystick can be **fixed** or
**floating** (it appears wherever your thumb lands on your side, and follows a
thumb that slides past its edge). The older "drag slime" style (the slime
chases your finger; drag above it to jump) is still available. The field
keeps clear of the controls, either by lifting the floor above them or, on
wide phones, by fitting them into the side margins, whichever leaves the
bigger field.

Default control sizes and spots are chosen for real devices. The stick is
~23–29 mm across on tablets and the aux button ~14–18 mm, both well above the
48dp / 44pt minimum touch targets; phones get a 17 mm floor. Defaults keep
36 px from the side edges and 30 px from the bottom, out of Android's
edge-swipe "Back" zone and the swipe-up "Home" zone a thumb pushing up to jump
would otherwise hit. They also respect safe-area insets (notches, home
indicator), and long-presses on the buttons never open a menu. "Up = jump"
triggers past half deflection. A tighter angle cone was modelled and rejected:
it cut accidental jumps while running only slightly and missed more deliberate
diagonal run-jumps.

**Customise controls** (setup screen or pause menu) is a HUD layout editor:
drag any control to move it, tap to select and resize it, set opacity, pick
fixed or floating and joystick or drag. Separate 1- and 2-player layouts,
saved on the device; *Reset* restores the defaults.

**Aux button**, per sport (`SlimeMode.aux`):

- Basketball, **GRAB**: hold to catch and carry the ball (at 75% speed), let go
  to toss it straight up; tilting the stick lobs it a little, enough for a
  lay-up, not a long-range auto-shot. Bumping the carrier (or touching the ball)
  knocks it loose, it auto-throws after 2.5 s, and you can't score while
  carrying.
- Volleyball, **SET**, and soccer, **FLICK**: tap to pop a ball off your head
  straight up.

Keyboard: A/D move, W jump, S aux for the left player; arrows and ↓ for the
right (either set in 1-player).

**Ball speed** is a time-scale on the ball only: the same arcs play faster or
slower, so hits feel identical at any setting.

**AI**: on every re-plan it

1. simulates the ball forward with the real physics,
2. searches a fan of contact angles for ground hits and timed jumps it could
   make (given its own speed / accel / jump arc), including tilted contacts when
   a wall or the net stops it standing in the ideal spot,
3. **verifies each idea by replaying its own steering and jump through the
   game's movement and collision code**, so the contact point, angle and
   velocities are the ones that will actually happen,
4. applies the game's impulse maths at that contact, predicts the ball's next
   path, and asks the sport how good the outcome is (lands far from the
   opponent / goes in / swishes),
5. executes the best plan.

If it is jammed against a wall or the other slime with the ball going nowhere,
it backs off, or jumps through the ball to dig it out of a corner.

In basketball, Medium and Hard also use **GRAB**. With the ball on their head
and no scoring hit lined up, they catch it and look for a shooting spot by
trying throws from spots across their attacking half with the game's own
launch maths (spread over several frames to avoid stutter). They walk there and
let go as soon as a throw is predicted to go in, when they arrive, or when a
defender closes in. When you're carrying, the CPU charges you to bump it loose. Easy, Medium
and Hard differ in reaction time, look-ahead, how many options they try, and
aim / timing noise. Unguarded in basketball, Hard sinks ~95% of the shots it
plans.

**Adding a sport**: create `modes/<sport>.ts` implementing `SlimeMode` and add it
to `modes/index.ts`. A mode provides:

- `arena`: walls, `statics` (rounded segments: nets, crossbars, rims) and
  one-way `platforms` (e.g. the hoop: balls drop through, never come up);
- `ball`: radius, mass, gravity, bounciness, minimum pop off a slime, …;
- `slimePhysics` (optional): overrides for slime gravity, ground `traction`
  (ice ≪ 1) and air control. Movement, touch and the AI all use it;
- rules: `serve`, `nextServer`, `checkRules`, plus optional `onTouch` and
  `createRallyData`. The world tracks per-rally state in `world.rally`
  (touches per side, consecutive touches, last touch, floor bounces per half,
  and a mode-specific `data` bag), so "one bounce per side" (tennis) or "three
  touches max" are a few lines;
- AI hooks: `evaluate` (rate a predicted ball path) and `homeX`;
- art: `drawArena` (static, rendered once and cached), `drawForeground`,
  `drawBall`.

**Multiplayer-ready**: the world only consumes per-side `Intent`s and is
deterministic for a seed + input stream (seeded PRNG, fixed timestep). It has no
DOM dependencies, so it can also run server-side as the authoritative host for
online play.

**Tests**: `npm test` runs the vitest suite (also in CI): physics rules
(momentum, restitution, slippery heads, the hoop can't be entered from below),
determinism, predictor vs. live simulation, rally state, mode physics
overrides, and seeded CPU-vs-CPU matches for every sport (finishes, ball rarely
stuck, Hard beats Easy, an unguarded CPU scores).

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
