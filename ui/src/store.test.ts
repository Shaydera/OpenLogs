import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { api } from './api/client';
import type { ChosenLog, LogSource } from './api/logSource';
import type { DamageReport, LogView, PullComparison, QuickOverview, RecentLog, Scope, Timeline } from './api/types';
import { comparisonFixture } from './test/compareFixture';
import { overviewFixture } from './test/overviewFixture';
import {
  abilityDetailFixture,
  aurasReportFixture,
  breakdownFixture,
  castsReportFixture,
  damageReportFixture,
  deathsReportFixture,
  healingReportFixture,
  interruptsReportFixture,
  playerDetailFixture,
  resourcesReportFixture,
  takenReportFixture,
  targetDetailFixture,
} from './test/reportFixtures';
import { eventsPageFixture, timelineFixture } from './test/viewFixtures';
import { type FightTab, initialState, useApp } from './store';

vi.mock('./api/client', () => ({
  api: {
    openLog: vi.fn(),
    recentLogs: vi.fn(),
    reopenRecent: vi.fn(),
    removeRecent: vi.fn(),
    quickOverview: vi.fn(),
    damageDoneReport: vi.fn(),
    healingReport: vi.fn(),
    damageTakenReport: vi.fn(),
    playerDetail: vi.fn(),
    abilityDetail: vi.fn(),
    targetDetail: vi.fn(),
    deathsReport: vi.fn(),
    castsReport: vi.fn(),
    aurasReport: vi.fn(),
    interruptsReport: vi.fn(),
    resourcesReport: vi.fn(),
    comparePulls: vi.fn(),
    breakdownReport: vi.fn(),
    filterOptions: vi.fn(),
    events: vi.fn(),
    timeline: vi.fn(),
  },
}));

const LOG: LogView = {
  id: 'WoWCombatLog-100726_185823.txt',
  fileName: 'WoWCombatLog-100726_185823.txt',
  sizeBytes: 230_331_451,
  cacheHit: false,
  logVersion: 22,
  build: '12.1.0',
  advancedLogging: true,
  brokenLines: 0,
  warnings: [],
  zone: 'The Venomous Abyss',
  startUnixMs: Date.UTC(2026, 9, 7, 19, 3, 2),
  fights: [],
};

const WHOLE_PULL = { startMs: null, endMs: null, attribution: 'reattributed' };
const OPEN = { perspective: 'friendly', source: [], target: [], ability: [] };

function sourceOf(log: LogView): LogSource {
  return { id: log.id, name: log.fileName, size: log.sizeBytes, lastModified: 0, read: vi.fn() };
}

function chosen(log: LogView): ChosenLog {
  return { name: log.fileName, open: async () => sourceOf(log) };
}
const ENEMY = 'Blightscale Rawling';
const PYRRIN_ROW = JSON.stringify({ kind: 'unit', unit: { kind: 'player', actorId: 2 } });

beforeEach(() => {
  Object.values(api).forEach((fn) => (fn as Mock).mockReset());
  vi.mocked(api.recentLogs).mockResolvedValue([]);
  vi.mocked(api.openLog).mockResolvedValue(LOG);
  vi.mocked(api.quickOverview).mockResolvedValue(overviewFixture);
  vi.mocked(api.breakdownReport).mockResolvedValue(breakdownFixture);
  vi.mocked(api.damageDoneReport).mockResolvedValue(damageReportFixture);
  vi.mocked(api.healingReport).mockResolvedValue(healingReportFixture);
  vi.mocked(api.damageTakenReport).mockResolvedValue(takenReportFixture);
  vi.mocked(api.playerDetail).mockResolvedValue(playerDetailFixture);
  vi.mocked(api.abilityDetail).mockResolvedValue(abilityDetailFixture);
  vi.mocked(api.targetDetail).mockResolvedValue(targetDetailFixture);
  vi.mocked(api.deathsReport).mockResolvedValue(deathsReportFixture);
  vi.mocked(api.castsReport).mockResolvedValue(castsReportFixture);
  vi.mocked(api.comparePulls).mockResolvedValue(comparisonFixture);
  vi.mocked(api.events).mockResolvedValue(eventsPageFixture);
  vi.mocked(api.timeline).mockResolvedValue(timelineFixture);
  localStorage.clear();
  useApp.setState(initialState());
});

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function openPull() {
  await useApp.getState().openLog(chosen(LOG));
  await useApp.getState().openFight(1);
}

describe('logs and pulls', () => {
  it('opens a log, refreshes the recent list and loads a pull', async () => {
    await useApp.getState().openLog(chosen(LOG));
    expect(useApp.getState()).toMatchObject({ log: LOG, opening: null });
    expect(api.recentLogs).toHaveBeenCalled();

    await useApp.getState().openFight(1);
    expect(api.quickOverview).toHaveBeenCalledWith(LOG.id, 1, null);
    expect(useApp.getState()).toMatchObject({ view: { kind: 'fight', fightIndex: 1 }, overview: overviewFixture });
    useApp.getState().backToPulls();
    expect(useApp.getState().view).toEqual({ kind: 'start' });
  });

  it('shows the indexing progress while a log opens', async () => {
    const indexed = deferred<LogView>();
    let report: (bytesRead: number, totalBytes: number) => void = () => {};
    vi.mocked(api.openLog).mockImplementation((_, onProgress) => {
      report = onProgress ?? report;
      return indexed.promise;
    });
    const opening = useApp.getState().openLog(chosen(LOG));
    await vi.waitFor(() => expect(api.openLog).toHaveBeenCalled());
    report(8 << 20, LOG.sizeBytes);
    expect(useApp.getState().opening).toEqual({ file: LOG.fileName, bytesRead: 8 << 20, totalBytes: LOG.sizeBytes });
    indexed.resolve(LOG);
    await opening;
    expect(useApp.getState()).toMatchObject({ log: LOG, opening: null });
  });

  it('opens a recent log again through its stored entry', async () => {
    const entry: RecentLog = { id: LOG.id, fileName: LOG.fileName, sizeBytes: LOG.sizeBytes, zone: null, startUnixMs: null, pullCount: 3, openedAtUnixMs: 0, exists: true };
    vi.mocked(api.reopenRecent).mockResolvedValue(sourceOf(LOG));
    await useApp.getState().openRecent(entry);
    expect(api.reopenRecent).toHaveBeenCalledWith(LOG.id);
    expect(useApp.getState().log).toEqual(LOG);
  });

  it('keeps the open log when another cannot be reached, and drops it once reading the other failed', async () => {
    await openPull();
    const unreachable: ChosenLog = { name: 'gone.txt', open: () => Promise.reject(new DOMException('gone', 'NotFoundError')) };
    await useApp.getState().openLog(unreachable);
    expect(useApp.getState()).toMatchObject({ log: LOG, view: { kind: 'fight', fightIndex: 1 } });

    vi.mocked(api.openLog).mockRejectedValueOnce('The log changed on disk since it was opened. Open it again to read it.');
    await useApp.getState().openLog(chosen({ ...LOG, id: 'other.txt', fileName: 'other.txt' }));
    expect(useApp.getState()).toMatchObject({ log: null, view: { kind: 'start' }, overview: null });
    expect(useApp.getState().error).toContain('Could not open other.txt');
  });

  it('turns a failed open into a readable error and still refreshes the recent list', async () => {
    const gone: ChosenLog = { name: 'gone.txt', open: () => Promise.reject(new DOMException('The file could not be found.', 'NotFoundError')) };
    await useApp.getState().openLog(gone);
    expect(useApp.getState().error).toBe('Could not open gone.txt: NotFoundError: The file could not be found.');
    expect(useApp.getState().log).toBeNull();
    expect(api.recentLogs).toHaveBeenCalledTimes(1);
  });

  it('records a failed pull load for the fight view and clears it on the next load', async () => {
    vi.mocked(api.quickOverview).mockRejectedValueOnce(`File not found: ${LOG.id}`);
    await openPull();
    expect(useApp.getState()).toMatchObject({ fightError: `File not found: ${LOG.id}`, fightLoading: false });

    await useApp.getState().openFight(1);
    expect(useApp.getState().fightError).toBeNull();
  });

  it('resets the tab, range, details and Casts selection when a pull opens', async () => {
    await openPull();
    await useApp.getState().setTab('casts');
    useApp.getState().selectCastsRow(PYRRIN_ROW);
    useApp.getState().setCastsSort({ key: 'cpm', desc: false });
    await useApp.getState().setRange({ startMs: 0, endMs: 1_000 });
    await useApp.getState().openPlayer(4);

    await useApp.getState().openFight(1);
    expect(useApp.getState()).toMatchObject({
      tab: 'overview',
      range: null,
      report: null,
      details: [],
      castsRow: null,
      castsSort: { key: 'amount', desc: true },
    });
  });
});

