import { type Engine, workerEngine } from '../engine/engine';
import { dungeonsJson } from '../gameData';
import { browserDatabase, type Database } from './db';
import { type LogSource, reopenHandle } from './logSource';
import { type RecentRecord, recentRecords, rememberLog } from './recent';
import type {
  Attribution,
  AuraKind,
  AurasReport,
  InterruptsReport,
  ResourcesReport,
  CastsReport,
  DeathsReport,
  AbilityDetail,
  Breakdown,
  Dimension,
  FilterOption,
  Scope,
  ScopeMetric,
  DamageReport,
  DamageTakenReport,
  HealingReport,
  LogView,
  Metric,
  PlayerDetail,
  PullComparison,
  QuickOverview,
  RecentLog,
  TargetDetail,
  ReportFilter,
  EventsPage,
  EventsPageRequest,
  Timeline,
  ViewOptions,
} from './types';

const CHUNK_BYTES = 8 << 20;
/** Logs whose index is kept, so they open again without being read. */
const MAX_STORED_INDEXES = 20;

interface StoredIndex {
  key: string;
  json: string;
}

/** When a stored index was last used; kept apart so choosing what to evict reads no index. */
interface IndexUse {
  key: string;
  usedAtUnixMs: number;
}

export interface ClientDeps {
  engine: () => Engine;
  dungeons: () => Promise<string | null>;
  db: Database;
  now: () => number;
}

/** Losing the cache or the recent list must not fail opening a log. */
async function quietly<T>(task: () => Promise<T>): Promise<T | undefined> {
  try {
    return await task();
  } catch {
    return undefined;
  }
}

