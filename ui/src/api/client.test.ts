import { describe, expect, it, vi } from 'vitest';
import type { Engine } from '../engine/engine';
import { createClient } from './client';
import type { Database, StoreName } from './db';
import type { LogSource } from './logSource';
import type { LogView } from './types';

const MiB = 1 << 20;

function memoryDatabase(): Database {
  const stores: Record<StoreName, Map<string, object>> = { indexes: new Map(), 'indexes-used': new Map(), recent: new Map() };
  const keyOf = (store: StoreName, value: object) => (value as Record<string, string>)[store === 'recent' ? 'id' : 'key'];
  return {
    get: async <T>(store: StoreName, key: string) => stores[store].get(key) as T | undefined,
    put: async (store, value) => void stores[store].set(keyOf(store, value), structuredClone(value)),
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
  const state = { restarts: 0 };
  const engine: Engine = {
    indexFormatVersion: async () => 5,
    setDungeons: async () => {},
    setChannelSpells: async () => {},
    beginIndex: async () => void fed.splice(0),
    feed: async (bytes) => void fed.push(bytes.length),
    finishIndex: async (logId) => view(logId),
    indexJson: async () => '{"fights":[]}',
    restoreIndex: async (_, logId) => ({ ...view(logId), cacheHit: true }),
    fightRange: async (fight) => [fight * 100, fight * 100 + 100],
    touchFight: async (fight) => loaded.includes(fight),
    loadFight: async (_, __, fight) => void loaded.push(fight),
    call: async <T>(command: string, args: object) => ({ command, args }) as T,
    restarts: () => state.restarts,
  };
  return { engine, loaded, fed, state };
}

function source(id: string, size: number, lastModified = 1): LogSource & { read: ReturnType<typeof vi.fn> } {
  return { id, name: id, size, lastModified, read: vi.fn(async (_: number, length: number) => new Uint8Array(length)) };
}

function client() {
  const fake = fakeEngine();
  let clock = 0;
  const api = createClient({ engine: () => fake.engine, dungeons: async () => null, channelSpells: async () => null, db: memoryDatabase(), now: () => ++clock });
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
    let channels: string | null = null;
    const api = createClient({ engine: () => fake.engine, dungeons: async () => 'keys', channelSpells: async () => channels, db: memoryDatabase(), now: () => 1 });
    await api.openLog(source('a.txt', 10));
    channels = '{"ids":[5143]}';
    await api.openLog(source('b.txt', 10));
    await api.openLog(source('c.txt', 10));
    expect(given).toEqual(['keys', '{"ids":[5143]}']);
  });

  it('opens a log without a game table the engine rejects', async () => {
    const fake = fakeEngine();
    fake.engine.setChannelSpells = async () => {
      throw new Error('invalid channel table');
    };
    const api = createClient({ engine: () => fake.engine, dungeons: async () => null, channelSpells: async () => '{}', db: memoryDatabase(), now: () => 1 });
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

describe('reports', () => {
  it('loads each pull from its part of the log once and keeps reports on the open log', async () => {
    const { api, loaded } = client();
    const log = source('raid.txt', 1000);
    await api.openLog(log);
    log.read.mockClear();

    const filter = { startMs: null, endMs: null, attribution: 'reattributed' as const };
    await api.damageDoneReport('raid.txt', 1, filter);
    await api.healingReport('raid.txt', 1, filter);
    expect(log.read.mock.calls).toEqual([[100, 100]]);

    expect(await api.comparePulls('raid.txt', 1, 3, 'augmented')).toEqual({
      command: 'compare_pulls',
      args: { fightA: 1, fightB: 3, attribution: 'augmented' },
    });
    expect(loaded).toEqual([1, 3]);

    await api.openLog(source('other.txt', 1000));
    await expect(api.damageDoneReport('raid.txt', 1, filter)).rejects.toBe('This log is no longer open. Open it again.');
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
    const filter = { startMs: null, endMs: null, attribution: 'reattributed' as const };
    await expect(api.damageDoneReport('raid.txt', 1, filter)).rejects.toBe('This log is no longer open. Open it again.');
  });
});
