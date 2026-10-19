import { type StateCreator, create } from 'zustand';
import { api } from './api/client';
import type { ChosenLog } from './api/logSource';
import type {
  AbilityRef,
  AuraKind,
  AurasReport,
  InterruptsReport,
  ResourcesReport,
  CastsReport,
  DeathsReport,
  AbilityDetail,
  EventsPage,
  EventsPageRequest,
  ReportView,
  Timeline,
  Attribution,
  Breakdown,
  BreakdownRow,
  DamageReport,
  DamageTakenReport,
  Detail,
  Dimension,
  FilterOption,
  HealingReport,
  Kpis,
  LogView,
  MeterCategory,
  Metric,
  PlayerDetail,
  PullComparison,
  QuickOverview,
  RecentLog,
  ReportFilter,
  Scope,
  Side,
  TargetDetail,
  UnitRef,
  ReplayData,
} from './api/types';
import { rangeWindow, requestWindow, sameWindow, shownWindow, covers, windowSpan } from './components/views/zoomGeometry';
import { type GameDataManifest, gameDataManifest } from './gameData';
import { replayClock } from './components/replay/replayClock';
import { t } from './i18n/i18n';
import { rowValue } from './components/filters/labels';
import { effectiveView, lanesOf } from './reportViews';
import { type FilterTab, isFilterTab, SIDES } from './scopeSides';
import { readStored, writeStored } from './storage';
import { type ThemeMode, type ThemeName, readTheme, readThemeMode, storeTheme, storeThemeMode } from './theme';
import { normalizeUiSize, readUiSize, storeUiSize } from './uiScale';

const HIDE_ABORTED_KEY = 'hideAborted';
const AUG_DELTA_KEY = 'showAugDelta';
const COLOR_BY_TARGET_KEY = 'colorByTarget';
const HIDE_PROCS_KEY = 'hideProcs';
const INCLUDE_OVERKILL_KEY = 'includeOverkill';
export type FightTab =
  | 'overview'
  | 'damage'
  | 'healing'
  | 'taken'
  | 'deaths'
  | 'casts'
  | 'buffs'
  | 'interrupts'
  | 'resources'
  | 'replay';
export type ReplaySpeed = 0.5 | 1 | 2 | 4;
export type ReplayLayers = { map: boolean; grid: boolean; effects: boolean; worldMarkers: boolean; facing: boolean; names: boolean };
export type ReplayFilters = { players: boolean; pets: boolean; bosses: boolean; adds: boolean; hidden: number[] };
export type ReplayState = {
  time: number;
  playing: boolean;
  speed: ReplaySpeed;
  selected: number | null;
  layers: ReplayLayers;
  filters: ReplayFilters;
  split: boolean;
  splitWidth: number;
  follow: boolean;
  rangeOpen: boolean;
  allAuras: boolean;
  meter: ReplayMeter;
};
export type MeterMode = 'cumulative' | 'window';
export type MeterWindowMs = 5000 | 10000 | 30000;
export type ReplayMeter = { category: MeterCategory; mode: MeterMode; windowMs: MeterWindowMs };

const REPLAY_KEY = 'replay';
const REPLAY_SPEEDS: ReplaySpeed[] = [0.5, 1, 2, 4];
export const METER_CATEGORIES: MeterCategory[] = ['damageDone', 'healingDone', 'damageTaken', 'healingReceived', 'interrupts', 'dispels'];
export const METER_WINDOWS: MeterWindowMs[] = [5000, 10000, 30000];
const DEFAULT_REPLAY_METER: ReplayMeter = { category: 'damageDone', mode: 'cumulative', windowMs: 10000 };
const DEFAULT_SPLIT_WIDTH = 480;
const REPLAY_TICK_MS = 100;
export type MetricTab = 'damage' | 'healing' | 'taken';
export const isMetricTab = (tab: FightTab): tab is MetricTab => tab === 'damage' || tab === 'healing' || tab === 'taken';

/** Whole Mythic+ runs have no replay; the boss pulls inside them have one. */
export function replayOffered({ log, view }: Pick<State, 'log' | 'view'>): boolean {
  if (view.kind !== 'fight') return true;
  const { fightIndex } = view;
  return log?.fights.find((fight) => fight.index === fightIndex)?.run == null;
}

/** The replay shows beside the report: the split is on and the shown fight has a replay. */
export const replaySplitShown = (state: Pick<State, 'log' | 'view' | 'replay'>): boolean => state.replay.split && replayOffered(state);

/** The view filters by role: `own` is the perspective's side (Damage Taken: the target), `other` the side it faces. */
export interface Filters {
  perspective: Side;
  own: UnitRef[];
  other: UnitRef[];
  ability: AbilityRef[];
}
const EMPTY_FILTERS: Filters = { perspective: 'friendly', own: [], other: [], ability: [] };
/** Tabs without filters map the roles like Damage Done. */
const sidesOf = (tab: FightTab) => SIDES[isFilterTab(tab) ? tab : 'damage'];
const NONE: UnitRef[] = [];

function scopeOf({ perspective, own, other, ability }: Filters, tab: FightTab): Scope {
  const sides = sidesOf(tab);
  const unit = (dimension: 'source' | 'target') => (sides.own === dimension ? own : sides.other === dimension ? other : NONE);
  return { perspective, source: unit('source'), target: unit('target'), ability };
}

/**
 * The page filter as a detail page of `tab` (Damage Done or Healing, friendly players and enemies)
 * reads it: an Enemies view hands its selections over by side. The core keeps what the page applies.
 */
export function pageScope(filters: Filters, tab: 'damage' | 'healing'): Scope {
  const friendly = filters.perspective === 'friendly' ? filters : { ...filters, own: filters.other, other: filters.own };
  return scopeOf({ ...friendly, perspective: 'friendly' }, tab);
}

/** The view's dimension behind a detail page's `dimension`, the inverse of `pageScope`. */
export function viewDimension(dimension: Dimension, perspective: Side): Dimension {
  if (perspective === 'friendly' || dimension === 'ability') return dimension;
  return dimension === 'source' ? 'target' : 'source';
}

const roleOf = (dimension: Dimension, tab: FightTab) => (dimension === 'ability' ? 'ability' : dimension === sidesOf(tab).own ? 'own' : 'other');