describe('reports', () => {
  it('reloads the shown report with the current range and Aug mode', async () => {
    await openPull();
    await useApp.getState().setTab('damage');
    expect(api.damageDoneReport).toHaveBeenLastCalledWith(LOG.id, 1, WHOLE_PULL);
    expect(useApp.getState().report).toEqual({ tab: 'damage', data: damageReportFixture });

    await useApp.getState().setAttribution('augmented');
    expect(api.damageDoneReport).toHaveBeenLastCalledWith(LOG.id, 1, { ...WHOLE_PULL, attribution: 'augmented' });

    await useApp.getState().setRange({ startMs: 158_000, endMs: 273_000 });
    expect(api.damageDoneReport).toHaveBeenLastCalledWith(LOG.id, 1, { startMs: 158_000, endMs: 273_000, attribution: 'augmented' });
  });

  it('loads a range overview, also when coming back to the tab, and falls back to the pull overview', async () => {
    await openPull();
    const ranged = { ...overviewFixture, deaths: [] };
    vi.mocked(api.quickOverview).mockResolvedValue(ranged);
    await useApp.getState().setRange({ startMs: 40_000, endMs: 60_000 });
    expect(api.quickOverview).toHaveBeenLastCalledWith(LOG.id, 1, { startMs: 40_000, endMs: 60_000, attribution: 'reattributed' });
    expect(useApp.getState().report).toEqual({ tab: 'overview', data: ranged });
    expect(useApp.getState().overview).toBe(overviewFixture);

    await useApp.getState().setTab('damage');
    await useApp.getState().setRange({ startMs: 0, endMs: 30_000 });
    await useApp.getState().setTab('overview');
    expect(api.quickOverview).toHaveBeenLastCalledWith(LOG.id, 1, { startMs: 0, endMs: 30_000, attribution: 'reattributed' });

    await useApp.getState().setRange(null);
    expect(useApp.getState().report).toBeNull();
    expect(api.quickOverview).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['overview', api.quickOverview, overviewFixture, []],
    ['damage', api.damageDoneReport, damageReportFixture, []],
    ['healing', api.healingReport, healingReportFixture, []],
    ['taken', api.damageTakenReport, takenReportFixture, []],
  ] as const)('loads the %s tab through its own API call', async (tab, load, data, scope) => {
    (load as Mock).mockResolvedValue(data);
    await openPull();
    // The whole-pull overview arrives with the pull; only a range makes Overview request a report.
    useApp.setState({ range: { startMs: 40_000, endMs: 60_000 } });
    await useApp.getState().setTab(tab);
    expect(load).toHaveBeenLastCalledWith(LOG.id, 1, ...scope, { startMs: 40_000, endMs: 60_000, attribution: 'reattributed' });
    expect(useApp.getState().report).toEqual({ tab, data });
  });
});

