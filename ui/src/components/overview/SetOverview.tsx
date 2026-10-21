import { useId, useMemo, useState } from 'react';
import type { Kpis, PullSet, SetPull } from '../../api/types';
import { formatAmount, formatDuration, formatEventTimeTenths, formatInteger, formatOrdinal, formatPercent, formatSeconds } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { PULL_CHIP } from '../../pulls/groupPulls';
import { useApp } from '../../store';
import { CutoffShade } from '../reports/CutoffShade';
import { type SetOrder, type SetRow, averageFirstDeath, bestPull, pullFirstDeaths, rowHpAtEnd, sortRows } from './setOverviewModel';

const CURVE_HEIGHT = 34;
const ORDERS: SetOrder[] = ['inOrder', 'bestFirst'];

function hpAtEndText(row: SetRow): string {
  const hp = rowHpAtEnd(row);
  return hp !== null ? formatPercent(hp) : '—';
}

const lengthText = (row: SetRow, ms: number) => (row.view.status === 'aborted' ? formatSeconds(ms) : formatDuration(ms));

function durationText(row: SetRow): string {
  const whole = lengthText(row, row.view.durationMs);
  return row.pull.cutoffMs === null ? whole : t('setOverview.cutDuration', { analysed: lengthText(row, row.pull.kpis.durationMs), whole });
}

const potions = (kpis: Kpis) => t('setOverview.potions', { used: formatInteger(kpis.combatPotions), without: formatInteger(kpis.playersWithoutCombatPotion) });

/** A pull's boss HP over its own length, as a line over a filled area; unknown samples are skipped. */
function BossHpCurve({ pull, durationMs }: { pull: SetPull; durationMs: number }) {
  const points = pull.bossHp.flatMap((hp, i) => (hp === null ? [] : [{ x: Math.min(100, ((i * pull.bossHpStepMs) / durationMs) * 100), y: CURVE_HEIGHT - (hp / 100) * CURVE_HEIGHT }]));
  if (points.length < 2) return null;
  const line = points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <svg className="set-curve" viewBox={`0 0 100 ${CURVE_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={t('setOverview.bossHp')}>
      <polygon className="set-curve-area" points={`${points[0].x},${CURVE_HEIGHT} ${line} ${last.x},${CURVE_HEIGHT}`} />
      <polyline className="set-curve-line" points={line} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg className="chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** The Overview of a pull set: one row per pull and a total row over all of them. */
export function SetOverview({ set, rows, kpis }: { set: PullSet; rows: SetRow[]; kpis: Kpis }) {
  const log = useApp((s) => s.log);
  const openFight = useApp((s) => s.openFight);
  const deathCutoff = useApp((s) => s.deathCutoff);
  const [order, setOrder] = useState<SetOrder>('inOrder');
  const titleId = useId();
  const shown = useMemo(() => sortRows(rows, order), [rows, order]);
  const longest = Math.max(1, ...rows.map((row) => row.view.durationMs));
  const bossName = log?.fights.find((fight) => fight.index === set.fights[0])?.name ?? '';
  const best = bestPull(rows);

  return (
    <section className="panel set-panel" aria-labelledby={titleId}>
      <div className="panel-head panel-head-ov">
        <div>
          <h2 id={titleId} className="h2">
            {t('setOverview.title')}
          </h2>
          <p className="panel-sub">{t('setOverview.subtitle')}</p>
        </div>
        <div className="seg" role="group" aria-label={t('setOverview.sort')}>
          {ORDERS.map((value) => (
            <button key={value} type="button" className={order === value ? 'on' : undefined} aria-pressed={order === value} onClick={() => setOrder(value)}>
              {t(`setOverview.${value}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="set-scroll">
        <div className={deathCutoff !== null ? 'set-table set-cut' : 'set-table'}>
          <div className="set-row set-head" aria-hidden="true">
            <span className="cap">{t('pulls.column.pull')}</span>
            <span className="cap">{t('pulls.column.result')}</span>
            <span className="cap num-col">{t('pulls.column.duration')}</span>
            <span className="cap">{t('setOverview.column.bossHp')}</span>
            <span className="cap num-col">{t('setOverview.column.atEnd')}</span>
            {deathCutoff !== null && <span className="cap">{t('setOverview.column.endsAt')}</span>}
            <span className="cap num-col">{t('setOverview.column.deaths')}</span>
            <span className="cap num-col">{t('setOverview.column.firstDeath')}</span>
            <span className="cap num-col">{t('setOverview.column.raidDps')}</span>
            <span className="cap num-col">{t('setOverview.column.potions')}</span>
            <span />
          </div>
          {shown.map((row) => (
            <button
              key={row.view.index}
              type="button"
              className="set-row set-pull"
              aria-label={t('pulls.open', { n: row.view.n, boss: bossName })}
              onClick={() => void openFight(row.view.index)}
            >
              <span className="num text-muted">#{row.view.n}</span>
              <span className={`chip ${PULL_CHIP[row.view.status]}`}>{t(`status.${row.view.status}`)}</span>
              <span className="num num-col">{durationText(row)}</span>
              <span className="set-track" style={{ width: `${(row.view.durationMs / longest) * 100}%` }}>
                <BossHpCurve pull={row.pull} durationMs={row.view.durationMs} />
                {row.pull.cutoffMs !== null && <CutoffShade cutoffMs={row.pull.cutoffMs} durationMs={row.view.durationMs} />}
              </span>
              <span className="num num-col text-soft">{hpAtEndText(row)}</span>
              {deathCutoff !== null && (
                <span className={row.pull.cutoffMs !== null ? 'set-ends-cut' : 'text-soft'}>
                  {row.pull.cutoffMs !== null ? t('cutoff.mark', { nth: formatOrdinal(deathCutoff) }) : t('setOverview.pullEnd')}
                </span>
              )}
              <span className="num num-col">{formatInteger(row.pull.kpis.deaths)}</span>
              <span className="num num-col text-soft">{row.pull.kpis.firstDeathMs !== null ? formatEventTimeTenths(row.pull.kpis.firstDeathMs) : '—'}</span>
              <span className="num num-col">{formatAmount(row.pull.kpis.raidDps)}</span>
              <span className="num num-col text-soft">{potions(row.pull.kpis)}</span>
              <Chevron />
            </button>
          ))}
          <div className="set-row set-total" role="group" aria-label={t(`pulls.set.${set.kind}`)}>
            <span className="set-total-label">{t(`pulls.set.${set.kind}`)}</span>
            <span className="num num-col">{formatDuration(kpis.durationMs)}</span>
            <span className="set-best">
              {best &&
                (best.kind === 'wipe'
                  ? t('setOverview.bestWipe', { percent: formatPercent(rowHpAtEnd(best.row) ?? 0), n: best.row.view.n })
                  : t('setOverview.bestKill', { duration: formatDuration(best.row.view.durationMs), n: best.row.view.n }))}
            </span>
            <span />
            {deathCutoff !== null && <span />}
            <span className="num num-col">{formatInteger(kpis.deaths)}</span>
            <span className="num num-col text-soft">{averageFirstDeath(pullFirstDeaths(rows))}</span>
            <span className="num num-col">{formatAmount(kpis.raidDps)}</span>
            <span className="num num-col text-soft">{potions(kpis)}</span>
            <span />
          </div>
        </div>
      </div>
    </section>
  );
}