/** The tab's grouping: the user's choice, else the tab's default. */
export const groupOf = (grouping: Partial<Record<FilterTab, Dimension>>, tab: FilterTab): Dimension => grouping[tab] ?? SIDES[tab].rows[0];

/** The scope of `state`'s filters and tab; the current object while it still matches. */
function derivedScope(state: State): Scope {
  const next = scopeOf(state.filters, state.tab);
  const { scope } = state;
  const same = next.perspective === scope.perspective && next.source === scope.source && next.target === scope.target && next.ability === scope.ability;
  return same ? scope : next;
}
/** The range a request sends; one that reaches the pull's end stays open, so the pull's last events count as they do for the whole pull. */
function reportFilter(s: Pick<State, 'range' | 'attribution' | 'includeOverkill' | 'overview'>): ReportFilter {
  const { range } = s;
  const pullEnd = s.overview?.timeline.durationMs;
  const endMs = range === null || (pullEnd !== undefined && range.endMs >= pullEnd) ? null : range.endMs;
  return { startMs: range?.startMs ?? null, endMs, attribution: s.attribution, includeOverkill: s.includeOverkill };
}
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

/** The views' toggles; kept for the session. */
export interface ViewToggles {
  /** Events of Casts: list begin casts with their outcome. */
  beginCasts: boolean;
  /** Casts: list rejected inputs, logged for the logging player only. */
  rejected: boolean;
  /** Timeline of Damage Taken: draw every hit. */
  hits: boolean;
}
const NO_TOGGLES: ViewToggles = { beginCasts: false, rejected: false, hits: false };
export type EventsLayout = 'grid' | 'text';
/** Rows of an Events page. */
export const EVENTS_PAGE_ROWS = 60;

/** A pull comparison, shown instead of the pull's tabs. */
export interface ComparisonState {
  /** Log indices of the earlier and the later pull; the shown pull is one of them. */
  a: number;
  b: number;
  data: PullComparison | null;
  loading: boolean;
  error: string | null;
  /** Aug mode and overkill rule the pull's report was calculated with; Back recalculates it after a change. */
  reportAttribution: Attribution;
  reportIncludeOverkill: boolean;
}

/** The log being opened; `totalBytes` is `null` until its size is known. */
export interface Opening {
  file: string;
  bytesRead: number;
  totalBytes: number | null;
}

type Store = State & Actions;
type SetState = (partial: Partial<Omit<State, 'scope'>>) => void;

interface State {
  filters: Filters;
  /** The filters as the core scope of the current tab; the same object until one of them or the tab's sides change. */
  scope: Scope;
  /** The groupings the user chose per tab. */
  grouping: Partial<Record<FilterTab, Dimension>>;
  breakdown: Breakdown | null;
  recent: RecentLog[];
  log: LogView | null;
  /** The log being opened, for the drop zone status. */
  opening: Opening | null;
  error: string | null;
  hideAborted: boolean;
  view: View;
  overview: QuickOverview | null;
  fightLoading: boolean;
  /** Why the current pull could not be loaded. */
  fightError: string | null;
  tab: FightTab;
  attribution: Attribution;
  /** Damage counts the overkill of killing hits; remembered for every log. */
  includeOverkill: boolean;
  /** `null` = the whole pull. */
  range: TimeRange | null;
  report: ReportData | null;
  reportLoading: boolean;
  /** The Overview's figures for the range, loaded with the report of a tab whose header shows them. */
  rangeKpis: Kpis | null;
  reportError: string | null;
  /** The Timeline or Events request failed; the table's report is unaffected. */
  viewError: string | null;
  viewLoading: boolean;
  showAugDelta: boolean;
  /** Damage Done and Healing colour their bars by target (healing: by the healed players' role). */
  colorByTarget: boolean;
  /** Casts tab: hide curated procs and passive triggers unless an ability is selected. */
  hideProcs: boolean;
  theme: ThemeName;
  themeMode: ThemeMode;
  uiSize: number;
  /** Casts tab: the chosen row's key (`null` = the top row) and the spell sort; kept per pull. */
  castsRow: string | null;
  castsSort: CastsSort;
  /** Buffs & Debuffs tab: buffs or debuffs on the perspective's side. */
  auraKind: AuraKind;
  /** The view of the report tabs; kept across tabs, reset per pull. */
  reportView: ReportView;
  /** The timeline's window inside the range; `null` = the first 20 s of the range. */
  zoom: TimeRange | null;
  /** The lane dimension the user chose per tab. */
  lanes: Partial<Record<FilterTab, Dimension>>;
  /** The first row of each tab's Events page; a filter change starts over. */
  eventsOffset: Partial<Record<FilterTab, number>>;
  viewToggles: ViewToggles;
  eventsLayout: EventsLayout;
  /** The shown tab's timeline or Events page, loaded with its report. */
  timeline: Timeline | null;
  events: EventsPage | null;
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
  /** The shipped game data for the dialog; `null` until loaded, or when the app has none. */
  gameData: GameDataManifest | null;
  gameDataLoading: boolean;
  replay: ReplayState;
  /** The shown pull's replay bundle; loaded on first use. */
  replayData: ReplayData | null;
  replayRequest: number;
  /** Why the current pull's replay could not be loaded. */
  replayError: string | null;
}

