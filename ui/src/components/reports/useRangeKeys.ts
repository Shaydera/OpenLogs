import { type KeyboardEvent, useRef, useState } from 'react';
import { formatEventTime } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import type { TimeRange } from '../../store';
import { type Edge, fullRange, handleKey, sameRange } from './rangeGeometry';

/** What a selection handle needs to be a slider; spread it on the handle element. */
export interface HandleProps {
  role: 'slider';
  tabIndex: number;
  'aria-label': string;
  'aria-valuemin': number;
  'aria-valuemax': number;
  'aria-valuenow': number;
  'aria-valuetext': string;
  'aria-describedby': string;
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
  onKeyUp(): void;
  onBlur(): void;
}

export interface RangeKeys {
  /** The selection while keys are held (`null` = the whole pull); `undefined` when none are. */
  draft: TimeRange | null | undefined;
  handleProps(edge: Edge, shown: TimeRange | null): HandleProps;
}

/**
 * The keyboard for a brush's two handles: each handle is a slider over the pull in seconds
 * (`handleKey` has the keys). Held keys only move the draft; the selection goes to `onChange` once,
 * on key release or blur — Escape at once.
 */
export function useRangeKeys(
  durationMs: number,
  current: TimeRange | null,
  onChange: (range: TimeRange | null) => void,
  hintId: string,
): RangeKeys {
  const [draft, setDraft] = useState<TimeRange | null | undefined>(undefined);
  // Key events can follow each other before a render: the newest draft is read from here.
  const latest = useRef<TimeRange | null | undefined>(undefined);

  const update = (next: TimeRange | null | undefined) => {
    latest.current = next;
    setDraft(next);
  };
  const commit = () => {
    const next = latest.current;
    if (next === undefined) return;
    update(undefined);
    if (!sameRange(next, current)) onChange(next);
  };

  function handleProps(edge: Edge, shown: TimeRange | null): HandleProps {
    const selection = shown ?? fullRange(durationMs);
    const value = edge === 'start' ? selection.startMs : selection.endMs;
    return {
      role: 'slider',
      tabIndex: 0,
      'aria-label': t(edge === 'start' ? 'range.handleStart' : 'range.handleEnd'),
      'aria-valuemin': 0,
      'aria-valuemax': Math.round(durationMs / 1000),
      'aria-valuenow': Math.round(value / 1000),
      'aria-valuetext': formatEventTime(value),
      'aria-describedby': hintId,
      onKeyDown(event) {
        const base = latest.current !== undefined ? latest.current : current;
        const next = handleKey(base, edge, event.key, event.shiftKey, durationMs);
        if (next === undefined) return;
        event.preventDefault();
        update(next);
        // Escape is one decision, not a key held down.
        if (event.key === 'Escape') commit();
      },
      onKeyUp: commit,
      onBlur: commit,
    };
  }

  return { draft, handleProps };
}