describe('detail stack', () => {
  it('opens a player with the tab metric, keeps range and Aug mode, and closes back to the report', async () => {
    await openPull();
    await useApp.getState().setTab('healing');
    await useApp.getState().setRange({ startMs: 0, endMs: 60_000 });
    await useApp.getState().openPlayer(2);
    expect(api.playerDetail).toHaveBeenLastCalledWith(LOG.id, 1, 2, 'healing', { startMs: 0, endMs: 60_000, attribution: 'reattributed' }, OPEN);
    expect(useApp.getState().report).toEqual({ tab: 'player', data: playerDetailFixture });

    await useApp.getState().setAttribution('augmented');
    expect(api.playerDetail).toHaveBeenLastCalledWith(LOG.id, 1, 2, 'healing', { startMs: 0, endMs: 60_000, attribution: 'augmented' }, OPEN);

    await useApp.getState().closeDetail();
    expect(useApp.getState().details).toEqual([]);
    expect(api.healingReport).toHaveBeenLastCalledWith(LOG.id, 1, { startMs: 0, endMs: 60_000, attribution: 'augmented' });
  });

  it('opens players from Damage Taken in the damage view and forgets that origin on a tab change', async () => {
    await openPull();
    await useApp.getState().setTab('taken');
    await useApp.getState().openPlayer(4);
    expect(useApp.getState().tab).toBe('damage');
    expect(api.playerDetail).toHaveBeenLastCalledWith(LOG.id, 1, 4, 'damage', WHOLE_PULL, OPEN);

    await useApp.getState().setTab('healing');
    await useApp.getState().closeDetail();
    expect(useApp.getState().tab).toBe('healing');

    await useApp.getState().openPlayer(4);
    await useApp.getState().setTab('overview');
    expect(useApp.getState().details).toEqual([]);
  });

  it('drills from player to ability and back, keeping the loaded ability name below other pages', async () => {
    await openPull();
    await useApp.getState().openPlayer(4);
    await useApp.getState().openAbility(44425, null);
    const ability = { kind: 'ability', player: 4, spellId: 44425, pet: null, spellName: 'Arcane Barrage' };
    expect(useApp.getState().details).toEqual([{ kind: 'player', player: 4 }, ability]);
    expect(api.abilityDetail).toHaveBeenLastCalledWith(LOG.id, 1, 4, 44425, null, 'damage', WHOLE_PULL, OPEN);
    expect(useApp.getState().report).toEqual({ tab: 'ability', data: abilityDetailFixture });

    await useApp.getState().openTarget(ENEMY);
    expect(useApp.getState().details[1]).toEqual(ability);
    await useApp.getState().back();
    await useApp.getState().back();
    expect(useApp.getState().details).toEqual([{ kind: 'player', player: 4 }]);
    expect(useApp.getState().report).toEqual({ tab: 'player', data: playerDetailFixture });
  });

  it('shows the player when the metric changes on an ability page', async () => {
    await openPull();
    await useApp.getState().setTab('damage');
    await useApp.getState().openPlayer(4);
    await useApp.getState().openAbility(44425, null);
    await useApp.getState().setTab('healing');
    expect(useApp.getState().details).toEqual([{ kind: 'player', player: 4 }]);
    expect(api.playerDetail).toHaveBeenLastCalledWith(LOG.id, 1, 4, 'healing', WHOLE_PULL, OPEN);
    expect(api.abilityDetail).toHaveBeenCalledTimes(1);
  });

  it('pins the enemy the empty Enemies entry resolved to and replaces a shown target', async () => {
    vi.mocked(api.targetDetail).mockResolvedValueOnce({ ...targetDetailFixture, name: "Ula'tek" });
    await openPull();
    await useApp.getState().openTarget('');
    expect(useApp.getState().tab).toBe('damage');
    expect(api.targetDetail).toHaveBeenLastCalledWith(LOG.id, 1, '', WHOLE_PULL, OPEN);
    expect(useApp.getState().details).toEqual([{ kind: 'target', name: "Ula'tek" }]);
    await useApp.getState().setRange({ startMs: 120_000, endMs: 140_000 });
    expect(api.targetDetail).toHaveBeenLastCalledWith(LOG.id, 1, "Ula'tek", { startMs: 120_000, endMs: 140_000, attribution: 'reattributed' }, OPEN);

    await useApp.getState().openTarget(ENEMY);
    expect(useApp.getState().details).toEqual([{ kind: 'target', name: ENEMY }]);
    await useApp.getState().setTab('healing');
    expect(useApp.getState().details).toHaveLength(1);
    await useApp.getState().setTab('taken');
    expect(useApp.getState().details).toEqual([]);
  });

  it('keeps an enemy below the player and ability pages opened on top of it', async () => {
    await openPull();
    await useApp.getState().openTarget(ENEMY);
    await useApp.getState().openPlayer(4);
    await useApp.getState().openPlayer(3);
    expect(useApp.getState().details).toEqual([
      { kind: 'target', name: ENEMY },
      { kind: 'player', player: 3 },
    ]);
    await useApp.getState().openAbilityOf(3, 44425, 'damage');
    expect(useApp.getState().details).toHaveLength(3);

    await useApp.getState().back();
    await useApp.getState().back();
    expect(useApp.getState().details).toEqual([{ kind: 'target', name: ENEMY }]);
    expect(useApp.getState().report).toEqual({ tab: 'target', data: targetDetailFixture });
  });

  it('shows a lower page of the stack from the breadcrumb and ignores other depths', async () => {
    await openPull();
    await useApp.getState().openTarget(ENEMY);
    await useApp.getState().openPlayer(4);
    await useApp.getState().openAbility(44425, null);
    for (const depth of [2, 3, -1]) await useApp.getState().showDetailAt(depth);
    expect(useApp.getState().details).toHaveLength(3);
    expect(api.abilityDetail).toHaveBeenCalledTimes(1);

    await useApp.getState().showDetailAt(0);
    expect(useApp.getState().details).toEqual([{ kind: 'target', name: ENEMY }]);
    expect(useApp.getState().report).toEqual({ tab: 'target', data: targetDetailFixture });
    expect(useApp.getState().focusRequest).toBe('page');
  });
});

describe('detail origin', () => {
  it('returns to the Deaths tab and the chosen death a player page was opened from', async () => {
    await openPull();
    await useApp.getState().openDeathRecap(4, 239_100);
    expect(useApp.getState()).toMatchObject({ tab: 'deaths', focusDeath: { player: 4, t: 239_100 }, report: { tab: 'deaths', data: deathsReportFixture } });

    useApp.getState().selectDeath(4, 239_050);
    await useApp.getState().openPlayer(4);
    expect(useApp.getState().tab).toBe('damage');
    await useApp.getState().back();
    expect(useApp.getState()).toMatchObject({
      tab: 'deaths',
      details: [],
      detailOrigin: null,
      focusDeath: { player: 4, t: 239_050 },
      report: { tab: 'deaths', data: deathsReportFixture },
    });

    await useApp.getState().setTab('casts');
    expect(useApp.getState().focusDeath).toBeNull();
  });

  it("walks back through a player's ability to the Casts tab and keeps its selection", async () => {
    await openPull();
    await useApp.getState().setTab('casts');
    useApp.getState().selectCastsRow(PYRRIN_ROW);
    useApp.getState().setCastsSort({ key: 'cpm', desc: false });
    await useApp.getState().openAbilityOf(2, 774, 'healing');
    expect(useApp.getState().tab).toBe('healing');
    expect(useApp.getState().details).toEqual([
      { kind: 'player', player: 2 },
      { kind: 'ability', player: 2, spellId: 774, pet: null },
    ]);
    expect(api.abilityDetail).toHaveBeenLastCalledWith(LOG.id, 1, 2, 774, null, 'healing', WHOLE_PULL, OPEN);

    await useApp.getState().back();
    expect(useApp.getState().details).toEqual([{ kind: 'player', player: 2 }]);
    await useApp.getState().closeDetail();
    expect(useApp.getState()).toMatchObject({
      tab: 'casts',
      report: { tab: 'casts', data: castsReportFixture },
      castsRow: PYRRIN_ROW,
      castsSort: { key: 'cpm', desc: false },
    });
  });
});