interface Actions {
  setPerspective(side: Side): Promise<void>;
  select(dimension: Dimension, value: UnitRef | AbilityRef | null): Promise<void>;
  /** Narrows `dimension` to `row`; a pet ability row also narrows the sources to its pets. */
  showOnly(dimension: Dimension, row: BreakdownRow): Promise<void>;
  clearFilters(): Promise<void>;
  /** Clears the selections behind a detail page's dimensions and keeps the rest. */
  clearPageFilter(dimensions: Dimension[]): Promise<void>;
  setGrouping(dimension: Dimension): Promise<void>;
  filterOptions(dimension: Dimension): Promise<FilterOption[]>;
  refreshRecent(): Promise<void>;
  openLog(chosen: ChosenLog): Promise<void>;
  openRecent(entry: RecentLog): Promise<void>;
  removeRecent(entry: RecentLog): Promise<void>;
  setHideAborted(hide: boolean): void;
  openFight(fightIndex: number): Promise<void>;
  backToPulls(): void;
  dismissError(): void;
  showError(message: string): void;
  /** `focus`: where focus goes once the tab shows (the pull breadcrumb: the Overview title). */
  setTab(tab: FightTab, focus?: FocusTarget | null): Promise<void>;
  setAttribution(attribution: Attribution): Promise<void>;
  setIncludeOverkill(include: boolean): Promise<void>;
  setRange(range: TimeRange | null): Promise<void>;
  setShowAugDelta(show: boolean): void;
  setColorByTarget(on: boolean): void;
  setHideProcs(hide: boolean): Promise<void>;
  setTheme(theme: ThemeName): void;
  setThemeMode(mode: ThemeMode): void;
  setUiSize(percent: number): void;
  selectCastsRow(key: string): void;
  setCastsSort(sort: CastsSort): void;
  setAuraKind(kind: AuraKind): Promise<void>;
  setReportView(view: ReportView): Promise<void>;
  /** Moves the timeline's window; `refreshTimeline` loads what it needs. */
  setZoom(zoom: TimeRange | null): void;
  /** Loads the timeline when the loaded window no longer serves the shown one. */
  refreshTimeline(): Promise<void>;
  setLanes(dimension: Dimension): Promise<void>;
  setViewToggle(toggle: keyof ViewToggles, on: boolean): Promise<void>;
  setEventsLayout(layout: EventsLayout): void;
  showEventsPage(offset: number): Promise<void>;
  /** The Events view at the page that holds `t`. */
  showEventsAt(t: number): Promise<void>;
  /** Asks again for the view the last view request asked for. */
  retryView(): Promise<void>;
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
  loadReplay(): Promise<void>;
  setReplayTime(ms: number): void;
  toggleReplayPlay(): void;
  setReplaySpeed(speed: ReplaySpeed): void;
  selectReplayUnit(id: number | null): void;
  setReplayLayer(layer: keyof ReplayLayers, on: boolean): void;
  setReplayFilter(filters: Partial<ReplayFilters>): void;
  setReplaySplit(on: boolean): void;
  setReplaySplitWidth(width: number): void;
  setReplayRangeOpen(open: boolean): void;
  setReplayAllAuras(all: boolean): void;
  setReplayMeter(meter: Partial<ReplayMeter>): void;
  setReplayFollow(on: boolean): void;
  openReplayAt(ms: number): void;
}

function readFlag(key: string, fallback: boolean): boolean {
  const value = readStored(key);
  return value === null ? fallback : value === 'true';
}

function writeFlag(key: string, value: boolean) {
  writeStored(key, String(value));
}

const DEFAULT_REPLAY_LAYERS: ReplayLayers = { map: true, grid: false, effects: true, worldMarkers: true, facing: false, names: true };
const DEFAULT_REPLAY_FILTERS: ReplayFilters = { players: true, pets: false, bosses: true, adds: true, hidden: [] };

function readReplayState(): ReplayState {
  const state: ReplayState = {
    time: 0,
    playing: false,
    speed: 1,
    selected: null,
    layers: DEFAULT_REPLAY_LAYERS,
    filters: DEFAULT_REPLAY_FILTERS,
    split: false,
    splitWidth: DEFAULT_SPLIT_WIDTH,
    follow: false,
    rangeOpen: false,
    allAuras: false,
    meter: DEFAULT_REPLAY_METER,
  };
  const raw = readStored(REPLAY_KEY);
  if (raw === null) return state;
  try {
    const stored = JSON.parse(raw) as Partial<Record<string, unknown>>;
    const flags = <T extends object>(defaults: T, value: unknown): T => {
      const read = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, typeof read[key] === 'boolean' ? read[key] : fallback])) as T;
    };
    return {
      ...state,
      layers: flags(DEFAULT_REPLAY_LAYERS, stored.layers),
      filters: { ...flags({ ...DEFAULT_REPLAY_FILTERS, hidden: undefined }, stored.filters), hidden: [] } as ReplayFilters,
      speed: REPLAY_SPEEDS.find((speed) => speed === stored.speed) ?? 1,
      split: stored.split === true,
      splitWidth: typeof stored.splitWidth === 'number' && stored.splitWidth > 0 ? stored.splitWidth : DEFAULT_SPLIT_WIDTH,
      rangeOpen: stored.rangeOpen === true,
      allAuras: stored.allAuras === true,
      meter: readMeter(stored.meter),
    };
  } catch {
    return state;
  }
}

function readMeter(value: unknown): ReplayMeter {
  const stored = (typeof value === 'object' && value !== null ? value : {}) as Partial<Record<keyof ReplayMeter, unknown>>;
  return {
    category: METER_CATEGORIES.find((category) => category === stored.category) ?? DEFAULT_REPLAY_METER.category,
    mode: stored.mode === 'window' ? 'window' : 'cumulative',
    windowMs: METER_WINDOWS.find((windowMs) => windowMs === stored.windowMs) ?? DEFAULT_REPLAY_METER.windowMs,
  };
}

function writeReplayState({ layers, filters: { hidden: _hidden, ...filters }, speed, split, splitWidth, rangeOpen, allAuras, meter }: ReplayState) {
  writeStored(REPLAY_KEY, JSON.stringify({ layers, filters, speed, split, splitWidth, rangeOpen, allAuras, meter }));
}

export function initialState(): State {
  return {
    filters: EMPTY_FILTERS,
    scope: scopeOf(EMPTY_FILTERS, 'overview'),
    grouping: {},
    breakdown: null,
    recent: [],
    log: null,
    opening: null,
    error: null,
    hideAborted: readFlag(HIDE_ABORTED_KEY, true),
    view: { kind: 'start' },
    overview: null,
    fightLoading: false,
    fightError: null,
    tab: 'overview',
    attribution: 'reattributed',
    includeOverkill: readFlag(INCLUDE_OVERKILL_KEY, false),
    range: null,
    report: null,
    reportLoading: false,
    rangeKpis: null,
    reportError: null,
    viewError: null,
    viewLoading: false,
    showAugDelta: readFlag(AUG_DELTA_KEY, false),
    colorByTarget: readFlag(COLOR_BY_TARGET_KEY, false),
    hideProcs: readFlag(HIDE_PROCS_KEY, true),
    theme: readTheme(),
    themeMode: readThemeMode(),
    uiSize: readUiSize(),
    castsRow: null,
    castsSort: DEFAULT_CASTS_SORT,
    auraKind: 'buffs',
    reportView: 'table',
    zoom: null,
    lanes: {},
    eventsOffset: {},
    viewToggles: NO_TOGGLES,
    eventsLayout: 'grid',
    timeline: null,
    events: null,
    details: [],
    detailOrigin: null,
    focusDeath: null,
    comparison: null,
    focusRequest: null,
    settingsOpen: false,
    gameData: null,
    gameDataLoading: false,
    replay: readReplayState(),
    replayData: null,
    replayRequest: 0,
    replayError: null,
  };
}

