import { useRef } from 'react';
import type { FightRow, PullComparison } from '../../api/types';
import { useFocusRequest } from '../../hooks/useFocusRequest';
import { formatDuration, formatEventTime } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { type PullStatus, type PullView, pullView } from '../../pulls/groupPulls';
import { useApp } from '../../store';
import { AttributionToggle } from '../reports/AttributionToggle';
import { CompareChart } from './CompareChart';
import { CompareDeaths } from './CompareDeaths';
import { ComparePlayers } from './ComparePlayers';
import { durationDelta, endHpLabel, kpiRows, phaseRows } from './compareData';

const CHIP: Record<PullStatus, string> = { kill: 'kill', wipe: 'wipe', incomplete: 'wipe', aborted: 'abort' };

const startLabel = (ms: number | null) => (ms === null ? '—' : formatEventTime(ms));

/** Two pulls side by side; replaces the pull's tabs until "Back". */
export function PullComparisonView({ row }: { row: FightRow }) {
  const comparison = useApp((s) => s.comparison);
  const log = useApp((s) => s.log);
  const closeComparison = useApp((s) => s.closeComparison);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useFocusRequest('compare', () => titleRef.current);
  const fights = log?.fights ?? [];
  const pullA = comparison ? pullView(fights, comparison.a) : null;
  const pullB = comparison ? pullView(fights, comparison.b) : null;
  const shown = pullView(fights, row.index);
  if (!comparison || !pullA || !pullB || !shown) return null;

  return (
    <div>
      <header className="fight-head">
        <button type="button" className="btn" onClick={() => void closeComparison()}>
          {t('compare.back', { n: shown.n })}
        </button>
        <h1 ref={titleRef} tabIndex={-1} className="fight-title">
          {t('compare.title', { boss: row.name, a: pullA.n, b: pullB.n })}
        </h1>
        <AttributionToggle label={t('compare.aug')} />
      </header>
      <div className="layout">
        <main className="content">
          <section className="cmp-pulls" aria-label={t('compare.pulls')}>
            <PullCard pull={pullA} side="a" />
            <PullCard pull={pullB} side="b" />
          </section>
          {comparison.error !== null ? (
            <p className="muted">{t('compare.failed', { reason: comparison.error })}</p>
          ) : comparison.data === null ? (
            <p className="muted">{t('compare.loading')}</p>
          ) : (
            <>
              {/* The shown numbers stay while another Aug mode is calculated. */}
              {comparison.loading && (
                <p className="muted" role="status">
                  {t('compare.loading')}
                </p>
              )}
              <ComparisonBody data={comparison.data} nA={pullA.n} nB={pullB.n} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function PullCard({ pull, side }: { pull: PullView; side: 'a' | 'b' }) {
  const label = t('compare.pull', { n: pull.n });
  return (
    <div role="group" aria-label={label} className="panel panel-pad cmp-pull">
      <span className={`cmp-swatch cmp-swatch-${side}`} aria-hidden="true" />
      <h2 className="h2">{label}</h2>
      <span className={`chip ${CHIP[pull.status]}`}>{t(`status.${pull.status}`)}</span>
      <span className="num">{formatDuration(pull.durationMs)}</span>
      <span className="muted">{t('fight.bossHp', { percent: endHpLabel(pull) })}</span>
    </div>
  );
}

function ComparisonBody({ data, nA, nB }: { data: PullComparison; nA: number; nB: number }) {
  const labelA = t('compare.pull', { n: nA });
  const labelB = t('compare.pull', { n: nB });
  const phases = phaseRows(data.a.overview.timeline.phases, data.b.overview.timeline.phases);
  return (
    <>
      <section className="panel" aria-labelledby="cmp-kpis-title">
        <div className="panel-head">
          <h2 id="cmp-kpis-title" className="h2">
            {t('overview.kpis')}
          </h2>
        </div>
        <table className="ctable rtable" aria-labelledby="cmp-kpis-title">
          <thead>
            <tr>
              <th scope="col" className="cap">{t('compare.figure')}</th>
              <th scope="col" className="cap r">{labelA}</th>
              <th scope="col" className="cap r">{labelB}</th>
              <th scope="col" className="cap r">{t('compare.difference')}</th>
            </tr>
          </thead>
          <tbody>
            {kpiRows(data.a.overview.kpis, data.b.overview.kpis).map((kpi) => (
              <tr key={kpi.label}>
                <th scope="row">{t(kpi.label)}</th>
                <td className="r num">{kpi.a}</td>
                <td className="r num">{kpi.b}</td>
                <td className="r num">{kpi.delta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <CompareChart data={data} labelA={labelA} labelB={labelB} />
      <section className="panel" aria-labelledby="cmp-phases-title">
        <div className="panel-head">
          <h2 id="cmp-phases-title" className="h2">
            {t('compare.phases')}
          </h2>
        </div>
        {phases.length === 0 ? (
          <p className="muted pad">{t('compare.noPhases')}</p>
        ) : (
          <table className="ctable rtable" aria-labelledby="cmp-phases-title">
            <thead>
              <tr>
                <th scope="col" className="cap">{t('compare.phase')}</th>
                <th scope="col" className="cap r">{labelA}</th>
                <th scope="col" className="cap r">{labelB}</th>
                <th scope="col" className="cap r">{t('compare.difference')}</th>
              </tr>
            </thead>
            <tbody>
              {phases.map((phase) => (
                <tr key={phase.label}>
                  <th scope="row">{phase.label}</th>
                  <td className="r num">{startLabel(phase.a)}</td>
                  <td className="r num">{startLabel(phase.b)}</td>
                  <td className="r num">{phase.a !== null && phase.b !== null ? durationDelta(phase.a, phase.b) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <ComparePlayers players={data.players} nA={nA} nB={nB} />
      <CompareDeaths data={data} labelA={labelA} labelB={labelB} />
    </>
  );
}
