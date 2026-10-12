import { create } from 'zustand';
import { api } from './api/client';
import type {
  GameDataStatus,
  AuraScope,
  AurasReport,
  InterruptsReport,
  ResourcesReport,
  CastsReport,
  DeathsReport,
  AbilityDetail,
  Attribution,
  DamageReport,
  DamageTakenReport,
  Detail,
  HealingReport,
  Kpis,
  LogView,
  Metric,
  PlayerDetail,
  PullComparison,
  QuickOverview,
  RecentLog,
  ReportFilter,
  TargetDetail,
} from './api/types';
import { t } from './i18n/i18n';
import { readStored, writeStored } from './storage';

const HIDE_ABORTED_KEY = 'hideAborted';
const AUG_DELTA_KEY = 'showAugDelta';
const COLOR_BY_TARGET_KEY = 'colorByTarget';
const HIDE_PROCS_KEY = 'hideProcs';
export type FightTab =
  | 'overview'
  | 'damage'
  | 'healing'
  | 'taken'
  | 'deaths'
  | 'casts'
  | 'buffs'
  | 'interrupts'
  | 'resources';
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
  | { tab: 'deaths'; data: DeathsReport }
  | { tab: 'casts'; data: CastsReport }
  | { tab: 'buffs'; data: AurasReport }
  | { tab: 'interrupts'; data: InterruptsReport }
  | { tab: 'resources'; data: ResourcesReport }
  | { tab: 'overview'; data: QuickOverview };

export type View = { kind: 'start' } | { kind: 'fight'; fightIndex: number };

/** Where keyboard focus goes after a navigation: a page title, the comparison title or the active tab. */
export type FocusTarget = 'start' | 'fight' | 'page' | 'tab' | 'compare';

export type CastsSortKey = 'amount' | 'uptime' | 'cpm';
export interface CastsSort {
  key: CastsSortKey;
  desc: boolean;
}
const DEFAULT_CASTS_SORT: CastsSort = { key: 'amount', desc: true };

/** A pull comparison, shown instead of the pull's tabs. */
export interface ComparisonState {
  /** Log indices of the earlier and the later pull; the shown pull is one of them. */
  a: number;
  b: number;
  data: PullComparison | null;
  loading: boolean;
  error: string | null;
  /** Aug mode the pull's report was calculated with; Back recalculates it after a change. */
  reportAttribution: Attribution;
}

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
  /** The Overview's figures for the range, loaded with the report of a tab whose header shows them. */
  rangeKpis: Kpis | null;
  reportError: string | null;
  showAugDelta: boolean;
  /** Damage Done and Healing colour their bars by target (healing: by the healed players' role). */
  colorByTarget: boolean;
  /** Casts tab: hide curated procs and passive triggers. */
  hideProcs: boolean;
  /** Casts tab: the chosen player (`null` = the top caster) and the spell sort; kept per pull. */
  castsPlayer: number | null;
  castsSort: CastsSort;
  /** Buffs & Debuffs tab: which auras to list. */
  auraScope: AuraScope;
  /** Drilldown stack; the last entry is shown instead of the report. */
  details: Detail[];
  /** Tab a detail stack was opened from; shown again once the stack is empty. */
  detailOrigin: FightTab | null;
  /** Death the Deaths tab shows: a cross-link target or the user's choice. */
  focusDeath: { player: number; t: number } | null;
  /** Open pull comparison; `null` shows the pull's tabs. Tab, range and details stay as they were. */
  comparison: ComparisonState | null;
  /**
   * Focus requested by the last navigation; the element that renders for it takes it once.
   * A failed load or a range, Aug-mode or scope change drops a request nobody took.
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
  setColorByTarget(on: boolean): void;
  setHideProcs(hide: boolean): void;
  selectCastsPlayer(player: number): void;
  setCastsSort(sort: CastsSort): void;
  setAuraScope(scope: AuraScope): Promise<void>;
  openPlayer(player: number): Promise<void>;
  openAbility(spellId: number, pet: string | null): Promise<void>;
  openTarget(name: string): Promise<void>;
  openDeathRecap(player: number, t: number): Promise<void>;
  selectDeath(player: number, t: number): void;
  openAbilityOf(player: number, spellId: number, tab: 'damage' | 'healing'): Promise<void>;
  back(): Promise<void>;
  /** Shows the page at `depth` of the detail stack (a breadcrumb link); the pages above it close. */
  showDetailAt(depth: number): Promise<void>;
  closeDetail(): Promise<void>;
  consumeFocus(): void;
  openComparison(other: number): Promise<void>;
  closeComparison(): Promise<void>;
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
    rangeKpis: null,
    reportError: null,
    showAugDelta: readFlag(AUG_DELTA_KEY, false),
    colorByTarget: readFlag(COLOR_BY_TARGET_KEY, false),
    hideProcs: readFlag(HIDE_PROCS_KEY, true),
    castsPlayer: null,
    castsSort: DEFAULT_CASTS_SORT,
    auraScope: 'buffs_on_players',
    details: [],
    detailOrigin: null,
    focusDeath: null,
    comparison: null,
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
let comparisonRequest = 0;

