import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useEffect, useState } from 'react';

/** Opens files dropped on the window; returns whether a drag is currently over it. */
export function useLogDrop(onDrop: (path: string) => void): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    try {
      getCurrentWebview()
        .onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === 'enter' || payload.type === 'over') {
            setOver(true);
          } else if (payload.type === 'leave') {
            setOver(false);
          } else if (payload.type === 'drop') {
            setOver(false);
            const first = payload.paths[0];
            if (first) onDrop(first);
          }
        })
        .then((stop) => (disposed ? stop() : (unlisten = stop)))
        .catch(() => undefined);
    } catch {
      // Not running inside Tauri (tests, browser preview): no drag & drop.
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [onDrop]);
  return over;
}
