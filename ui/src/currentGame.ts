import type { Game } from './api/types';

let game: Game | null = null;
const listeners = new Set<() => void>();

/** The game of the open log, which decides how names read and which spell icons show; the store keeps it in step. */
export function currentGame(): Game | null {
  return game;
}

/** Listeners hear only of another game, not of every refresh of the open log. */
export function setCurrentGame(next: Game | null) {
  const changed = JSON.stringify(next) !== JSON.stringify(game);
  game = next;
  if (changed) listeners.forEach((listener) => listener());
}

export function subscribeCurrentGame(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