describe('focus requests', () => {
  it('asks for focus where a navigation leads and drops requests a filter change leaves unanswered', async () => {
    await openPull();
    expect(useApp.getState().focusRequest).toBe('fight');
    await useApp.getState().setTab('deaths');
    expect(useApp.getState().focusRequest).toBeNull();
    await useApp.getState().openPlayer(4);
    expect(useApp.getState().focusRequest).toBe('page');
    await useApp.getState().setRange({ startMs: 0, endMs: 10_000 });
    expect(useApp.getState().focusRequest).toBeNull();
    await useApp.getState().back();
    expect(useApp.getState().focusRequest).toBe('tab');
    useApp.getState().consumeFocus();
    expect(useApp.getState().focusRequest).toBeNull();

    vi.mocked(api.playerDetail).mockRejectedValueOnce('Actor 99 is not a player of this pull');
    await useApp.getState().openPlayer(99);
    expect(useApp.getState().reportError).toBe('Actor 99 is not a player of this pull');
    expect(useApp.getState().focusRequest).toBeNull();

    useApp.getState().backToPulls();
    expect(useApp.getState().focusRequest).toBe('start');
  });
});

describe('request races', () => {
  it.each([
    ['finishes', (old: ReturnType<typeof deferred<LogView>>) => old.resolve(LOG)],
    ['fails', (old: ReturnType<typeof deferred<LogView>>) => old.reject('File not found')],
  ])('keeps the newest log when an older open %s last', async (_, settle) => {
    const other = { ...LOG, id: 'other.txt', fileName: 'other.txt' };
    const old = deferred<LogView>();
    vi.mocked(api.openLog).mockReturnValueOnce(old.promise).mockResolvedValueOnce(other);
    const pending = useApp.getState().openLog(chosen(LOG));
    await useApp.getState().openLog(chosen(other));
    settle(old);
    await pending;
    expect(useApp.getState()).toMatchObject({ log: other, opening: null, error: null });
  });

  const fresh = { ...overviewFixture, deaths: [] };
  it.each([
    {
      overtaken: 'the same pull is reopened',
      overtake: async () => {
        vi.mocked(api.quickOverview).mockResolvedValueOnce(overviewFixture).mockResolvedValueOnce(fresh);
        await useApp.getState().openFight(2);
        await useApp.getState().openFight(1);
      },
      fails: false,
      expected: { overview: fresh },
    },
    { overtaken: 'another pull opens', overtake: () => useApp.getState().openFight(2), fails: true, expected: { overview: overviewFixture } },
    { overtaken: 'the pull list is shown', overtake: async () => useApp.getState().backToPulls(), fails: true, expected: { overview: null } },
    { overtaken: 'another log opens', overtake: () => useApp.getState().openLog(chosen(LOG)), fails: false, expected: { view: { kind: 'start' }, overview: null } },
  ])('drops a pull load once $overtaken', async ({ overtake, fails, expected }) => {
    await useApp.getState().openLog(chosen(LOG));
    const old = deferred<QuickOverview>();
    vi.mocked(api.quickOverview).mockReturnValueOnce(old.promise);
    const pending = useApp.getState().openFight(1);
    await overtake();
    if (fails) old.reject('File not found');
    else old.resolve({ ...overviewFixture, kpis: { ...overviewFixture.kpis, deaths: 99 } });
    await pending;
    expect(useApp.getState()).toMatchObject({ ...expected, fightLoading: false, fightError: null, error: null });
  });

  const freshReport = { ...damageReportFixture, total: 1 };
  const freshComparison = { ...comparisonFixture, players: [] };
  function slowReport() {
    const old = deferred<DamageReport>();
    vi.mocked(api.damageDoneReport).mockReturnValueOnce(old.promise).mockResolvedValue(freshReport);
    return { start: () => useApp.getState().setTab('damage'), settle: () => old.resolve(damageReportFixture) };
  }
  function slowComparison() {
    const old = deferred<PullComparison>();
    vi.mocked(api.comparePulls).mockReturnValueOnce(old.promise).mockResolvedValue(freshComparison);
    return { start: () => useApp.getState().openComparison(3), settle: () => old.resolve(comparisonFixture) };
  }
  it.each([
    { response: 'report', slow: slowReport, overtaken: 'a newer Aug mode', overtake: 'augmented', expected: { report: { tab: 'damage', data: freshReport }, reportLoading: false } },
    { response: 'report', slow: slowReport, overtaken: 'another pull', overtake: 'pull', expected: { report: null, reportLoading: false } },
    { response: 'comparison', slow: slowComparison, overtaken: 'a newer Aug mode', overtake: 'augmented', expected: { comparison: { data: freshComparison, loading: false } } },
    { response: 'comparison', slow: slowComparison, overtaken: 'another pull', overtake: 'pull', expected: { comparison: null } },
    { response: 'comparison', slow: slowComparison, overtaken: 'closing it', overtake: 'close', expected: { comparison: null } },
  ])('drops a $response response overtaken by $overtaken', async ({ slow, overtake, expected }) => {
    await openPull();
    const { start, settle } = slow();
    const pending = start();
    if (overtake === 'augmented') await useApp.getState().setAttribution('augmented');
    else if (overtake === 'pull') await useApp.getState().openFight(2);
    else await useApp.getState().closeComparison();
    settle();
    await pending;
    expect(useApp.getState()).toMatchObject(expected);
  });
});

describe('pull comparison', () => {
  it('compares the shown pull with another one, the earlier pull first, in the current Aug mode', async () => {
    await openPull();
    await useApp.getState().openComparison(1);
    expect(api.comparePulls).not.toHaveBeenCalled();

    await useApp.getState().openFight(3);
    await useApp.getState().openComparison(1);
    expect(api.comparePulls).toHaveBeenLastCalledWith(LOG.id, 1, 3, 'reattributed');
    expect(useApp.getState().comparison).toEqual({ a: 1, b: 3, data: comparisonFixture, loading: false, error: null, reportAttribution: 'reattributed' });
    expect(useApp.getState().focusRequest).toBe('compare');
    expect(useApp.getState().view).toEqual({ kind: 'fight', fightIndex: 3 });

    await useApp.getState().setAttribution('augmented');
    expect(api.comparePulls).toHaveBeenLastCalledWith(LOG.id, 1, 3, 'augmented');

    vi.mocked(api.comparePulls).mockRejectedValueOnce('Pull 9 does not exist in this log.');
    await useApp.getState().openComparison(9);
    expect(useApp.getState().comparison).toMatchObject({ a: 3, b: 9, data: null, loading: false, error: 'Pull 9 does not exist in this log.' });
  });

  it('returns to the pull as it was left and recalculates it only for a new Aug mode', async () => {
    await openPull();
    await useApp.getState().setTab('damage');
    await useApp.getState().setRange({ startMs: 0, endMs: 60_000 });
    expect(api.damageDoneReport).toHaveBeenCalledTimes(2);

    await useApp.getState().openComparison(3);
    await useApp.getState().closeComparison();
    expect(useApp.getState()).toMatchObject({
      comparison: null,
      focusRequest: 'fight',
      tab: 'damage',
      range: { startMs: 0, endMs: 60_000 },
      report: { tab: 'damage', data: damageReportFixture },
    });
    expect(api.damageDoneReport).toHaveBeenCalledTimes(2);

    await useApp.getState().openComparison(3);
    await useApp.getState().setAttribution('augmented');
    expect(api.damageDoneReport).toHaveBeenCalledTimes(2);
    await useApp.getState().closeComparison();
    expect(api.damageDoneReport).toHaveBeenCalledTimes(3);
    expect(api.damageDoneReport).toHaveBeenLastCalledWith(LOG.id, 1, { startMs: 0, endMs: 60_000, attribution: 'augmented' });
  });
});

