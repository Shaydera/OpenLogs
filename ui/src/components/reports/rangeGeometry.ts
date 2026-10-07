import { formatDuration, formatEventTime } from '../../i18n/format';
import type { TimeRange } from '../../store';

/** Pointer travel below this is a click, not a brush. */
export const MIN_DRAG_PX = 4;
/** The shortest selection a drag, a handle or a key makes. */
const MIN_RANGE_MS = 1_000;
/** Arrow keys move a handle by a second, Page Up and Page Down by ten. */
const KEY_STEP_MS = 1_000;
const PAGE_STEP_MS = 10_000;

/** One end of a selection: the brush's left or right handle. */
export type Edge = 'start' | 'end';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The whole pull as a range. */
export function fullRange(durationMs: number): TimeRange {
  return { startMs: 0, endMs: durationMs };
}

/** `null` (the whole pull, no filter) for a range that covers the pull; else the range itself. */
export function normalizeRange(range: TimeRange | null, durationMs: number): TimeRange | null {
  if (range === null || (range.startMs <= 0 && range.endMs >= durationMs)) return null;
  return range;
}

/**
 * A range kept for another pull of the boss (a saved range) as it fits this pull: cut at its end,
 * `null` when it covers the whole pull, `undefined` when less than MIN_RANGE_MS of it lies inside.
 */
export function rangeInPull(range: TimeRange, durationMs: number): TimeRange | null | undefined {
  const startMs = Math.max(0, range.startMs);
  const endMs = Math.min(range.endMs, durationMs);
  if (endMs - startMs < Math.min(MIN_RANGE_MS, durationMs) || endMs <= startMs) return undefined;
  return normalizeRange({ startMs, endMs }, durationMs);
}

export function sameRange(a: TimeRange | null, b: TimeRange | null): boolean {
  if (a === null || b === null) return a === b;
  return a.startMs === b.startMs && a.endMs === b.endMs;
}

/**
 * Converts a drag across a plot of `width` pixels into a range of whole seconds, at least
 * MIN_RANGE_MS long (a shorter pull: its whole length), or `null` for no change.
 */
export function brushToRange(x0: number, x1: number, width: number, durationMs: number): TimeRange | null {
  if (width <= 0 || durationMs <= 0 || Math.abs(x1 - x0) < MIN_DRAG_PX) return null;
  const toMs = (x: number) => {
    const fraction = Math.min(1, Math.max(0, x / width));
    return Math.min(durationMs, Math.round((fraction * durationMs) / 1000) * 1000);
  };
  const startMs = toMs(Math.min(x0, x1));
  const endMs = Math.max(0, x1, x0) >= width ? durationMs : toMs(Math.max(x0, x1));
  return endMs - startMs >= Math.min(MIN_RANGE_MS, durationMs) ? { startMs, endMs } : null;
}

/** A selection as `0:00 – 7:58`. */
export function rangeSpan(range: TimeRange): string {
  return `${formatEventTime(range.startMs)} – ${formatEventTime(range.endMs)}`;
}

export function rangeLabel(range: TimeRange): string {
  return `${rangeSpan(range)} · ${formatDuration(range.endMs - range.startMs)}`;
}

/** The time at `x` of a plot `width` pixels wide, clamped to the pull. */
export function timeAt(x: number, width: number, durationMs: number): number {
  if (width <= 0) return 0;
  return clamp(x / width, 0, 1) * durationMs;
}

/** A pointer time in whole seconds; the pull's end stays exact so a drag to the edge reaches it. */
export function snapToSecond(ms: number, durationMs: number): number {
  if (ms >= durationMs) return durationMs;
  return Math.max(0, Math.min(durationMs, Math.round(ms / 1000) * 1000));
}

/**
 * `range` (`null` = the whole pull) with one edge moved to `ms`: inside the pull and at least
 * MIN_RANGE_MS long (a shorter pull stays whole).
 */
export function withEdge(range: TimeRange | null, edge: Edge, ms: number, durationMs: number): TimeRange | null {
  const { startMs, endMs } = range ?? fullRange(durationMs);
  const min = Math.min(MIN_RANGE_MS, durationMs);
  const next =
    edge === 'start'
      ? { startMs: Math.round(clamp(ms, 0, Math.max(0, endMs - min))), endMs }
      : { startMs, endMs: Math.round(clamp(ms, Math.min(durationMs, startMs + min), durationMs)) };
  return normalizeRange(next, durationMs);
}

/** The selection moved by `deltaMs`, keeping its length, stopped at the ends of the pull. */
export function shiftRange(range: TimeRange | null, deltaMs: number, durationMs: number): TimeRange | null {
  if (range === null) return null;
  const length = range.endMs - range.startMs;
  const startMs = clamp(range.startMs + deltaMs, 0, Math.max(0, durationMs - length));
  return normalizeRange({ startMs, endMs: startMs + length }, durationMs);
}

const KEY_STEPS: Record<string, number> = {
  ArrowLeft: -KEY_STEP_MS,
  ArrowDown: -KEY_STEP_MS,
  ArrowRight: KEY_STEP_MS,
  ArrowUp: KEY_STEP_MS,
  PageDown: -PAGE_STEP_MS,
  PageUp: PAGE_STEP_MS,
};

/**
 * A key on a selection handle (a slider): arrows move the edge by a second, Page Up/Down by ten,
 * Home/End to its limit; with Shift the arrows and Page keys move the whole selection; Escape
 * selects the full pull. `undefined` for keys a handle does not use.
 */
export function handleKey(range: TimeRange | null, edge: Edge, key: string, shift: boolean, durationMs: number): TimeRange | null | undefined {
  if (key === 'Escape') return null;
  if (Object.hasOwn(KEY_STEPS, key)) {
    const step = KEY_STEPS[key];
    if (shift) return shiftRange(range, step, durationMs);
    const { startMs, endMs } = range ?? fullRange(durationMs);
    return withEdge(range, edge, (edge === 'start' ? startMs : endMs) + step, durationMs);
  }
  if (key === 'Home') return withEdge(range, edge, 0, durationMs);
  if (key === 'End') return withEdge(range, edge, durationMs, durationMs);
  return undefined;
}
