import type { DataGame, Game, LogView } from './api/types';

let log: Pick<LogView, 'game' | 'dataGame'> | null = null;
const listeners = new Set<() => void>();

/** The game of the open log, which decides how names read; the store keeps it in step. */
export function currentGame(): Game | null {
  return log?.game ?? null;
}

/** The game data of the open log, which decides which spell icons show. */
export function currentDataGame(): DataGame {
  return log?.dataGame ?? 'retail';
}

/** Listeners hear only of another game, not of every refresh of the open log. */
export function setCurrentLog(next: Pick<LogView, 'game' | 'dataGame'> | null) {
  const key = (value: typeof next) => JSON.stringify([value?.game ?? null, value?.dataGame ?? null]);
  const changed = key(next) !== key(log);
  log = next;
  if (changed) listeners.forEach((listener) => listener());
}

export function subscribeCurrentGame(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
