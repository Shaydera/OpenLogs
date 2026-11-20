import type { Game } from './api/types';

let game: Game | null = null;
const listeners = new Set<() => void>();

/** The game of the open log, which decides how names read and which spell icons show; the store keeps it in step. */
export function currentGame(): Game | null {
  return game;
}

export function setCurrentGame(next: Game | null) {
  game = next;
  listeners.forEach((listener) => listener());
}

export function subscribeCurrentGame(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
