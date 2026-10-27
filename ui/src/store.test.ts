import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { api } from './api/client';
import { replayClock } from './components/replay/replayClock';
import type { ChosenLog, LogSource } from './api/logSource';
import type { BreakdownRow, DamageReport, FightRow, LogView, PullComparison, PullSet, QuickOverview, ReplayData, RecentLog, Scope, SetOverview, Timeline, UnitRef } from './api/types';
import { comparisonFixture } from './test/compareFixture';
import { overviewFixture } from './test/overviewFixture';
import { runLogFixture } from './test/runFixture';
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
    replay: vi.fn(),
    castsReport: vi.fn(),
    aurasReport: vi.fn(),
    interruptsReport: vi.fn(),
    resourcesReport: vi.fn(),
    comparePulls: vi.fn(),
    breakdownReport: vi.fn(),
    filterOptions: vi.fn(),
    events: vi.fn(),
    timeline: vi.fn(),
    pullSet: vi.fn(),
    followLog: vi.fn(),
    canFollow: vi.fn(),
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

const WHOLE_PULL = { startMs: null, endMs: null, attribution: 'reattributed', includeOverkill: false, deathCutoff: null };
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
  vi.mocked(api.canFollow).mockReturnValue(false);
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
    expect(api.quickOverview).toHaveBeenCalledWith(LOG.id, 1, WHOLE_PULL);
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
    expect(api.damageDoneReport).toHaveBeenLastCalledWith(LOG.id, 1, { startMs: 158_000, endMs: 273_000, attribution: 'augmented', includeOverkill: false, deathCutoff: null });
  });

  it('counts overkill in the report and the pull overview once included, and remembers it for every log', async () => {
    await openPull();
    await useApp.getState().setTab('damage');
    await useApp.getState().setIncludeOverkill(true);
    const included = { ...WHOLE_PULL, includeOverkill: true };
    expect(api.damageDoneReport).toHaveBeenLastCalledWith(LOG.id, 1, included);
    expect(api.quickOverview).toHaveBeenLastCalledWith(LOG.id, 1, included);
    expect(initialState().includeOverkill).toBe(true);
  });

  it('loads a range overview, also when coming back to the tab, and falls back to the pull overview', async () => {
    await openPull();
    const ranged = { ...overviewFixture, deaths: [] };
    vi.mocked(api.quickOverview).mockResolvedValue(ranged);
    await useApp.getState().setRange({ startMs: 40_000, endMs: 60_000 });
    expect(api.quickOverview).toHaveBeenLastCalledWith(LOG.id, 1, { startMs: 40_000, endMs: 60_000, attribution: 'reattributed', includeOverkill: false, deathCutoff: null });
    expect(useApp.getState().report).toEqual({ tab: 'overview', data: ranged });
    expect(useApp.getState().overview).toBe(overviewFixture);

    await useApp.getState().setTab('damage');
    await useApp.getState().setRange({ startMs: 0, endMs: 30_000 });
    await useApp.getState().setTab('overview');
    expect(api.quickOverview).toHaveBeenLastCalledWith(LOG.id, 1, { startMs: 0, endMs: 30_000, attribution: 'reattributed', includeOverkill: false, deathCutoff: null });

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
    expect(load).toHaveBeenLastCalledWith(LOG.id, 1, ...scope, { startMs: 40_000, endMs: 60_000, attribution: 'reattributed', includeOverkill: false, deathCutoff: null });
    expect(useApp.getState().report).toEqual({ tab, data });
  });
});

