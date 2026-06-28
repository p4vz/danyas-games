/**
 * Common contract every game in the collection implements.
 *
 * The router mounts a game into a container element and tears it down on
 * navigation. Keeping this uniform means a new game is just a folder under
 * `src/games/` plus one entry in `registry.ts`.
 */
export interface Game {
  /** Build DOM / canvas inside `container` and start running. */
  mount(container: HTMLElement): void;
  /** Stop loops, release audio, remove listeners. Must be idempotent. */
  unmount(): void;
  /** Called when the viewport size changes. */
  resize(): void;
}

/** Factory signature stored in the registry. */
export type GameFactory = () => Game;
