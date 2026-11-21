import type { DataGame, LogView } from './api/types';

let dataGame: DataGame | null = null;
const listeners = new Set<() => void>();

/** The game data of the open log, which decides which spell icons show; the store keeps it in step. */
export function currentDataGame(): DataGame {
  return dataGame ?? 'retail';
}

/** Listeners hear only of other game data, not of every refresh of the open log. */
export function setCurrentLog(next: Pick<LogView, 'dataGame'> | null) {
  const changed = (next?.dataGame ?? null) !== dataGame;
  dataGame = next?.dataGame ?? null;
  if (changed) listeners.forEach((listener) => listener());
}

export function subscribeCurrentGame(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
