import { useRef, useState } from 'react';
import type { AbilityDetail, AbilityHit } from '../../api/types';
import { useFocusRequest } from '../../hooks/useFocusRequest';
import { spellIcon } from '../../icons';
import { formatAmount, formatAmountTenths, formatCount, formatEventTime, formatEventTimeTenths, formatFixed, formatInteger, formatSeconds, formatShare } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { Facts } from '../detail/Facts';
import { PageFilter } from '../detail/PageFilter';
import { TimeAxis } from '../detail/TimeAxis';
import { GameIcon } from '../GameIcon';
import { Kpi, KpiStrip } from '../Kpi';
import { classColor, shortName } from '../overview/players';
import { band } from '../player/chartGeometry';
import { abilityTraits, directHitsPerCast } from './abilityTraits';
import { hitHistogram, schoolName } from './hitHistogram';

const HIT_TICK_MAX_PX = 118;
const HISTOGRAM_BAR_MAX_PX = 180;

export function AbilityDetailView({ detail }: { detail: AbilityDetail }) {
  const back = useApp((s) => s.back);
  const openTarget = useApp((s) => s.openTarget);
  const [critsOnly, setCritsOnly] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useFocusRequest('page', () => titleRef.current);
  const name = shortName(detail.player.name);
  // Melee swings have no spell entry in the log.
  const title = detail.spellName || (detail.spellId === 0 ? t('overview.melee') : t('overview.unknownSpell', { id: detail.spellId }));
  const healing = detail.metric === 'healing';
  // Only player names carry a realm suffix; NPC names may contain hyphens of their own.
  const players = new Set(detail.playerTargets);
  const display = (unit: string) => (players.has(unit) ? shortName(unit) : unit);
  const rawTarget = (hit: AbilityHit) => detail.targetNames[String(hit.target)] ?? '?';
  const targetName = (hit: AbilityHit) => display(rawTarget(hit));
  const visible = detail.hits.filter((h) => (!critsOnly || h.critical) && (target === null || rawTarget(h) === target));

  const color = classColor(detail.player.classToken);
  const topTarget = Math.max(1, ...detail.byTarget.map((row) => row.amount));
  // The footer opens the selected target, else the one that took the most.
  const footTarget = target ?? detail.byTarget[0]?.name ?? null;

  return (
    <div className="player-page">
      <section className="dhead">
        <button type="button" className="accent-link" onClick={() => void back()}>
          {t('ability.back', { name })}
        </button>
        <GameIcon name={title} icon={spellIcon(detail.spellId)} large />
        <div className="dhead-id">
          <h1 ref={titleRef} tabIndex={-1} className="dhead-title">
            {title}
          </h1>
          <Facts
            items={[
              <>
                {t('ability.byWord')}{' '}
                <button type="button" className="dhead-player" style={{ color: classColor(detail.player.classToken) }} onClick={() => void back()}>
                  {name}
                </button>
              </>,
              <>
                {t('ability.spellIdLabel')} <span className="num value-text">{formatCount(detail.spellId)}</span>
              </>,
              schoolName(detail.school),
              detail.hits.length > 0 ? abilityTraits(detail) : null,
              detail.pet,
            ]}
          />
        </div>
      </section>
      <PageFilter dimensions={['target']} />
      <AbilityKpis detail={detail} name={name} targetName={targetName} />
      <HitsOverTime detail={detail} targetName={targetName} />
      <div className="ability-columns">
        {/* One selected target has no by-target block: the core sends none. */}
        {detail.byTarget.length > 0 && (
          <section className="panel dpane panel-clip" aria-labelledby="ability-targets-title">
            <div className="panel-head panel-head-tight panel-head-baseline">
              <h2 id="ability-targets-title" className="h2">
                {t('ability.byTarget')}
              </h2>
              <span className="panel-hint">{t('ability.byTargetHint')}</span>
            </div>
            <div className="tg-row tg-row-head" aria-hidden="true">
              <span className="cap tg-cap">{t('ability.target')}</span>
              <span className="cap tg-cap tg-end">{t('report.hits')}</span>
              <span className="cap tg-cap tg-end">{t('ability.critsCol')}</span>
              <span className="cap tg-cap">{t(healing ? 'tabs.healing' : 'player.damage')}</span>
            </div>
            <div role="group" aria-label={t('ability.byTarget')}>
              {detail.byTarget.map((row) => (
                <button
                  key={row.name}
                  type="button"
                  className={row.name === target ? 'tg-row tg-row-on' : 'tg-row'}
                  aria-pressed={row.name === target}
                  onClick={() => setTarget(row.name === target ? null : row.name)}
                >
                  <span className="tg-name">{display(row.name)}</span>
                  <span className="num tg-end">{formatCount(row.hits)}</span>
                  <span className="num tg-end tg-crits">{formatCount(row.crits)}</span>
                  <span className="tg-amount">
                    <span className="bar bar-md" aria-hidden="true">
                      <span style={{ width: `${(row.amount / topTarget) * 100}%`, background: color }} />
                    </span>
                    <span className="num tg-value">{formatAmountTenths(row.amount)}</span>
                  </span>
                </button>
              ))}
            </div>
            {!healing && footTarget !== null && (
              <div className="tg-foot">
                <button type="button" className="accent-link" onClick={() => void openTarget(footTarget)}>
                  {t('ability.openTarget', { name: footTarget })}
                </button>
              </div>
            )}
          </section>
        )}
        <Histogram detail={detail} color={color} />
      </div>
      <section className="panel panel-clip" aria-labelledby="ability-log-title">
        <div className="panel-head panel-head-tight">
          <h2 id="ability-log-title" className="h2">
            {t('ability.hitLog')}{' '}
            <span className="num hit-count">{t('ability.logCount', { shown: formatInteger(visible.length), total: formatInteger(detail.hits.length) })}</span>
          </h2>
          <div className="hit-filters" role="group" aria-label={t('ability.filter')}>
            <button type="button" className={critsOnly ? 'pill' : 'pill on'} aria-pressed={!critsOnly} onClick={() => setCritsOnly(false)}>
              {t('ability.allHits')}
            </button>
            <button type="button" className={critsOnly ? 'pill on' : 'pill'} aria-pressed={critsOnly} onClick={() => setCritsOnly(true)}>
              {t('ability.critsOnly')}
            </button>
            {target !== null && (
              <button type="button" className="pill on" onClick={() => setTarget(null)}>
                {t('ability.targetChip', { name: display(target) })}
              </button>
            )}
          </div>
        </div>
        <div role="table" aria-label={t('ability.hitLog')}>
          <div className="hit-row hit-row-head" role="row">
            <span role="columnheader" className="cap hit-cap">
              {t('ability.time')}
            </span>
            <span role="columnheader" className="cap hit-cap">
              {t('ability.target')}
            </span>
            <span role="columnheader" className="cap hit-cap hit-end">
              {t('report.amount')}
            </span>
            <span role="columnheader">
              <span className="sr-only">{t('ability.crit')}</span>
            </span>
          </div>
          {/* Focusable so the keyboard can scroll it. */}
          <div className="hit-scroll" role="rowgroup" tabIndex={0} aria-label={t('ability.hitLogRows')}>
            {visible.map((hit, i) => (
              <div key={`${hit.t}-${hit.target}-${i}`} className="hit-row" role="row">
                <span role="cell" className="num hit-time">
                  {formatEventTimeTenths(hit.t)}
                </span>
                <span role="cell" className="hit-target">
                  {targetName(hit)}
                </span>
                <span role="cell" className="num hit-end">
                  {formatInteger(hit.amount)}
                </span>
                <span role="cell">{hit.critical && <span className="crit-badge">{t('ability.crit')}</span>}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function largest(hits: AbilityHit[]): AbilityHit | undefined {
  return hits.reduce<AbilityHit | undefined>((best, h) => (!best || h.amount > best.amount ? h : best), undefined);
}

function AbilityKpis({ detail, name, targetName }: { detail: AbilityDetail; name: string; targetName: (h: AbilityHit) => string }) {
  const hits = detail.hits.length;
  const casts = detail.casts.length;
  // Direct hits only: a HoT's or DoT's ticks are no targets of its casts.
  const perCast = directHitsPerCast(detail);
  const crits = detail.hits.filter((h) => h.critical).length;
  const max = largest(detail.hits);
  const healing = detail.metric === 'healing';
  return (
    <KpiStrip label={t('ability.kpis')} variant="ability">
      <Kpi
        label={t(healing ? 'tabs.healing' : 'player.damage')}
        value={formatAmount(detail.total)}
        sub={
          detail.playerTotal > 0
            ? t(healing ? 'ability.shareHealing' : 'ability.shareDamage', { share: formatShare((detail.total / detail.playerTotal) * 100), name })
            : '—'
        }
      />
      <Kpi
        label={t('player.casts')}
        value={casts > 0 ? formatCount(casts) : '—'}
        sub={casts > 0 ? t('ability.castEvery', { duration: formatSeconds((detail.endMs - detail.startMs) / casts) }) : '—'}
      />
      <Kpi label={t('report.hits')} value={formatCount(hits)} sub={perCast !== null ? t('ability.perCast', { value: formatFixed(perCast, 2) }) : '—'} />
      <Kpi label={t('ability.critRate')} value={hits > 0 ? formatShare((crits / hits) * 100) : '—'} tone="accent" sub={t('ability.crits', { count: crits })} />
      <Kpi
        label={t('ability.avgMedianHit')}
        value={hits > 0 ? formatAmount(detail.total / hits) : '—'}
        sub={hits > 0 ? t('ability.median', { value: formatAmount(detail.median) }) : '—'}
      />
      <Kpi label={t('player.maxHit')} value={max ? formatAmount(max.amount) : '—'} sub={max ? `${targetName(max)} · ${formatEventTime(max.t)}` : '—'} />
      {detail.uptime !== null && <Kpi label={t('ability.uptime')} value={formatShare(detail.uptime * 100)} sub={t('ability.uptimeHint')} />}
    </KpiStrip>
  );
}

function HitsOverTime({ detail, targetName }: { detail: AbilityDetail; targetName: (h: AbilityHit) => string }) {
  const { startMs, endMs } = detail;
  const max = largest(detail.hits);
  const color = classColor(detail.player.classToken);
  const at = (time: number) => band(time, time + 1, startMs, endMs)?.leftPct;
  const label = max
    ? t('ability.chartLabel', { count: detail.hits.length, max: formatAmount(max.amount), time: formatEventTime(max.t), target: targetName(max) })
    : t('ability.noHits');
  return (
    <section className="panel chart-panel" aria-labelledby="ability-chart-title">
      <div className="chart-head">
        <h2 id="ability-chart-title" className="h2">
          {t('ability.hitsOverTime')}
        </h2>
        <ul className="chart-legend" aria-label={t('player.legend')}>
          <li className="chart-key">
            <span className="lg-swatch lg-swatch-tick" style={{ background: color }} />
            {t('ability.legendHit')}
          </li>
          <li className="chart-key">
            <span className="lg-swatch lg-swatch-crit" />
            {t('ability.crit')}
          </li>
          <li className="chart-key">
            <span className="lg-swatch lg-swatch-cast" />
            {t('ability.legendCast')}
          </li>
          <li className="chart-key">
            <span className="lg-swatch lg-swatch-dead" />
            {t('player.dead')}
          </li>
        </ul>
      </div>
      <div className="ahchart" role="img" aria-label={label}>
        {detail.dead.map(([a, b]) => {
          const pos = band(a, b, startMs, endMs);
          return pos ? <div key={a} className="pc-dead" style={{ left: `${pos.leftPct}%`, width: `${pos.widthPct}%` }} /> : null;
        })}
        <div className="ah-base" />
        {detail.hits.map((hit, i) => {
          const left = at(hit.t);
          if (left === undefined || !max) return null;
          const height = max.amount > 0 ? Math.max(3, Math.sqrt(hit.amount / max.amount) * HIT_TICK_MAX_PX) : 3;
          return (
            <div
              key={`${hit.t}-${i}`}
              className={hit.critical ? 'ah-hit crit' : 'ah-hit'}
              style={{ left: `${left}%`, height: `${height}px`, background: hit.critical ? undefined : color }}
            />
          );
        })}
        {detail.casts.map((time, i) => {
          const left = at(time);
          return left === undefined ? null : <div key={`${time}-${i}`} className="ah-cast" style={{ left: `${left}%` }} />;
        })}
        {max && <span className="pc-peak num">{formatAmount(max.amount)}</span>}
      </div>
      <TimeAxis startMs={startMs} endMs={endMs} />
    </section>
  );
}

function Histogram({ detail, color }: { detail: AbilityDetail; color: string }) {
  const bins = hitHistogram(detail.hits);
  const peak = Math.max(1, ...bins.map((b) => b.count));
  const summary = bins.map((b) => `${b.label}: ${formatInteger(b.count)}`).join(', ');
  return (
    <section className="panel chart-panel chart-panel-tall dpane" aria-labelledby="ability-dist-title">
      <div className="chart-head chart-head-hist">
        <h2 id="ability-dist-title" className="h2">
          {t('ability.distribution')}
        </h2>
        <span className="chart-note">{t('ability.distNote', { count: detail.hits.length })}</span>
      </div>
      <div className="hist-plot" role="img" aria-label={t('ability.distLabel', { summary: summary || t('ability.noHits') })}>
        {bins.map((b) => (
          <div key={b.fromAmount} className="hist-bin">
            <span className="num hist-count">{formatInteger(b.count)}</span>
            {b.crits > 0 && <div className="hist-crit" style={{ height: `${(b.crits / peak) * HISTOGRAM_BAR_MAX_PX}px` }} />}
            <div
              className={b.crits > 0 ? 'hist-hit' : 'hist-hit hist-hit-top'}
              style={{ height: `${((b.count - b.crits) / peak) * HISTOGRAM_BAR_MAX_PX}px`, background: color }}
            />
          </div>
        ))}
      </div>
      <div className="hist-labels" aria-hidden="true">
        {bins.map((b) => (
          <span key={b.fromAmount} className="num">
            {b.label}
          </span>
        ))}
      </div>
    </section>
  );
}
