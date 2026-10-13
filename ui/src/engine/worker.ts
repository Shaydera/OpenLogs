import init, { Session, take_panic_message } from './pkg/openlogs_wasm';
import type { EngineRequest, EngineResponse } from './protocol';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<EngineRequest>) => void) | null;
  postMessage(message: EngineResponse): void;
};

const ready = init();
let session: Session | undefined;
/** Given again to a session that replaces one that trapped. */
let dungeons: string | undefined;

function openSession(): Session {
  const fresh = new Session();
  if (dungeons !== undefined) fresh.set_dungeons(dungeons);
  return fresh;
}

scope.onmessage = async ({ data: { id, method, args } }) => {
  try {
    await ready;
    session ??= openSession();
    const result: unknown = Reflect.apply(session[method] as (...args: unknown[]) => unknown, session, args);
    if (method === 'set_dungeons') dungeons = args[0] as string;
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
