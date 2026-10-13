import type { FightRow, LogView, RunInfo } from '../api/types';

/** 30:59.6 against the real limits 32:30 / 26:00 / 19:30: in time +1. */
const PRIORY: RunInfo = {
  challengeModeId: 499,
  keystoneLevel: 12,
  affixIds: [10, 147, 9],
  totalTimeMs: 1_859_624,
  bosses: { killed: 3, total: 3 },
  timer: { kind: 'inTime', upgrades: 1 },
};

function row(
  index: number,
  name: string,
  encounterId: number,
  outcome: FightRow['outcome'],
  durationMs: number,
  bossHpPercent: number | null,
  extra: Partial<FightRow> = {},
): FightRow {
  return {
    index,
    encounterId,
    name,
    difficulty: 8,
    difficultyLabel: 'Mythic+',
    outcome,
    durationMs,
    bossHpPercent,
    playerCount: 5,
    startUnixMs: Date.UTC(2026, 9, 8, 20, index),
    zone: 'Priory of the Sacred Flame',
    run: null,
    runIndex: 1,
    ...extra,
  };
}

/**
 * A +12 Priory of the Sacred Flame completed in 31:00 (log index 1) with five boss pulls
 * (2–6; pull 3 is an aborted 4 s wipe), then Ula'tek Heroic outside the run (7).
 */
export const runLogFixture: LogView = {
  id: 'WoWCombatLog-100826_195800.txt',
  fileName: 'WoWCombatLog-100826_195800.txt',
  sizeBytes: 52_428_800,
  cacheHit: false,
  logVersion: 22,
  build: '12.1.0',
  advancedLogging: true,
  brokenLines: 0,
  warnings: [],
  zone: 'Priory of the Sacred Flame',
  startUnixMs: Date.UTC(2026, 9, 8, 20, 1),
  fights: [
    row(1, 'Priory of the Sacred Flame', 0, 'kill', 1_860_000, null, { run: PRIORY, runIndex: null }),
    row(2, 'Captain Dailcry', 2847, 'kill', 95_000, 0),
    row(3, 'Baron Braunpyke', 2835, 'wipe', 4_000, null),
    row(4, 'Baron Braunpyke', 2835, 'wipe', 62_000, 41.5),
    row(5, 'Baron Braunpyke', 2835, 'kill', 101_000, 0),
    row(6, 'Prioress Murrpray', 2848, 'kill', 140_000, 0),
    row(7, "Ula'tek", 3492, 'kill', 478_610, 0, {
      difficulty: 15,
      difficultyLabel: 'Heroic',
      playerCount: 20,
      zone: 'The Venomous Abyss',
      runIndex: null,
    }),
  ],
};
