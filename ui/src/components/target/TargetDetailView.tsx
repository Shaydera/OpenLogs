import { useRef } from 'react';
import type { TargetDetail } from '../../api/types';
import { useFocusRequest } from '../../hooks/useFocusRequest';
import { formatAmount, formatEventTime, formatInteger, formatMillions, formatSeconds, formatShare } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { Facts } from '../detail/Facts';
import { PageFilter } from '../detail/PageFilter';
import { TimeAxis } from '../detail/TimeAxis';
import { Kpi, KpiStrip } from '../Kpi';
import { classColor, shortName } from '../overview/players';
import { PlayerIcon } from '../reports/PlayerName';
import { rosterIndex } from '../reports/reportData';
import { EnemyTile } from './EnemyTile';
import { intermissionBands, lifetimeLanes, SLOW_CLEAR_MS } from './lifetimeGeometry';

const LANE_PITCH_PX = 6;
const LANE_INSET_PX = 4;
const MIN_CHART_HEIGHT_PX = 40;

export function TargetDetailView({ detail }: { detail: TargetDetail }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useFocusRequest('page', () => titleRef.current);
  const openTarget = useApp((s) => s.openTarget);
  const openPlayer = useApp((s) => s.openPlayer);
  const killed = detail.units.flatMap((u) => (u.death === null ? [] : [{ firstHit: u.firstHit, life: u.death - u.firstHit }]));
  const longest = killed.reduce<(typeof killed)[number] | undefined>((best, u) => (!best || u.life > best.life ? u : best), undefined);
  const roster = rosterIndex(detail.roster);
  const topPlayer = Math.max(1, ...detail.byPlayer.map((p) => p.amount));
  const alive = detail.units.length - killed.length;
  // "Rawling spawned at 3:32": the last word of the name stands for one unit.
  const unit = detail.name.split(' ').at(-1) ?? detail.name;
  const overview = useApp((s) => s.overview);
  const lanes = lifetimeLanes(detail.units, detail.startMs, detail.endMs, unit);
  const bands = intermissionBands(overview?.timeline.phases ?? [], detail.startMs, detail.endMs);

  return (
    <div className="enemy-page">
      <aside className="panel enemy-panel" aria-labelledby="target-enemies-title">
        <div className="panel-head panel-head-tight">
          <div>
            <h2 id="target-enemies-title" className="h2">
              {t('target.enemiesCount', { count: detail.enemies.length })}
            </h2>
            <div className="panel-sub">{t('target.enemiesHint')}</div>
          </div>
        </div>
        <div role="group" aria-label={t('target.enemies')}>
          {detail.enemies.map((enemy) => {
            const current = enemy.name === detail.name;
            return (
              <button
                key={enemy.name}
                type="button"
                className={current ? 'elink elink-on' : 'elink'}
                aria-current={current ? 'page' : undefined}
                onClick={() => void openTarget(enemy.name)}
              >
                <EnemyTile name={enemy.name} primary={enemy.primary} />
                <span className="elink-text">
                  <span className="elink-name">{enemy.name}</span>
                  <span className="elink-sub">
                    {[
                      t('target.units', { count: enemy.units }),
                      enemy.sharesBossHp ? t('target.sharesHpShort') : enemy.isBoss ? t('target.boss') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="num elink-amount">{formatMillions(enemy.damageTaken)}</span>
              </button>
            );
          })}
        </div>
      </aside>
      <div className="target-main">
        <section className="dhead dhead-enemy">
          <EnemyTile name={detail.name} primary={detail.primary} large />
          <div className="dhead-id">
            <h1 ref={titleRef} tabIndex={-1} className="dhead-title dhead-title-enemy">
              {detail.name}
            </h1>
            <Facts
              items={[
                t(detail.isBoss ? 'target.boss' : 'target.add'),
                t('target.spawned', { count: detail.units.length }),
                <span className="fact-kill">{t('target.killed', { count: killed.length })}</span>,
                alive > 0 ? <span className="fact-warn">{t('target.alive', { count: alive })}</span> : null,
                detail.sharesBossHp ? <span title={t('target.sharesHp')}>{t('target.sharesHpShort')}</span> : null,
              ]}
            />
          </div>
        </section>
        <PageFilter dimensions={['source', 'ability']} />
        <KpiStrip label={t('target.kpis')}>
          <Kpi
            label={t('target.damageTaken')}
            value={formatAmount(detail.damageTaken)}
            sub={detail.raidDamage > 0 ? t('target.ofRaid', { share: formatShare((detail.damageTaken / detail.raidDamage) * 100) }) : '—'}
          />
          <Kpi
            label={t('target.maxHp')}
            value={detail.maxHp !== null ? formatAmount(detail.maxHp) : '—'}
            sub={t(detail.isBoss ? 'target.perUnit' : 'target.perAdd')}
          />
          <Kpi
            label={t('target.avgLife')}
            value={killed.length > 0 ? formatSeconds(killed.reduce((sum, u) => sum + u.life, 0) / killed.length) : '—'}
            sub={t('target.avgLifeHint')}
          />
          <Kpi
            label={t('target.longest')}
            value={longest ? formatSeconds(longest.life) : '—'}
            tone={longest ? 'warn' : undefined}
            sub={longest ? t('target.spawnedAt', { unit, time: formatEventTime(longest.firstHit) }) : '—'}
          />
          <Kpi label={t('target.waves')} value={formatInteger(detail.waves.length)} sub={t('target.wavesHint')} />
        </KpiStrip>
        <section className="panel chart-panel" aria-labelledby="target-life-title">
          <div className="chart-head">
            <h2 id="target-life-title" className="h2">
              {t(detail.isBoss ? 'target.lifetimes' : 'target.addLifetimes')}
            </h2>
            <ul className="chart-legend" aria-label={t('player.legend')}>
              <li className="chart-key">
                <span className="lg-swatch lg-swatch-short" />
                {t('target.legendShort')}
              </li>
              <li className="chart-key">
                <span className="lg-swatch lg-swatch-long" />
                {t('target.legendLong')}
              </li>
              <li className="chart-key">
                <span className="lg-swatch lg-swatch-alive" />
                {t('target.legendAlive')}
              </li>
              <li className="chart-key">{t(detail.isBoss ? 'target.legendRowsUnits' : 'target.legendRows')}</li>
            </ul>
          </div>
          <div
            className="lt-chart"
            role="img"
            aria-label={t('target.lifetimesLabel', { units: formatInteger(detail.units.length), waves: formatInteger(detail.waves.length) })}
            style={{ height: `${Math.max(MIN_CHART_HEIGHT_PX, LANE_INSET_PX + lanes.length * LANE_PITCH_PX)}px` }}
          >
            {bands.map((b) => (
              <div key={b.leftPct} className="lt-phase" style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }} />
            ))}
            {lanes.map((lane, i) => (
              <div
                key={lane.actor}
                className={`lt-lane ${lane.kind}`}
                title={lane.title}
                style={{ top: `${LANE_INSET_PX + i * LANE_PITCH_PX}px`, left: `${lane.leftPct}%`, width: `${lane.widthPct}%` }}
              />
            ))}
          </div>
          <ul className="sr-only" aria-label={t('target.lifetimes')}>
            {lanes.map((lane) => (
              <li key={lane.actor}>{lane.title}</li>
            ))}
          </ul>
          <TimeAxis startMs={detail.startMs} endMs={detail.endMs} />
        </section>
        <div className="target-columns">
          <section className="panel tpane" aria-labelledby="target-waves-title">
            <div className="panel-head panel-head-tight">
              <h2 id="target-waves-title" className="h2">
                {t('target.waves')}
              </h2>
            </div>
            <div className="scroll-x">
              <div className="wave-rows" role="table" aria-label={t('target.waves')}>
                <div className="wave-row wave-row-head" role="row">
                  <span role="columnheader" className="cap wave-cap">
                    #
                  </span>
                  <span role="columnheader" className="cap wave-cap">
                    {t('target.spawn')}
                  </span>
                  <span role="columnheader" className="cap wave-cap wave-end">
                    {t(detail.isBoss ? 'target.unitsCol' : 'target.addsCol')}
                  </span>
                  <span role="columnheader" className="cap wave-cap wave-end">
                    {t('target.killedCol')}
                  </span>
                  <span role="columnheader" className="cap wave-cap wave-end">
                    {t('target.cleared')}
                  </span>
                  <span role="columnheader" className="cap wave-cap wave-end">
                    {t('target.avgLife')}
                  </span>
                </div>
                {detail.waves.map((wave, i) => (
                  <div key={wave.startMs} className="wave-row" role="row">
                    <span role="cell" className="num wave-n">
                      {formatInteger(i + 1)}
                    </span>
                    <span role="cell" className="num">
                      {formatEventTime(wave.startMs)}
                    </span>
                    <span role="cell" className="num wave-end">
                      {formatInteger(wave.units)}
                    </span>
                    <span role="cell" className={wave.killed < wave.units ? 'num wave-end wave-warn' : 'num wave-end'}>
                      {`${formatInteger(wave.killed)}/${formatInteger(wave.units)}`}
                    </span>
                    <span role="cell" className={wave.clearMs >= SLOW_CLEAR_MS ? 'num wave-end wave-warn' : 'num wave-end'}>
                      {formatSeconds(wave.clearMs)}
                    </span>
                    <span role="cell" className="num wave-end wave-avg">
                      {wave.avgLifeMs !== null ? formatSeconds(wave.avgLifeMs) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
          {/* One selected source has no by-player block: the core sends none. */}
          {detail.byPlayer.length > 0 && (
            <section className="panel tpane" aria-labelledby="target-players-title">
              <div className="panel-head panel-head-tight">
                <h2 id="target-players-title" className="h2">
                  {t('target.byPlayer')}
                </h2>
              </div>
              <div role="table" aria-label={t('target.byPlayer')}>
                {detail.byPlayer.map((row) => {
                  const player = roster.get(row.player);
                  const color = classColor(player?.classToken ?? null);
                  return (
                    <div key={row.player} className="bp-row" role="row">
                      <span role="cell">
                        <PlayerIcon player={player} size={18} />
                      </span>
                      <span role="cell" className="bp-name-cell">
                        <button type="button" className="bp-name" style={{ color }} onClick={() => void openPlayer(row.player)}>
                          {player ? shortName(player.name) : t('report.unknownPlayer')}
                        </button>
                      </span>
                      <span role="cell">
                        <span className="bar bar-md bp-bar" aria-hidden="true">
                          <span className="bp-fill" style={{ width: `${(row.amount / topPlayer) * 100}%`, background: color }} />
                        </span>
                      </span>
                      <span role="cell" className="num bp-end">
                        {formatMillions(row.amount)}
                      </span>
                      <span role="cell" className="num bp-end bp-share">
                        {detail.damageTaken > 0 ? formatShare((row.amount / detail.damageTaken) * 100) : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
