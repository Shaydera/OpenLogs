import type { EngineMethod } from './protocol';

const GAME_DATA: readonly EngineMethod[] = ['set_dungeons', 'set_channel_spells', 'set_spell_classes', 'set_talent_trees'];

/** The game data given to the engine, to give again to a session that replaces one that trapped. */
export class GameDataLog {
  /** The latest call per table and game, such as `set_spell_classes:forever`. */
  private readonly calls = new Map<string, { method: EngineMethod; args: unknown[] }>();

  record(method: EngineMethod, args: unknown[]) {
    if (GAME_DATA.includes(method)) this.calls.set(`${method}:${String(args[1] ?? '')}`, { method, args });
  }

  replay(session: object) {
    this.calls.forEach(({ method, args }) => Reflect.apply(Reflect.get(session, method) as (...args: unknown[]) => unknown, session, args));
  }
}
