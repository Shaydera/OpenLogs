import { describe, expect, it } from 'vitest';
import type { FightRow, RunInfo } from '../api/types';
import type { View } from '../store';
import { followUpdate, liveNoticeOf } from './follow';

function fight(index: number, outcome: FightRow['outcome'], durationMs: number, extra: Partial<FightRow> = {}): FightRow {
  return {
    index,
    encounterId: 3497,
    name: 'The Lost Explorers',
    difficulty: 15,
    difficultyLabel: 'Heroic',
    outcome,
    durationMs,
    bossHpPercent: outcome === 'kill' ? 0 : 40,
    playerCount: 20,
    startUnixMs: Date.UTC(2026, 8, 6, 12, index),
    zone: 'The Venomous Abyss',
    run: null,
    runIndex: null,
    combat: null,
    ...extra,
  };
}

const RUN: RunInfo = {
  key: { challengeModeId: 505, keystoneLevel: 12, affixIds: [10, 9], totalTimeMs: 0, bosses: null, timer: null },
  instanceId: 2287,
  killedBosses: 0,
  running: false,
  provisional: false,
};
const DUNGEON: RunInfo = { key: null, instanceId: 230, killedBosses: 2, running: false, provisional: false };

const wipe = (index: number) => fight(index, 'wipe', 120_000);
const kill = (index: number) => fight(index, 'kill', 300_000);
const aborted = (index: number) => fight(index, 'wipe', 4_000);
const trash = (index: number) => fight(index, 'kill', 30_000, { encounterId: 0, name: 'Venomfang Juggernaut', bossHpPercent: null, combat: { enemyCount: 3 } });
const shown = (fightIndex: number): View => ({ kind: 'fight', fightIndex });

describe('followUpdate jump', () => {
  const before = [wipe(10), wipe(20), wipe(30)];

  it.each([
    ['newest shown, new wipe', shown(30), [...before, wipe(40)], true, false, 40],
    ['older shown, new wipe', shown(20), [...before, wipe(40)], true, false, null],
    ['newest shown, new pull aborted while hidden', shown(30), [...before, aborted(40)], true, false, null],
    ['newest shown, new pull aborted but shown', shown(30), [...before, aborted(40)], false, false, 40],
    ['newest shown while comparing', shown(30), [...before, wipe(40)], true, true, null],
    ['no pull shown', { kind: 'start' } as View, [...before, wipe(40)], true, false, null],
    ['newest shown, its outcome changes', shown(30), [wipe(10), wipe(20), kill(30)], true, false, 30],
    ['unknown pull shown, new trash', shown(99), [...before, trash(40)], true, false, 40],
  ] as [string, View, FightRow[], boolean, boolean, number | null][])('%s', (_name, view, after, hideAborted, comparing, jumpTo) => {
    expect(followUpdate(before, after, view, hideAborted, comparing).jumpTo).toBe(jumpTo);
  });

  it('jumps to the run when it arrives with its boss pulls', () => {
    const arrived = [
      fight(40, 'incomplete', 600_000, { run: RUN, name: 'Halls of Atonement' }),
      fight(41, 'kill', 90_000, { runIndex: 40, encounterId: 2400 }),
      fight(42, 'kill', 95_000, { runIndex: 40, encounterId: 2401 }),
    ];
    expect(followUpdate(before, [...before, ...arrived], shown(30), true, false).jumpTo).toBe(40);
  });

  it('moves on from the shown run when the next run arrives', () => {
    const runs = [
      fight(40, 'kill', 600_000, { run: RUN, name: 'Halls of Atonement' }),
      fight(41, 'kill', 90_000, { runIndex: 40, encounterId: 2400 }),
      fight(42, 'kill', 95_000, { runIndex: 40, encounterId: 2401 }),
    ];
    const next = [
      fight(43, 'kill', 700_000, { run: RUN, name: 'Priory of the Sacred Flame' }),
      fight(44, 'kill', 80_000, { runIndex: 43, encounterId: 2570 }),
    ];
    expect(followUpdate(runs, [...runs, ...next], shown(40), true, false).jumpTo).toBe(43);
  });

  it('follow does not leave a boss pull for new trash but follows new trash from a combat pull', () => {
    const before = [wipe(10), trash(20)];
    expect(followUpdate(before, [...before, trash(30)], shown(10), true, false).jumpTo).toBeNull();
    expect(followUpdate(before, [...before, trash(30)], shown(20), true, false).jumpTo).toBe(30);
    expect(followUpdate(before, [...before, wipe(30)], shown(10), true, false).jumpTo).toBe(30);
    expect(followUpdate(before, [...before, wipe(30)], shown(20), true, false).jumpTo).toBeNull();
  });
});

describe('followUpdate shown pull', () => {
  it('flags a shown pull that is no longer listed', () => {
    const before = [wipe(10), wipe(20)];
    const update = followUpdate(before, [wipe(10)], shown(20), true, false);
    expect(update).toEqual({ jumpTo: null, set: null, shownVanished: true, reload: false });
  });
});