let reportRequest = 0;
let viewRequest = 0;
/** Changes with every view request that asks for more than another window: a superseded timeline of the same value answers the same query. */
let viewQuery = 0;
/** The view request whose timeline is shown. */
let shownTimelineRequest = 0;
let logRequest = 0;
let fightRequest = 0;
let comparisonRequest = 0;
let replayRequest = 0;
/** The pull a replay load is in flight for; `null` when none. */
let replayLoadingFor: string | null = null;
let replayTicker: ReturnType<typeof setInterval> | null = null;

const replayKey = (logId: string, fight: number) => `${logId}#${fight}`;

function stopReplayTicker() {
  if (replayTicker !== null) clearInterval(replayTicker);
  replayTicker = null;
}

/** The replay's time window: the selected range, else the whole pull. */
function replayWindow(state: Pick<State, 'range' | 'replayData' | 'overview'>): { startMs: number; endMs: number } {
  if (state.range) return state.range;
  const durationMs = state.replayData?.durationMs ?? state.overview?.timeline.durationMs ?? Infinity;
  return { startMs: 0, endMs: durationMs };
}

/** Pauses the clock and makes an in-flight replay load stale; the next pull starts at 0. */
function dropReplay(set: SetState, get: () => State) {
  replayRequest += 1;
  replayLoadingFor = null;
  stopReplayTicker();
  replayClock.pause();
  replayClock.seek(0);
  set({ replayData: null, replayError: null, replayRequest, replay: { ...get().replay, time: 0, playing: false, selected: null, follow: false, filters: { ...get().replay.filters, hidden: [] } } });
}

/** Makes an in-flight pull load stale. */
function dropPendingFight() {
  fightRequest += 1;
}

/** Makes every in-flight report and view request stale and clears the view's pending state. */
function dropPendingReports(set: SetState) {
  reportRequest += 1;
  viewRequest += 1;
  viewQuery += 1;
  set({ viewLoading: false, viewError: null });
}

/** Makes an in-flight comparison stale. */
function dropPendingComparison() {
  comparisonRequest += 1;
}

type ReportInput = Pick<State, 'tab' | 'details' | 'auraKind' | 'filters' | 'scope' | 'grouping' | 'hideProcs'>;

/** The core's fact family of a tab: Buffs & Debuffs follows its toggle. */
const metricOf = (tab: FilterTab, auraKind: AuraKind) => (tab === 'buffs' ? auraKind : SIDES[tab].metric);

/** The tab's report, or the detail page on top of the stack for Damage Done and Healing. */
async function fetchReport(logId: string, fight: number, input: ReportInput, filter: ReportFilter): Promise<ReportData> {
  const { tab, details, auraKind, filters, scope, grouping, hideProcs } = input;
  const top: Detail | undefined = details[details.length - 1];
  const metric: Metric = tab === 'healing' ? 'healing' : 'damage';
  if (tab === 'damage' || tab === 'healing') {
    const page = pageScope(filters, tab);
    if (top?.kind === 'player') return { tab: 'player', data: await api.playerDetail(logId, fight, top.player, metric, filter, page) };
    if (top?.kind === 'ability') return { tab: 'ability', data: await api.abilityDetail(logId, fight, top.player, top.spellId, top.pet, metric, filter, page) };
    if (top?.kind === 'target') return { tab: 'target', data: await api.targetDetail(logId, fight, top.name, filter, page) };
  }
  switch (tab) {
    case 'overview':
      return { tab, data: await api.quickOverview(logId, fight, filter) };
    case 'damage':
      return { tab, data: await api.damageDoneReport(logId, fight, filter) };
    case 'healing':
      return { tab, data: await api.healingReport(logId, fight, filter) };
    case 'taken':
      return { tab, data: await api.damageTakenReport(logId, fight, filter) };
    case 'deaths':
      return { tab, data: await api.deathsReport(logId, fight, filter, scope) };
    case 'casts':
      return { tab, data: await api.castsReport(logId, fight, filter, scope, groupOf(grouping, tab), hideProcs) };
    case 'buffs':
      return { tab, data: await api.aurasReport(logId, fight, filter, scope, auraKind, groupOf(grouping, tab)) };
    case 'interrupts':
      return { tab, data: await api.interruptsReport(logId, fight, filter, scope, groupOf(grouping, tab)) };
    case 'resources':
      return { tab, data: await api.resourcesReport(logId, fight, filter, scope) };
    case 'replay':
      throw new Error('The replay has no report');
  }
}

type ViewData = Pick<State, 'events' | 'timeline'>;

/** A failed request leaves no view data: the last payload belongs to another filter or window. */
const NO_VIEW_DATA: ViewData = { events: null, timeline: null };

/** The window the newest view request asks the timeline for; `null` when it asks for none. */
let pendingTimeline: TimeRange | null = null;
/** The core's widest window that lists log lines, as the last timeline carried it; `null` before any. */
let listedWindowMs: number | null = null;
/** The Events page the last view request named; `undefined` when it read the tab's offset. */
let lastPage: EventsPageRequest | undefined;