describe('view filters', () => {
  it('sends the scope with the breakdown and resets it for another pull', async () => {
    await openPull();
    await useApp.getState().setTab('damage');
    await useApp.getState().select('source', { kind: 'player', actorId: 3 });
    const last = vi.mocked(api.breakdownReport).mock.calls.at(-1)!;
    expect(last[3]).toEqual({ perspective: 'friendly', source: [{ kind: 'player', actorId: 3 }], target: [], ability: [] });
    expect(last[5]).toBe('source');
    expect(useApp.getState().breakdown).toBe(breakdownFixture);
    await useApp.getState().openFight(2);
    expect(useApp.getState().scope.source).toEqual([]);
  });

  it('keeps each selection on its side across tabs', async () => {
    const player = { kind: 'player', actorId: 3 } as const;
    const enemy = { kind: 'unit', name: ENEMY } as const;
    const execute = { kind: 'name', name: 'Execute' } as const;
    await openPull();
    await useApp.getState().setTab('damage');
    await useApp.getState().select('source', player);
    await useApp.getState().select('target', enemy);
    await useApp.getState().select('ability', execute);
    await useApp.getState().setTab('taken');
    const taken = { perspective: 'friendly', source: [enemy], target: [player], ability: [execute] };
    expect(useApp.getState().scope).toEqual(taken);
    expect(vi.mocked(api.breakdownReport).mock.calls.at(-1)![3]).toEqual(taken);
    await useApp.getState().select('target', null);
    await useApp.getState().setTab('healing');
    expect(useApp.getState().scope).toEqual({ perspective: 'friendly', source: [], target: [enemy], ability: [execute] });
  });

  it('keeps the scope object while neither the filters nor the tab change', async () => {
    await openPull();
    await useApp.getState().setTab('damage');
    await useApp.getState().select('source', { kind: 'player', actorId: 3 });
    const scope = useApp.getState().scope;
    await useApp.getState().setRange({ startMs: 10_000, endMs: 20_000 });
    useApp.getState().setColorByTarget(true);
    expect(useApp.getState().scope).toBe(scope);
  });

  it('swaps the sides when the perspective changes and drops the ability', async () => {
    await openPull();
    await useApp.getState().setTab('damage');
    await useApp.getState().select('source', { kind: 'player', actorId: 3 });
    await useApp.getState().select('ability', { kind: 'name', name: 'Execute' });
    await useApp.getState().setPerspective('enemy');
    expect(useApp.getState().scope).toEqual({ perspective: 'enemy', source: [], target: [{ kind: 'player', actorId: 3 }], ability: [] });
  });

  it('remembers the chosen grouping per tab', async () => {
    await openPull();
    await useApp.getState().setTab('damage');
    await useApp.getState().setGrouping('ability');
    await useApp.getState().setTab('taken');
    expect(vi.mocked(api.breakdownReport).mock.calls.at(-1)![5]).toBe('target');
    await useApp.getState().setTab('damage');
    expect(vi.mocked(api.breakdownReport).mock.calls.at(-1)![5]).toBe('ability');
  });

  it('sends the scope, grouping and Hide procs with the casts report and reloads it for Hide procs', async () => {
    await openPull();
    await useApp.getState().setTab('casts');
    await useApp.getState().select('source', { kind: 'player', actorId: 2 });
    await useApp.getState().setGrouping('ability');
    const scope = { perspective: 'friendly', source: [{ kind: 'player', actorId: 2 }], target: [], ability: [] };
    expect(api.castsReport).toHaveBeenLastCalledWith(LOG.id, 1, WHOLE_PULL, scope, 'ability', true);
    await useApp.getState().setHideProcs(false);
    expect(api.castsReport).toHaveBeenLastCalledWith(LOG.id, 1, WHOLE_PULL, scope, 'ability', false);
  });

  it('sends the scope and grouping with the interrupts report', async () => {
    vi.mocked(api.interruptsReport).mockResolvedValue(interruptsReportFixture);
    await openPull();
    await useApp.getState().setTab('interrupts');
    await useApp.getState().select('ability', { kind: 'id', spellId: 5 });
    const scope = { perspective: 'friendly', source: [], target: [], ability: [{ kind: 'id', spellId: 5 }] };
    expect(api.interruptsReport).toHaveBeenLastCalledWith(LOG.id, 1, WHOLE_PULL, scope, 'source');
    expect(useApp.getState().report).toEqual({ tab: 'interrupts', data: interruptsReportFixture });
  });

  it('asks the auras report for the chosen kind and asks the pickers for its family', async () => {
    vi.mocked(api.aurasReport).mockResolvedValue(aurasReportFixture);
    vi.mocked(api.filterOptions).mockResolvedValue([]);
    await openPull();
    await useApp.getState().setTab('buffs');
    await useApp.getState().setAuraKind('debuffs');
    const scope = { perspective: 'friendly', source: [], target: [], ability: [] };
    expect(api.aurasReport).toHaveBeenLastCalledWith(LOG.id, 1, WHOLE_PULL, scope, 'debuffs', 'ability');
    await useApp.getState().filterOptions('target');
    expect(api.filterOptions).toHaveBeenLastCalledWith(LOG.id, 1, WHOLE_PULL, scope, 'debuffs', 'target');
  });

  it('sends the scope with the deaths report and narrows to the player a death recap link names', async () => {
    vi.mocked(api.deathsReport).mockResolvedValue(deathsReportFixture);
    await openPull();
    await useApp.getState().setTab('damage');
    await useApp.getState().select('target', { kind: 'unit', name: ENEMY });
    await useApp.getState().setPerspective('enemy');
    await useApp.getState().select('source', { kind: 'unit', name: ENEMY });
    await useApp.getState().select('ability', { kind: 'name', name: 'Virulent Spit' });
    await useApp.getState().openDeathRecap(4, 239_100);
    const scope = { perspective: 'friendly', source: [], target: [{ kind: 'player', actorId: 4 }], ability: [] };
    expect(api.deathsReport).toHaveBeenLastCalledWith(LOG.id, 1, WHOLE_PULL, scope);
    expect(useApp.getState().report).toEqual({ tab: 'deaths', data: deathsReportFixture });
  });

  it('sends the range and the own side as the resources holder, never a target', async () => {
    vi.mocked(api.resourcesReport).mockResolvedValue(resourcesReportFixture);
    await openPull();
    await useApp.getState().setTab('damage');
    await useApp.getState().select('source', { kind: 'player', actorId: 3 });
    await useApp.getState().select('target', { kind: 'unit', name: ENEMY });
    useApp.setState({ range: { startMs: 40_000, endMs: 60_000 } });
    await useApp.getState().setTab('resources');
    const scope = { perspective: 'friendly', source: [{ kind: 'player', actorId: 3 }], target: [], ability: [] };
    expect(api.resourcesReport).toHaveBeenLastCalledWith(LOG.id, 1, { startMs: 40_000, endMs: 60_000, attribution: 'reattributed' }, scope);
  });

  it('hands the page filter to a detail page by side, also from an Enemies view', async () => {
    const enemy = { kind: 'unit', name: ENEMY } as const;
    const execute = { kind: 'name', name: 'Execute' } as const;
    await openPull();
    await useApp.getState().setTab('damage');
    await useApp.getState().select('target', enemy);
    await useApp.getState().select('ability', execute);
    await useApp.getState().openPlayer(4);
    expect(api.playerDetail).toHaveBeenLastCalledWith(LOG.id, 1, 4, 'damage', WHOLE_PULL, { ...OPEN, target: [enemy], ability: [execute] });
    await useApp.getState().closeDetail();
    await useApp.getState().setPerspective('enemy');
    await useApp.getState().openPlayer(4);
    expect(api.playerDetail).toHaveBeenLastCalledWith(LOG.id, 1, 4, 'damage', WHOLE_PULL, { ...OPEN, target: [enemy] });
  });

  it('hands an Enemies view to the ability and target pages with the friendly side as source', async () => {
    const enemy = { kind: 'unit', name: ENEMY } as const;
    const healer = { kind: 'player', actorId: 2 } as const;
    await openPull();
    await useApp.getState().setTab('damage');
    await useApp.getState().setPerspective('enemy');
    await useApp.getState().select('source', enemy);
    await useApp.getState().select('target', healer);
    const page = { ...OPEN, source: [healer], target: [enemy] };
    await useApp.getState().openPlayer(4);
    await useApp.getState().openAbility(44425, null);
    expect(api.abilityDetail).toHaveBeenLastCalledWith(LOG.id, 1, 4, 44425, null, 'damage', WHOLE_PULL, page);
    await useApp.getState().openTarget(ENEMY);
    expect(api.targetDetail).toHaveBeenLastCalledWith(LOG.id, 1, ENEMY, WHOLE_PULL, page);
  });

  it('clears only the selections behind the page dimensions, by side', async () => {
    const enemy = { kind: 'unit', name: ENEMY } as const;
    const healer = { kind: 'player', actorId: 2 } as const;
    const execute = { kind: 'name', name: 'Execute' } as const;
    await openPull();
    await useApp.getState().setTab('damage');
    await useApp.getState().setPerspective('enemy');
    await useApp.getState().select('source', enemy);
    await useApp.getState().select('target', healer);
    await useApp.getState().select('ability', execute);
    await useApp.getState().openPlayer(4);
    await useApp.getState().clearPageFilter(['target']);
    expect(useApp.getState().filters).toEqual({ perspective: 'enemy', own: [], other: [healer], ability: [execute] });
    await useApp.getState().clearPageFilter(['ability']);
    expect(useApp.getState().filters).toEqual({ perspective: 'enemy', own: [], other: [healer], ability: [] });
    expect(api.playerDetail).toHaveBeenLastCalledWith(LOG.id, 1, 4, 'damage', WHOLE_PULL, { ...OPEN, source: [healer] });
  });

  it('maps the own and other selection onto every tab by its sides and resets them for another pull', async () => {
    const player = { kind: 'player', actorId: 3 } as const;
    const enemy = { kind: 'unit', name: ENEMY } as const;
    await openPull();
    await useApp.getState().setTab('damage');
    await useApp.getState().select('source', player);
    await useApp.getState().select('target', enemy);
    const roles: [FightTab, Partial<Scope>][] = [
      ['casts', { source: [player], target: [enemy] }],
      ['interrupts', { source: [player], target: [enemy] }],
      ['buffs', { source: [enemy], target: [player] }],
      ['deaths', { source: [enemy], target: [player] }],
      ['resources', { source: [player], target: [] }],
    ];
    for (const [tab, sides] of roles) {
      await useApp.getState().setTab(tab);
      expect(useApp.getState().scope).toEqual({ perspective: 'friendly', source: [], target: [], ability: [], ...sides });
    }
    await useApp.getState().openFight(2);
    expect(useApp.getState().filters).toEqual(initialState().filters);
  });

  it('drops the breakdown when the next tab fails to load', async () => {
    await openPull();
    await useApp.getState().setTab('damage');
    expect(useApp.getState().breakdown).toBe(breakdownFixture);
    vi.mocked(api.deathsReport).mockRejectedValue(new Error('boom'));
    await useApp.getState().setTab('deaths');
    expect(useApp.getState().breakdown).toBeNull();
  });
});

