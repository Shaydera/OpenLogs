import type { OverviewTimeline, Phase } from '../../api/types';
import { formatAmount, formatDuration, formatEventTime, formatPercent } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { stepLine } from '../player/chartGeometry';

const VIEW_WIDTH = 1000;
/** Height of the pull comparison's 1000×100 box. */
const VIEW_HEIGHT = 100;

/**
 * How values map into a view box: boss HP 0–100 % from `hpZero` up by `hpSpan`, raid DPS from the
 * bottom (`height`) up by `dpsSpan` at its peak.
 */
export interface PlotScale {
  height: number;
  hpZero: number;
  hpSpan: number;
  dpsSpan: number;
}

/** The pull comparison: both series use the whole 1000×100 box. */
const COMPARE_SCALE: PlotScale = { height: VIEW_HEIGHT, hpZero: VIEW_HEIGHT, hpSpan: VIEW_HEIGHT, dpsSpan: VIEW_HEIGHT };

/** The fight timeline and the range panel: boss HP 100 % at y 12 leaves room for the death diamonds. */
const TIMELINE_SCALE: PlotScale = { height: 120, hpZero: 112, hpSpan: 100, dpsSpan: 70 };
export const TIMELINE_VIEW_BOX = `0 0 ${VIEW_WIDTH} ${TIMELINE_SCALE.height}`;

export interface TimelineGeometry {
  hasBossData: boolean;
  bossHpPath: string;
  dpsPath: string;
  phases: { key: string; leftPct: number; widthPct: number; kind: Phase['kind']; label: string }[];
  ticks: { leftPct: number; label: string }[];
}

/** Position of `ms` within the pull in percent, clamped to 0–100. */
export function percentOf(ms: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.min(100, Math.max(0, (ms / durationMs) * 100));
}

const round = (value: number) => Math.round(value * 10) / 10;
const x = (ms: number, durationMs: number) => round((percentOf(ms, durationMs) / 100) * VIEW_WIDTH);

/** Step `i` of a series over a pull of `lengthMs` on an axis of `axisMs`: start, middle of its real length, end. */
function stepAt(i: number, stepMs: number, lengthMs: number, axisMs: number) {
  const from = i * stepMs;
  const to = Math.min(lengthMs, (i + 1) * stepMs);
  return { x0: x(from, axisMs), x: x((from + to) / 2, axisMs), x1: x(to, axisMs) };
}

/** Boss HP gaps up to this many samples are carried through; longer ones (the boss gone) break the line. */
const MAX_BRIDGED_HP_SAMPLES = 3;

/** `points` without the short `null` runs between two values, so the line runs straight across them. */
function bridgeShortGaps<T>(points: (T | null)[], maxGap: number): (T | null)[] {
  const out: (T | null)[] = [];
  let gap = 0;
  for (const point of points) {
    if (point === null) {
      gap += 1;
      continue;
    }
    const bridged = gap > 0 && gap <= maxGap && out.length > 0;
    if (!bridged) for (let i = 0; i < gap; i += 1) out.push(null);
    gap = 0;
    out.push(point);
  }
  for (let i = 0; i < gap; i += 1) out.push(null);
  return out;
}

/**
 * Boss HP per step as a line that breaks where the boss reported nothing for longer than
 * MAX_BRIDGED_HP_SAMPLES steps; shorter gaps are bridged so no lone dashes remain.
 */
export function bossHpPath(
  bossHp: (number | null)[],
  stepMs: number,
  lengthMs: number,
  axisMs = lengthMs,
  scale: PlotScale = COMPARE_SCALE,
): string {
  const points = bossHp.map((value, i) =>
    value === null ? null : { ...stepAt(i, stepMs, lengthMs, axisMs), y: round(scale.hpZero - (value / 100) * scale.hpSpan) },
  );
  return stepLine(bridgeShortGaps(points, MAX_BRIDGED_HP_SAMPLES));
}

