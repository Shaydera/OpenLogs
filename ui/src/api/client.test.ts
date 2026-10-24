import { describe, expect, it, vi } from 'vitest';
import type { Engine } from '../engine/engine';
import { createClient, SetCancelled } from './client';
import type { Database, StoreName } from './db';
import type { LogSource } from './logSource';
import type { LogView } from './types';

const MiB = 1 << 20;

/** IndexedDB clones what it stores; a file handle survives that in the browser, but not `structuredClone` here. */
function cloneLikeIndexedDb(value: object): object {
  const { handle, ...rest } = value as { handle?: unknown };
  return handle === undefined ? structuredClone(rest) : { ...structuredClone(rest), handle };
}

function memoryDatabase(): Database {
  const stores: Record<StoreName, Map<string, object>> = { indexes: new Map(), 'indexes-used': new Map(), recent: new Map() };
  const keyOf = (store: StoreName, value: object) => (value as Record<string, string>)[store === 'recent' ? 'id' : 'key'];
  return {
    get: async <T>(store: StoreName, key: string) => stores[store].get(key) as T | undefined,
    put: async (store, value) => void stores[store].set(keyOf(store, value), cloneLikeIndexedDb(value)),
    delete: async (store, key) => void stores[store].delete(key),
    all: async <T>(store: StoreName) => [...stores[store].values()] as T[],
  };
}

function view(id: string, logVersion: number | null = 22): LogView {
  return {
    id,
    fileName: id,
    sizeBytes: 0,
    cacheHit: false,
    logVersion,
    build: null,
    advancedLogging: true,
    brokenLines: 0,
    warnings: [],
    zone: 'The Venomous Abyss',
    startUnixMs: null,
    fights: [],
  };
}

/** Records what reaches the engine; pulls 1–3 span bytes 100–200, 200–300 and 300–400. */
function fakeEngine() {
  const loaded: number[] = [];
  const fed: number[] = [];
  const setFeeds: number[] = [];
  const state = { restarts: 0, beginIndexCalls: 0 };
  const engine: Engine = {
    indexFormatVersion: async () => 5,
    setDungeons: async () => {},
    setChannelSpells: async () => {},
    setSpellClasses: async () => {},
    beginIndex: async () => {
      state.beginIndexCalls += 1;
      fed.splice(0);
    },
    feed: async (bytes) => void fed.push(bytes.length),
    finishIndex: async (logId) => view(logId),
    indexJson: async () => '{"fights":[]}',
    restoreIndex: async (_, logId) => ({ ...view(logId), cacheHit: true }),
    refreshIndex: async (logId) => view(logId),
    snapshotJson: async () => '{"fights":[]}',
    fightRange: async (fight) => [fight * 100, fight * 100 + 100],
    touchFight: async (fight) => loaded.includes(fight),
    loadFight: async (_, __, fight) => void loaded.push(fight),
    setBegin: async () => void setFeeds.splice(0),
    setFeed: async (_, __, fight) => void setFeeds.push(fight),
    setFinish: async () => JSON.stringify([{ pulls: setFeeds.length }]),
    call: async <T>(command: string, args: object) => ({ command, args }) as T,
    restarts: () => state.restarts,
  };
  return { engine, loaded, fed, setFeeds, state };
}

function source(id: string, size: number, lastModified = 1): LogSource & { read: ReturnType<typeof vi.fn> } {
  return { id, name: id, size, lastModified, read: vi.fn(async (_: number, length: number) => new Uint8Array(length)) };
}

/** A log on disk that `grow` appends to; `refresh` picks the growth up like a fresh handle read. */
function growable(id: string, size: number, lastModified = 1) {
  let onDisk = size;
  const log: LogSource & { grow(to: number): void } = {
    ...source(id, size, lastModified),
    grow: (to) => void (onDisk = to),
    refresh: async () => {
      const grew = onDisk > log.size;
      log.size = onDisk;
      log.lastModified += 1;
      return grew;
    },
  };
  return log;
}

/** A remembered file; `permission` is what the browser grants without asking. */
function fileHandle(permission: PermissionState = 'granted') {
  const file = { gone: false, permission };
  const handle = {
    queryPermission: async () => file.permission,
    requestPermission: async () => 'granted',
    getFile: async () => {
      if (file.gone) throw new DOMException('The file could not be found.', 'NotFoundError');
      return new File(['log'], 'log.txt');
    },
  } as unknown as FileSystemFileHandle;
  return { handle, file };
}

function client() {
  const fake = fakeEngine();
  let clock = 0;
  const api = createClient({
    engine: () => fake.engine,
    dungeons: async () => null,
    channelSpells: async () => null,
    spellClasses: async () => null,
    db: memoryDatabase(),
    now: () => ++clock,
  });
  return { api, ...fake };
}

