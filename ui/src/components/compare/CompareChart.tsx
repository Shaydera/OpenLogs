import { Fragment, type ReactNode } from 'react';
import type { PullComparison } from '../../api/types';
import { type MessageKey, t } from '../../i18n/i18n';
import { timelineSummary } from '../overview/timelineGeometry';
import { CutoffShade } from '../reports/CutoffShade';
import { type PullPaths, compareChart, drawOrder } from './compareGeometry';

type Side = 'a' | 'b';

/** Boss HP and raid DPS of both pulls, stacked over one time axis as long as the longer pull; each pull greyed from its own cut. */
export function CompareChart({ data, labelA, labelB }: { data: PullComparison; labelA: string; labelB: string }) {
  const a = data.a.overview.timeline;
  const b = data.b.overview.timeline;
  const chart = compareChart(a, b);
  const order = drawOrder(a, b);
  const summary = [
    { pull: labelA, text: timelineSummary(a) },
    { pull: labelB, text: timelineSummary(b) },
  ]
    .filter((entry) => entry.text !== '')
    .map((entry) => t('compare.chartSummary', { pull: entry.pull, summary: entry.text }))
    .join(' ');
  const plot = (cap: MessageKey, draw: (paths: PullPaths, side: Side) => ReactNode) => (
    <div className="cmp-plot" aria-hidden="true">
      <span className="cap">{t(cap)}</span>
      {order.map((side) => {
        const { cutoffMs } = data[side].overview.timeline;
        return (
          <Fragment key={side}>
            <svg viewBox="0 0 1000 100" preserveAspectRatio="none">
              {draw(chart[side], side)}
            </svg>
            {cutoffMs !== null && <CutoffShade cutoffMs={cutoffMs} durationMs={chart.axisMs} />}
          </Fragment>
        );
      })}
    </div>
  );
  return (
    <section className="panel" aria-labelledby="cmp-chart-title">
      <div className="panel-head">
        <h2 id="cmp-chart-title" className="h2">
          {t('compare.overTime')}
        </h2>
        <ul className="legend">
          <li className="legend-pull-a">{labelA}</li>
          <li className="legend-pull-b">{t('compare.legendDashed', { pull: labelB })}</li>
        </ul>
      </div>
      {plot('timeline.bossHp', (paths, side) => paths.bossHp && <path d={paths.bossHp} className={`cmp-hp-${side}`} />)}
      {plot('timeline.raidDps', (paths, side) => paths.dps && <path d={paths.dps} className={`cmp-dps-${side}`} />)}
      {summary && <p className="sr-only">{summary}</p>}
      <div className="tl-axis" aria-hidden="true">
        {chart.ticks.map((tick) => (
          <span key={tick.label} className="num" style={{ left: `${tick.leftPct}%` }}>
            {tick.label}
          </span>
        ))}
      </div>
    </section>
  );
}