describe('detail stack', () => {
  it('opens a player with the tab metric, keeps range and Aug mode, and closes back to the report', async () => {
    await openPull();
    await useApp.getState().setTab('healing');
    await useApp.getState().setRange({ startMs: 0, endMs: 60_000 });
    await useApp.getState().openPlayer(2);
    expect(api.playerDetail).toHaveBeenLastCalledWith(LOG.id, 1, 2, 'healing', { startMs: 0, endMs: 60_000, attribution: 'reattributed', includeOverkill: false, deathCutoff: null }, OPEN);
    expect(useApp.getState().report).toEqual({ tab: 'player', data: playerDetailFixture });

    await useApp.getState().setAttribution('augmented');
    expect(api.playerDetail).toHaveBeenLastCalledWith(LOG.id, 1, 2, 'healing', { startMs: 0, endMs: 60_000, attribution: 'augmented', includeOverkill: false, deathCutoff: null }, OPEN);

    await useApp.getState().closeDetail();
    expect(useApp.getState().details).toEqual([]);
    expect(api.healingReport).toHaveBeenLastCalledWith(LOG.id, 1, { startMs: 0, endMs: 60_000, attribution: 'augmented', includeOverkill: false, deathCutoff: null });
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
    expect(api.targetDetail).toHaveBeenLastCalledWith(LOG.id, 1, "Ula'tek", { startMs: 120_000, endMs: 140_000, attribution: 'reattributed', includeOverkill: false, deathCutoff: null }, OPEN);

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

describe('pull sets', () => {
  const SET: PullSet = { kind: 'wipes', encounterId: 3492, difficulty: 15, fights: [1, 3] };
  const SET_OVERVIEW: SetOverview = {
    overview: overviewFixture,
    pulls: [1, 3].map((fightIndex) => ({ fightIndex, kpis: overviewFixture.kpis, pullDurationMs: overviewFixture.kpis.durationMs, cutoffMs: null, bossHpStepMs: 1000, bossHp: [100, 62] })),
  };

  async function openSet() {
    await useApp.getState().openLog(chosen(LOG));
    vi.mocked(api.pullSet).mockResolvedValueOnce([SET_OVERVIEW]);
    await useApp.getState().openSet(SET);
  }

  function capturedPass() {
    const pass = deferred<unknown[]>();
    const captured: NonNullable<Parameters<typeof api.pullSet>[3]> = {};
    vi.mocked(api.pullSet).mockImplementationOnce((_logId, _fights, _commands, options) => {
      Object.assign(captured, options);
      return pass.promise;
    });
    return { pass, captured };
  }

  async function onDamageTab() {
    await openSet();
    vi.mocked(api.pullSet).mockResolvedValueOnce([damageReportFixture, breakdownFixture]);
    await useApp.getState().setTab('damage');
  }

  it('opening_a_set_reads_its_overview_over_every_pull', async () => {
    await useApp.getState().openLog(chosen(LOG));
    const { pass, captured } = capturedPass();
    const pending = useApp.getState().openSet(SET);
    captured.onProgress?.({ done: 1, total: 2 });
    expect(useApp.getState()).toMatchObject({ view: { kind: 'set', set: SET }, fightLoading: true, setProgress: { done: 1, total: 2 } });
    pass.resolve([SET_OVERVIEW]);
    await pending;
    expect(api.pullSet).toHaveBeenCalledWith(LOG.id, [1, 3], [{ command: 'quick_overview', args: { filter: WHOLE_PULL } }], expect.anything());
    expect(api.quickOverview).not.toHaveBeenCalled();
    expect(useApp.getState()).toMatchObject({ overview: overviewFixture, setPulls: SET_OVERVIEW.pulls, fightLoading: false, setProgress: null });
  });

  it('a_queued_pass_shows_its_progress_once_it_starts_reading', async () => {
    await useApp.getState().openLog(chosen(LOG));
    const overviewPass = capturedPass();
    const opening = useApp.getState().openSet(SET);
    overviewPass.captured.onProgress?.({ done: 1, total: 2 });
    const reportPass = capturedPass();
    const switching = useApp.getState().setTab('damage');
    expect(useApp.getState().setProgress).toEqual({ done: 1, total: 2 });
    overviewPass.captured.onProgress?.({ done: 2, total: 2 });
    expect(useApp.getState().setProgress).toEqual({ done: 2, total: 2 });
    overviewPass.pass.resolve([SET_OVERVIEW]);
    await opening;
    expect(useApp.getState().setProgress).toBeNull();
    reportPass.captured.onProgress?.({ done: 0, total: 2 });
    expect(useApp.getState().setProgress).toEqual({ done: 0, total: 2 });
    reportPass.pass.resolve([damageReportFixture, breakdownFixture]);
    await switching;
    expect(useApp.getState().setProgress).toBeNull();
  });

  it('a_damage_tab_in_a_set_reads_report_and_breakdown_in_one_pass', async () => {
    await openSet();
    vi.mocked(api.pullSet).mockResolvedValueOnce([damageReportFixture, breakdownFixture]);
    await useApp.getState().setTab('damage');
    expect(api.pullSet).toHaveBeenLastCalledWith(
      LOG.id,
      [1, 3],
      [
        { command: 'damage_done_report', args: { filter: WHOLE_PULL } },
        { command: 'breakdown_report', args: { filter: WHOLE_PULL, scope: OPEN, metric: 'damageDone', group: 'source' } },
      ],
      expect.anything(),
    );
    expect(api.damageDoneReport).not.toHaveBeenCalled();
    expect(useApp.getState()).toMatchObject({ report: { tab: 'damage', data: damageReportFixture }, breakdown: breakdownFixture, reportLoading: false, setProgress: null });
  });

  it('a_filter_picker_in_a_set_lists_the_options_of_every_pull', async () => {
    await onDamageTab();
    const options = [{ kind: 'unit', unit: { kind: 'player', actorId: 2 } }];
    vi.mocked(api.pullSet).mockResolvedValueOnce([options]);
    expect(await useApp.getState().filterOptions('target')).toBe(options);
    expect(api.pullSet).toHaveBeenLastCalledWith(
      LOG.id,
      [1, 3],
      [{ command: 'filter_options', args: { filter: WHOLE_PULL, scope: OPEN, metric: 'damageDone', dimension: 'target' } }],
      expect.anything(),
    );
    expect(api.filterOptions).not.toHaveBeenCalled();
  });

  it('a_filter_menu_pass_stops_once_the_set_is_left_or_the_menu_no_longer_needs_it', async () => {
    await onDamageTab();
    let wanted = true;
    const left = capturedPass();
    const leaving = useApp.getState().filterOptions('target', () => wanted);
    const closed = capturedPass();
    const closing = useApp.getState().filterOptions('source', () => wanted);
    expect(closed.captured.isStale?.()).toBe(false);
    wanted = false;
    expect(closed.captured.isStale?.()).toBe(true);
    wanted = true;
    useApp.getState().backToPulls();
    expect(left.captured.isStale?.()).toBe(true);
    left.pass.reject(new Error('cancelled'));
    closed.pass.reject(new Error('cancelled'));
    await expect(leaving).resolves.toEqual([]);
    await expect(closing).resolves.toEqual([]);
  });

  it('reopening_a_filter_menu_with_the_same_filters_reuses_the_options_of_the_set', async () => {
    await onDamageTab();
    const options = [{ kind: 'unit', unit: { kind: 'player', actorId: 2 } }];
    vi.mocked(api.pullSet).mockResolvedValueOnce([options]);
    expect(await useApp.getState().filterOptions('target')).toBe(options);
    expect(await useApp.getState().filterOptions('target')).toBe(options);
    expect(api.pullSet).toHaveBeenCalledTimes(3);

    vi.mocked(api.pullSet).mockResolvedValueOnce([damageReportFixture, breakdownFixture]);
    await useApp.getState().select('source', { kind: 'player', actorId: 2 });
    vi.mocked(api.pullSet).mockResolvedValueOnce([[]]);
    expect(await useApp.getState().filterOptions('target')).toEqual([]);
    expect(api.pullSet).toHaveBeenCalledTimes(5);
  });

  it('two_filter_menus_asking_for_the_same_list_share_one_pass', async () => {
    await onDamageTab();
    const options = [{ kind: 'unit', unit: { kind: 'player', actorId: 2 } }];
    let firstWanted = true;
    const { pass, captured } = capturedPass();
    const first = useApp.getState().filterOptions('target', () => firstWanted);
    const second = useApp.getState().filterOptions('target');
    expect(api.pullSet).toHaveBeenCalledTimes(3);
    firstWanted = false;
    expect(captured.isStale?.()).toBe(false);
    pass.resolve([options]);
    await expect(first).resolves.toBe(options);
    await expect(second).resolves.toBe(options);
  });

  it('going_back_to_a_tab_the_set_already_read_shows_it_without_reading_the_pulls_again', async () => {
    await onDamageTab();
    vi.mocked(api.pullSet).mockResolvedValueOnce([damageReportFixture, breakdownFixture]);
    await useApp.getState().setTab('healing');
    await useApp.getState().setTab('damage');
    expect(api.pullSet).toHaveBeenCalledTimes(3);
    expect(useApp.getState()).toMatchObject({ report: { tab: 'damage', data: damageReportFixture }, breakdown: breakdownFixture, reportLoading: false });
  });

  it('cancelling_the_first_pass_of_a_set_returns_to_the_pull_list', async () => {
    await useApp.getState().openLog(chosen(LOG));
    const { pass, captured } = capturedPass();
    const pending = useApp.getState().openSet(SET);
    useApp.getState().cancelSet();
    expect(captured.isStale?.()).toBe(true);
    pass.reject(new Error('cancelled'));
    await pending;
    expect(useApp.getState()).toMatchObject({ view: { kind: 'start' }, overview: null, error: null });
  });

  it('cancelling_a_tab_pass_stops_it_and_returns_to_the_set_overview', async () => {
    await openSet();
    const { pass, captured } = capturedPass();
    const switching = useApp.getState().setTab('damage');
    useApp.getState().cancelSet();
    expect(captured.isStale?.()).toBe(true);
    pass.reject(new Error('cancelled'));
    await switching;
    expect(useApp.getState()).toMatchObject({ view: { kind: 'set', set: SET }, tab: 'overview', overview: overviewFixture, report: null, reportLoading: false, reportError: null });
  });

  it.each([
    { option: 'overkill', change: () => useApp.getState().setIncludeOverkill(true) },
    { option: 'cutoff', change: () => useApp.getState().setDeathCutoff(3) },
  ])('cancelling_a_set_refresh_puts_the_option_back_with_the_overview_shown ($option)', async ({ change }) => {
    await onDamageTab();
    const { pass, captured } = capturedPass();
    const toggling = change();
    useApp.getState().cancelSet();
    expect(captured.isStale?.()).toBe(true);
    pass.reject(new Error('cancelled'));
    await toggling;
    expect(useApp.getState()).toMatchObject({ includeOverkill: false, deathCutoff: null, tab: 'overview', overview: overviewFixture, error: null });
  });

  it('set_view_re_reads_the_overview_when_the_cutoff_changes', async () => {
    await onDamageTab();
    const overviewRead = expect.objectContaining({ command: 'quick_overview' });
    vi.mocked(api.pullSet).mockResolvedValueOnce([SET_OVERVIEW, damageReportFixture, breakdownFixture]);
    await useApp.getState().setDeathCutoff(3);
    expect(vi.mocked(api.pullSet).mock.lastCall?.[2]).toContainEqual({ command: 'quick_overview', args: { filter: { ...WHOLE_PULL, deathCutoff: 3 } } });

    vi.mocked(api.pullSet).mockResolvedValueOnce([healingReportFixture, breakdownFixture]);
    await useApp.getState().setTab('healing');
    expect(vi.mocked(api.pullSet).mock.lastCall?.[2]).not.toContainEqual(overviewRead);
  });

  it('the_overkill_toggle_in_a_set_reads_the_overview_and_the_tab_in_one_pass', async () => {
    await onDamageTab();
    const withOverkill = { ...WHOLE_PULL, includeOverkill: true };
    const overview = { ...overviewFixture, kpis: { ...overviewFixture.kpis, raidDamage: 1 } };
    vi.mocked(api.pullSet).mockResolvedValueOnce([{ ...SET_OVERVIEW, overview }, damageReportFixture, breakdownFixture]);
    await useApp.getState().setIncludeOverkill(true);
    expect(api.pullSet).toHaveBeenCalledTimes(3);
    expect(api.pullSet).toHaveBeenLastCalledWith(
      LOG.id,
      [1, 3],
      [
        { command: 'quick_overview', args: { filter: withOverkill } },
        { command: 'damage_done_report', args: { filter: withOverkill } },
        { command: 'breakdown_report', args: { filter: withOverkill, scope: OPEN, metric: 'damageDone', group: 'source' } },
      ],
      expect.anything(),
    );
    expect(useApp.getState()).toMatchObject({ overview, report: { tab: 'damage', data: damageReportFixture }, reportLoading: false });
  });

  it.each([
    ['finishes', (pass: ReturnType<typeof deferred<unknown[]>>) => pass.resolve([SET_OVERVIEW])],
    ['is cancelled', (pass: ReturnType<typeof deferred<unknown[]>>) => pass.reject(new Error('cancelled'))],
  ])('leaving_a_set_stops_its_pass (the pass %s late)', async (_, settle) => {
    await useApp.getState().openLog(chosen(LOG));
    const { pass, captured } = capturedPass();
    const pending = useApp.getState().openSet(SET);
    useApp.getState().backToPulls();
    expect(captured.isStale?.()).toBe(true);
    settle(pass);
    await pending;
    expect(useApp.getState()).toMatchObject({ view: { kind: 'start' }, overview: null, setPulls: null, setProgress: null, error: null, fightError: null });
  });

  it('hiding_aborted_pulls_later_keeps_the_open_set', async () => {
    await openSet();
    useApp.getState().setHideAborted(false);
    expect(useApp.getState().view).toEqual({ kind: 'set', set: SET });
  });

  it('tabs_without_set_support_cannot_be_opened_in_a_set', async () => {
    await openSet();
    await useApp.getState().setTab('resources');
    expect(useApp.getState()).toMatchObject({ tab: 'overview', overview: overviewFixture });
    expect(api.resourcesReport).not.toHaveBeenCalled();
  });

  it('the_deaths_tab_of_a_set_reads_its_report_over_every_pull', async () => {
    await openSet();
    const setDeaths = { ...deathsReportFixture, pulls: [], byKillingBlow: [], noLethal: 0, byPlayer: [] };
    vi.mocked(api.pullSet).mockResolvedValueOnce([setDeaths]);
    await useApp.getState().setTab('deaths');
    expect(api.pullSet).toHaveBeenLastCalledWith(LOG.id, [1, 3], [{ command: 'deaths_report', args: { filter: WHOLE_PULL, scope: OPEN } }], expect.anything());
    expect(api.deathsReport).not.toHaveBeenCalled();
    expect(useApp.getState()).toMatchObject({ report: { tab: 'deaths', data: setDeaths }, breakdown: null, reportLoading: false });
  });

  it('switching_the_aura_kind_in_a_set_reads_debuffs', async () => {
    await openSet();
    const buffs = { ...aurasReportFixture, pulls: [] };
    const debuffs = { ...aurasReportFixture, pulls: [], players: 9 };
    vi.mocked(api.pullSet).mockResolvedValueOnce([buffs]);
    await useApp.getState().setTab('buffs');
    vi.mocked(api.pullSet).mockResolvedValueOnce([debuffs]);
    await useApp.getState().setAuraKind('debuffs');
    expect(api.pullSet).toHaveBeenLastCalledWith(
      LOG.id,
      [1, 3],
      [{ command: 'auras_report', args: { filter: WHOLE_PULL, scope: OPEN, kind: 'debuffs', group: 'ability' } }],
      expect.anything(),
    );
    expect(useApp.getState().report).toMatchObject({ tab: 'buffs', data: debuffs });
    const passes = vi.mocked(api.pullSet).mock.calls.length;
    await useApp.getState().setAuraKind('buffs');
    expect(api.pullSet).toHaveBeenCalledTimes(passes);
    expect(useApp.getState().report).toMatchObject({ tab: 'buffs', data: buffs });
  });

  it('a_selected_death_names_its_pull', () => {
    useApp.getState().selectDeath(7, 5000, 3);
    expect(useApp.getState().focusDeath).toEqual({ player: 7, t: 5000, fight: 3 });
  });
});

describe('pull comparison', () => {
  it('compares the shown pull with another one, the earlier pull first, in the current Aug mode', async () => {
    await openPull();
    await useApp.getState().openComparison(1);
    expect(api.comparePulls).not.toHaveBeenCalled();

    await useApp.getState().openFight(3);
    await useApp.getState().openComparison(1);
    expect(api.comparePulls).toHaveBeenLastCalledWith(LOG.id, 1, 3, 'reattributed', false, null);
    expect(useApp.getState().comparison).toEqual({ a: 1, b: 3, data: comparisonFixture, loading: false, error: null, reportAttribution: 'reattributed', reportIncludeOverkill: false, reportDeathCutoff: null });
    expect(useApp.getState().focusRequest).toBe('compare');
    expect(useApp.getState().view).toEqual({ kind: 'fight', fightIndex: 3 });

    await useApp.getState().setAttribution('augmented');
    expect(api.comparePulls).toHaveBeenLastCalledWith(LOG.id, 1, 3, 'augmented', false, null);

    vi.mocked(api.comparePulls).mockRejectedValueOnce('Pull 9 does not exist in this log.');
    await useApp.getState().openComparison(9);
    expect(useApp.getState().comparison).toMatchObject({ a: 3, b: 9, data: null, loading: false, error: 'Pull 9 does not exist in this log.' });
  });

  it('recalculates the comparison for overkill and the pull once back', async () => {
    await openPull();
    await useApp.getState().setTab('damage');
    await useApp.getState().openComparison(3);
    const pullLoads = vi.mocked(api.damageDoneReport).mock.calls.length;
    await useApp.getState().setIncludeOverkill(true);
    expect(api.comparePulls).toHaveBeenLastCalledWith(LOG.id, 1, 3, 'reattributed', true, null);
    expect(api.damageDoneReport).toHaveBeenCalledTimes(pullLoads);
    await useApp.getState().closeComparison();
    expect(api.damageDoneReport).toHaveBeenLastCalledWith(LOG.id, 1, { ...WHOLE_PULL, includeOverkill: true });
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
    expect(api.damageDoneReport).toHaveBeenLastCalledWith(LOG.id, 1, { startMs: 0, endMs: 60_000, attribution: 'augmented', includeOverkill: false, deathCutoff: null });
  });

  it('compares both pulls at the cutoff and recalculates the pull for it once back', async () => {
    await openPull();
    await useApp.getState().setTab('damage');
    await useApp.getState().openComparison(3);
    await useApp.getState().setDeathCutoff(3);
    expect(api.comparePulls).toHaveBeenLastCalledWith(LOG.id, 1, 3, 'reattributed', false, 3);
    await useApp.getState().closeComparison();
    expect(api.damageDoneReport).toHaveBeenLastCalledWith(LOG.id, 1, { ...WHOLE_PULL, deathCutoff: 3 });
  });
});

describe('death cutoff', () => {
  const PULL: QuickOverview = { ...overviewFixture, timeline: { ...overviewFixture.timeline, durationMs: 168_729 } };
  const CUT: QuickOverview = { ...PULL, timeline: { ...PULL.timeline, cutoffMs: 130_320 } };
  const CUT_AT_3 = { ...WHOLE_PULL, deathCutoff: 3 };

  async function cutAtThirdDeath() {
    vi.mocked(api.quickOverview).mockResolvedValue(CUT);
    await useApp.getState().setDeathCutoff(3);
  }

  it('setDeathCutoff reloads the overview and the report with the cutoff', async () => {
    await openPull();
    await useApp.getState().setTab('damage');
    await useApp.getState().setDeathCutoff(3);
    expect(api.quickOverview).toHaveBeenLastCalledWith(LOG.id, 1, CUT_AT_3);
    expect(api.damageDoneReport).toHaveBeenLastCalledWith(LOG.id, 1, CUT_AT_3);
  });

  it('a slower overview of an earlier cutoff does not replace the newer one', async () => {
    await openPull();
    const slow = deferred<QuickOverview>();
    vi.mocked(api.quickOverview).mockReturnValueOnce(slow.promise).mockResolvedValueOnce(CUT);
    const first = useApp.getState().setDeathCutoff(1);
    await useApp.getState().setDeathCutoff(3);
    slow.resolve(PULL);
    await first;
    expect(useApp.getState().overview).toBe(CUT);
  });

  it('cutoff resets when another pull opens', async () => {
    await openPull();
    await useApp.getState().setDeathCutoff(3);
    await useApp.getState().openFight(2);
    expect(useApp.getState().deathCutoff).toBeNull();
    expect(api.quickOverview).toHaveBeenLastCalledWith(LOG.id, 2, WHOLE_PULL);
  });

  it.each([
    { range: { startMs: 100_000, endMs: 150_000 }, clipped: { startMs: 100_000, endMs: 130_321 } },
    { range: { startMs: 140_000, endMs: 150_000 }, clipped: null },
  ])('cutoff_clips_or_drops_a_range_past_the_cut (from $range.startMs)', async ({ range, clipped }) => {
    vi.mocked(api.quickOverview).mockResolvedValue(PULL);
    await openPull();
    await useApp.getState().setRange(range);
    useApp.getState().setZoom({ startMs: 140_000, endMs: 145_000 });
    await cutAtThirdDeath();
    expect(useApp.getState()).toMatchObject({ range: clipped, zoom: null });
  });

  it('a range ending at the cut is sent open', async () => {
    await openPull();
    await cutAtThirdDeath();
    await useApp.getState().setTab('damage');
    await useApp.getState().setRange({ startMs: 0, endMs: 130_321 });
    expect(api.damageDoneReport).toHaveBeenLastCalledWith(LOG.id, 1, { ...CUT_AT_3, startMs: 0 });
  });

  it('runs never send a cutoff', async () => {
    vi.mocked(api.openLog).mockResolvedValue(runLogFixture);
    await useApp.getState().openLog(chosen(runLogFixture));
    await useApp.getState().openFight(1);
    await useApp.getState().setTab('damage');
    await useApp.getState().setDeathCutoff(3);
    expect(api.quickOverview).toHaveBeenLastCalledWith(runLogFixture.id, 1, WHOLE_PULL);
    expect(api.damageDoneReport).toHaveBeenLastCalledWith(runLogFixture.id, 1, WHOLE_PULL);
  });

  it('replay stops at the cut', async () => {
    await openPull();
    await cutAtThirdDeath();
    useApp.getState().setReplayTime(160_000);
    expect(useApp.getState().replay.time).toBe(130_321);
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

  it('narrows a pet ability row to the ability and the pets behind it', async () => {
    const wolves: UnitRef[] = [{ kind: 'pet', owner: 3, name: 'Wolf' }];
    const melee: BreakdownRow = {
      key: { kind: 'ability', ability: { kind: 'id', spellId: 0 }, rowKind: 'own', pet: 'Wolf' },
      name: '',
      number: null,
      spellId: 0,
      amount: 500,
      share: 1,
      absorbed: 0,
      healAbsorbed: 0,
      overheal: 0,
      healed: 0,
      hits: 2,
      crits: 0,
      casts: 0,
      hitAmount: 0,
      ticks: 0,
      tickAmount: 0,
      misses: [],
      pets: wolves,
    };
    await openPull();
    await useApp.getState().setTab('damage');
    await useApp.getState().showOnly('ability', melee);
    expect(vi.mocked(api.breakdownReport).mock.calls.at(-1)![3]).toEqual({ perspective: 'friendly', source: wolves, target: [], ability: [{ kind: 'id', spellId: 0 }] });
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
    expect(api.resourcesReport).toHaveBeenLastCalledWith(LOG.id, 1, { startMs: 40_000, endMs: 60_000, attribution: 'reattributed', includeOverkill: false, deathCutoff: null }, scope);
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
    expect(api.damageDoneReport).toHaveBeenLastCalledWith(LOG.id, 1, { startMs: 300_000, endMs: null, attribution: 'reattributed', includeOverkill: false, deathCutoff: null });
    await useApp.getState().setRange({ startMs: 300_000, endMs: 400_000 });
    expect(api.damageDoneReport).toHaveBeenLastCalledWith(LOG.id, 1, { startMs: 300_000, endMs: 400_000, attribution: 'reattributed', includeOverkill: false, deathCutoff: null });
  });
});

describe('replay', () => {
  const replayOf = (durationMs: number): ReplayData => ({
    encounterId: 1,
    advancedLogging: true,
    durationMs,
    roster: [],
    spells: {},
    units: [],
    tracks: [],
    health: [],
    power: [],
    targets: [],
    casts: [],
    auras: [],
    raidMarkers: [],
    worldMarkers: [],
    effects: [],
    phases: [],
    deaths: [],
    maps: [],
    arenaFrame: null,
  });

  it('loads the replay once per pull', async () => {
    const data = replayOf(60_000);
    vi.mocked(api.replay).mockResolvedValue(data);
    await openPull();
    await Promise.all([useApp.getState().loadReplay(), useApp.getState().loadReplay()]);
    await useApp.getState().loadReplay();
    expect(api.replay).toHaveBeenCalledTimes(1);
    expect(api.replay).toHaveBeenCalledWith(LOG.id, 1);
    expect(useApp.getState().replayData).toBe(data);
  });

  it('opening another pull resets replay state and drops a stale bundle', async () => {
    const stale = deferred<ReplayData>();
    vi.mocked(api.replay).mockReturnValueOnce(stale.promise);
    await openPull();
    const loading = useApp.getState().loadReplay();
    useApp.getState().setReplayTime(5_000);
    useApp.getState().toggleReplayPlay();
    expect(replayClock.playing()).toBe(true);

    await useApp.getState().openFight(2);
    expect(useApp.getState().replay).toMatchObject({ time: 0, playing: false });
    expect(replayClock.playing()).toBe(false);
    expect(replayClock.now()).toBe(0);

    const fresh = replayOf(30_000);
    vi.mocked(api.replay).mockResolvedValueOnce(fresh);
    await useApp.getState().loadReplay();
    stale.resolve(replayOf(99_000));
    await loading;
    expect(useApp.getState().replayData).toBe(fresh);
  });

  it('openReplayAt switches to the replay tab outside the split and only seeks inside it', async () => {
    vi.mocked(api.replay).mockResolvedValue(replayOf(60_000));
    await openPull();
    await useApp.getState().setTab('casts');
    useApp.getState().openReplayAt(12_000);
    expect(useApp.getState()).toMatchObject({ tab: 'replay', replay: { time: 12_000 } });

    await useApp.getState().setTab('casts');
    useApp.getState().setReplaySplit(true);
    useApp.getState().openReplayAt(20_000);
    expect(useApp.getState()).toMatchObject({ tab: 'casts', replay: { time: 20_000 } });
    expect(replayClock.now()).toBe(20_000);
  });

  it('replay time clamps to the selected range', async () => {
    vi.mocked(api.replay).mockResolvedValue(replayOf(60_000));
    await openPull();
    useApp.getState().setReplayTime(900_000);
    expect(useApp.getState().replay.time).toBe(overviewFixture.timeline.durationMs);

    await useApp.getState().setRange({ startMs: 10_000, endMs: 20_000 });
    useApp.getState().setReplayTime(0);
    expect(useApp.getState().replay.time).toBe(10_000);
    useApp.getState().setReplayTime(25_000);
    expect(useApp.getState().replay.time).toBe(20_000);
  });

  it('keeps the clock and the stored time in step while playing, and stops at the end of the range', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
      await openPull();
      await useApp.getState().setRange({ startMs: 0, endMs: 1_000 });
      useApp.getState().setReplaySpeed(2);
      useApp.getState().toggleReplayPlay();
      vi.advanceTimersByTime(300);
      expect(useApp.getState().replay.time).toBeGreaterThanOrEqual(500);
      expect(useApp.getState().replay.time).toBeLessThanOrEqual(600);
      vi.advanceTimersByTime(1_000);
      expect(useApp.getState().replay).toMatchObject({ time: 1_000, playing: false });
      expect(replayClock.playing()).toBe(false);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it('plays at the persisted speed and starts inside the range', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
      localStorage.setItem('openlogs.replay', JSON.stringify({ speed: 4 }));
      useApp.setState(initialState());
      await openPull();
      await useApp.getState().setRange({ startMs: 10_000, endMs: 60_000 });
      useApp.getState().toggleReplayPlay();
      expect(useApp.getState().replay.time).toBe(10_000);
      vi.advanceTimersByTime(1_000);
      expect(useApp.getState().replay.time).toBeGreaterThanOrEqual(13_800);
      expect(useApp.getState().replay.time).toBeLessThanOrEqual(14_000);
      useApp.getState().toggleReplayPlay();
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it('records a failed load and clears it on retry', async () => {
    await openPull();
    vi.mocked(api.replay).mockRejectedValueOnce('boom');
    await useApp.getState().loadReplay();
    expect(useApp.getState()).toMatchObject({ replayError: 'boom', replayData: null });
    vi.mocked(api.replay).mockResolvedValueOnce(replayOf(60_000));
    await useApp.getState().loadReplay();
    expect(useApp.getState()).toMatchObject({ replayError: null });
    expect(useApp.getState().replayData).not.toBeNull();
  });

  it('persists layers, filters and speed but not the hidden units', () => {
    useApp.getState().setReplayLayer('facing', true);
    useApp.getState().setReplayFilter({ pets: true, hidden: [4] });
    useApp.getState().setReplaySpeed(4);
    const restored = initialState().replay;
    expect(restored.layers.facing).toBe(true);
    expect(restored.filters).toMatchObject({ pets: true, hidden: [] });
    expect(restored.speed).toBe(4);
  });

  it("remembers whether the replay's range panel is open", () => {
    expect(useApp.getState().replay.rangeOpen).toBe(false);
    useApp.getState().setReplayRangeOpen(true);
    expect(initialState().replay.rangeOpen).toBe(true);
  });

  it('remembers the all auras switch', () => {
    expect(useApp.getState().replay.allAuras).toBe(false);
    useApp.getState().setReplayAllAuras(true);
    expect(initialState().replay.allAuras).toBe(true);
  });

  it('remembers the meter settings and ignores invalid stored values', () => {
    expect(useApp.getState().replay.meter).toEqual({ category: 'damageDone', mode: 'cumulative', windowMs: 10_000 });
    useApp.getState().setReplayMeter({ category: 'healingDone', mode: 'window' });
    useApp.getState().setReplayMeter({ windowMs: 30_000 });
    expect(initialState().replay.meter).toEqual({ category: 'healingDone', mode: 'window', windowMs: 30_000 });

    localStorage.setItem('openlogs.replay', JSON.stringify({ meter: { category: 'overhealing', mode: 'window', windowMs: 7_000 } }));
    expect(initialState().replay.meter).toEqual({ category: 'damageDone', mode: 'window', windowMs: 10_000 });
  });

  it('new layers get their defaults for stored replay settings', () => {
    localStorage.setItem('openlogs.replay', JSON.stringify({ layers: { effects: false, worldMarkers: true, facing: true, names: true } }));
    expect(initialState().replay.layers).toEqual({ map: true, grid: false, effects: false, worldMarkers: true, facing: true, names: true });
  });
});

describe('ui size', () => {
  it('stores a valid size and falls back to 100 for an invalid one', () => {
    useApp.getState().setUiSize(110);
    expect(useApp.getState().uiSize).toBe(110);
    expect(localStorage.getItem('openlogs.uiSize')).toBe('110');

    useApp.getState().setUiSize(7);
    expect(useApp.getState().uiSize).toBe(100);
  });
});

describe('live refresh', () => {
  function wipe(index: number): FightRow {
    return {
      index,
      encounterId: 3492,
      name: 'Vexie and the Geargrinders',
      difficulty: 15,
      difficultyLabel: 'Heroic',
      outcome: 'wipe',
      durationMs: 120_000,
      bossHpPercent: 40,
      playerCount: 20,
      startUnixMs: Date.UTC(2026, 9, 7, 19, index),
      zone: 'The Venomous Abyss',
      run: null,
      runIndex: null,
    };
  }
  const LIVE: LogView = { ...LOG, fights: [wipe(1), wipe(2)] };
  const GROWN: LogView = { ...LIVE, fights: [...LIVE.fights, wipe(3)] };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(api.openLog).mockResolvedValue(LIVE);
    vi.mocked(api.canFollow).mockReturnValue(true);
    vi.mocked(api.followLog).mockResolvedValue(null);
  });

  afterEach(() => {
    useApp.getState().setLiveRefresh(false);
    vi.useRealTimers();
  });

  it('moves a viewer of the newest pull to the new one, keeping tab, view and death cutoff', async () => {
    await useApp.getState().openLog(chosen(LIVE));
    await useApp.getState().openFight(2);
    await useApp.getState().setTab('deaths');
    await useApp.getState().setReportView('timeline');
    await useApp.getState().setDeathCutoff(3);
    vi.mocked(api.followLog).mockResolvedValueOnce(GROWN);
    await vi.advanceTimersByTimeAsync(2000);
    const s = useApp.getState();
    expect(s.view).toEqual({ kind: 'fight', fightIndex: 3 });
    expect([s.tab, s.reportView, s.deathCutoff]).toEqual(['deaths', 'timeline', 3]);
    expect(s.liveNotice).toMatchObject({ kind: 'pull', status: 'wipe' });
    const cut = { ...WHOLE_PULL, deathCutoff: 3 };
    expect(api.quickOverview).toHaveBeenLastCalledWith(LIVE.id, 3, cut);
    expect(api.deathsReport).toHaveBeenLastCalledWith(LIVE.id, 3, cut, OPEN);
    expect(s).toMatchObject({ overview: overviewFixture, overviewCutoff: 3, report: { tab: 'deaths', data: deathsReportFixture }, timeline: timelineFixture });
  });

  it('leaves a viewer of an older pull where they are', async () => {
    await useApp.getState().openLog(chosen(LIVE));
    await useApp.getState().openFight(1);
    vi.mocked(api.followLog).mockResolvedValueOnce(GROWN);
    await vi.advanceTimersByTimeAsync(2000);
    expect(useApp.getState().view).toEqual({ kind: 'fight', fightIndex: 1 });
    expect(useApp.getState().log?.fights).toHaveLength(3);
  });

  it('keeps the shown log while a refresh lists the same pulls', async () => {
    await useApp.getState().openLog(chosen(LIVE));
    const shownLog = useApp.getState().log;
    vi.mocked(api.followLog).mockResolvedValueOnce({ ...LIVE, sizeBytes: LIVE.sizeBytes + 4096, fights: LIVE.fights.map((fight) => ({ ...fight })) });
    await vi.advanceTimersByTimeAsync(2000);
    expect(useApp.getState().log).toBe(shownLog);
  });

  it('takes a viewer of a pull that is no longer listed back to the pull list', async () => {
    await useApp.getState().openLog(chosen(LIVE));
    await useApp.getState().openFight(2);
    vi.mocked(api.followLog).mockResolvedValueOnce({ ...LIVE, fights: [wipe(1)] });
    await vi.advanceTimersByTimeAsync(2000);
    expect(useApp.getState().view).toEqual({ kind: 'start' });
  });

  it('stops refreshing once the option is turned off', async () => {
    await useApp.getState().openLog(chosen(LIVE));
    await vi.advanceTimersByTimeAsync(2000);
    useApp.getState().setLiveRefresh(false);
    await vi.advanceTimersByTimeAsync(6000);
    expect(api.followLog).toHaveBeenCalledTimes(1);
  });

  it('keeps refreshing after a failed read and gives up after five in a row', async () => {
    await useApp.getState().openLog(chosen(LIVE));
    vi.mocked(api.followLog).mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce(null).mockRejectedValue(new Error('read failed'));
    await vi.advanceTimersByTimeAsync(12_000);
    expect(api.followLog).toHaveBeenCalledTimes(6);
    expect(useApp.getState().canFollow).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.followLog).toHaveBeenCalledTimes(7);
    expect(useApp.getState().canFollow).toBe(false);
  });

  it('runs one refresh at a time', async () => {
    await useApp.getState().openLog(chosen(LIVE));
    vi.mocked(api.followLog).mockReturnValue(new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(6000);
    expect(api.followLog).toHaveBeenCalledTimes(1);
  });

  it('adds a new pull to the open set and reads the set again', async () => {
    const overviewOf = (fights: number[]): SetOverview => ({
      overview: overviewFixture,
      pulls: fights.map((fightIndex) => ({ fightIndex, kpis: overviewFixture.kpis, pullDurationMs: 120_000, cutoffMs: null, bossHpStepMs: 1000, bossHp: [100, 40] })),
    });
    const set: PullSet = { kind: 'wipes', encounterId: 3492, difficulty: 15, fights: [1, 2] };
    await useApp.getState().openLog(chosen(LIVE));
    vi.mocked(api.pullSet).mockResolvedValueOnce([overviewOf([1, 2])]);
    await useApp.getState().openSet(set);
    vi.mocked(api.pullSet).mockResolvedValueOnce([damageReportFixture, breakdownFixture]);
    await useApp.getState().setTab('damage');
    const grown = overviewOf([1, 2, 3]);
    vi.mocked(api.pullSet).mockResolvedValueOnce([grown, damageReportFixture, breakdownFixture]);
    vi.mocked(api.followLog).mockResolvedValueOnce(GROWN);
    await vi.advanceTimersByTimeAsync(2000);
    expect(useApp.getState()).toMatchObject({ view: { kind: 'set', set: { ...set, fights: [1, 2, 3] } }, tab: 'damage', setPulls: grown.pulls });
    expect(api.pullSet).toHaveBeenLastCalledWith(
      LIVE.id,
      [1, 2, 3],
      [
        { command: 'quick_overview', args: { filter: WHOLE_PULL } },
        { command: 'damage_done_report', args: { filter: WHOLE_PULL } },
        { command: 'breakdown_report', args: { filter: WHOLE_PULL, scope: OPEN, metric: 'damageDone', group: 'source' } },
      ],
      expect.anything(),
    );
  });

  it('settles the last pull once the log has not grown for 30 s', async () => {
    await useApp.getState().openLog(chosen(LIVE));
    vi.mocked(api.followLog).mockResolvedValueOnce(GROWN);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.followLog).not.toHaveBeenCalledWith(LIVE.id, true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.followLog).toHaveBeenLastCalledWith(LIVE.id, true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.followLog).toHaveBeenLastCalledWith(LIVE.id, false);
    expect(vi.mocked(api.followLog).mock.calls.filter(([, settleAll]) => settleAll)).toHaveLength(1);
  });
});
