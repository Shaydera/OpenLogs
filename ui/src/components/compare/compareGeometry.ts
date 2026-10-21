import type { OverviewTimeline } from '../../api/types';
import { bossHpPath, dpsAreaPath, minuteTicks } from '../overview/timelineGeometry';

/** Paths of one pull in the 1000×100 view box of each plot. */
export interface PullPaths {
  bossHp: string;
  dps: string;
}

export interface CompareChart {
  /** The longer pull: the shared time axis. */
  axisMs: number;
  a: PullPaths;
  b: PullPaths;
  ticks: { leftPct: number; label: string }[];
}

/** Both pulls on one time axis as long as the longer pull; both raid DPS areas share one scale. */
export function compareChart(a: OverviewTimeline, b: OverviewTimeline): CompareChart {
  const axisMs = Math.max(a.durationMs, b.durationMs);
  const peak = Math.max(0, ...a.raidDps, ...b.raidDps);
  const paths = (timeline: OverviewTimeline): PullPaths => ({
    bossHp: bossHpPath(timeline.bossHp, timeline.bossHpStepMs, timeline.durationMs, axisMs),
    dps: dpsAreaPath(timeline.raidDps, timeline.dpsStepMs, timeline.durationMs, peak, axisMs),
  });
  return { axisMs, a: paths(a), b: paths(b), ticks: minuteTicks(axisMs) };
}

/** The pulls in drawing order: the one cut earlier first, so neither shade greys a part that is still analysed. */
export function drawOrder(a: OverviewTimeline, b: OverviewTimeline): ('a' | 'b')[] {
  const cut = (timeline: OverviewTimeline) => timeline.cutoffMs ?? Infinity;
  return cut(b) < cut(a) ? ['b', 'a'] : ['a', 'b'];
}
