import type { Game } from './api/types';

let game: Game | null = null;

/** The game of the open log, which decides how names read; the store keeps it in step. */
export function currentGame(): Game | null {
  return game;
}

export function setCurrentGame(next: Game | null) {
  game = next;
}
