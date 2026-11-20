import init, { Session, take_panic_message } from './pkg/openlogs_wasm';
import { GameDataLog } from './gameDataLog';
import type { EngineRequest, EngineResponse } from './protocol';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<EngineRequest>) => void) | null;
  postMessage(message: EngineResponse): void;
};

const ready = init();
let session: Session | undefined;
const gameData = new GameDataLog();

function openSession(): Session {
  const fresh = new Session();
  gameData.replay(fresh);
  return fresh;
}

scope.onmessage = async ({ data: { id, method, args } }) => {
  try {
    await ready;
    session ??= openSession();
    const result: unknown = Reflect.apply(session[method] as (...args: unknown[]) => unknown, session, args);
    gameData.record(method, args);
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
