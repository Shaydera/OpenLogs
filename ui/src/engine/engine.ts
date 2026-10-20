import type { LogView } from '../api/types';
import type { EngineMethod, EngineRequest, EngineResponse } from './protocol';

/** The analysis engine (Rust, as WebAssembly) in its Web Worker. It holds one log at a time. */
export interface Engine {
  /** Changes whenever a stored index can no longer be read back. */
  indexFormatVersion(): Promise<number>;
  /** The Mythic+ dungeon table, which decides run results and key timers. */
  setDungeons(json: string): Promise<void>;
  /** The spells the game channels, which draw as channels where the log has no channel aura. */
  setChannelSpells(json: string): Promise<void>;
  /** Which spells belong to a player class and which of those are crowd control. */
  setSpellClasses(json: string): Promise<void>;
  beginIndex(): Promise<void>;
  /** Takes ownership of `bytes`; the caller must not use them afterwards. */
  feed(bytes: Uint8Array): Promise<void>;
  finishIndex(logId: string, fileName: string, sizeBytes: number): Promise<LogView>;
  indexJson(): Promise<string>;
  restoreIndex(indexJson: string, logId: string, fileName: string, sizeBytes: number): Promise<LogView>;
  /** `[prelude, end)` byte offsets the pull needs. */
  fightRange(fight: number): Promise<[number, number]>;
  /** Keeps a loaded pull loaded for longer; `false` when it is not loaded. */
  touchFight(fight: number): Promise<boolean>;
  /** Takes ownership of `bytes`, the pull's part of the log starting at `baseOffset`. */
  loadFight(bytes: Uint8Array, baseOffset: number, fight: number): Promise<void>;
  /** Starts reading `fights` as one set; `commandsJson` lists the commands to run over it. */
  setBegin(fights: number[], commandsJson: string): Promise<void>;
  /** Takes ownership of `bytes`, one pull's part of the log; pulls arrive in set order. */
  setFeed(bytes: Uint8Array, baseOffset: number, fight: number): Promise<void>;
  /** One result per command, as a JSON array. */
  setFinish(): Promise<string>;
  call<T>(command: string, args: object): Promise<T>;
  /** Counts restarts after a crash; each restart forgets the open log. */
  restarts(): number;
}

/** Starts the engine's worker. Failures reject with the engine's message as a string. */
export function workerEngine(): Engine {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: string) => void }>();
  let nextId = 0;
  let restarts = 0;
  /** Why the worker stopped for good (e.g. its module failed to load); every request fails with it. */
  let failure: string | null = null;

  worker.onmessage = ({ data }: MessageEvent<EngineResponse>) => {
    const request = pending.get(data.id);
    pending.delete(data.id);
    if ('error' in data) {
      if (data.restarted) restarts += 1;
      request?.reject(data.error);
    } else {
      request?.resolve(data.result);
    }
  };
  const stop = (reason: string) => {
    failure = reason;
    for (const request of pending.values()) request.reject(reason);
    pending.clear();
  };
  worker.onerror = (event) => stop(event.message || 'The analysis engine stopped.');
  worker.onmessageerror = () => stop('The analysis engine sent an unreadable answer.');

  function send<T>(method: EngineMethod, args: unknown[] = [], transfer: Transferable[] = []): Promise<T> {
    if (failure !== null) return Promise.reject(failure);
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage({ id, method, args } satisfies EngineRequest, transfer);
    });
  }

  return {
    indexFormatVersion: () => send('index_format_version'),
    setDungeons: (json) => send('set_dungeons', [json]),
    setChannelSpells: (json) => send('set_channel_spells', [json]),
    setSpellClasses: (json) => send('set_spell_classes', [json]),
    beginIndex: () => send('begin_index'),
    feed: (bytes) => send('index_feed', [bytes], [bytes.buffer]),
    finishIndex: async (logId, fileName, sizeBytes) => JSON.parse(await send<string>('finish_index', [logId, fileName, sizeBytes])),
    indexJson: () => send('index_json'),
    restoreIndex: async (indexJson, logId, fileName, sizeBytes) =>
      JSON.parse(await send<string>('restore_index', [indexJson, logId, fileName, sizeBytes])),
    fightRange: async (fight) => {
      const [start, end] = await send<number[]>('fight_range', [fight]);
      return [start, end];
    },
    touchFight: (fight) => send('touch_fight', [fight]),
    loadFight: (bytes, baseOffset, fight) => send('load_fight', [bytes, baseOffset, fight], [bytes.buffer]),
    setBegin: (fights, commandsJson) => send('set_begin', [Uint32Array.from(fights), commandsJson]),
    setFeed: (bytes, baseOffset, fight) => send('set_feed', [bytes, baseOffset, fight], [bytes.buffer]),
    setFinish: () => send('set_finish'),
    call: async (command, args) => JSON.parse(await send<string>('call', [command, JSON.stringify(args)])),
    restarts: () => restarts,
  };
}
