import { create } from 'zustand';
import { api } from './api/client';
import type {
  GameDataStatus,
  Attribution,
  DamageReport,
  DamageTakenReport,
  FightTimeline,
  HealingReport,
  LogView,
  RecentLog,
  ReportFilter,
} from './api/types';
import { t } from './i18n/i18n';
import { readStored, writeStored } from './storage';

const HIDE_ABORTED_KEY = 'hideAborted';
const AUG_DELTA_KEY = 'showAugDelta';
export type FightTab =
  | 'damage'
  | 'healing'
  | 'taken';
export interface TimeRange {
  startMs: number;
  endMs: number;
}
export type ReportData =
  | { tab: 'damage'; data: DamageReport }
  | { tab: 'healing'; data: HealingReport }
  | { tab: 'taken'; data: DamageTakenReport };

export type View = { kind: 'start' } | { kind: 'fight'; fightIndex: number };

/** Where keyboard focus goes after a navigation: a page title. */
export type FocusTarget = 'start' | 'fight';

interface State {
  recent: RecentLog[];
  log: LogView | null;
  /** File name currently being indexed, for the drop zone status. */
  openingFile: string | null;
  error: string | null;
  hideAborted: boolean;
  view: View;
  timeline: FightTimeline | null;
  fightLoading: boolean;
  /** Why the current pull could not be loaded. */
  fightError: string | null;
  tab: FightTab;
  attribution: Attribution;
  /** `null` = the whole pull. */
  range: TimeRange | null;
  report: ReportData | null;
  reportLoading: boolean;
  reportError: string | null;
  showAugDelta: boolean;
  /**
   * Focus requested by the last navigation; the element that renders for it takes it once.
   * A range or Aug-mode change drops a request nobody took.
   */
  focusRequest: FocusTarget | null;
  settingsOpen: boolean;
  /** Game-data status for the dialog; `null` until loaded, or when the shell cannot tell. */
  gameData: GameDataStatus | null;
  /** A status request is running (opening the dialog, or its poll during a sync). */
  gameDataLoading: boolean;
  /** "Refresh now" was clicked and its sync has not answered yet. */
  gameDataRefreshing: boolean;
}