describe('opening logs', () => {
  it('indexes a log in chunks once and reopens it from the stored index until the file changes', async () => {
    const { api, fed } = client();
    const progress: number[] = [];
    const log = source('WoWCombatLog-100726_185823.txt', 20 * MiB);

    const first = await api.openLog(log, (bytesRead) => progress.push(bytesRead));
    expect(first.cacheHit).toBe(false);
    expect(fed).toEqual([8 * MiB, 8 * MiB, 4 * MiB]);
    expect(progress).toEqual([8 * MiB, 16 * MiB, 20 * MiB]);

    log.read.mockClear();
    const again = await api.openLog(log);
    expect(again.cacheHit).toBe(true);
    expect(log.read).not.toHaveBeenCalled();

    const appended = await api.openLog(source(log.id, 21 * MiB, 2));
    expect(appended.cacheHit).toBe(false);
  });

  it('gives the engine the game tables once, and keeps asking for one that was missing', async () => {
    const fake = fakeEngine();
    const given: string[] = [];
    fake.engine.setDungeons = async (json) => void given.push(json);
    fake.engine.setChannelSpells = async (json) => void given.push(json);
    fake.engine.setSpellClasses = async (json) => void given.push(json);
    let channels: string | null = null;
    const classes = '{"classSpells":[408],"crowdControl":[408]}';
    const api = createClient({
      engine: () => fake.engine,
      dungeons: async () => 'keys',
      channelSpells: async () => channels,
      spellClasses: async () => classes,
      db: memoryDatabase(),
      now: () => 1,
    });
    await api.openLog(source('a.txt', 10));
    channels = '{"ids":[5143]}';
    await api.openLog(source('b.txt', 10));
    await api.openLog(source('c.txt', 10));
    expect(given).toEqual(['keys', classes, '{"ids":[5143]}']);
  });

  it('opens a log without a game table the engine rejects', async () => {
    const fake = fakeEngine();
    fake.engine.setChannelSpells = async () => {
      throw new Error('invalid channel table');
    };
    const api = createClient({
      engine: () => fake.engine,
      dungeons: async () => null,
      channelSpells: async () => '{}',
      spellClasses: async () => null,
      db: memoryDatabase(),
      now: () => 1,
    });
    expect((await api.openLog(source('a.txt', 10))).cacheHit).toBe(false);
  });

  it('remembers combat logs newest first; without a file handle they must be chosen again', async () => {
    const { api } = client();
    await api.openLog(source('older.txt', 10));
    await api.openLog(source('newer.txt', 10));
    const recent = await api.recentLogs();
    expect(recent.map((entry) => [entry.id, entry.exists])).toEqual([
      ['newer.txt', false],
      ['older.txt', false],
    ]);
  });
});

describe('recent logs', () => {
  it('forgets a removed log together with its stored index', async () => {
    const { api } = client();
    await api.openLog(source('raid', 10));
    await api.openLog(source('raid|old.txt', 10));
    await api.removeRecent('raid');
    expect((await api.recentLogs()).map((entry) => entry.id)).toEqual(['raid|old.txt']);
    expect((await api.openLog(source('raid', 10))).cacheHit).toBe(false);
    expect((await api.openLog(source('raid|old.txt', 10))).cacheHit).toBe(true);
  });

  it('keeps a log removed while it was being opened out of the list, without an index', async () => {
    const { api } = client();
    const opened = api.openLog(source('raid.txt', 10));
    await api.removeRecent('raid.txt');
    await opened;
    expect(await api.recentLogs()).toEqual([]);
    expect((await api.openLog(source('raid.txt', 10))).cacheHit).toBe(false);
  });

  it('keeps a log removed while its growth is being stored out of the list, without an index', async () => {
    const { api, engine } = client();
    const log = growable('raid.txt', 10);
    await api.openLog(log);
    engine.snapshotJson = async () => {
      void api.removeRecent('raid.txt');
      return '{"fights":[]}';
    };
    log.grow(20);
    expect(await api.followLog('raid.txt', true)).not.toBeNull();
    expect(await api.recentLogs()).toEqual([]);
    expect((await api.openLog(source('raid.txt', 20, 2))).cacheHit).toBe(false);
  });

  it('drops logs whose file is gone but keeps their index, and keeps those it may not check yet', async () => {
    const { api } = client();
    const present = fileHandle();
    const deleted = fileHandle();
    const unchecked = fileHandle('prompt');
    await api.openLog({ ...source('present.txt', 10), handle: present.handle });
    await api.openLog({ ...source('deleted.txt', 10), handle: deleted.handle });
    await api.openLog({ ...source('unchecked.txt', 10), handle: unchecked.handle });
    deleted.file.gone = true;
    unchecked.file.gone = true;
    expect((await api.recentLogs()).map((entry) => entry.id)).toEqual(['unchecked.txt', 'present.txt']);
    expect((await api.openLog(source('deleted.txt', 10))).cacheHit).toBe(true);
  });

  it('forgets a log whose file turns out to be gone when it is opened again', async () => {
    const { api } = client();
    const remembered = fileHandle('prompt');
    await api.openLog({ ...source('raid.txt', 10), handle: remembered.handle });
    remembered.file.gone = true;
    await expect(api.reopenRecent('raid.txt')).rejects.toBe('The file no longer exists.');
    expect(await api.recentLogs()).toEqual([]);
  });
});