describe('timeline and events views', () => {
  const firstPage = { kind: 'from', offset: 0, limit: 60 };

  it('keeps the chosen view across tabs, shows the table where a tab lacks it and resets it for another pull', async () => {
    await openPull();
    await useApp.getState().setTab('damage');
    await useApp.getState().setReportView('events');
    expect(api.events).toHaveBeenLastCalledWith(LOG.id, 1, WHOLE_PULL, OPEN, 'damageDone', { beginCasts: false, rejected: false, hits: false, hideProcs: true }, firstPage);
    expect(useApp.getState().events).toBe(eventsPageFixture);
    vi.mocked(api.events).mockClear();
    await useApp.getState().setTab('resources');
    expect(api.events).not.toHaveBeenCalled();
    expect(useApp.getState().events).toBeNull();
    await useApp.getState().setTab('casts');
    expect(api.events).toHaveBeenLastCalledWith(LOG.id, 1, WHOLE_PULL, OPEN, 'casts', expect.anything(), firstPage);
    await useApp.getState().openFight(2);
    expect(useApp.getState()).toMatchObject({ reportView: 'table', events: null, timeline: null, zoom: null });
  });

  it('pages through the events of a tab and starts over when a filter or toggle changes', async () => {
    await openPull();
    await useApp.getState().setTab('damage');
    await useApp.getState().setReportView('events');
    await useApp.getState().showEventsPage(60);
    expect(api.events).toHaveBeenLastCalledWith(LOG.id, 1, WHOLE_PULL, OPEN, 'damageDone', expect.anything(), { kind: 'from', offset: 60, limit: 60 });
    await useApp.getState().select('target', { kind: 'unit', name: ENEMY });
    expect(vi.mocked(api.events).mock.lastCall?.[6]).toEqual(firstPage);
    await useApp.getState().showEventsPage(120);
    await useApp.getState().setViewToggle('beginCasts', true);
    expect(vi.mocked(api.events).mock.lastCall?.slice(5)).toEqual([{ beginCasts: true, rejected: false, hits: false, hideProcs: true }, firstPage]);
  });

  it('opens the Events page that holds a time and remembers it as the page', async () => {
    await openPull();
    await useApp.getState().setTab('damage');
    vi.mocked(api.events).mockResolvedValueOnce({ ...eventsPageFixture, offset: 120 });
    await useApp.getState().showEventsAt(130_007);
    expect(api.events).toHaveBeenLastCalledWith(LOG.id, 1, WHOLE_PULL, OPEN, 'damageDone', expect.anything(), { kind: 'at', t: 130_007, limit: 60 });
    expect(useApp.getState()).toMatchObject({ reportView: 'events', eventsOffset: { damage: 120 } });
  });

  it('asks the timeline for the shown window and half of it on either side, and asks again only when the window leaves it', async () => {
    await openPull();
    await useApp.getState().setTab('casts');
    await useApp.getState().setReportView('timeline');
    expect(api.timeline).toHaveBeenLastCalledWith(LOG.id, 1, WHOLE_PULL, OPEN, 'casts', 'source', expect.anything(), { startMs: 0, endMs: 30_000 });
    vi.mocked(api.timeline).mockClear();
    useApp.getState().setZoom({ startMs: 115_000, endMs: 135_000 });
    await useApp.getState().refreshTimeline();
    expect(api.timeline).not.toHaveBeenCalled();
    useApp.getState().setZoom({ startMs: 140_000, endMs: 160_000 });
    await useApp.getState().refreshTimeline();
    expect(vi.mocked(api.timeline).mock.lastCall?.[7]).toEqual({ startMs: 130_000, endMs: 170_000 });
    await useApp.getState().setLanes('ability');
    expect(vi.mocked(api.timeline).mock.lastCall?.[5]).toBe('ability');
    await useApp.getState().setTab('buffs');
    expect(vi.mocked(api.timeline).mock.lastCall?.[5]).toBe('target');
  });

  it('judges a timeline request that is still out by the window it asks for', async () => {
    await openPull();
    await useApp.getState().setTab('casts');
    useApp.getState().setZoom({ startMs: 120_000, endMs: 130_000 });
    await useApp.getState().setReportView('timeline');
    vi.mocked(api.timeline).mockClear();
    let settle: (timeline: Timeline) => void = () => {};
    vi.mocked(api.timeline).mockReturnValueOnce(new Promise((resolve) => (settle = resolve)));
    const relaning = useApp.getState().setLanes('ability');
    await useApp.getState().refreshTimeline();
    expect(api.timeline).toHaveBeenCalledTimes(1);
    useApp.getState().setZoom({ startMs: 138_000, endMs: 148_000 });
    await useApp.getState().refreshTimeline();
    expect(vi.mocked(api.timeline).mock.lastCall?.[7]).toEqual({ startMs: 133_000, endMs: 153_000 });
    settle(timelineFixture);
    await relaning;
  });

  it('shows a superseded timeline that holds more of the moved window, but never one older than the shown timeline', async () => {
    await openPull();
    await useApp.getState().setTab('casts');
    useApp.getState().setZoom({ startMs: 120_000, endMs: 130_000 });
    await useApp.getState().setReportView('timeline');
    const answers: ((timeline: Timeline) => void)[] = [];
    vi.mocked(api.timeline).mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const loaded = (startMs: number, endMs: number) => ({ ...timelineFixture, startMs, endMs });
    useApp.getState().setZoom({ startMs: 150_000, endMs: 160_000 });
    const first = useApp.getState().refreshTimeline();
    useApp.getState().setZoom({ startMs: 158_000, endMs: 168_000 });
    const second = useApp.getState().refreshTimeline();
    answers[0](loaded(145_000, 165_000));
    await first;
    expect(useApp.getState()).toMatchObject({ timeline: { startMs: 145_000 }, viewLoading: true });
    answers[1](loaded(153_000, 173_000));
    await second;
    expect(useApp.getState()).toMatchObject({ timeline: { startMs: 153_000 }, viewLoading: false });

    useApp.getState().setZoom({ startMs: 170_000, endMs: 180_000 });
    const third = useApp.getState().refreshTimeline();
    useApp.getState().setZoom({ startMs: 190_000, endMs: 200_000 });
    const fourth = useApp.getState().refreshTimeline();
    answers[3](loaded(185_000, 205_000));
    await fourth;
    useApp.getState().setZoom({ startMs: 170_000, endMs: 180_000 });
    answers[2](loaded(165_000, 185_000));
    await third;
    expect(useApp.getState().timeline).toMatchObject({ startMs: 185_000 });
  });

  it('never shows a superseded window refresh once the filter changed or a newer request failed', async () => {
    await openPull();
    await useApp.getState().setTab('casts');
    useApp.getState().setZoom({ startMs: 120_000, endMs: 130_000 });
    await useApp.getState().setReportView('timeline');
    const answers: { resolve: (timeline: Timeline) => void; reject: (err: Error) => void }[] = [];
    vi.mocked(api.timeline).mockImplementation(() => new Promise((resolve, reject) => answers.push({ resolve, reject })));
    const loaded = (startMs: number, endMs: number) => ({ ...timelineFixture, startMs, endMs });

    useApp.getState().setZoom({ startMs: 150_000, endMs: 160_000 });
    const refresh = useApp.getState().refreshTimeline();
    const selecting = useApp.getState().select('target', { kind: 'unit', name: ENEMY });
    answers[0].resolve(loaded(145_000, 165_000));
    await refresh;
    expect(useApp.getState().timeline).toMatchObject({ startMs: 110_000 });
    answers[1].resolve(loaded(145_000, 165_000));
    await selecting;

    useApp.getState().setZoom({ startMs: 170_000, endMs: 180_000 });
    const older = useApp.getState().refreshTimeline();
    useApp.getState().setZoom({ startMs: 190_000, endMs: 200_000 });
    const newer = useApp.getState().refreshTimeline();
    answers[3].reject(new Error('timeline failed'));
    await newer;
    useApp.getState().setZoom({ startMs: 170_000, endMs: 180_000 });
    answers[2].resolve(loaded(165_000, 185_000));
    await older;
    expect(useApp.getState()).toMatchObject({ timeline: null, viewError: expect.stringContaining('timeline failed') });
  });

  it('keeps the zoom window as it is when it is set to the same window', () => {
    useApp.getState().setZoom({ startMs: 120_000, endMs: 130_000 });
    const window = useApp.getState().zoom;
    useApp.getState().setZoom({ startMs: 120_000, endMs: 130_000 });
    expect(useApp.getState().zoom).toBe(window);
  });

  it('asks again on zooming in once the request is within the limit the timeline carries', async () => {
    await openPull();
    await useApp.getState().setTab('casts');
    useApp.getState().setZoom({ startMs: 100_000, endMs: 200_000 });
    vi.mocked(api.timeline).mockResolvedValueOnce({ ...timelineFixture, startMs: 50_000, endMs: 250_000, linesListed: false, listedWindowMs: 60_000 });
    await useApp.getState().setReportView('timeline');
    vi.mocked(api.timeline).mockClear();
    useApp.getState().setZoom({ startMs: 120_000, endMs: 170_000 });
    await useApp.getState().refreshTimeline();
    expect(api.timeline).not.toHaveBeenCalled();
    useApp.getState().setZoom({ startMs: 120_000, endMs: 140_000 });
    await useApp.getState().refreshTimeline();
    expect(vi.mocked(api.timeline).mock.lastCall?.[7]).toEqual({ startMs: 110_000, endMs: 150_000 });
  });

  it("shows a failed reload's error instead of the last filter's timeline and asks again on the next pan", async () => {
    await openPull();
    await useApp.getState().setTab('casts');
    useApp.getState().setZoom({ startMs: 120_000, endMs: 130_000 });
    await useApp.getState().setReportView('timeline');
    vi.mocked(api.timeline).mockRejectedValueOnce(new Error('timeline failed'));
    await useApp.getState().select('target', { kind: 'unit', name: ENEMY });
    expect(useApp.getState()).toMatchObject({ timeline: null, viewError: expect.stringContaining('timeline failed') });
    vi.mocked(api.timeline).mockClear();
    useApp.getState().setZoom({ startMs: 121_000, endMs: 131_000 });
    await useApp.getState().refreshTimeline();
    expect(api.timeline).toHaveBeenCalledTimes(1);
    expect(useApp.getState()).toMatchObject({ timeline: timelineFixture, viewError: null });
  });

  it('asks again for the same Events page when a failed load is retried and shows it once it arrives', async () => {
    await openPull();
    await useApp.getState().setTab('damage');
    vi.mocked(api.events).mockRejectedValueOnce(new Error('events failed'));
    await useApp.getState().showEventsAt(130_007);
    expect(useApp.getState()).toMatchObject({ events: null, viewError: expect.stringContaining('events failed') });
    await useApp.getState().retryView();
    expect(api.events).toHaveBeenLastCalledWith(LOG.id, 1, WHOLE_PULL, OPEN, 'damageDone', expect.anything(), { kind: 'at', t: 130_007, limit: 60 });
    expect(useApp.getState()).toMatchObject({ events: eventsPageFixture, viewError: null });
  });

  it('keeps the table when its view fails to load and clears the failure on the next load', async () => {
    await openPull();
    await useApp.getState().setTab('damage');
    vi.mocked(api.events).mockRejectedValueOnce(new Error('events failed'));
    await useApp.getState().setReportView('events');
    expect(useApp.getState()).toMatchObject({ viewError: expect.stringContaining('events failed'), viewLoading: false, reportError: null });
    await useApp.getState().setReportView('table');
    expect(useApp.getState()).toMatchObject({ viewError: null, reportError: null });
    expect(useApp.getState().report).not.toBeNull();
  });

  it('keeps the loaded table when the view request of the same load fails', async () => {
    await openPull();
    await useApp.getState().setTab('damage');
    useApp.setState({ reportView: 'events' });
    vi.mocked(api.events).mockRejectedValueOnce(new Error('events failed'));
    await useApp.getState().setTab('casts');
    expect(useApp.getState().report).not.toBeNull();
    expect(useApp.getState()).toMatchObject({ reportError: null, viewError: expect.stringContaining('events failed') });
  });

  it('writes the events even when the table of the same load fails', async () => {
    await openPull();
    useApp.setState({ reportView: 'events' });
    vi.mocked(api.castsReport).mockRejectedValueOnce(new Error('table failed'));
    await useApp.getState().setTab('casts');
    expect(useApp.getState()).toMatchObject({ events: eventsPageFixture, viewError: null, viewLoading: false, reportError: expect.stringContaining('table failed') });
  });

  it('resets the view state when another pull opens while a view is pending', async () => {
    await openPull();
    await useApp.getState().setTab('damage');
    vi.mocked(api.events).mockReturnValueOnce(deferred<typeof eventsPageFixture>().promise);
    void useApp.getState().setReportView('events');
    expect(useApp.getState().viewLoading).toBe(true);
    await useApp.getState().openFight(2);
    expect(useApp.getState()).toMatchObject({ viewLoading: false, viewError: null });
  });

  it('drops an Events page that a tab switch has superseded', async () => {
    await openPull();
    await useApp.getState().setTab('damage');
    const late = deferred<typeof eventsPageFixture>();
    vi.mocked(api.events).mockReturnValueOnce(late.promise);
    const pending = useApp.getState().setReportView('events');
    expect(useApp.getState().viewLoading).toBe(true);
    await useApp.getState().setTab('resources');
    late.resolve(eventsPageFixture);
    await pending;
    expect(useApp.getState()).toMatchObject({ events: null, viewLoading: false });
  });

  it("sends a range that reaches the pull's end without an end, so the pull's last events count", async () => {
    await openPull();
    await useApp.getState().setTab('damage');
    await useApp.getState().setRange({ startMs: 300_000, endMs: 478_610 });
    expect(api.damageDoneReport).toHaveBeenLastCalledWith(LOG.id, 1, { startMs: 300_000, endMs: null, attribution: 'reattributed' });
    await useApp.getState().setRange({ startMs: 300_000, endMs: 400_000 });
    expect(api.damageDoneReport).toHaveBeenLastCalledWith(LOG.id, 1, { startMs: 300_000, endMs: 400_000, attribution: 'reattributed' });
  });
});
