/** Methods of the Rust `Session` the worker runs on behalf of `engine.ts`. */
export type EngineMethod =
  | 'index_format_version'
  | 'set_dungeons'
  | 'set_channel_spells'
  | 'begin_index'
  | 'index_feed'
  | 'finish_index'
  | 'index_json'
  | 'restore_index'
  | 'fight_range'
  | 'touch_fight'
  | 'load_fight'
  | 'call';

export interface EngineRequest {
  id: number;
  method: EngineMethod;
  args: unknown[];
}

export type EngineResponse =
  | { id: number; result: unknown }
  /** `restarted`: the engine replaced its session and forgot the open log. */
  | { id: number; error: string; restarted?: boolean };
