import { useEffect } from 'react';
import { type FocusTarget, useApp } from '../store';

/**
 * Focuses `element()` once when the last navigation asked for `target`, then clears the
 * request. Runs after every render, because a page's heading may mount later than the request.
 */
export function useFocusRequest(target: FocusTarget, element: () => HTMLElement | null | undefined): void {
  const request = useApp((s) => s.focusRequest);
  const consumeFocus = useApp((s) => s.consumeFocus);
  useEffect(() => {
    if (request !== target) return;
    const node = element();
    if (!node) return;
    node.focus();
    consumeFocus();
  });
}