/** Makes an in-flight pull load stale. */
function dropPendingFight() {
  fightRequest += 1;
}

/** Makes every in-flight report request stale. */
function dropPendingReports() {
  reportRequest += 1;
}

/** Makes an in-flight comparison stale. */
function dropPendingComparison() {
  comparisonRequest += 1;
}

/** The tab's report, or the detail page on top of the stack for Damage Done and Healing. */
async function fetchReport(
  path: string,
  fight: number,
  tab: FightTab,
  top: Detail | undefined,
  auraScope: AuraScope,
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
    case 'deaths':
      return { tab, data: await api.deathsReport(path, fight, filter) };
    case 'casts':
      return { tab, data: await api.castsReport(path, fight, filter) };
    case 'buffs':
      return { tab, data: await api.aurasReport(path, fight, auraScope, filter) };
    case 'interrupts':
      return { tab, data: await api.interruptsReport(path, fight, filter) };
    case 'resources':
      return { tab, data: await api.resourcesReport(path, fight, filter) };
  }
}

/** Loads the report of the current tab; only the newest request may write the result. */
async function loadReport(get: () => State & Actions, set: (partial: Partial<State>) => void) {
  const { log, view, tab, attribution, range, details, auraScope } = get();
  if (!log || view.kind !== 'fight') return;
  const request = ++reportRequest;
  if (tab === 'overview' && range === null) {
    // The whole-pull overview is already in `state.overview`.
    set({ report: null, reportError: null, reportLoading: false });
    return;
  }
  const filter = { startMs: range?.startMs ?? null, endMs: range?.endMs ?? null, attribution };
  set({ reportLoading: true, reportError: null, rangeKpis: null });
  try {
    // Resources' header shows the Overview's figures; a failure only leaves it at "…".
    const rangeKpis =
      tab === 'resources' && range !== null ? api.quickOverview(log.path, view.fightIndex, filter).then((o) => o.kpis, () => null) : null;
    const report = await fetchReport(log.path, view.fightIndex, tab, details[details.length - 1], auraScope, filter);
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
    const kpis = await rangeKpis;
    if (kpis && request === reportRequest) set({ rangeKpis: kpis });
  } catch (err) {
    // A page that failed has no heading to focus; a later load must not inherit the request.
    if (request === reportRequest) set({ reportError: String(err), focusRequest: null });
  } finally {
    if (request === reportRequest) set({ reportLoading: false });
  }
}