/** Raid DPS per step as a closed area scaled to `peak`; empty without values or peak. */
export function dpsAreaPath(
  raidDps: number[],
  stepMs: number,
  lengthMs: number,
  peak: number,
  axisMs = lengthMs,
  scale: PlotScale = COMPARE_SCALE,
): string {
  if (peak <= 0 || raidDps.length === 0) return '';
  const points = raidDps.map((value, i) => ({
    ...stepAt(i, stepMs, lengthMs, axisMs),
    y: round(scale.height - (value / peak) * scale.dpsSpan),
  }));
  // A pull shorter than one step: draw its only value across the step.
  const line: (readonly [number, number])[] =
    points.length === 1
      ? [
          [points[0].x0, points[0].y],
          [points[0].x1, points[0].y],
        ]
      : points.map((p) => [p.x, p.y] as const);
  const first = line[0][0];
  const last = line[line.length - 1][0];
  return [`M ${first} ${scale.height}`, ...line.map(([px, py]) => `L ${px} ${py}`), `L ${last} ${scale.height}`, 'Z'].join(' ');
}

/** A tick on every full minute of the axis but its very end, where the label would hang past the plot. */
export function minuteTicks(axisMs: number): { leftPct: number; label: string }[] {
  const ticks: { leftPct: number; label: string }[] = [];
  for (let ms = 0; ms === 0 || ms < axisMs; ms += 60_000) {
    ticks.push({ leftPct: percentOf(ms, axisMs), label: formatDuration(ms) });
  }
  return ticks;
}

/** A phase's name: from its config, else "Phase 1" / "Intermission 1". */
export function phaseLabel(phase: Phase): string {
  return phase.name ?? (phase.kind === 'boss' ? t('timeline.phase', { n: phase.number }) : t('timeline.intermission', { n: phase.number }));
}

/** Labels that still repeat get a number ("Boss submerged 1", "Boss submerged 2"), as the range pills show them. */
export function numberRepeats(labels: string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((label) => {
    if (labels.filter((other) => other === label).length < 2) return label;
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    return t('range.repeatedPhase', { name: label, n });
  });
}

export function timelineGeometry(timeline: OverviewTimeline, durationMs: number): TimelineGeometry {
  const bossHp = bossHpPath(timeline.bossHp, timeline.bossHpStepMs, durationMs, durationMs, TIMELINE_SCALE);
  const dpsPath = dpsAreaPath(timeline.raidDps, timeline.dpsStepMs, durationMs, Math.max(0, ...timeline.raidDps), durationMs, TIMELINE_SCALE);
  const phases = timeline.phases.map((phase) => ({
    key: `${phase.kind}-${phase.number}`,
    leftPct: percentOf(phase.startMs, durationMs),
    widthPct: percentOf(phase.endMs, durationMs) - percentOf(phase.startMs, durationMs),
    kind: phase.kind,
    label: phaseLabel(phase),
  }));
  return { hasBossData: bossHp !== '', bossHpPath: bossHp, dpsPath, phases, ticks: minuteTicks(durationMs) };
}

/** Screen-reader summary of the drawn lines: boss HP from its first to its last value, and the raid-DPS peak. */
export function timelineSummary(timeline: OverviewTimeline): string {
  const hp = timeline.bossHp.filter((value): value is number => value !== null);
  const parts: string[] = [];
  if (hp.length > 0) {
    parts.push(t('timeline.bossSummary', { from: formatPercent(hp[0]), to: formatPercent(hp[hp.length - 1]) }));
  }
  const peak = Math.max(0, ...timeline.raidDps);
  if (peak > 0) {
    const middle = Math.min(timeline.durationMs, (timeline.raidDps.indexOf(peak) + 0.5) * timeline.dpsStepMs);
    parts.push(t('timeline.dpsSummary', { peak: formatAmount(peak), time: formatEventTime(middle) }));
  }
  return parts.join(' ');
}
