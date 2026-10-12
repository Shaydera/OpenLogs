import { describe, expect, it } from 'vitest';
import type { FightRow, RunInfo } from '../api/types';
import { comparablePulls, groupPulls, groupRuns, pullStatus, pullView, rangeKey, runChipLabel, runProgress, runStatus, runSubtitle } from './groupPulls';
import { runLogFixture } from '../test/runFixture';

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
    run: null,
    runIndex: null,
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
    expect(comparablePulls(mixed, mixed[0])).toEqual([]);
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

describe('comparable pulls', () => {
  it('offers the other pulls of the boss and difficulty, never aborted ones, numbered as in the pull list', () => {
    expect(comparablePulls(LOG, LOG[7]).map((p) => [p.index, p.n, p.status])).toEqual([
      [5, 1, 'wipe'],
      [6, 2, 'wipe'],
    ]);
    expect(comparablePulls(LOG, LOG[0])).toEqual([]);
    expect(pullView(LOG, 8)).toMatchObject({ index: 8, n: 4, status: 'kill' });
    expect(pullView(LOG, 7)).toMatchObject({ n: 3, status: 'aborted' });
    expect(pullView(LOG, 99)).toBeNull();
  });

  it('offers no comparison for Mythic+ boss pulls whose run is missing from the log', () => {
    const first = fight('Captain Dailcry', 2847, 'wipe', 60_000, 40, { difficulty: 8, difficultyLabel: 'Mythic+' });
    const second = fight('Captain Dailcry', 2847, 'kill', 70_000, 0, { difficulty: 8, difficultyLabel: 'Mythic+' });
    expect(comparablePulls([first, second], second)).toEqual([]);
  });
});

describe('Mythic+ runs', () => {
  const RUN: RunInfo = { challengeModeId: 499, keystoneLevel: 12, affixIds: [10, 147, 9], totalTimeMs: 600_000, bosses: null, timer: null };
  const MPLUS = { difficulty: 8, difficultyLabel: 'Mythic+', playerCount: 5 };
  const RUN_LOG = [
    fight("Ula'tek", 3492, 'kill', 478_610, 0, { index: 101 }),
    fight('Priory of the Sacred Flame', 0, 'kill', 600_000, null, { ...MPLUS, index: 102, run: RUN }),
    fight('Captain Dailcry', 2847, 'kill', 60_000, 0, { ...MPLUS, index: 103, runIndex: 102 }),
    fight('Baron Braunpyke', 2835, 'wipe', 19, null, { ...MPLUS, index: 104, runIndex: 102 }),
    fight('Baron Braunpyke', 2835, 'wipe', 30_000, 87.5, { ...MPLUS, index: 105, runIndex: 102 }),
    fight('Baron Braunpyke', 2835, 'kill', 60_000, 0, { ...MPLUS, index: 106, runIndex: 102 }),
    fight('Priory of the Sacred Flame', 0, 'incomplete', 90_000, null, {
      ...MPLUS,
      index: 107,
      run: { ...RUN, keystoneLevel: 13, totalTimeMs: null },
    }),
    fight('Captain Dailcry', 2847, 'wipe', 45_000, 40, { ...MPLUS, index: 108, runIndex: 107 }),
  ];

  it('lists each run with its boss pulls numbered within the run and its dungeon data', () => {
    const runs = groupRuns(RUN_LOG, true);
    expect(runs.map((run) => [run.index, run.dungeon, run.keystoneLevel, run.status, run.pullCount, run.bosses, run.timer])).toEqual([
      [102, 'Priory of the Sacred Flame', 12, 'completed', 4, null, null],
      [107, 'Priory of the Sacred Flame', 13, 'incomplete', 1, null, null],
    ]);
    expect(runs[0].affixIds).toEqual([10, 147, 9]);
    expect(runs[0].pulls.map((pull) => [pull.index, pull.n, pull.name, pull.status])).toEqual([
      [103, 1, 'Captain Dailcry', 'kill'],
      [105, 3, 'Baron Braunpyke', 'wipe'],
      [106, 4, 'Baron Braunpyke', 'kill'],
    ]);
    expect(groupRuns(RUN_LOG, false)[0].pulls.map((pull) => pull.n)).toEqual([1, 2, 3, 4]);
    expect(groupRuns(LOG, false)).toEqual([]);

    const known: RunInfo = { ...RUN, bosses: { killed: 3, total: 3 }, timer: { kind: 'inTime', upgrades: 2 } };
    const [run] = groupRuns([{ ...RUN_LOG[1], run: known }], false);
    expect([run.bosses, run.timer]).toEqual([{ killed: 3, total: 3 }, { kind: 'inTime', upgrades: 2 }]);
  });

  it('keeps runs and their boss pulls out of the boss groups and comparisons, with saved ranges per dungeon', () => {
    expect(groupPulls(RUN_LOG, false).map((group) => group.name)).toEqual(["Ula'tek"]);
    expect(comparablePulls(RUN_LOG, RUN_LOG[5])).toEqual([]);
    expect(comparablePulls(RUN_LOG, RUN_LOG[1])).toEqual([]);
    expect(pullView(RUN_LOG, 106)).toBeNull();
    expect([rangeKey(RUN_LOG[1]), rangeKey(RUN_LOG[2]), rangeKey(LOG[0])]).toEqual(['run:499', '2847:8', '3455:15']);
  });

  it('names the result of a run and only what the dungeon data tells', () => {
    expect([runStatus(RUN_LOG[1]), runStatus({ ...RUN_LOG[1], outcome: 'wipe' }), runStatus(RUN_LOG[6])]).toEqual(['completed', 'notCompleted', 'incomplete']);
    expect(runProgress({ bosses: { killed: 3, total: 3 }, timer: { kind: 'inTime', upgrades: 2 } })).toEqual(['In time +2', '3/3 bosses']);
    expect(runProgress({ bosses: { killed: 4, total: 4 }, timer: { kind: 'overTime' } })).toEqual(['Over time', '4/4 bosses']);
    expect(runProgress({ bosses: { killed: 1, total: 1 }, timer: null })).toEqual(['1/1 boss']);
    expect(runProgress({ bosses: null, timer: null })).toEqual([]);
  });
});

describe('run cards', () => {
  it("shows the logged key time, not an abandoned key's 0, with the result and the dungeon data", () => {
    const [run] = groupRuns(runLogFixture.fights, true);
    expect(run.loggedMs).toBe(1_859_624);
    const abandoned = { ...runLogFixture.fights[0], run: { ...runLogFixture.fights[0].run!, totalTimeMs: 0 } };
    expect(groupRuns([abandoned], true)[0].loggedMs).toBeNull();

    expect(runSubtitle(run)).toBe('3/3 bosses · 5 boss pulls · Affixes 10, 147, 9');
    expect(runSubtitle({ ...run, bosses: null, affixIds: [] })).toBe('5 boss pulls');
    const chips = [run, { ...run, timer: { kind: 'overTime' as const } }, { ...run, timer: null, loggedMs: null }, { ...run, status: 'notCompleted' as const }];
    expect(chips.map(runChipLabel)).toEqual(['In time +1 · 30:59', 'Over time · 30:59', 'Completed · 31:00', 'Not completed']);
  });
});
