import type { PullComparison } from '../../api/types';
import { t } from '../../i18n/i18n';
import { timelineSummary } from '../overview/timelineGeometry';
import { compareChart } from './compareGeometry';

/** Boss HP and raid DPS of both pulls, stacked over one time axis as long as the longer pull. */
export function CompareChart({ data, labelA, labelB }: { data: PullComparison; labelA: string; labelB: string }) {
  const a = data.a.overview.timeline;
  const b = data.b.overview.timeline;
  const chart = compareChart(a, b);
  const summary = [
    { pull: labelA, text: timelineSummary(a) },
    { pull: labelB, text: timelineSummary(b) },
  ]
    .filter((entry) => entry.text !== '')
    .map((entry) => t('compare.chartSummary', { pull: entry.pull, summary: entry.text }))
    .join(' ');
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
      <div className="cmp-plot" aria-hidden="true">
        <span className="cap">{t('timeline.bossHp')}</span>
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none">
          {chart.a.bossHp && <path d={chart.a.bossHp} className="cmp-hp-a" />}
          {chart.b.bossHp && <path d={chart.b.bossHp} className="cmp-hp-b" />}
        </svg>
      </div>
      <div className="cmp-plot" aria-hidden="true">
        <span className="cap">{t('timeline.raidDps')}</span>
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none">
          {chart.a.dps && <path d={chart.a.dps} className="cmp-dps-a" />}
          {chart.b.dps && <path d={chart.b.dps} className="cmp-dps-b" />}
        </svg>
      </div>
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
