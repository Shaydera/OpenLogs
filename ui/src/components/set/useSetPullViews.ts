import { useMemo } from 'react';
import type { PullView } from '../../pulls/groupPulls';
import { useApp } from '../../store';
import { pullViews } from './seams';

/** The open set's pulls by fight index with their number and result; empty outside a set. */
export function useSetPullViews(): Map<number, PullView> {
  const log = useApp((s) => s.log);
  const view = useApp((s) => s.view);
  const fights = view.kind === 'set' ? view.set.fights : null;
  return useMemo(() => (log && fights ? pullViews(log, fights) : new Map<number, PullView>()), [log, fights]);
}