describe('reports', () => {
  it('loads each pull from its part of the log once and keeps reports on the open log', async () => {
    const { api, loaded } = client();
    const log = source('raid.txt', 1000);
    await api.openLog(log);
    log.read.mockClear();

    const filter = { startMs: null, endMs: null, attribution: 'reattributed' as const, includeOverkill: false, deathCutoff: null };
    await api.damageDoneReport('raid.txt', 1, filter);
    await api.healingReport('raid.txt', 1, filter);
    expect(log.read.mock.calls).toEqual([[100, 100]]);

    expect(await api.comparePulls('raid.txt', 1, 3, 'augmented', true, 2)).toEqual({
      command: 'compare_pulls',
      args: { fightA: 1, fightB: 3, attribution: 'augmented', includeOverkill: true, deathCutoff: 2 },
    });
    expect(loaded).toEqual([1, 3]);

    await api.openLog(source('other.txt', 1000));
    await expect(api.damageDoneReport('raid.txt', 1, filter)).rejects.toBe('This log is no longer open. Open it again.');
  });
});

describe('pull sets', () => {
  const commands = [{ command: 'quick_overview' as const, args: { filter: null } }];

  it('a_pull_set_feeds_every_pull_in_order_and_reports_progress', async () => {
    const { api, setFeeds } = client();
    await api.openLog(source('raid.txt', 1000));
    const progress: { done: number; total: number }[] = [];

    const results = await api.pullSet('raid.txt', [1, 3, 4], commands, { onProgress: (p) => progress.push(p) });

    expect(setFeeds).toEqual([1, 3, 4]);
    expect(progress).toEqual([{ done: 0, total: 3 }, { done: 1, total: 3 }, { done: 2, total: 3 }, { done: 3, total: 3 }]);
    expect(results).toEqual([{ pulls: 3 }]);
  });

  it('a_stale_pull_set_stops_before_the_next_pull', async () => {
    const { api, setFeeds } = client();
    await api.openLog(source('raid.txt', 1000));

    const run = api.pullSet('raid.txt', [1, 2, 3], commands, { isStale: () => setFeeds.length >= 1 });

    await expect(run).rejects.toBeInstanceOf(SetCancelled);
    expect(setFeeds).toEqual([1]);
  });

  it('a_pull_set_that_went_stale_while_queued_leaves_the_engine_alone', async () => {
    const { api, setFeeds } = client();
    await api.openLog(source('raid.txt', 1000));
    await api.pullSet('raid.txt', [1, 2], commands);

    await expect(api.pullSet('raid.txt', [3], commands, { isStale: () => true })).rejects.toBeInstanceOf(SetCancelled);
    expect(setFeeds).toEqual([1, 2]);
  });
});

describe('failures', () => {
  it('stops reading a log once another is opened', async () => {
    const { api, fed } = client();
    const first = source('first.txt', 40 * MiB);
    let second: Promise<unknown> = Promise.resolve();
    first.read.mockImplementation(async (_: number, length: number) => {
      if (first.read.mock.calls.length === 2) second = api.openLog(source('second.txt', 10));
      return new Uint8Array(length);
    });
    await expect(api.openLog(first)).rejects.toBe('Another log is being opened.');
    expect(first.read).toHaveBeenCalledTimes(2);
    await expect(second).resolves.toMatchObject({ id: 'second.txt' });
    expect(fed).toEqual([10]);
  });

  it('treats the open log as closed after the engine restarted', async () => {
    const { api, state } = client();
    await api.openLog(source('raid.txt', 1000));
    state.restarts = 1;
    const filter = { startMs: null, endMs: null, attribution: 'reattributed' as const, includeOverkill: false, deathCutoff: null };
    await expect(api.damageDoneReport('raid.txt', 1, filter)).rejects.toBe('This log is no longer open. Open it again.');
  });
});

