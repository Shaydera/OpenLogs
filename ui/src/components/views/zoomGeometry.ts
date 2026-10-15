import type { TimeRange } from '../../store';

/** The narrowest window the timeline zooms to. */
export const MIN_WINDOW_MS = 2_500;
/** A window of this span or less lists the log lines of its marks; the core lists none beyond it. */
export const LISTED_WINDOW_MS = 120_000;
/** A new view shows this much of the range. */
const DEFAULT_WINDOW_MS = 20_000;

export const windowSpan = (window: TimeRange) => window.endMs - window.startMs;

/** The range as a window; `null` is the whole pull. */
export const rangeWindow = (range: TimeRange | null, durationMs: number): TimeRange => range ?? { startMs: 0, endMs: durationMs };

/** `window` moved and cut into `range`, at least MIN_WINDOW_MS long (a shorter range: all of it); it keeps its length while it fits. */
export function clampWindow(window: TimeRange, range: TimeRange): TimeRange {
  const length = Math.min(windowSpan(range), Math.max(MIN_WINDOW_MS, windowSpan(window)));
  const startMs = Math.min(Math.max(window.startMs, range.startMs), range.endMs - length);
  return { startMs, endMs: startMs + length };
}

/** The window the timeline shows: the chosen one, else the first 20 s of the range. */
export function shownWindow(zoom: TimeRange | null, range: TimeRange): TimeRange {
  return clampWindow(zoom ?? { startMs: range.startMs, endMs: range.startMs + DEFAULT_WINDOW_MS }, range);
}

/** What a timeline request asks for: the shown window and half of it on either side, so a pan by half a window draws at once. */
export function requestWindow(shown: TimeRange, range: TimeRange): TimeRange {
  const pad = Math.round(windowSpan(shown) / 2);
  return { startMs: Math.max(range.startMs, shown.startMs - pad), endMs: Math.min(range.endMs, shown.endMs + pad) };
}

/** Whether a loaded window holds all of the shown one. */
export function covers(loaded: TimeRange, shown: TimeRange): boolean {
  return loaded.startMs <= shown.startMs && loaded.endMs >= shown.endMs;
}

/** Window lengths of the zoom bar; longer ones join once the range holds them. */
const PRESETS_MS = [5_000, 10_000, 20_000, 30_000, 60_000, 120_000, 300_000];
const ALWAYS = 5;

/** The zoom bar's lengths for a range; `null` is the whole range. */
export function presets(range: TimeRange): (number | null)[] {
  return [...PRESETS_MS.filter((ms, i) => i < ALWAYS || ms < windowSpan(range)), null];
}

/** A window of `length` around the centre of `window`; `null` is the whole range. */
export function presetWindow(window: TimeRange, length: number | null, range: TimeRange): TimeRange {
  if (length === null) return range;
  const centre = (window.startMs + window.endMs) / 2;
  return clampWindow({ startMs: Math.round(centre - length / 2), endMs: Math.round(centre + length / 2) }, range);
}

/** `window` scaled by `factor` (below 1 zooms in) around `anchorMs`, which stays where it is. */
export function zoomBy(window: TimeRange, factor: number, anchorMs: number, range: TimeRange): TimeRange {
  const length = Math.max(MIN_WINDOW_MS, Math.round(windowSpan(window) * factor));
  const share = (anchorMs - window.startMs) / windowSpan(window);
  const startMs = Math.round(anchorMs - share * length);
  return clampWindow({ startMs, endMs: startMs + length }, range);
}

/** `window` moved by `fraction` of its length (negative is earlier), stopped at the range. */
export function panBy(window: TimeRange, fraction: number, range: TimeRange): TimeRange {
  const delta = Math.round(windowSpan(window) * fraction);
  return clampWindow({ startMs: window.startMs + delta, endMs: window.endMs + delta }, range);
}

/** The time at `x` of a ruler `width` pixels wide that shows `window`. */
export function timeAtX(x: number, width: number, window: TimeRange): number {
  const share = width > 0 ? Math.min(1, Math.max(0, x / width)) : 0;
  return Math.round(window.startMs + share * windowSpan(window));
}

/** A drag across the ruler from `x0` to `x1`: the window it spans (a span below the narrowest window widens around its centre), `null` for a click. */
export function dragWindow(x0: number, x1: number, width: number, window: TimeRange, range: TimeRange): TimeRange | null {
  if (Math.abs(x1 - x0) < 4) return null;
  const a = timeAtX(Math.min(x0, x1), width, window);
  const b = timeAtX(Math.max(x0, x1), width, window);
  const length = Math.max(MIN_WINDOW_MS, b - a);
  const startMs = Math.round((a + b - length) / 2);
  return clampWindow({ startMs, endMs: startMs + length }, range);
}

/** A mouse wheel notch turns about 100 px; a trackpad sends a few px at a time. */
const WHEEL_ZOOM_PX = 450;
const WHEEL_PAN_PX = 1_000;

/** The zoom factor of a Ctrl + wheel turn of `px` (down zooms out), by how far it turned. */
export function wheelZoomFactor(px: number): number {
  return Math.min(2, Math.max(0.5, Math.exp(px / WHEEL_ZOOM_PX)));
}

/** The share of a window a Shift + wheel turn of `px` pans, at most half of it. */
export function wheelPanFraction(px: number): number {
  return Math.min(0.5, Math.max(-0.5, px / WHEEL_PAN_PX));
}

/** Where `ms` lies in `window`, in percent (outside it below 0 or above 100). */
export function percentIn(ms: number, window: TimeRange): number {
  const length = windowSpan(window);
  return length > 0 ? ((ms - window.startMs) / length) * 100 : 0;
}

/** Major tick steps of the ruler; each gets five minor ticks. */
const STEPS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000, 120_000, 300_000];
/** Major ticks stand at least this far apart. */
const MIN_TICK_PX = 64;

export interface RulerTicks {
  stepMs: number;
  major: number[];
  minor: number[];
}

/** Ruler ticks of a window drawn `widthPx` wide: the smallest step that keeps labels apart, and minor ticks between them. */
export function rulerTicks(window: TimeRange, widthPx: number): RulerTicks {
  const length = windowSpan(window);
  const stepMs = STEPS_MS.find((step) => (step / length) * widthPx >= MIN_TICK_PX) ?? STEPS_MS[STEPS_MS.length - 1];
  const minorMs = stepMs / 5;
  const major: number[] = [];
  const minor: number[] = [];
  for (let ms = Math.ceil(window.startMs / minorMs) * minorMs; ms <= window.endMs; ms += minorMs) {
    (ms % stepMs === 0 ? major : minor).push(ms);
  }
  return { stepMs, major, minor };
}