describe('followUpdate running run', () => {
  /** Running inside, left but possibly going on after a ghost run, or final. */
  const brd = (durationMs: number, state: 'running' | 'left' | 'final') =>
    fight(1, state === 'running' ? 'incomplete' : 'ended', durationMs, {
      run: { ...DUNGEON, running: state === 'running', provisional: state !== 'final' },
      name: 'Blackrock Depths',
      encounterId: 0,
    });
  const gerstahn = fight(2, 'wipe', 12_000, { runIndex: 1, encounterId: 227 });
  const roccor = fight(3, 'kill', 40_000, { runIndex: 1, encounterId: 228 });

  it('a running run is never a jump target', () => {
    const update = followUpdate([brd(100_000, 'running'), gerstahn], [brd(200_000, 'running'), gerstahn], shown(2), true, false);
    expect([update.jumpTo, update.reload]).toEqual([null, false]);
  });

  it('stays on a shown running run and reloads it when one of its pulls arrives', () => {
    const before = [brd(100_000, 'running'), gerstahn];
    expect(followUpdate(before, [brd(200_000, 'running'), gerstahn, roccor], shown(1), true, false)).toMatchObject({ jumpTo: null, reload: true });
    expect(followUpdate(before, [brd(200_000, 'running'), gerstahn], shown(1), true, false)).toMatchObject({ jumpTo: null, reload: false });
  });

  it('stays on the newest pull through a ghost run and follows the next boss pull of the run', () => {
    const left = followUpdate([brd(100_000, 'running'), gerstahn], [brd(110_000, 'left'), gerstahn], shown(2), true, false);
    expect(left.jumpTo).toBeNull();
    const back = followUpdate([brd(110_000, 'left'), gerstahn], [brd(300_000, 'running'), gerstahn, roccor], shown(2), true, false);
    expect(back.jumpTo).toBe(3);
  });

  it('jumps to a dungeon run once it is final', () => {
    expect(followUpdate([brd(100_000, 'left'), gerstahn], [brd(100_000, 'final'), gerstahn], shown(2), true, false).jumpTo).toBe(1);
  });
});

describe('followUpdate set', () => {
  const set = (kind: 'wipes' | 'kills', fights: number[]): View => ({ kind: 'set', set: { kind, encounterId: 3497, difficulty: 15, fights } });
  const before = [wipe(10), wipe(20), wipe(30)];

  it('appends new matching pulls and drops vanished ones', () => {
    const after = [wipe(10), wipe(30), wipe(40), kill(50), aborted(60), fight(70, 'wipe', 120_000, { encounterId: 9999 })];
    const update = followUpdate(before, after, set('wipes', [10, 20, 30]), true, false);
    expect(update.set).toEqual({ kind: 'wipes', encounterId: 3497, difficulty: 15, fights: [10, 30, 40] });
    expect(update.jumpTo).toBeNull();
  });

  it('collects kills into a kills set', () => {
    const update = followUpdate(before, [...before, wipe(40), kill(50)], set('kills', [30]), true, false);
    expect(update.set?.fights).toEqual([30, 50]);
  });

  it.each([
    ['drops a pull that no longer fits the set', [wipe(10), wipe(20), kill(30)], [10, 20]],
    ['reads a pull again that changed but still fits', [wipe(10), wipe(20), fight(30, 'wipe', 130_000)], [10, 20, 30]],
  ] as [string, FightRow[], number[]][])('%s', (_name, after, fights) => {
    expect(followUpdate(before, after, set('wipes', [10, 20, 30]), true, false).set?.fights).toEqual(fights);
  });

  it('leaves the set alone when nothing changes for it', () => {
    expect(followUpdate(before, [...before, kill(40)], set('wipes', [10, 20]), true, false).set).toBeNull();
  });
});

describe('liveNoticeOf', () => {
  it('numbers a pull among its boss pulls, hidden ones counted', () => {
    const fights = [aborted(1), wipe(2), fight(3, 'wipe', 150_000, { bossHpPercent: 12.4 })];
    expect(liveNoticeOf(fights, 3)).toEqual({ kind: 'pull', n: 3, status: 'wipe', bossHpPercent: 12.4 });
  });

  it('describes a run', () => {
    const fights = [fight(5, 'incomplete', 600_000, { run: RUN, name: 'Halls of Atonement' })];
    expect(liveNoticeOf(fights, 5)).toEqual({ kind: 'run', heading: 'Halls of Atonement +12', status: 'incomplete' });
  });

  it('describes a dungeon run', () => {
    const brd = { run: DUNGEON, name: 'Blackrock Depths', difficulty: 1, difficultyLabel: 'Normal' };
    const fights = [fight(5, 'ended', 600_000, brd)];
    expect(liveNoticeOf(fights, 5)).toEqual({ kind: 'run', heading: 'Blackrock Depths Normal', status: 'ended' });
  });

  it('names a combat pull after its enemies', () => {
    expect(liveNoticeOf([wipe(1), trash(2)], 2)).toEqual({ kind: 'combat', name: 'Venomfang Juggernaut', moreEnemies: 2, status: 'kill' });
  });
});
