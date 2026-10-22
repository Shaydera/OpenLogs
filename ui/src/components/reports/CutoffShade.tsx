import type { QuickOverview } from '../../api/types';
import { formatDuration, formatEventTimeTenths, formatOrdinal } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { analysedEndMs, useApp } from '../../store';
import { percentOf } from '../overview/timelineGeometry';
import { startsAfterCut } from './rangeGeometry';

/** Greys a plot of the whole pull from the death cutoff on: a dashed line at the cut with `mark`, `rest` in the greyed part. */
export function CutoffShade({ cutoffMs, durationMs, mark, rest }: { cutoffMs: number; durationMs: number; mark?: string; rest?: string }) {
  return (
    <div className="cutoff-shade" style={{ left: `${percentOf(cutoffMs, durationMs)}%` }}>
      {mark && <span className="cutoff-mark">{mark}</span>}
      {rest && <span className="cutoff-rest">{rest}</span>}
    </div>
  );
}

/** Why a phase starting at `startMs` cannot be picked: it lies after the death cutoff's analysed end `endMs`. */
export function afterCutTitle(startMs: number, endMs: number, deathCutoff: number | null): string | undefined {
  return deathCutoff !== null && startsAfterCut(startMs, endMs) ? t('cutoff.afterDeath', { nth: formatOrdinal(deathCutoff) }) : undefined;
}

/** The length of a pull's rest after its analysed end, as the shade names it. */
export function cutoffRest(analysedEnd: number, axisEndMs: number): string {
  return t('cutoff.rest', { duration: formatDuration(axisEndMs - analysedEnd) });
}

/** The shade over a plot of the whole pull `overview`, labelled with the cut death; nothing without a cut. */
export function PullCutoffShade({ overview }: { overview: QuickOverview }) {
  const deathCutoff = useApp((s) => s.deathCutoff);
  const { cutoffMs, durationMs } = overview.timeline;
  if (cutoffMs === null) return null;
  const mark = deathCutoff === null ? undefined : t('cutoff.markAt', { nth: formatOrdinal(deathCutoff), time: formatEventTimeTenths(cutoffMs) });
  return <CutoffShade cutoffMs={cutoffMs} durationMs={durationMs} mark={mark} rest={cutoffRest(analysedEndMs(overview), durationMs)} />;
}