describe('following a log that grows', () => {
  it('feeds only the bytes appended since the last read', async () => {
    const { api, fed } = client();
    const log = growable('raid.txt', 10 * MiB);
    await api.openLog(log);
    fed.splice(0);

    log.grow(13 * MiB);
    const result = await api.followLog('raid.txt', false);

    expect(fed).toEqual([3 * MiB]);
    expect(result).not.toBeNull();
  });

  it('feeds a restored log from its start on its first growth, without beginning a new index', async () => {
    const { api, fed, state } = client();
    await api.openLog(growable('raid.txt', 10 * MiB));
    const log = growable('raid.txt', 10 * MiB);
    expect((await api.openLog(log)).cacheHit).toBe(true);
    fed.splice(0);
    state.beginIndexCalls = 0;

    log.grow(11 * MiB);
    await api.followLog('raid.txt', false);

    expect(fed.reduce((a, b) => a + b, 0)).toBe(11 * MiB);
    expect(state.beginIndexCalls).toBe(0);
  });

  it('stops feeding a restored log from its start once another log is opened', async () => {
    const { api } = client();
    await api.openLog(growable('raid.txt', 40 * MiB));
    const log = growable('raid.txt', 40 * MiB);
    await api.openLog(log);
    let other: Promise<LogView> | null = null;
    const read = vi.mocked(log.read);
    read.mockImplementation(async (_: number, length: number) => {
      if (read.mock.calls.length === 2) other = api.openLog(source('other.txt', 10));
      return new Uint8Array(length);
    });

    log.grow(41 * MiB);

    expect(await api.followLog('raid.txt', false)).toBeNull();
    expect(log.read).toHaveBeenCalledTimes(2);
    await expect(other).resolves.toMatchObject({ id: 'other.txt' });
  });

  it('stops following once the engine has restarted', async () => {
    const { api, state } = client();
    const log = growable('raid.txt', 10 * MiB);
    await api.openLog(log);
    state.restarts = 1;

    log.grow(11 * MiB);

    expect(await api.followLog('raid.txt', false)).toBeNull();
    expect(api.canFollow('raid.txt')).toBe(false);
  });

  it('has nothing to refresh when the log did not grow, unless a followed growth is still to settle', async () => {
    const { api } = client();
    const log = growable('raid.txt', 10 * MiB);
    await api.openLog(log);

    expect(await api.followLog('raid.txt', false)).toBeNull();
    expect(await api.followLog('raid.txt', true)).toBeNull();

    log.grow(11 * MiB);
    await api.followLog('raid.txt', false);
    expect(await api.followLog('raid.txt', false)).toBeNull();
    expect(await api.followLog('raid.txt', true)).not.toBeNull();
  });

  it('feeds the rest of a growth whose read failed on the next refresh', async () => {
    const { api, engine, fed } = client();
    const log = growable('raid.txt', 10 * MiB);
    await api.openLog(log);
    fed.splice(0);
    let feeds = 0;
    engine.feed = async (bytes) => {
      if (++feeds === 2) throw new Error('read failed');
      fed.push(bytes.length);
    };

    log.grow(22 * MiB);
    await expect(api.followLog('raid.txt', false)).rejects.toThrow('read failed');
    expect(await api.followLog('raid.txt', false)).not.toBeNull();
    expect(fed).toEqual([8 * MiB, 4 * MiB]);
  });

  it('cannot follow a log without a handle, or one that is not open', async () => {
    const { api } = client();
    await api.openLog(source('plain.txt', 10));
    expect(api.canFollow('plain.txt')).toBe(false);
    expect(api.canFollow('other.txt')).toBe(false);
    expect(await api.followLog('other.txt', false)).toBeNull();
  });

  it('stores the grown index at most once a minute, and once more when it settles, dropping the one it replaces', async () => {
    const fake = fakeEngine();
    let clock = 0;
    const db = memoryDatabase();
    const api = createClient({
      engine: () => fake.engine,
      dungeons: async () => null,
      channelSpells: async () => null,
      spellClasses: async () => null,
      db,
      now: () => clock,
    });
    const log = growable('raid.txt', 10);
    await api.openLog(log);
    const keys = async () => (await db.all<{ key: string }>('indexes')).map((entry) => entry.key);
    expect(await keys()).toEqual(['raid.txt|10|1|5']);

    log.grow(20);
    await api.followLog('raid.txt', false);
    expect(await keys()).toEqual(['raid.txt|20|2|5']);

    clock = 30_000;
    log.grow(30);
    await api.followLog('raid.txt', false);
    expect(await keys()).toEqual(['raid.txt|20|2|5']);

    clock = 60_000;
    log.grow(40);
    await api.followLog('raid.txt', false);
    expect(await keys()).toEqual(['raid.txt|40|4|5']);

    clock = 70_000;
    log.grow(50);
    await api.followLog('raid.txt', false);
    expect(await keys()).toEqual(['raid.txt|40|4|5']);

    clock = 72_000;
    await api.followLog('raid.txt', true);
    expect(await keys()).toEqual(['raid.txt|50|6|5']);
  });
});
