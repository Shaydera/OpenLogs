import { type MouseEvent as ReactMouseEvent, type RefObject, useEffect, useRef, useState } from 'react';
import type { TimeRange } from '../../store';
import { type Edge, MIN_DRAG_PX, brushToRange, normalizeRange, sameRange, snapToSecond, timeAt, withEdge } from './rangeGeometry';

/** `brush` draws a new selection across the plot; an edge moves that handle. */
export type DragMode = 'brush' | Edge;

export interface Brush {
  /** The selection while a drag is in progress (`null` = the whole pull); `undefined` without a drag. */
  preview: TimeRange | null | undefined;
  /** Starts a drag on mouse down. */
  start(event: ReactMouseEvent, mode: DragMode): void;
}

/**
 * Pointer selection on a plot: a drag across the plot selects a range in whole seconds, a drag of a
 * handle moves that edge, a click without a drag goes to `onClick` with its x position and the plot
 * width. `onChange` gets each new selection; one that covers the whole pull is `null`.
 */
export function useBrush(
  plotRef: RefObject<HTMLElement | null>,
  durationMs: number,
  current: TimeRange | null,
  onChange: (range: TimeRange | null) => void,
  onClick: (x: number, width: number) => void,
): Brush {
  const [preview, setPreview] = useState<TimeRange | null | undefined>(undefined);
  /** Removes the listeners of a drag in progress. */
  const stopDrag = useRef<(() => void) | null>(null);

  useEffect(() => () => stopDrag.current?.(), []);

  function start(event: ReactMouseEvent, mode: DragMode) {
    if (event.button !== 0) return;
    // A handle sits inside the plot: its drag must not also start a brush.
    event.stopPropagation();
    stopDrag.current?.();
    const box = plotRef.current?.getBoundingClientRect();
    const left = box?.left ?? 0;
    const width = box?.width ?? 0;
    const x0 = event.clientX - left;
    const dragged = (x: number) => Math.abs(x - x0) >= MIN_DRAG_PX;
    /** The selection a drag to `x` makes; `undefined` when it makes none. */
    const selection = (x: number): TimeRange | null | undefined => {
      if (mode !== 'brush') return withEdge(current, mode, snapToSecond(timeAt(x, width, durationMs), durationMs), durationMs);
      const brushed = brushToRange(x0, x, width, durationMs);
      return brushed === null ? undefined : normalizeRange(brushed, durationMs);
    };
    const stop = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      window.removeEventListener('blur', stop);
      stopDrag.current = null;
      setPreview(undefined);
    };
    const move = (e: MouseEvent) => {
      // The button was released outside the window: drop the drag.
      if (e.buttons === 0) return stop();
      const x = e.clientX - left;
      setPreview(dragged(x) ? selection(x) : undefined);
    };
    const up = (e: MouseEvent) => {
      stop();
      const x = e.clientX - left;
      if (!dragged(x)) {
        if (mode === 'brush') onClick(x0, width);
        return;
      }
      const next = selection(x);
      if (next !== undefined && !sameRange(next, current)) onChange(next);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    window.addEventListener('blur', stop);
    stopDrag.current = stop;
  }

  return { preview, start };
}
