import { useRef } from 'react';
import type { DeathRecap, DeathsReport } from '../../api/types';
import { useFocusRequest } from '../../hooks/useFocusRequest';
import { classIcon } from '../../icons';
import { formatAmount, formatEventTime, formatEventTimeTenths, formatPercent } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { GameIcon, MonogramTile } from '../GameIcon';
import { classColor, shortName } from '../overview/players';
import { hitIcon, hitName, reportSpellName, rosterIndex } from '../reports/reportData';
import { DEATH_LEAD_MS } from '../replay/playback';
import { hitSource, recapCallout, recapPlot } from './recapModel';

export function RecapPanel({ recap, report }: { recap: DeathRecap; report: DeathsReport }) {
  const openPlayer = useApp((s) => s.openPlayer);
  const openReplayAt = useApp((s) => s.openReplayAt);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useFocusRequest('page', () => titleRef.current);
  const spellName = (id: number) => reportSpellName(report.spells, id);
  const roster = rosterIndex(report.roster);
  const player = roster.get(recap.player);
  const name = shortName(recap.playerName);
  const colour = classColor(player?.classToken ?? null);
  const kb = recap.killingBlow;
  const rezzer = recap.resurrectedBy?.source != null ? roster.get(recap.resurrectedBy.source) : undefined;
  const callout = recapCallout(recap, spellName);
  const plot = recapPlot(recap);
  const first = recap.hp[0];
  const last = recap.hp[recap.hp.length - 1];
  const facts = [recap.specName, t('recap.number', { n: recap.number })].filter(Boolean).join(' · ');
  const resurrected =
    recap.resurrectedAt === null
      ? null
      : rezzer
        ? t('recap.resurrectedBy', { time: formatEventTime(recap.resurrectedAt), name: shortName(rezzer.name) })
        : t('recap.resurrected', { time: formatEventTime(recap.resurrectedAt) });

  return (
    <section className="panel" aria-labelledby="recap-title">
      <div className="panel-head panel-head-recap">
        {player?.classId != null ? (
          <GameIcon icon={classIcon(player.classId)} size={44} name={name} />
        ) : (
          <MonogramTile name={name} size={44} />
        )}
        <div className="recap-id">
          <h2 id="recap-title" ref={titleRef} tabIndex={-1} className="recap-title">
            <button type="button" className="recap-name" style={{ color: colour }} onClick={() => void openPlayer(recap.player)}>
              {name}
            </button>{' '}
            <span className="recap-dagger">{t('recap.dagger', { time: formatEventTime(recap.t) })}</span>
          </h2>
          <span className="recap-sub">
            {facts}
            {' · '}
            {kb ? (
              <>
                <span className="recap-em">{hitName(kb, spellName)}</span> {t('recap.by')} <span className="recap-em">{hitSource(kb)}</span>
              </>
            ) : (
              t('deaths.noLethalHit')
            )}
            {resurrected && ` · ${resurrected}`}
          </span>
          <button type="button" className="lnk recap-replay" onClick={() => openReplayAt(recap.t - DEATH_LEAD_MS)}>
            {t('replay.showIn')}
          </button>
        </div>
        <div className="recap-stats" role="group" aria-label={t('recap.kpis')}>
          <div className="recap-stat">
            <span className="cap">{t('recap.damage5s')}</span>
            <b className="recap-stat-dmg">{formatAmount(recap.damageTaken5s)}</b>
          </div>
          <div className="recap-stat">
            <span className="cap">{t('recap.healing5s')}</span>
            <b className="recap-stat-heal">{formatAmount(recap.healingTaken5s)}</b>
          </div>
          <div className="recap-stat">
            <span className="cap">{t('recap.hpBefore')}</span>
            <b>{recap.hpBeforePct !== null ? formatPercent(Math.round(recap.hpBeforePct)) : '—'}</b>
          </div>
          <div className="recap-stat">
            <span className="cap">{t('recap.overkill')}</span>
            <b className="recap-stat-death">{kb ? formatAmount(kb.overkill) : '—'}</b>
          </div>
        </div>
      </div>
      {callout && (
        <div className="recap-callout">
          {kb && <GameIcon icon={hitIcon(kb)} size={28} name={hitName(kb, spellName)} />}
          <p className="recap-callout-text">
            <span className="recap-lead">{callout.lead}</span>
            {callout.body}
            {callout.warning && <span className="recap-warn">{callout.warning}</span>}
          </p>
        </div>
      )}
      <div className="recap-chart-head">
        <span className="cap">{t('recap.hpTitle')}</span>
        <ul className="chart-legend" aria-label={t('recap.legend')}>
          <li className="chart-key">
            <span className="lg-swatch lg-swatch-dmg" aria-hidden="true" />
            {t('recap.legendDamage')}
          </li>
          <li className="chart-key">
            <span className="lg-swatch lg-swatch-heal" aria-hidden="true" />
            {t('recap.legendHealing')}
          </li>
        </ul>
      </div>
      <div
        className="recap-chart"
        role="img"
        aria-label={
          first && last
            ? t('recap.chartLabel', { name, from: formatPercent(Math.round(first.pct)), to: formatPercent(Math.round(last.pct)) })
            : t('recap.noHp')
        }
        style={{ color: colour }}
      >
        <div className="recap-guide" aria-hidden="true" />
        <svg viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true">
          {plot.area && <path d={plot.area} className="recap-area" />}
          {plot.line && <path d={plot.line} className="recap-line" />}
        </svg>
        {plot.damage.map((tick, i) => (
          <div key={`d${i}`} className="recap-tick recap-tick-dmg" style={{ left: `calc(${tick.leftPct}% - 1px)`, height: tick.heightPx }} />
        ))}
        {plot.heals.map((tick, i) => (
          <div key={`h${i}`} className="recap-tick recap-tick-heal" style={{ left: `calc(${tick.leftPct}% - 1px)`, height: tick.heightPx }} />
        ))}
        <span className="num recap-label recap-label-top" aria-hidden="true">
          {formatPercent(100)}
        </span>
        <span className="num recap-label recap-label-mid" aria-hidden="true">
          {formatPercent(50)}
        </span>
        <span className="num recap-label recap-label-start" aria-hidden="true">
          {formatEventTime(plot.startMs)}
        </span>
        <span className="num recap-label recap-label-death" aria-hidden="true">
          {t('recap.dagger', { time: formatEventTimeTenths(recap.t) })}
        </span>
      </div>
    </section>
  );
}
