import { formatEventTime } from '../../i18n/format';
import { t } from '../../i18n/i18n';

const WIDTH = 1000;
const HEIGHT = 200;
const TOP = 10;
const BOTTOM = 190;

const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;

/** One value of a step series: drawn at `x`, covering `x0`–`x1` of its step. */
export interface StepPoint {
  x0: number;
  x: number;
  x1: number;
  y: number;
}

/**
 * A line through step points; `null` breaks it. A point without a neighbour is drawn flat
 * across its step, so a lone value stays visible.
 */
export function stepLine(points: (StepPoint | null)[]): string {
  const parts: string[] = [];
  let run: StepPoint[] = [];
  const flush = () => {
    if (run.length === 1) parts.push(`M ${run[0].x0} ${run[0].y} L ${run[0].x1} ${run[0].y}`);
    else if (run.length > 1) parts.push(run.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' '));
    run = [];
  };
  for (const point of points) {
    if (point === null) flush();
    else run.push(point);
  }
  flush();
  return parts.join(' ');
}

/** X positions of step `i` in a `width` box over `len` ms; the last step may be shorter. */
function stepX(i: number, stepMs: number, len: number, width: number) {
  const from = i * stepMs;
  const to = Math.min(len, (i + 1) * stepMs);
  const at = (ms: number) => round1((ms / len) * width);
  return { x0: at(from), x: at((from + to) / 2), x1: at(to) };
}

/** A round ceiling above `peak`, the player chart's y scale and label: half-power-of-ten steps (2.93M → 3.0M). */
function niceCeil(peak: number): number {
  if (peak <= 0) return 0;
  // The epsilon keeps exact powers of ten (log10 can land just below them) in their own decade.
  const step = 10 ** Math.floor(Math.log10(peak) + 1e-9) / 2;
  return Math.ceil(peak / step) * step;
}

/** SVG paths of per-second values per step over `[startMs, endMs)`, scaled to `niceCeil(peak)`. */
export function seriesPaths(series: number[], stepMs: number, startMs: number, endMs: number) {
  const len = endMs - startMs;
  const peak = Math.max(0, ...series);
  if (series.length === 0 || len <= 0 || peak <= 0) return { line: '', area: '', peak: 0, ceiling: 0 };
  const ceiling = niceCeil(peak);
  const points = series.map((value, i) => ({ ...stepX(i, stepMs, len, WIDTH), y: round1(BOTTOM - (value / ceiling) * (BOTTOM - TOP)) }));
  const line = stepLine(points);
  const lone = points.length === 1;
  const first = lone ? points[0].x0 : points[0].x;
  const last = lone ? points[0].x1 : points[points.length - 1].x;
  return { line, area: `${line} L ${last} ${HEIGHT} L ${first} ${HEIGHT} Z`, peak, ceiling };
}

/** An interval's position in percent of the range; `null` if it lies outside. */
export function band(start: number, end: number, rangeStart: number, rangeEnd: number) {
  const len = rangeEnd - rangeStart;
  const from = Math.max(start, rangeStart);
  const to = Math.min(end, rangeEnd);
  if (len <= 0 || to <= from) return null;
  return { leftPct: round2(((from - rangeStart) / len) * 100), widthPct: round2(((to - from) / len) * 100) };
}

/** Axis ticks at round times inside the range. */
export function rangeTicks(startMs: number, endMs: number) {
  const len = endMs - startMs;
  if (len <= 0) return [];
  const step = len > 180_000 ? 60_000 : len > 60_000 ? 30_000 : 5_000;
  const ticks: { leftPct: number; label: string }[] = [];
  for (let ms = Math.ceil(startMs / step) * step; ms <= endMs; ms += step) {
    ticks.push({ leftPct: round2(((ms - startMs) / len) * 100), label: formatEventTime(ms) });
  }
  return ticks;
}

/**
 * The mana line in the player chart's 1000×200 box (same x as `seriesPaths`). It breaks at `null`
 * samples and while the player is dead (a step whose middle lies in a `dead` interval).
 */
export function manaPath(mana: (number | null)[], stepMs: number, startMs: number, endMs: number, dead: [number, number][] = []): string {
  const len = endMs - startMs;
  if (len <= 0) return '';
  const inDead = (i: number) => {
    const from = i * stepMs;
    const middle = startMs + (from + Math.min(len, from + stepMs)) / 2;
    return dead.some(([a, b]) => middle >= a && middle < b);
  };
  return stepLine(
    mana.map((value, i) =>
      value === null || inDead(i) ? null : { ...stepX(i, stepMs, len, WIDTH), y: round1(BOTTOM - (value / 100) * (BOTTOM - TOP)) },
    ),
  );
}

/** Lane labels read out at most this many times or intervals. */
const LANE_LIST_MAX = 10;

/** `a, b, c`, or the first LANE_LIST_MAX items followed by "and N more". */
function cappedList(items: string[]): string {
  if (items.length <= LANE_LIST_MAX) return items.join(', ');
  return t('chart.listMore', { list: items.slice(0, LANE_LIST_MAX).join(', '), count: items.length - LANE_LIST_MAX });
}

/** Intervals inside the range for a lane label; empty when none is in range. */
export function intervalList(intervals: [number, number][], startMs: number, endMs: number): string {
  return cappedList(
    intervals
      .filter(([a, b]) => band(a, b, startMs, endMs) !== null)
      .map(([a, b]) => t('chart.interval', { from: formatEventTime(Math.max(a, startMs)), to: formatEventTime(Math.min(b, endMs)) })),
  );
}

/** The edge of a cast icon in Casts & buffs. */
const CAST_ICON_PX = 22;

/**
 * Whether a cast lane is too crowded for icons: two casts in range lie closer than half an icon,
 * so their icons would cover each other by more than half (`lanePx` is the lane's width).
 */
export function castsCrowd(times: number[], startMs: number, endMs: number, lanePx: number): boolean {
  const len = endMs - startMs;
  if (len <= 0 || lanePx <= 0) return false;
  const inRange = times.filter((time) => time >= startMs && time < endMs).sort((a, b) => a - b);
  const minGapMs = (CAST_ICON_PX / 2 / lanePx) * len;
  return inRange.some((time, i) => i > 0 && time - inRange[i - 1] < minGapMs);
}