/** The shown tab's timeline window or Events page; neither for a table. */
async function fetchView(logId: string, fight: number, state: State, filter: ReportFilter, page?: EventsPageRequest): Promise<ViewData> {
  const { tab, details, reportView, scope, auraKind, lanes, viewToggles, hideProcs, eventsOffset, zoom, range, overview } = state;
  const shown = effectiveView(tab, details.length > 0, reportView);
  pendingTimeline = null;
  if (shown === 'table' || !isFilterTab(tab) || !overview) return { events: null, timeline: null };
  const metric = metricOf(tab, auraKind);
  const options = { ...viewToggles, hideProcs };
  if (shown === 'events') {
    const request = page ?? { kind: 'from', offset: eventsOffset[tab] ?? 0, limit: EVENTS_PAGE_ROWS };
    return { events: await api.events(logId, fight, filter, scope, metric, options, request), timeline: null };
  }
  const whole = rangeWindow(range, overview.timeline.durationMs);
  const window = requestWindow(shownWindow(zoom, whole), whole);
  pendingTimeline = window;
  const timeline = await api.timeline(logId, fight, filter, scope, metric, lanesOf(lanes, tab), options, window);
  listedWindowMs = timeline.listedWindowMs;
  return { events: null, timeline };
}

/** How much of the timeline's shown window `timeline` holds, in ms. */
function shownMs(timeline: Timeline | null, state: State): number {
  if (!timeline || !state.overview) return 0;
  const shown = shownWindow(state.zoom, rangeWindow(state.range, state.overview.timeline.durationMs));
  return Math.max(0, Math.min(timeline.endMs, shown.endMs) - Math.max(timeline.startMs, shown.startMs));
}

/**
 * Loads only the view payload; only the newest request may write it, except that a superseded timeline of the same query
 * (`windowOnly`: only the window moved) is shown while it holds more of the shown window than the timeline on screen and is newer.
 * A page at a time sets the tab's offset.
 */
async function loadView(get: () => State & Actions, set: SetState, page?: EventsPageRequest, windowOnly = false) {
  const { log, view } = get();
  if (!log || view.kind !== 'fight') return;
  const request = ++viewRequest;
  if (!windowOnly) viewQuery += 1;
  const query = viewQuery;
  lastPage = page;
  set({ viewLoading: true, viewError: null });
  try {
    const next = await fetchView(log.id, view.fightIndex, get(), reportFilter(get()), page);
    if (request !== viewRequest) {
      const better = next.timeline && query === viewQuery && request > shownTimelineRequest && shownMs(next.timeline, get()) > shownMs(get().timeline, get());
      if (better) {
        shownTimelineRequest = request;
        set({ timeline: next.timeline });
      }
      return;
    }
    shownTimelineRequest = request;
    const { tab, eventsOffset } = get();
    set({ ...next, viewLoading: false, ...(next.events && isFilterTab(tab) ? { eventsOffset: { ...eventsOffset, [tab]: next.events.offset } } : {}) });
  } catch (err) {
    if (request === viewRequest) {
      shownTimelineRequest = request;
      set({ ...NO_VIEW_DATA, viewError: String(err), viewLoading: false });
    }
  }
}

/** Loads the report of the current tab; only the newest request may write the result. */
async function loadReport(get: () => State & Actions, set: SetState) {
  const { log, view, tab, range, details, scope, grouping } = get();
  if (!log || view.kind !== 'fight') return;
  const request = ++reportRequest;
  const viewToken = ++viewRequest;
  viewQuery += 1;
  lastPage = undefined;
  if ((tab === 'overview' && range === null) || tab === 'replay') {
    // The whole-pull overview is already in `state.overview`; the replay bundle loads through `loadReplay`.
    set({ report: null, breakdown: null, reportError: null, reportLoading: false, viewError: null, viewLoading: false });
    return;
  }
  const filter = reportFilter(get());
  set({ reportLoading: true, reportError: null, viewError: null, viewLoading: true, rangeKpis: null });
  try {
    // Resources' header shows the Overview's figures; a failure only leaves it at "…".
    const rangeKpis =
      tab === 'resources' && range !== null ? api.quickOverview(log.id, view.fightIndex, filter).then((o) => o.kpis, () => null) : null;
    const metricTab = isMetricTab(tab) && details.length === 0 ? tab : null;
    const [tableResult, viewData] = await Promise.all([
      Promise.all([
        fetchReport(log.id, view.fightIndex, get(), filter),
        metricTab ? api.breakdownReport(log.id, view.fightIndex, filter, scope, SIDES[metricTab].metric, groupOf(grouping, metricTab)) : Promise.resolve(null),
      ]).then(
        (data) => ({ data }),
        (err: unknown) => ({ err }),
      ),
      fetchView(log.id, view.fightIndex, get(), filter).then(
        (data) => ({ data }),
        (err: unknown) => ({ error: String(err) }),
      ),
    ]);
    if (request === reportRequest && viewToken === viewRequest) {
      shownTimelineRequest = viewToken;
      set('data' in viewData ? { ...viewData.data, viewLoading: false } : { ...NO_VIEW_DATA, viewError: viewData.error, viewLoading: false });
    }
    if ('err' in tableResult) throw tableResult.err;
    const [report, breakdown] = tableResult.data;
    if (request === reportRequest) {
      // Pin the enemy that the empty "Enemies" entry resolved to, so range changes keep it.
      const shown = get().details;
      const last = shown[shown.length - 1];
      if (report.tab === 'target' && last?.kind === 'target' && last.name === '') {
        set({ report, breakdown, details: [...shown.slice(0, -1), { kind: 'target', name: report.data.name }] });
      } else if (report.tab === 'ability' && last?.kind === 'ability' && last.spellId === report.data.spellId && last.spellName !== report.data.spellName) {
        // Pin the ability's name: the pull overview knows only its own spells.
        set({ report, breakdown, details: [...shown.slice(0, -1), { ...last, spellName: report.data.spellName }] });
      } else {
        set({ report, breakdown });
      }
    }
    const kpis = await rangeKpis;
    if (kpis && request === reportRequest) set({ rangeKpis: kpis });
  } catch (err) {
    // A page that failed has no heading to focus; a later load must not inherit the request.
    if (request === reportRequest) set({ reportError: String(err), breakdown: null, focusRequest: null });
  } finally {
    if (request === reportRequest) set({ reportLoading: false });
    if (viewToken === viewRequest) set({ viewLoading: false });
  }
}

/** The open pull's whole-pull overview, which the brush timeline draws; only the pull it was asked for may write. */
async function reloadOverview(get: () => State & Actions, set: SetState) {
  const { log, view } = get();
  if (!log || view.kind !== 'fight') return;
  const request = fightRequest;
  try {
    const overview = await api.quickOverview(log.id, view.fightIndex, reportFilter({ ...get(), range: null }));
    if (request === fightRequest) set({ overview });
  } catch (err) {
    if (request === fightRequest) set({ error: t('error.loadFailed', { reason: String(err) }) });
  }
}