interface Actions {
  refreshRecent(): Promise<void>;
  openLog(path: string): Promise<void>;
  removeRecent(path: string): Promise<void>;
  setHideAborted(hide: boolean): void;
  openFight(fightIndex: number): Promise<void>;
  backToPulls(): void;
  dismissError(): void;
  showError(message: string): void;
  setTab(tab: FightTab): Promise<void>;
  setAttribution(attribution: Attribution): Promise<void>;
  setRange(range: TimeRange | null): Promise<void>;
  setShowAugDelta(show: boolean): void;
  consumeFocus(): void;
  openSettings(): Promise<void>;
  closeSettings(): void;
  loadGameDataStatus(): Promise<void>;
  refreshGameData(): Promise<void>;
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function readFlag(key: string, fallback: boolean): boolean {
  const value = readStored(key);
  return value === null ? fallback : value === 'true';
}

function writeFlag(key: string, value: boolean) {
  writeStored(key, String(value));
}

export function initialState(): State {
  return {
    recent: [],
    log: null,
    openingFile: null,
    error: null,
    hideAborted: readFlag(HIDE_ABORTED_KEY, true),
    view: { kind: 'start' },
    timeline: null,
    fightLoading: false,
    fightError: null,
    tab: 'damage',
    attribution: 'reattributed',
    range: null,
    report: null,
    reportLoading: false,
    reportError: null,
    showAugDelta: readFlag(AUG_DELTA_KEY, false),
    focusRequest: null,
    settingsOpen: false,
    gameData: null,
    gameDataLoading: false,
    gameDataRefreshing: false,
  };
}

let reportRequest = 0;
let logRequest = 0;
let fightRequest = 0;

/** Makes an in-flight pull load stale. */
function dropPendingFight() {
  fightRequest += 1;
}

/** Makes every in-flight report request stale. */
function dropPendingReports() {
  reportRequest += 1;
}

async function fetchReport(path: string, fight: number, tab: FightTab, filter: ReportFilter): Promise<ReportData> {
  switch (tab) {
    case 'damage':
      return { tab, data: await api.damageDoneReport(path, fight, filter) };
    case 'healing':
      return { tab, data: await api.healingReport(path, fight, filter) };
    case 'taken':
      return { tab, data: await api.damageTakenReport(path, fight, filter) };
  }
}

/** Loads the report of the current tab; only the newest request may write the result. */
async function loadReport(get: () => State & Actions, set: (partial: Partial<State>) => void) {
  const { log, view, tab, attribution, range } = get();
  if (!log || view.kind !== 'fight') return;
  const request = ++reportRequest;
  const filter = { startMs: range?.startMs ?? null, endMs: range?.endMs ?? null, attribution };
  set({ reportLoading: true, reportError: null });
  try {
    const report = await fetchReport(log.path, view.fightIndex, tab, filter);
    if (request === reportRequest) set({ report });
  } catch (err) {
    if (request === reportRequest) set({ reportError: String(err) });
  } finally {
    if (request === reportRequest) set({ reportLoading: false });
  }
}

export const useApp = create<State & Actions>()((set, get) => ({
  ...initialState(),

  async refreshRecent() {
    try {
      set({ recent: await api.recentLogs() });
    } catch {
      // Outside the desktop shell (tests, browser preview) there is no recent list.
    }
  },

  async openLog(path) {
    const request = ++logRequest;
    set({ openingFile: fileName(path), error: null });
    try {
      const log = await api.openLog(path);
      if (request === logRequest) {
        dropPendingFight();
        dropPendingReports();
        set({ log, view: { kind: 'start' }, timeline: null, fightLoading: false, fightError: null });
      }
    } catch (err) {
      if (request === logRequest) set({ error: t('error.openFailed', { file: fileName(path), reason: String(err) }) });
    } finally {
      if (request === logRequest) set({ openingFile: null });
      // The backend may have added or dropped the entry either way.
      await get().refreshRecent();
    }
  },

  async removeRecent(path) {
    try {
      await api.removeRecent(path);
    } catch (err) {
      set({ error: t('error.removeFailed', { file: fileName(path), reason: String(err) }) });
    }
    await get().refreshRecent();
  },

  setHideAborted(hide) {
    writeFlag(HIDE_ABORTED_KEY, hide);
    set({ hideAborted: hide });
  },

  async openFight(fightIndex) {
    const log = get().log;
    if (!log) return;
    const request = ++fightRequest;
    dropPendingReports();
    set({
      view: { kind: 'fight', fightIndex },
      timeline: null,
      fightLoading: true,
      fightError: null,
      error: null,
      tab: 'damage',
      range: null,
      report: null,
      reportError: null,
      reportLoading: false,
      focusRequest: 'fight',
    });
    const report = loadReport(get, set);
    try {
      const timeline = await api.fightTimeline(log.path, fightIndex);
      if (request === fightRequest) set({ timeline });
    } catch (err) {
      if (request === fightRequest) set({ error: t('error.loadFailed', { reason: String(err) }), fightError: String(err) });
    } finally {
      if (request === fightRequest) set({ fightLoading: false });
    }
    await report;
  },

  backToPulls() {
    dropPendingFight();
    dropPendingReports();
    set({
      view: { kind: 'start' },
      timeline: null,
      fightLoading: false,
      fightError: null,
      tab: 'damage',
      range: null,
      report: null,
      reportError: null,
      reportLoading: false,
      focusRequest: 'start',
    });
  },

  dismissError() {
    set({ error: null });
  },

  showError(message) {
    set({ error: message });
  },

  async setTab(tab) {
    set({ tab, report: null, reportError: null });
    await loadReport(get, set);
  },

  consumeFocus() {
    set({ focusRequest: null });
  },

  async setAttribution(attribution) {
    // Filter changes never move focus; drop a request that no heading has taken (also in setRange).
    set({ attribution, focusRequest: null });
    await loadReport(get, set);
  },

  async setRange(range) {
    set({ range, focusRequest: null });
    await loadReport(get, set);
  },

  setShowAugDelta(show) {
    writeFlag(AUG_DELTA_KEY, show);
    set({ showAugDelta: show });
  },

  async openSettings() {
    set({ settingsOpen: true });
    await get().loadGameDataStatus();
  },

  closeSettings() {
    set({ settingsOpen: false });
  },

  async loadGameDataStatus() {
    set({ gameDataLoading: true });
    try {
      set({ gameData: await api.gameDataStatus() });
    } catch {
      // Outside the desktop shell (tests, browser preview) there is no status.
      set({ gameData: null });
    } finally {
      set({ gameDataLoading: false });
    }
  },

  async refreshGameData() {
    if (get().gameDataRefreshing) return;
    set({ gameDataRefreshing: true });
    try {
      set({ gameData: await api.refreshGameData() });
    } catch (err) {
      set({ error: t('error.refreshFailed', { reason: String(err) }) });
    } finally {
      set({ gameDataRefreshing: false });
    }
  },
}));
