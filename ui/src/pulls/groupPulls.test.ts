import { describe, expect, it } from 'vitest';
import type { FightRow } from '../api/types';
import { groupPulls, pullStatus, pullView } from './groupPulls';

let next = 1;
function fight(
  name: string,
  encounterId: number,
  outcome: FightRow['outcome'],
  durationMs: number,
  bossHpPercent: number | null,
  extra: Partial<FightRow> = {},
): FightRow {
  const index = next++;
  return {
    index,
    encounterId,
    name,
    difficulty: 15,
    difficultyLabel: 'Heroic',
    outcome,
    durationMs,
    bossHpPercent,
    playerCount: 20,
    startUnixMs: Date.UTC(2026, 8, 6, 12, index),
    zone: 'The Venomous Abyss',
    ...extra,
  };
}

// Real values from WoWCombatLog-100626_115111.txt.
const LOG = [
  fight('Vashnik the Malignant', 3455, 'kill', 364_703, 0),
  fight('The Lost Explorers', 3497, 'wipe', 17, null),
  fight('The Lost Explorers', 3497, 'wipe', 180_423, 58.4),
  fight('The Lost Explorers', 3497, 'kill', 440_280, 0),
  fight('Sszorak', 3420, 'wipe', 77_693, 82.2),
  fight('Sszorak', 3420, 'wipe', 247_029, 33.8),
  fight('Sszorak', 3420, 'wipe', 10, null),
  fight('Sszorak', 3420, 'kill', 309_124, 0),
];

describe('groupPulls', () => {
  it('groups pulls by boss, hiding aborted pulls but keeping their numbers and counts', () => {
    const groups = groupPulls(LOG, true);
    expect(groups.map((g) => g.name)).toEqual(['Vashnik the Malignant', 'The Lost Explorers', 'Sszorak']);
    const [vashnik, explorers, sszorak] = groups;
    expect(vashnik.bestWipePercent).toBeNull();
    expect(explorers).toMatchObject({ pullCount: 3, killPull: 3, killDurationMs: 440_280, bestWipePercent: 58.4 });
    expect(explorers.pulls.map((p) => [p.n, p.status])).toEqual([
      [2, 'wipe'],
      [3, 'kill'],
    ]);
    expect(sszorak.pulls.map((p) => p.hpBarPercent)).toEqual([17.8, 66.2, 100].map((v) => expect.closeTo(v, 5)));
    expect(sszorak).toMatchObject({ bestWipePercent: 33.8, killPull: 4 });
  });

  it('shows aborted pulls with an empty bar when not hidden and drops a boss whose only pulls are hidden', () => {
    const aborted = groupPulls(LOG, false)[1].pulls[0];
    expect([aborted.n, aborted.status, aborted.hpBarPercent]).toEqual([1, 'aborted', 0]);
    const onlyAborted = [fight('The Lost Explorers', 3497, 'wipe', 843, null)];
    expect(groupPulls(onlyAborted, true)).toEqual([]);
    expect(groupPulls(onlyAborted, false)).toHaveLength(1);
  });

  it('keeps each difficulty in its own group and shows unknown ones raw', () => {
    const mixed = [
      fight("Nek'zali the Soulcoiler", 3470, 'wipe', 12_303, 100),
      fight("Nek'zali the Soulcoiler", 3470, 'wipe', 446_880, 7.2, { difficulty: 16, difficultyLabel: 'Mythic' }),
      fight("Nek'zali the Soulcoiler", 3470, 'kill', 379_168, 0, { difficulty: 16, difficultyLabel: 'Mythic' }),
      fight('Nymrissa Wavecaller', 3379, 'kill', 281_817, 0, { difficulty: 233, difficultyLabel: null }),
    ];
    const groups = groupPulls(mixed, true);
    expect(groups.map((g) => [g.name, g.difficulty, g.pullCount, g.killPull, g.bestWipePercent])).toEqual([
      ["Nek'zali the Soulcoiler", 'Heroic', 1, null, 100],
      ["Nek'zali the Soulcoiler", 'Mythic', 2, 2, 7.2],
      ['Nymrissa Wavecaller', 'Difficulty 233', 1, 1, null],
    ]);
    expect(new Set(groups.map((g) => g.key)).size).toBe(3);
  });
});

describe('pullStatus', () => {
  it('classifies kills, wipes, aborted and incomplete pulls', () => {
    expect(pullStatus(fight('A', 1, 'kill', 5_000, 0))).toBe('kill');
    expect(pullStatus(fight('A', 1, 'wipe', 9_999, null))).toBe('aborted');
    expect(pullStatus(fight('A', 1, 'wipe', 10_000, 90))).toBe('wipe');
    expect(pullStatus(fight('A', 1, 'incomplete', 60_000, 40))).toBe('incomplete');
    expect(pullStatus(fight('A', 1, 'incomplete', 2_000, null))).toBe('aborted');
  });
});

describe('pullView', () => {
  it('numbers a pull as in the pull list, aborted pulls included', () => {
    expect(pullView(LOG, 8)).toMatchObject({ index: 8, n: 4, status: 'kill' });
    expect(pullView(LOG, 7)).toMatchObject({ n: 3, status: 'aborted' });
    expect(pullView(LOG, 99)).toBeNull();
  });
});