export function createClient({ engine: getEngine, dungeons, db, now }: ClientDeps) {
  let current: { source: LogSource; engineRestarts: number } | null = null;
  let dungeonsLoaded = false;
  let latestOpen = 0;
  let queue: Promise<unknown> = Promise.resolve();

  /** One engine operation at a time: a report must not load pulls while another log opens. */
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  const useIndex = (key: string) => db.put('indexes-used', { key, usedAtUnixMs: now() } satisfies IndexUse);

  /** Evicts first, so a full quota does not keep the newest index out. */
  async function storeIndex(key: string, json: string) {
    const uses = await db.all<IndexUse>('indexes-used');
    uses.sort((a, b) => b.usedAtUnixMs - a.usedAtUnixMs);
    for (const stale of uses.slice(MAX_STORED_INDEXES - 1)) {
      await db.delete('indexes', stale.key);
      await db.delete('indexes-used', stale.key);
    }
    await db.put('indexes', { key, json } satisfies StoredIndex);
    await useIndex(key);
  }

  async function loadDungeons(engine: Engine) {
    if (dungeonsLoaded) return;
    // Without the dungeon table, runs still open; their results come from the log alone.
    const json = await dungeons().catch(() => null);
    if (json === null) return;
    await engine.setDungeons(json);
    dungeonsLoaded = true;
  }

  async function index(
    source: LogSource,
    onProgress: (bytesRead: number, totalBytes: number) => void,
    superseded: () => boolean,
  ): Promise<LogView> {
    const engine = getEngine();
    await loadDungeons(engine);
    const key = `${source.id}|${source.size}|${source.lastModified}|${await engine.indexFormatVersion()}`;
    const stored = await quietly(() => db.get<StoredIndex>('indexes', key));
    if (stored) {
      const view = await quietly(() => engine.restoreIndex(stored.json, source.id, source.name, source.size));
      if (view) {
        await quietly(() => useIndex(key));
        return view;
      }
    }
    await engine.beginIndex();
    let feeding: Promise<void> = Promise.resolve();
    for (let offset = 0; offset < source.size; offset += CHUNK_BYTES) {
      if (superseded()) throw 'Another log is being opened.';
      const bytes = await source.read(offset, Math.min(CHUNK_BYTES, source.size - offset));
      await feeding;
      onProgress(offset + bytes.length, source.size);
      feeding = engine.feed(bytes);
    }
    await feeding;
    const view = await engine.finishIndex(source.id, source.name, source.size);
    const json = await engine.indexJson();
    await quietly(() => storeIndex(key, json));
    return view;
  }

  /** Runs `command` once the pulls it needs are loaded from the open log. */
  function report<T>(logId: string, fights: number[], command: string, args: object): Promise<T> {
    return serial(async () => {
      const engine = getEngine();
      if (current && current.engineRestarts !== engine.restarts()) current = null;
      if (current?.source.id !== logId) throw 'This log is no longer open. Open it again.';
      const source = current.source;
      try {
        for (const fight of fights) {
          if (await engine.touchFight(fight)) continue;
          const [start, end] = await engine.fightRange(fight);
          const bytes = await source.read(start, Math.max(0, Math.min(end, source.size) - start));
          await engine.loadFight(bytes, start, fight);
        }
        return await engine.call<T>(command, args);
      } finally {
        if (current && current.engineRestarts !== engine.restarts()) current = null;
      }
    });
  }

  const pull =
    <T>(command: string) =>
    (logId: string, fightIndex: number, filter: ReportFilter) =>
      report<T>(logId, [fightIndex], command, { fightIndex, filter });

  return {
    /** A later call supersedes an open that is still reading; it fails without reading on. */
    openLog: (source: LogSource, onProgress: (bytesRead: number, totalBytes: number) => void = () => {}) => {
      const open = ++latestOpen;
      return serial(async () => {
        current = null;
        const view = await index(source, onProgress, () => open !== latestOpen);
        current = { source, engineRestarts: getEngine().restarts() };
        // Only real combat logs are remembered.
        if (view.logVersion !== null) await quietly(() => rememberLog(db, source, view, now()));
        return view;
      });
    },
    recentLogs: async (): Promise<RecentLog[]> =>
      (await recentRecords(db)).map((record) => ({
        id: record.id,
        fileName: record.fileName,
        sizeBytes: record.sizeBytes,
        zone: record.zone,
        startUnixMs: record.startUnixMs,
        pullCount: record.pullCount,
        openedAtUnixMs: record.openedAtUnixMs,
        exists: record.handle !== undefined,
      })),
    reopenRecent: async (id: string): Promise<LogSource> => {
      const record = await db.get<RecentRecord>('recent', id);
      if (!record) throw 'This log is no longer in the recent list.';
      return reopenHandle(record.handle);
    },
    removeRecent: (id: string) => db.delete('recent', id),
    quickOverview: (logId: string, fightIndex: number, filter: ReportFilter | null) =>
      report<QuickOverview>(logId, [fightIndex], 'quick_overview', { fightIndex, filter }),
    damageDoneReport: pull<DamageReport>('damage_done_report'),
    healingReport: pull<HealingReport>('healing_report'),
    damageTakenReport: pull<DamageTakenReport>('damage_taken_report'),
    playerDetail: (logId: string, fightIndex: number, player: number, metric: Metric, filter: ReportFilter, scope: Scope) =>
      report<PlayerDetail>(logId, [fightIndex], 'player_detail', { fightIndex, player, metric, filter, scope }),
    abilityDetail: (logId: string, fightIndex: number, player: number, spell: number, pet: string | null, metric: Metric, filter: ReportFilter, scope: Scope) =>
      report<AbilityDetail>(logId, [fightIndex], 'ability_detail', { fightIndex, player, spell, pet, metric, filter, scope }),
    targetDetail: (logId: string, fightIndex: number, name: string, filter: ReportFilter, scope: Scope) =>
      report<TargetDetail>(logId, [fightIndex], 'target_detail', { fightIndex, name, filter, scope }),
    deathsReport: (logId: string, fightIndex: number, filter: ReportFilter, scope: Scope) =>
      report<DeathsReport>(logId, [fightIndex], 'deaths_report', { fightIndex, filter, scope }),
    castsReport: (logId: string, fightIndex: number, filter: ReportFilter, scope: Scope, group: Dimension, hideProcs: boolean) =>
      report<CastsReport>(logId, [fightIndex], 'casts_report', { fightIndex, filter, scope, group, hideProcs }),
    aurasReport: (logId: string, fightIndex: number, filter: ReportFilter, scope: Scope, kind: AuraKind, group: Dimension) =>
      report<AurasReport>(logId, [fightIndex], 'auras_report', { fightIndex, filter, scope, kind, group }),
    breakdownReport: (logId: string, fightIndex: number, filter: ReportFilter, scope: Scope, metric: ScopeMetric, group: Dimension) =>
      report<Breakdown>(logId, [fightIndex], 'breakdown_report', { fightIndex, filter, scope, metric, group }),
    filterOptions: (logId: string, fightIndex: number, filter: ReportFilter, scope: Scope, metric: ScopeMetric, dimension: Dimension) =>
      report<FilterOption[]>(logId, [fightIndex], 'filter_options', { fightIndex, filter, scope, metric, dimension }),
    interruptsReport: (logId: string, fightIndex: number, filter: ReportFilter, scope: Scope, group: Dimension) =>
      report<InterruptsReport>(logId, [fightIndex], 'interrupts_report', { fightIndex, filter, scope, group }),
    resourcesReport: (logId: string, fightIndex: number, filter: ReportFilter, scope: Scope) =>
      report<ResourcesReport>(logId, [fightIndex], 'resources_report', { fightIndex, filter, scope }),
    events: (logId: string, fightIndex: number, filter: ReportFilter, scope: Scope, metric: ScopeMetric, options: ViewOptions, page: EventsPageRequest) =>
      report<EventsPage>(logId, [fightIndex], 'events', { fightIndex, filter, scope, metric, options, page }),
    timeline: (logId: string, fightIndex: number, filter: ReportFilter, scope: Scope, metric: ScopeMetric, lanes: Dimension, options: ViewOptions, window: { startMs: number; endMs: number }) =>
      report<Timeline>(logId, [fightIndex], 'timeline', { fightIndex, filter, scope, metric, lanes, options, window }),
    comparePulls: (logId: string, fightA: number, fightB: number, attribution: Attribution) =>
      report<PullComparison>(logId, [fightA, fightB], 'compare_pulls', { fightA, fightB, attribution }),
  };
}

let sharedEngine: Engine | null = null;

export const api = createClient({
  engine: () => (sharedEngine ??= workerEngine()),
  dungeons: dungeonsJson,
  db: browserDatabase,
  now: Date.now,
});