/** Loads the open comparison in the current Aug mode; only the newest request may write. */
async function loadComparison(get: () => State & Actions, set: SetState) {
  const { log, comparison, attribution, includeOverkill } = get();
  if (!log || !comparison) return;
  const request = ++comparisonRequest;
  // The shown comparison stays until the new Aug mode is calculated.
  set({ comparison: { ...comparison, loading: true, error: null } });
  const update = (partial: Partial<ComparisonState>) => {
    const current = get().comparison;
    if (request === comparisonRequest && current) set({ comparison: { ...current, ...partial } });
  };
  try {
    update({ data: await api.comparePulls(log.id, comparison.a, comparison.b, attribution, includeOverkill) });
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

// Many actions move the tab; deriving the scope on every write, the store's setState included, keeps it from going stale.
function derivingScope(actions: (set: SetState, get: () => Store) => Store): StateCreator<Store> {
  return (_set, get, store) => {
    const setState = store.setState;
    store.setState = ((partial: Partial<Store> | ((state: Store) => Partial<Store>), replace?: boolean) =>
      setState((state) => {
        const next = { ...(replace ? {} : state), ...(typeof partial === 'function' ? partial(state) : partial) } as Store;
        return { ...next, scope: derivedScope(next) };
      }, true)) as typeof store.setState;
    return actions((partial) => store.setState(partial), get);
  };
}

export const useApp = create<Store>()(derivingScope((set, get) => ({
  ...initialState(),

  async refreshRecent() {
    try {
      set({ recent: await api.recentLogs() });
    } catch {
      // Without a browser database (private windows, tests) there is no recent list.
    }
  },

  async openLog(chosen) {
    const request = ++logRequest;
    const file = chosen.name;
    set({ opening: { file, bytesRead: 0, totalBytes: null }, error: null });
    let replacing = false;
    const show = (log: LogView | null) => {
      dropPendingFight();
      dropPendingReports(set);
      dropPendingComparison();
      dropReplay(set, get);
      set({ log, view: { kind: 'start' }, overview: null, reportLoading: false, fightLoading: false, fightError: null, comparison: null });
    };
    try {
      const source = await chosen.open();
      replacing = true;
      const log = await api.openLog(source, (bytesRead, totalBytes) => {
        if (request === logRequest) set({ opening: { file, bytesRead, totalBytes } });
      });
      if (request === logRequest) show(log);
    } catch (err) {
      if (request !== logRequest) return;
      // Once reading started, the engine no longer holds the log on screen.
      if (replacing) show(null);
      set({ error: t('error.openFailed', { file, reason: String(err) }) });
    } finally {
      if (request === logRequest) set({ opening: null });
      await get().refreshRecent();
    }
  },

  async openRecent(entry) {
    await get().openLog({ name: entry.fileName, open: () => api.reopenRecent(entry.id) });
  },

  async removeRecent(entry) {
    try {
      await api.removeRecent(entry.id);
    } catch (err) {
      set({ error: t('error.removeFailed', { file: entry.fileName, reason: String(err) }) });
    }
    await get().refreshRecent();
  },

  setHideAborted(hide) {
    writeFlag(HIDE_ABORTED_KEY, hide);
    set({ hideAborted: hide });
  },

  async setPerspective(perspective) {
    const { filters } = get();
    if (filters.perspective === perspective) return;
    set({ filters: { perspective, own: filters.other, other: filters.own, ability: [] }, eventsOffset: {}, focusRequest: null });
    await loadReport(get, set);
  },
  async select(dimension, value) {
    const { filters, tab } = get();
    set({ filters: { ...filters, [roleOf(dimension, tab)]: value === null ? [] : [value] } as Filters, eventsOffset: {}, focusRequest: null });
    await loadReport(get, set);
  },
  async showOnly(dimension, row) {
    const { filters, tab } = get();
    const pets = row.pets.length > 0 ? { [roleOf('source', tab)]: row.pets } : {};
    set({ filters: { ...filters, [roleOf(dimension, tab)]: [rowValue(row.key)], ...pets } as Filters, eventsOffset: {}, focusRequest: null });
    await loadReport(get, set);
  },
  async clearFilters() {
    set({ filters: { ...EMPTY_FILTERS, perspective: get().filters.perspective }, eventsOffset: {}, focusRequest: null });
    await loadReport(get, set);
  },
  async clearPageFilter(dimensions) {
    const { filters, tab } = get();
    const cleared = Object.fromEntries(dimensions.map((d) => [roleOf(viewDimension(d, filters.perspective), tab), []]));
    set({ filters: { ...filters, ...cleared }, eventsOffset: {}, focusRequest: null });
    await loadReport(get, set);
  },
  async setGrouping(dimension) {
    const { tab } = get();
    if (!isFilterTab(tab) || SIDES[tab].rows.length < 2 || groupOf(get().grouping, tab) === dimension) return;
    set({ grouping: { ...get().grouping, [tab]: dimension } });
    await loadReport(get, set);
  },
  async filterOptions(dimension) {
    const { log, view, tab, scope } = get();
    if (!log || view.kind !== 'fight' || !isFilterTab(tab)) return [];
    return api.filterOptions(log.id, view.fightIndex, reportFilter(get()), scope, metricOf(tab, get().auraKind), dimension);
  },

  async openFight(fightIndex) {
    const log = get().log;
    if (!log) return;
    const request = ++fightRequest;
    dropPendingReports(set);
    dropPendingComparison();
    dropReplay(set, get);
    set({
      view: { kind: 'fight', fightIndex },
      overview: null,
      fightLoading: true,
      fightError: null,
      error: null,
      tab: 'overview',
      range: null,
      filters: EMPTY_FILTERS,
      breakdown: null,
      report: null,
      reportError: null,
      reportLoading: false,
      rangeKpis: null,
      details: [],
      detailOrigin: null,
      focusDeath: null,
      comparison: null,
      focusRequest: 'fight',
      castsRow: null,
      castsSort: DEFAULT_CASTS_SORT,
      reportView: 'table',
      zoom: null,
      eventsOffset: {},
      events: null,
      timeline: null,
    });
    try {
      const overview = await api.quickOverview(log.id, fightIndex, reportFilter(get()));
      if (request === fightRequest) set({ overview });
    } catch (err) {
      if (request === fightRequest) set({ error: t('error.loadFailed', { reason: String(err) }), fightError: String(err) });
    } finally {
      if (request === fightRequest) set({ fightLoading: false });
    }
  },

  backToPulls() {
    dropPendingFight();
    dropPendingReports(set);
    dropPendingComparison();
    dropReplay(set, get);
    set({
      view: { kind: 'start' },
      overview: null,
      fightLoading: false,
      fightError: null,
      tab: 'overview',
      range: null,
      report: null, breakdown: null,
      rangeKpis: null,
      reportError: null,
      reportLoading: false,
      details: [],
      detailOrigin: null,
      focusDeath: null,
      comparison: null,
      focusRequest: 'start',
      castsRow: null,
      castsSort: DEFAULT_CASTS_SORT,
      reportView: 'table',
      zoom: null,
      eventsOffset: {},
      events: null,
      timeline: null,
    });
  },

  dismissError() {
    set({ error: null });
  },

  showError(message) {
    set({ error: message });
  },

  async setTab(chosen, focus = null) {
    const { details, tab: current } = get();
    const tab = chosen === 'replay' && !replayOffered(get()) ? 'overview' : chosen;
    const keep = tab === 'damage' || tab === 'healing';
    const top = details[details.length - 1];
    // An ability page belongs to one metric; switching the metric shows its player instead.
    const kept = !keep ? [] : top?.kind === 'ability' && tab !== current ? details.slice(0, -1) : details;
    set({ tab, report: null, breakdown: null, events: null, timeline: null, reportError: null, details: kept, focusDeath: null, detailOrigin: null, focusRequest: focus });
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
      report: null, breakdown: null,
      reportError: null,
      focusRequest: 'page',
    });
    await loadReport(get, set);
  },

  async openAbility(spellId, pet) {
    const details = get().details;
    const top = details[details.length - 1];
    if (top?.kind !== 'player') return;
    set({ details: [...details, { kind: 'ability', player: top.player, spellId, pet }], report: null, breakdown: null, reportError: null, focusRequest: 'page' });
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
      report: null, breakdown: null,
      reportError: null,
      focusRequest: 'page',
    });
    await loadReport(get, set);
  },

  async openDeathRecap(player, t) {
    // A navigation to one death: show that player's deaths, whatever the page was filtered to.
    const filters: Filters = { perspective: 'friendly', own: [{ kind: 'player', actorId: player }], other: [], ability: [] };
    set({ tab: 'deaths', filters, details: [], detailOrigin: null, focusDeath: { player, t }, report: null, breakdown: null, reportError: null, focusRequest: 'page' });
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
      set({ tab, details: [...details, ability], report: null, breakdown: null, reportError: null, focusRequest: 'page' });
    } else {
      set({
        tab,
        details: [{ kind: 'player', player }, ability],
        detailOrigin: originFor(get()),
        report: null, breakdown: null,
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
      report: null, breakdown: null,
      reportError: null,
      focusRequest: rest.length > 0 ? 'page' : 'tab',
    });
    await loadReport(get, set);
  },

  async showDetailAt(depth) {
    const { details } = get();
    // Only a lower page: the top one is already shown.
    if (depth < 0 || depth >= details.length - 1) return;
    set({ details: details.slice(0, depth + 1), report: null, breakdown: null, reportError: null, focusRequest: 'page' });
    await loadReport(get, set);
  },

  async closeDetail() {
    const { detailOrigin, tab } = get();
    set({ details: [], tab: detailOrigin ?? tab, detailOrigin: null, report: null, breakdown: null, reportError: null, focusRequest: 'tab' });
    await loadReport(get, set);
  },

  consumeFocus() {
    set({ focusRequest: null });
  },

  async openComparison(other) {
    const { view, attribution, includeOverkill } = get();
    if (view.kind !== 'fight' || other === view.fightIndex) return;
    const [a, b] = other < view.fightIndex ? [other, view.fightIndex] : [view.fightIndex, other];
    set({
      comparison: { a, b, data: null, loading: true, error: null, reportAttribution: attribution, reportIncludeOverkill: includeOverkill },
      focusRequest: 'compare',
    });
    await loadComparison(get, set);
  },

  async closeComparison() {
    const comparison = get().comparison;
    if (!comparison) return;
    dropPendingComparison();
    set({ comparison: null, focusRequest: 'fight' });
    const { attribution, includeOverkill } = get();
    if (comparison.reportAttribution !== attribution || comparison.reportIncludeOverkill !== includeOverkill) await loadReport(get, set);
  },

  async setAttribution(attribution) {
    // Filter changes never move focus; drop a request that no heading has taken (also in setRange and setAuraKind).
    set({ attribution, eventsOffset: {}, focusRequest: null });
    // The Aug toggle on the comparison recalculates the comparison; Back recalculates the pull.
    if (get().comparison) await loadComparison(get, set);
    else await loadReport(get, set);
  },

  async setIncludeOverkill(include) {
    writeFlag(INCLUDE_OVERKILL_KEY, include);
    set({ includeOverkill: include, eventsOffset: {}, focusRequest: null });
    await reloadOverview(get, set);
    if (get().comparison) await loadComparison(get, set);
    else await loadReport(get, set);
  },

  async setRange(range) {
    const { zoom, overview } = get();
    const inside = zoom !== null && overview !== null && covers(rangeWindow(range, overview.timeline.durationMs), zoom);
    set({ range, zoom: inside ? zoom : null, eventsOffset: {}, focusRequest: null });
    await loadReport(get, set);
  },

  async setAuraKind(kind) {
    // Keep the shown report while the other kind loads, so the tab keeps its filter and focus.
    set({ auraKind: kind, eventsOffset: {}, focusRequest: null });
    await loadReport(get, set);
  },

  async setHideProcs(hide) {
    writeFlag(HIDE_PROCS_KEY, hide);
    set({ hideProcs: hide, eventsOffset: {} });
    if (get().tab === 'casts') await loadReport(get, set);
  },

  async setReportView(reportView) {
    if (get().reportView === reportView) return;
    set({ reportView, focusRequest: null });
    await loadView(get, set);
  },

  setZoom(zoom) {
    const current = get().zoom;
    if (zoom && current && sameWindow(zoom, current)) return;
    set({ zoom });
  },

  async refreshTimeline() {
    const { timeline, zoom, range, overview, viewLoading } = get();
    if (!overview) return;
    const whole = rangeWindow(range, overview.timeline.durationMs);
    const shown = shownWindow(zoom, whole);
    // A wide window lists no log lines; zooming in asks again once the request is narrow enough to list them.
    const limit = timeline?.listedWindowMs ?? listedWindowMs;
    const lists = (span: number) => limit === null || span <= limit;
    const serves = (loaded: TimeRange, linesListed: boolean) => covers(loaded, shown) && (linesListed || !lists(windowSpan(requestWindow(shown, whole))));
    // While a request is out, only its window counts: the loaded timeline is about to be replaced.
    if (viewLoading) {
      if (pendingTimeline && serves(pendingTimeline, lists(windowSpan(pendingTimeline)))) return;
    } else if (timeline && serves({ startMs: timeline.startMs, endMs: timeline.endMs }, timeline.linesListed)) {
      return;
    }
    await loadView(get, set, undefined, true);
  },

  async setLanes(dimension) {
    const { tab, lanes } = get();
    if (!isFilterTab(tab) || lanesOf(lanes, tab) === dimension) return;
    set({ lanes: { ...lanes, [tab]: dimension } });
    await loadView(get, set);
  },

  async setViewToggle(toggle, on) {
    set({ viewToggles: { ...get().viewToggles, [toggle]: on }, eventsOffset: {} });
    await loadView(get, set);
  },

  setEventsLayout(eventsLayout) {
    set({ eventsLayout });
  },

  async showEventsPage(offset) {
    const { tab, eventsOffset } = get();
    if (!isFilterTab(tab)) return;
    set({ eventsOffset: { ...eventsOffset, [tab]: offset } });
    await loadView(get, set);
  },

  async showEventsAt(t) {
    set({ reportView: 'events', focusRequest: null });
    await loadView(get, set, { kind: 'at', t, limit: EVENTS_PAGE_ROWS });
  },

  async retryView() {
    await loadView(get, set, lastPage);
  },

  setTheme(theme) {
    storeTheme(theme);
    set({ theme });
  },

  setThemeMode(mode) {
    storeThemeMode(mode);
    set({ themeMode: mode });
  },

  setUiSize(percent) {
    const uiSize = normalizeUiSize(percent);
    storeUiSize(uiSize);
    set({ uiSize });
  },

  selectCastsRow(key) {
    set({ castsRow: key });
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
    set({ gameData: await gameDataManifest(), gameDataLoading: false });
  },

  async loadReplay() {
    const { log, view, replayData } = get();
    if (!log || view.kind !== 'fight' || replayData) return;
    const key = replayKey(log.id, view.fightIndex);
    if (replayLoadingFor === key) return;
    replayLoadingFor = key;
    const request = replayRequest;
    set({ replayError: null });
    try {
      const data = await api.replay(log.id, view.fightIndex);
      if (request === replayRequest) set({ replayData: data });
    } catch (err) {
      if (request === replayRequest) set({ replayError: String(err) });
    } finally {
      if (request === replayRequest) replayLoadingFor = null;
    }
  },

  setReplayTime(ms) {
    const { startMs, endMs } = replayWindow(get());
    const time = Math.min(Math.max(ms, startMs), endMs);
    replayClock.seek(time);
    set({ replay: { ...get().replay, time } });
  },

  toggleReplayPlay() {
    const { replay } = get();
    if (replay.playing) {
      stopReplayTicker();
      replayClock.pause();
      set({ replay: { ...replay, playing: false, time: replayClock.now() } });
      return;
    }
    const { startMs, endMs } = replayWindow(get());
    if (replay.time >= endMs || replay.time < startMs) replayClock.seek(startMs);
    replayClock.setSpeed(replay.speed);
    replayClock.play();
    set({ replay: { ...replay, playing: true, time: replayClock.now() } });
    stopReplayTicker();
    replayTicker = setInterval(() => {
      const end = replayWindow(get()).endMs;
      const now = replayClock.now();
      if (now >= end) {
        stopReplayTicker();
        replayClock.pause();
        replayClock.seek(end);
        set({ replay: { ...get().replay, playing: false, time: end } });
      } else {
        set({ replay: { ...get().replay, time: now } });
      }
    }, REPLAY_TICK_MS);
  },

  setReplaySpeed(speed) {
    replayClock.setSpeed(speed);
    const replay = { ...get().replay, speed };
    set({ replay });
    writeReplayState(replay);
  },

  selectReplayUnit(id) {
    set({ replay: { ...get().replay, selected: id } });
  },

  setReplayLayer(layer, on) {
    const replay = { ...get().replay, layers: { ...get().replay.layers, [layer]: on } };
    set({ replay });
    writeReplayState(replay);
  },

  setReplayFilter(filters) {
    const replay = { ...get().replay, filters: { ...get().replay.filters, ...filters } };
    set({ replay });
    writeReplayState(replay);
  },

  setReplaySplit(on) {
    const replay = { ...get().replay, split: on };
    set({ replay });
    writeReplayState(replay);
  },

  setReplaySplitWidth(splitWidth) {
    const replay = { ...get().replay, splitWidth };
    set({ replay });
    writeReplayState(replay);
  },

  setReplayRangeOpen(rangeOpen) {
    const replay = { ...get().replay, rangeOpen };
    set({ replay });
    writeReplayState(replay);
  },

  setReplayAllAuras(allAuras) {
    const replay = { ...get().replay, allAuras };
    set({ replay });
    writeReplayState(replay);
  },

  setReplayMeter(meter) {
    const replay = { ...get().replay, meter: { ...get().replay.meter, ...meter } };
    set({ replay });
    writeReplayState(replay);
  },

  setReplayFollow(follow) {
    set({ replay: { ...get().replay, follow } });
  },

  openReplayAt(ms) {
    if (!replayOffered(get())) return;
    if (!replaySplitShown(get())) {
      void get().setTab('replay');
      void get().loadReplay();
    }
    get().setReplayTime(ms);
  },
})));
