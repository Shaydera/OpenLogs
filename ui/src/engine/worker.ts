import init, { Session, take_panic_message } from './pkg/openlogs_wasm';
import type { EngineRequest, EngineResponse } from './protocol';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<EngineRequest>) => void) | null;
  postMessage(message: EngineResponse): void;
};

const ready = init();
let session: Session | undefined;
const GAME_DATA = ['set_dungeons', 'set_channel_spells'] as const;
type GameDataMethod = (typeof GAME_DATA)[number];
/** Given again to a session that replaces one that trapped. */
const gameData = new Map<GameDataMethod, string>();

function openSession(): Session {
  const fresh = new Session();
  gameData.forEach((json, method) => fresh[method](json));
  return fresh;
}

scope.onmessage = async ({ data: { id, method, args } }) => {
  try {
    await ready;
    session ??= openSession();
    const result: unknown = Reflect.apply(session[method] as (...args: unknown[]) => unknown, session, args);
    if ((GAME_DATA as readonly string[]).includes(method)) gameData.set(method as GameDataMethod, args[0] as string);
    scope.postMessage({ id, result });
  } catch (error) {
    if (error instanceof WebAssembly.RuntimeError) {
      // A trap (a panic, running out of memory) leaves the session unusable.
      session = undefined;
      scope.postMessage({ id, error: take_panic_message() ?? String(error), restarted: true });
    } else {
      scope.postMessage({ id, error: String(error) });
    }
  }
};