/** Loads the open comparison in the current Aug mode; only the newest request may write. */
async function loadComparison(get: () => State & Actions, set: (partial: Partial<State>) => void) {
  const { log, comparison, attribution } = get();
  if (!log || !comparison) return;
  const request = ++comparisonRequest;
  // The shown comparison stays until the new Aug mode is calculated.
  set({ comparison: { ...comparison, loading: true, error: null } });
  const update = (partial: Partial<ComparisonState>) => {
    const current = get().comparison;
    if (request === comparisonRequest && current) set({ comparison: { ...current, ...partial } });
  };
  try {
    update({ data: await api.comparePulls(log.path, comparison.a, comparison.b, attribution) });
  } catch (err) {
    update({ data: null, error: String(err) });
  } finally {
    update({ loading: false });
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
        dropPendingComparison();
        set({ log, view: { kind: 'start' }, overview: null, fightLoading: false, fightError: null, comparison: null });
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
    dropPendingComparison();
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
      rangeKpis: null,
      details: [],
      detailOrigin: null,
      focusDeath: null,
      comparison: null,
      focusRequest: 'fight',
      castsPlayer: null,
      castsSort: DEFAULT_CASTS_SORT,
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
    dropPendingComparison();
    set({
      view: { kind: 'start' },
      overview: null,
      fightLoading: false,
      fightError: null,
      tab: 'overview',
      range: null,
      report: null,
      rangeKpis: null,
      reportError: null,
      reportLoading: false,
      details: [],
      detailOrigin: null,
      focusDeath: null,
      comparison: null,
      focusRequest: 'start',
      castsPlayer: null,
      castsSort: DEFAULT_CASTS_SORT,
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
    set({ tab, report: null, reportError: null, details: kept, focusDeath: null, detailOrigin: null, focusRequest: focus });
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

  async openDeathRecap(player, t) {
    set({ tab: 'deaths', details: [], detailOrigin: null, focusDeath: { player, t }, report: null, reportError: null, focusRequest: 'page' });
    await loadReport(get, set);
  },

  selectDeath(player, t) {
    set({ focusDeath: { player, t } });
  },

  async openAbilityOf(player, spellId, tab) {
    const { details } = get();
    const top = details[details.length - 1];
    const ability = { kind: 'ability' as const, player, spellId, pet: null };
    if (top?.kind === 'player' && top.player === player) {
      // From the player's own page: push, so Back walks through what is below it.
      set({ tab, details: [...details, ability], report: null, reportError: null, focusRequest: 'page' });
    } else {
      set({
        tab,
        details: [{ kind: 'player', player }, ability],
        detailOrigin: originFor(get()),
        report: null,
        reportError: null,
        focusRequest: 'page',
      });
    }
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

  async openComparison(other) {
    const { view, attribution } = get();
    if (view.kind !== 'fight' || other === view.fightIndex) return;
    const [a, b] = other < view.fightIndex ? [other, view.fightIndex] : [view.fightIndex, other];
    set({ comparison: { a, b, data: null, loading: true, error: null, reportAttribution: attribution }, focusRequest: 'compare' });
    await loadComparison(get, set);
  },

  async closeComparison() {
    const comparison = get().comparison;
    if (!comparison) return;
    dropPendingComparison();
    set({ comparison: null, focusRequest: 'fight' });
    if (comparison.reportAttribution !== get().attribution) await loadReport(get, set);
  },

  async setAttribution(attribution) {
    // Filter changes never move focus; drop a request that no heading has taken (also in setRange and setAuraScope).
    set({ attribution, focusRequest: null });
    // The Aug toggle on the comparison recalculates the comparison; Back recalculates the pull.
    if (get().comparison) await loadComparison(get, set);
    else await loadReport(get, set);
  },

  async setRange(range) {
    set({ range, focusRequest: null });
    await loadReport(get, set);
  },

  async setAuraScope(scope) {
    // Keep the shown report while the new scope loads, so the tab keeps its filter and focus.
    set({ auraScope: scope, focusRequest: null });
    await loadReport(get, set);
  },

  setHideProcs(hide) {
    writeFlag(HIDE_PROCS_KEY, hide);
    set({ hideProcs: hide });
  },

  selectCastsPlayer(player) {
    set({ castsPlayer: player });
  },

  setCastsSort(sort) {
    set({ castsSort: sort });
  },

  setColorByTarget(on) {
    writeFlag(COLOR_BY_TARGET_KEY, on);
    set({ colorByTarget: on });
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
