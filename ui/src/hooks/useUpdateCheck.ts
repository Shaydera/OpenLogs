import { useEffect } from 'react';
import { IN_DESKTOP_APP } from '../build';
import { useApp } from '../store';
import { UPDATE_CHECK_MS } from '../updateCheck';

/** Checks at start, when the check is turned on, and every 30 minutes while it stays on. */
export function useUpdateCheck() {
  const enabled = useApp((s) => s.updateCheck);
  const checkForUpdate = useApp((s) => s.checkForUpdate);
  useEffect(() => {
    if (!IN_DESKTOP_APP || !enabled) return;
    void checkForUpdate();
    const timer = setInterval(() => void checkForUpdate(), UPDATE_CHECK_MS);
    return () => clearInterval(timer);
  }, [enabled, checkForUpdate]);
}
