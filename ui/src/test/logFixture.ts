import type { FightRow, LogView, Outcome } from '../api/types';

function pull(index: number, outcome: Outcome, durationMs: number, bossHpPercent: number | null): FightRow {
  return {
    index,
    encounterId: 3492,
    name: "Ula'tek",
    difficulty: 15,
    difficultyLabel: 'Heroic',
    outcome,
    durationMs,
    bossHpPercent,
    playerCount: 4,
    startUnixMs: Date.UTC(2026, 9, 7, 19, index * 10),
    zone: 'The Venomous Abyss',
  };
}

/** Ula'tek Heroic: a wipe, an aborted pull and the kill. */
export const logFixture: LogView = {
  path: 'C:\\Logs\\WoWCombatLog-100726_185823.txt',
  fileName: 'WoWCombatLog-100726_185823.txt',
  sizeBytes: 230_331_451,
  cacheHit: true,
  logVersion: 22,
  build: '12.1.0',
  advancedLogging: true,
  brokenLines: 0,
  warnings: [],
  zone: 'The Venomous Abyss',
  startUnixMs: Date.UTC(2026, 9, 7, 19, 10),
  fights: [pull(1, 'wipe', 142_550, 60.4), pull(2, 'wipe', 19, null), pull(3, 'kill', 478_610, 0)],
};
