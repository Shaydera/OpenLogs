import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { api } from './api/client';
import type { DamageReport, LogView, QuickOverview } from './api/types';
import { gameDataFixture } from './test/gameDataFixture';
import { overviewFixture } from './test/overviewFixture';
import { damageReportFixture, healingReportFixture, takenReportFixture } from './test/reportFixtures';
import { initialState, useApp } from './store';

vi.mock('./api/client', () => ({
  api: {
    openLog: vi.fn(),
    recentLogs: vi.fn(),
    removeRecent: vi.fn(),
    quickOverview: vi.fn(),
    damageDoneReport: vi.fn(),
    healingReport: vi.fn(),
    damageTakenReport: vi.fn(),
    gameDataStatus: vi.fn(),
    refreshGameData: vi.fn(),
  },
}));

const LOG: LogView = {
  path: 'C:\\Logs\\WoWCombatLog-100726_185823.txt',
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

beforeEach(() => {
  Object.values(api).forEach((fn) => (fn as Mock).mockReset());
  vi.mocked(api.recentLogs).mockResolvedValue([]);
  vi.mocked(api.openLog).mockResolvedValue(LOG);
  vi.mocked(api.quickOverview).mockResolvedValue(overviewFixture);
  vi.mocked(api.damageDoneReport).mockResolvedValue(damageReportFixture);
  vi.mocked(api.healingReport).mockResolvedValue(healingReportFixture);
  vi.mocked(api.damageTakenReport).mockResolvedValue(takenReportFixture);
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
  await useApp.getState().openLog(LOG.path);
  await useApp.getState().openFight(1);
}

describe('logs and pulls', () => {
  it('opens a log, refreshes the recent list and loads a pull', async () => {
    await useApp.getState().openLog(LOG.path);
    expect(useApp.getState()).toMatchObject({ log: LOG, openingFile: null });
    expect(api.recentLogs).toHaveBeenCalled();

    await useApp.getState().openFight(1);
    expect(api.quickOverview).toHaveBeenCalledWith(LOG.path, 1, null);
    expect(useApp.getState()).toMatchObject({ view: { kind: 'fight', fightIndex: 1 }, overview: overviewFixture });
    useApp.getState().backToPulls();
    expect(useApp.getState().view).toEqual({ kind: 'start' });
  });

  it('turns a failed open into a readable error and still refreshes the recent list', async () => {
    vi.mocked(api.openLog).mockRejectedValue('File not found: C:\\Logs\\gone.txt');
    await useApp.getState().openLog('C:\\Logs\\gone.txt');
    expect(useApp.getState().error).toBe('Could not open gone.txt: File not found: C:\\Logs\\gone.txt');
    expect(useApp.getState().log).toBeNull();
    expect(api.recentLogs).toHaveBeenCalledTimes(1);
  });

  it('records a failed pull load for the fight view and clears it on the next load', async () => {
    vi.mocked(api.quickOverview).mockRejectedValueOnce(`File not found: ${LOG.path}`);
    await openPull();
    expect(useApp.getState()).toMatchObject({ fightError: `File not found: ${LOG.path}`, fightLoading: false });

    await useApp.getState().openFight(1);
    expect(useApp.getState().fightError).toBeNull();
  });

  it('resets the tab and range when a pull opens', async () => {
    await openPull();
    await useApp.getState().setTab('taken');
    await useApp.getState().setRange({ startMs: 0, endMs: 1_000 });

    await useApp.getState().openFight(1);
    expect(useApp.getState()).toMatchObject({
      tab: 'overview',
      range: null,
      report: null,
    });
  });
});

describe('reports', () => {
  it('reloads the shown report with the current range and Aug mode', async () => {
    await openPull();
    await useApp.getState().setTab('damage');
    expect(api.damageDoneReport).toHaveBeenLastCalledWith(LOG.path, 1, WHOLE_PULL);
    expect(useApp.getState().report).toEqual({ tab: 'damage', data: damageReportFixture });

    await useApp.getState().setAttribution('augmented');
    expect(api.damageDoneReport).toHaveBeenLastCalledWith(LOG.path, 1, { ...WHOLE_PULL, attribution: 'augmented' });

    await useApp.getState().setRange({ startMs: 158_000, endMs: 273_000 });
    expect(api.damageDoneReport).toHaveBeenLastCalledWith(LOG.path, 1, { startMs: 158_000, endMs: 273_000, attribution: 'augmented' });
  });

  it('loads a range overview, also when coming back to the tab, and falls back to the pull overview', async () => {
    await openPull();
    const ranged = { ...overviewFixture, deaths: [] };
    vi.mocked(api.quickOverview).mockResolvedValue(ranged);
    await useApp.getState().setRange({ startMs: 40_000, endMs: 60_000 });
    expect(api.quickOverview).toHaveBeenLastCalledWith(LOG.path, 1, { startMs: 40_000, endMs: 60_000, attribution: 'reattributed' });
    expect(useApp.getState().report).toEqual({ tab: 'overview', data: ranged });
    expect(useApp.getState().overview).toBe(overviewFixture);

    await useApp.getState().setTab('damage');
    await useApp.getState().setRange({ startMs: 0, endMs: 30_000 });
    await useApp.getState().setTab('overview');
    expect(api.quickOverview).toHaveBeenLastCalledWith(LOG.path, 1, { startMs: 0, endMs: 30_000, attribution: 'reattributed' });

    await useApp.getState().setRange(null);
    expect(useApp.getState().report).toBeNull();
    expect(api.quickOverview).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['overview', api.quickOverview, overviewFixture],
    ['damage', api.damageDoneReport, damageReportFixture],
    ['healing', api.healingReport, healingReportFixture],
    ['taken', api.damageTakenReport, takenReportFixture],
  ] as const)('loads the %s tab through its own API call', async (tab, load, data) => {
    (load as Mock).mockResolvedValue(data);
    await openPull();
    // The whole-pull overview arrives with the pull; only a range makes Overview request a report.
    useApp.setState({ range: { startMs: 40_000, endMs: 60_000 } });
    await useApp.getState().setTab(tab);
    expect(load).toHaveBeenLastCalledWith(LOG.path, 1, { startMs: 40_000, endMs: 60_000, attribution: 'reattributed' });
    expect(useApp.getState().report).toEqual({ tab, data });
  });
});

describe('focus requests', () => {
  it('asks for focus where a navigation leads and drops requests a filter change leaves unanswered', async () => {
    await openPull();
    expect(useApp.getState().focusRequest).toBe('fight');
    await useApp.getState().setRange({ startMs: 0, endMs: 10_000 });
    expect(useApp.getState().focusRequest).toBeNull();

    useApp.getState().backToPulls();
    expect(useApp.getState().focusRequest).toBe('start');
    useApp.getState().consumeFocus();
    expect(useApp.getState().focusRequest).toBeNull();
  });
});

describe('request races', () => {
  it.each([
    ['finishes', (old: ReturnType<typeof deferred<LogView>>) => old.resolve(LOG)],
    ['fails', (old: ReturnType<typeof deferred<LogView>>) => old.reject('File not found')],
  ])('keeps the newest log when an older open %s last', async (_, settle) => {
    const other = { ...LOG, path: 'C:\\Logs\\other.txt', fileName: 'other.txt' };
    const old = deferred<LogView>();
    vi.mocked(api.openLog).mockReturnValueOnce(old.promise).mockResolvedValueOnce(other);
    const pending = useApp.getState().openLog(LOG.path);
    await useApp.getState().openLog(other.path);
    settle(old);
    await pending;
    expect(useApp.getState()).toMatchObject({ log: other, openingFile: null, error: null });
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
    { overtaken: 'another log opens', overtake: () => useApp.getState().openLog(LOG.path), fails: false, expected: { view: { kind: 'start' }, overview: null } },
  ])('drops a pull load once $overtaken', async ({ overtake, fails, expected }) => {
    await useApp.getState().openLog(LOG.path);
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
  it.each([
    { overtaken: 'a newer Aug mode', overtake: 'augmented', expected: { report: { tab: 'damage', data: freshReport }, reportLoading: false } },
    { overtaken: 'another pull', overtake: 'pull', expected: { report: null, reportLoading: false } },
  ])('drops a report response overtaken by $overtaken', async ({ overtake, expected }) => {
    await openPull();
    const old = deferred<DamageReport>();
    vi.mocked(api.damageDoneReport).mockReturnValueOnce(old.promise).mockResolvedValue(freshReport);
    const pending = useApp.getState().setTab('damage');
    if (overtake === 'augmented') await useApp.getState().setAttribution('augmented');
    else await useApp.getState().openFight(2);
    old.resolve(damageReportFixture);
    await pending;
    expect(useApp.getState()).toMatchObject(expected);
  });
});

describe('settings', () => {
  it('loads the game-data status and refreshes it one request at a time', async () => {
    vi.mocked(api.gameDataStatus).mockResolvedValue(gameDataFixture);
    await useApp.getState().openSettings();
    expect(useApp.getState()).toMatchObject({ settingsOpen: true, gameData: gameDataFixture, gameDataLoading: false });

    const refreshed = { ...gameDataFixture, bossPortraits: { entries: 1_157, fetchedUnixMs: 1, error: null } };
    const refresh = deferred<typeof gameDataFixture>();
    vi.mocked(api.refreshGameData).mockReturnValueOnce(refresh.promise);
    const first = useApp.getState().refreshGameData();
    await useApp.getState().refreshGameData();
    expect(api.refreshGameData).toHaveBeenCalledTimes(1);
    refresh.resolve(refreshed);
    await first;
    expect(useApp.getState().gameData).toEqual(refreshed);

    vi.mocked(api.refreshGameData).mockRejectedValueOnce('shell gone');
    await useApp.getState().refreshGameData();
    expect(useApp.getState()).toMatchObject({ error: 'Could not refresh the game data: shell gone', gameDataRefreshing: false });
  });
});
