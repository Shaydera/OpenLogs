import { create } from 'zustand';
import { api } from './api/client';
import type {
  GameDataStatus,
  AbilityDetail,
  Attribution,
  DamageReport,
  DamageTakenReport,
  Detail,
  HealingReport,
  LogView,
  Metric,
  PlayerDetail,
  QuickOverview,
  RecentLog,
  ReportFilter,
  TargetDetail,
} from './api/types';
import { t } from './i18n/i18n';
import { readStored, writeStored } from './storage';

const HIDE_ABORTED_KEY = 'hideAborted';
const AUG_DELTA_KEY = 'showAugDelta';
export type FightTab =
  | 'overview'
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
  | { tab: 'taken'; data: DamageTakenReport }
  | { tab: 'player'; data: PlayerDetail }
  | { tab: 'ability'; data: AbilityDetail }
  | { tab: 'target'; data: TargetDetail }
  | { tab: 'overview'; data: QuickOverview };

export type View = { kind: 'start' } | { kind: 'fight'; fightIndex: number };

/** Where keyboard focus goes after a navigation: a page title or the active tab. */
export type FocusTarget = 'start' | 'fight' | 'page' | 'tab';

interface State {
  recent: RecentLog[];
  log: LogView | null;
  /** File name currently being indexed, for the drop zone status. */
  openingFile: string | null;
  error: string | null;
  hideAborted: boolean;
  view: View;
  overview: QuickOverview | null;
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
  /** Drilldown stack; the last entry is shown instead of the report. */
  details: Detail[];
  /** Tab a detail stack was opened from; shown again once the stack is empty. */
  detailOrigin: FightTab | null;
  /**
   * Focus requested by the last navigation; the element that renders for it takes it once.
   * A failed load or a range or Aug-mode change drops a request nobody took.
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
  /** `focus`: where focus goes once the tab shows (the pull breadcrumb: the Overview title). */
  setTab(tab: FightTab, focus?: FocusTarget | null): Promise<void>;
  setAttribution(attribution: Attribution): Promise<void>;
  setRange(range: TimeRange | null): Promise<void>;
  setShowAugDelta(show: boolean): void;
  openPlayer(player: number): Promise<void>;
  openAbility(spellId: number, pet: string | null): Promise<void>;
  openTarget(name: string): Promise<void>;
  openAbilityOf(player: number, spellId: number, tab: 'damage' | 'healing'): Promise<void>;
  back(): Promise<void>;
  /** Shows the page at `depth` of the detail stack (a breadcrumb link); the pages above it close. */
  showDetailAt(depth: number): Promise<void>;
  closeDetail(): Promise<void>;
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
    overview: null,
    fightLoading: false,
    fightError: null,
    tab: 'overview',
    attribution: 'reattributed',
    range: null,
    report: null,
    reportLoading: false,
    reportError: null,
    showAugDelta: readFlag(AUG_DELTA_KEY, false),
    details: [],
    detailOrigin: null,
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

/** The tab's report, or the detail page on top of the stack for Damage Done and Healing. */
async function fetchReport(
  path: string,
  fight: number,
  tab: FightTab,
  top: Detail | undefined,
  filter: ReportFilter,
): Promise<ReportData> {
  const metric: Metric = tab === 'healing' ? 'healing' : 'damage';
  if (tab === 'damage' || tab === 'healing') {
    if (top?.kind === 'player') return { tab: 'player', data: await api.playerDetail(path, fight, top.player, metric, filter) };
    if (top?.kind === 'ability') return { tab: 'ability', data: await api.abilityDetail(path, fight, top.player, top.spellId, top.pet, metric, filter) };
    if (top?.kind === 'target') return { tab: 'target', data: await api.targetDetail(path, fight, top.name, filter) };
  }
  switch (tab) {
    case 'overview':
      return { tab, data: await api.quickOverview(path, fight, filter) };
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
  const { log, view, tab, attribution, range, details } = get();
  if (!log || view.kind !== 'fight') return;
  const request = ++reportRequest;
  if (tab === 'overview' && range === null) {
    // The whole-pull overview is already in `state.overview`.
    set({ report: null, reportError: null, reportLoading: false });
    return;
  }
  const filter = { startMs: range?.startMs ?? null, endMs: range?.endMs ?? null, attribution };
  set({ reportLoading: true, reportError: null });
  try {
    const report = await fetchReport(log.path, view.fightIndex, tab, details[details.length - 1], filter);
    if (request === reportRequest) {
      // Pin the enemy that the empty "Enemies" entry resolved to, so range changes keep it.
      const shown = get().details;
      const last = shown[shown.length - 1];
      if (report.tab === 'target' && last?.kind === 'target' && last.name === '') {
        set({ report, details: [...shown.slice(0, -1), { kind: 'target', name: report.data.name }] });
      } else if (report.tab === 'ability' && last?.kind === 'ability' && last.spellId === report.data.spellId && last.spellName !== report.data.spellName) {
        // Pin the ability's name: the pull overview knows only its own spells.
        set({ report, details: [...shown.slice(0, -1), { ...last, spellName: report.data.spellName }] });
      } else {
        set({ report });
      }
    }
  } catch (err) {
    // A page that failed has no heading to focus; a later load must not inherit the request.
    if (request === reportRequest) set({ reportError: String(err), focusRequest: null });
  } finally {
    if (request === reportRequest) set({ reportLoading: false });
  }
}

/** Detail pages live on Damage Done or Healing. */
function reportTab(tab: FightTab): FightTab {
  return tab === 'healing' ? 'healing' : 'damage';
}

/** The tab to return to when a detail page opens on top of the current stack. */
function originFor(state: State): FightTab | null {
  if (state.details.length > 0) return state.detailOrigin;
  return state.tab === 'damage' || state.tab === 'healing' ? null : state.tab;
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
        set({ log, view: { kind: 'start' }, overview: null, fightLoading: false, fightError: null });
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
      overview: null,
      fightLoading: true,
      fightError: null,
      error: null,
      tab: 'overview',
      range: null,
      report: null,
      reportError: null,
      reportLoading: false,
      details: [],
      detailOrigin: null,
      focusRequest: 'fight',
    });
    try {
      const overview = await api.quickOverview(log.path, fightIndex, null);
      if (request === fightRequest) set({ overview });
    } catch (err) {
      if (request === fightRequest) set({ error: t('error.loadFailed', { reason: String(err) }), fightError: String(err) });
    } finally {
      if (request === fightRequest) set({ fightLoading: false });
    }
  },

  backToPulls() {
    dropPendingFight();
    dropPendingReports();
    set({
      view: { kind: 'start' },
      overview: null,
      fightLoading: false,
      fightError: null,
      tab: 'overview',
      range: null,
      report: null,
      reportError: null,
      reportLoading: false,
      details: [],
      detailOrigin: null,
      focusRequest: 'start',
    });
  },

  dismissError() {
    set({ error: null });
  },

  showError(message) {
    set({ error: message });
  },

  async setTab(tab, focus = null) {
    const { details, tab: current } = get();
    const keep = tab === 'damage' || tab === 'healing';
    const top = details[details.length - 1];
    // An ability page belongs to one metric; switching the metric shows its player instead.
    const kept = !keep ? [] : top?.kind === 'ability' && tab !== current ? details.slice(0, -1) : details;
    set({ tab, report: null, reportError: null, details: kept, detailOrigin: null, focusRequest: focus });
    await loadReport(get, set);
  },

  async openPlayer(player) {
    const state = get();
    // An enemy page stays below the player so Back returns to it; a shown player or ability is replaced.
    const below = state.details.slice(0, state.details.findLastIndex((d) => d.kind === 'target') + 1);
    set({
      tab: reportTab(state.tab),
      details: [...below, { kind: 'player', player }],
      detailOrigin: originFor(state),
      report: null,
      reportError: null,
      focusRequest: 'page',
    });
    await loadReport(get, set);
  },

  async openAbility(spellId, pet) {
    const details = get().details;
    const top = details[details.length - 1];
    if (top?.kind !== 'player') return;
    set({ details: [...details, { kind: 'ability', player: top.player, spellId, pet }], report: null, reportError: null, focusRequest: 'page' });
    await loadReport(get, set);
  },

  async openTarget(name) {
    const state = get();
    const details = state.details;
    const below = details[details.length - 1]?.kind === 'target' ? details.slice(0, -1) : details;
    set({
      tab: reportTab(state.tab),
      details: [...below, { kind: 'target', name }],
      detailOrigin: originFor(state),
      report: null,
      reportError: null,
      focusRequest: 'page',
    });
    await loadReport(get, set);
  },

  async openAbilityOf(player, spellId, tab) {
    const { details } = get();
    const top = details[details.length - 1];
    if (top?.kind !== 'player' || top.player !== player) return;
    const ability = { kind: 'ability' as const, player, spellId, pet: null };
    // From the player's own page: push, so Back walks through what is below it.
    set({ tab, details: [...details, ability], report: null, reportError: null, focusRequest: 'page' });
    await loadReport(get, set);
  },

  async back() {
    const { details, detailOrigin, tab } = get();
    const rest = details.slice(0, -1);
    // The stack empties: return to the tab it was opened from.
    const home = rest.length === 0 ? detailOrigin : null;
    set({
      details: rest,
      tab: home ?? tab,
      detailOrigin: home === null ? detailOrigin : null,
      report: null,
      reportError: null,
      focusRequest: rest.length > 0 ? 'page' : 'tab',
    });
    await loadReport(get, set);
  },

  async showDetailAt(depth) {
    const { details } = get();
    // Only a lower page: the top one is already shown.
    if (depth < 0 || depth >= details.length - 1) return;
    set({ details: details.slice(0, depth + 1), report: null, reportError: null, focusRequest: 'page' });
    await loadReport(get, set);
  },

  async closeDetail() {
    const { detailOrigin, tab } = get();
    set({ details: [], tab: detailOrigin ?? tab, detailOrigin: null, report: null, reportError: null, focusRequest: 'tab' });
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
