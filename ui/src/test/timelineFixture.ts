import type { FightTimeline } from '../api/types';

/** The timeline of a trimmed Ula'tek kill (Oct 7, 2026) for UI tests. */
export const timelineFixture: FightTimeline = {
  durationMs: 478_610,
  bossHpStepMs: 60_000,
  bossHp: [99, 90, null, null, 40, 20, 10, 0],
  dpsStepMs: 120_000,
  raidDps: [3_000_000, 5_000_000, 1_000_000, 4_000_000],
  phases: [
    { kind: 'boss', number: 1, startMs: 0, endMs: 120_000, name: null },
    { kind: 'intermission', number: 1, startMs: 120_000, endMs: 240_000, name: null },
    { kind: 'boss', number: 2, startMs: 240_000, endMs: 478_610, name: null },
  ],
  deaths: [33_200, 239_100],
};
