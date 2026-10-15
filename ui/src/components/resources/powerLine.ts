import type { TimeRange } from '../../store';

/** A logged power or health sample: `[t, current, max]`. */
export type Sample = [number, number, number];

/** A power line's box: 1000 wide, this tall. */
export const LINE_BOX_HEIGHT = 40;
const WIDTH = 1000;

const round1 = (v: number) => Math.round(v * 10) / 10;
const share = ([, current, max]: Sample) => (max > 0 ? current / max : 0);
/** Full at y 2, empty at y 38: the line never touches the frame; values past either end are drawn at it. */
const y = (sample: Sample) => round1(38 - Math.min(1, Math.max(0, share(sample))) * 36);

interface Step {
  fromMs: number;
  toMs: number;
  y: number;
}

/**
 * Each sample's value held until the next sample, as the log has it (power is a state, never
 * interpolated), cut at the window's edges and out of the dead phases. Runs break where a phase was cut out.
 */
function runs(samples: Sample[], window: TimeRange, dead: [number, number][]): Step[][] {
  const all: Step[][] = [];
  let run: Step[] = [];
  const add = (fromMs: number, toMs: number, sample: Sample) => {
    const last = run[run.length - 1];
    if (last && last.toMs !== fromMs) {
      all.push(run);
      run = [];
    }
    run.push({ fromMs, toMs, y: y(sample) });
  };
  samples.forEach((sample, i) => {
    const next = samples[i + 1];
    const fromMs = Math.max(window.startMs, sample[0]);
    const toMs = Math.min(window.endMs, next ? next[0] : window.endMs);
    if (toMs < fromMs) return;
    let cursor = fromMs;
    let cut = false;
    for (const [a, b] of dead) {
      if (b <= cursor || a >= toMs) continue;
      if (a > cursor) add(cursor, a, sample);
      cursor = Math.max(cursor, b);
      cut = true;
    }
    if (cursor < toMs || !cut) add(cursor, toMs, sample);
  });
  if (run.length > 0) all.push(run);
  return all;
}

const x = (ms: number, window: TimeRange) => round1(((ms - window.startMs) / Math.max(1, window.endMs - window.startMs)) * WIDTH);
const runPath = (run: Step[], window: TimeRange) =>
  run.map((step, i) => `${i === 0 ? 'M' : 'L'} ${x(step.fromMs, window)} ${step.y} H ${x(step.toMs, window)}`).join(' ');

/** The line of samples in the window, broken where the unit was dead (`dead`, absolute times). */
export function powerPath(samples: Sample[], window: TimeRange, dead: [number, number][] = []): string {
  return runs(samples, window, dead)
    .map((run) => runPath(run, window))
    .join(' ');
}

/** The area under the line, each run closed to the bottom of the box. */
export function powerArea(samples: Sample[], window: TimeRange, dead: [number, number][] = []): string {
  return runs(samples, window, dead)
    .map((run) => `${runPath(run, window)} V ${LINE_BOX_HEIGHT} H ${x(run[0].fromMs, window)} Z`)
    .join(' ');
}

/** The sample in force at `ms`: the last one at or before it. */
export function sampleAt(samples: Sample[], ms: number): Sample | null {
  let found: Sample | null = null;
  for (const sample of samples) {
    if (sample[0] > ms) break;
    found = sample;
  }
  return found;
}

/** The lowest share of max in the window: the sample in force at its start and those logged inside it. */
export function lowestIn(samples: Sample[], window: TimeRange): Sample | null {
  let lowest = sampleAt(samples, window.startMs);
  for (const sample of samples) {
    if (sample[0] <= window.startMs || sample[0] > window.endMs) continue;
    if (lowest === null || share(sample) < share(lowest)) lowest = sample;
  }
  return lowest;
}

export const sampleShare = share;
