import type { FightTimeline, Phase } from '../../api/types';
import { t } from '../../i18n/i18n';

const VIEW_WIDTH = 1000;

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

const TIMELINE_SCALE: PlotScale = { height: 120, hpZero: 112, hpSpan: 100, dpsSpan: 70 };
export const TIMELINE_VIEW_BOX = `0 0 ${VIEW_WIDTH} ${TIMELINE_SCALE.height}`;

export interface TimelineGeometry {
  bossHpPath: string;
  dpsPath: string;
  phases: { key: string; label: string }[];
}

/** Position of `ms` within the pull in percent, clamped to 0–100. */
export function percentOf(ms: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.min(100, Math.max(0, (ms / durationMs) * 100));
}

const round = (value: number) => Math.round(value * 10) / 10;
const x = (ms: number, durationMs: number) => round((percentOf(ms, durationMs) / 100) * VIEW_WIDTH);

/** Step `i` of a series over the pull: start, middle of its real length, end. */
function stepAt(i: number, stepMs: number, durationMs: number) {
  const from = i * stepMs;
  const to = Math.min(durationMs, (i + 1) * stepMs);
  return { x0: x(from, durationMs), x: x((from + to) / 2, durationMs), x1: x(to, durationMs) };
}

/** One value of a step series: drawn at `x`, covering `x0`–`x1` of its step. */
interface StepPoint {
  x0: number;
  x: number;
  x1: number;
  y: number;
}

/**
 * A line through step points; `null` breaks it. A point without a neighbour is drawn flat
 * across its step, so a lone value stays visible.
 */
function stepLine(points: (StepPoint | null)[]): string {
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
export function bossHpPath(bossHp: (number | null)[], stepMs: number, durationMs: number): string {
  const points = bossHp.map((value, i) =>
    value === null ? null : { ...stepAt(i, stepMs, durationMs), y: round(TIMELINE_SCALE.hpZero - (value / 100) * TIMELINE_SCALE.hpSpan) },
  );
  return stepLine(bridgeShortGaps(points, MAX_BRIDGED_HP_SAMPLES));
}

/** Raid DPS per step as a closed area scaled to `peak`; empty without values or peak. */
function dpsAreaPath(raidDps: number[], stepMs: number, durationMs: number, peak: number): string {
  if (peak <= 0 || raidDps.length === 0) return '';
  const points = raidDps.map((value, i) => ({
    ...stepAt(i, stepMs, durationMs),
    y: round(TIMELINE_SCALE.height - (value / peak) * TIMELINE_SCALE.dpsSpan),
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
  return [`M ${first} ${TIMELINE_SCALE.height}`, ...line.map(([px, py]) => `L ${px} ${py}`), `L ${last} ${TIMELINE_SCALE.height}`, 'Z'].join(' ');
}

/** A phase's name: from its config, else "Phase 1" / "Intermission 1". */
function phaseLabel(phase: Phase): string {
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

export function timelineGeometry(timeline: FightTimeline, durationMs: number): TimelineGeometry {
  const bossHp = bossHpPath(timeline.bossHp, timeline.bossHpStepMs, durationMs);
  const dpsPath = dpsAreaPath(timeline.raidDps, timeline.dpsStepMs, durationMs, Math.max(0, ...timeline.raidDps));
  const phases = timeline.phases.map((phase) => ({
    key: `${phase.kind}-${phase.number}`,
    label: phaseLabel(phase),
  }));
  return { bossHpPath: bossHp, dpsPath, phases };
}
