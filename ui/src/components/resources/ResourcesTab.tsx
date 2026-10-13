import { useState } from 'react';
import type { PowerTrack, ResourcesReport } from '../../api/types';
import { spellIcon } from '../../icons';
import { formatAmount, formatDuration, formatPercent, formatSeconds, formatShare } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { TimeAxis } from '../detail/TimeAxis';
import { GameIcon } from '../GameIcon';
import { Kpi } from '../Kpi';
import { classColor, ROLE_ORDER, shortName } from '../overview/players';
import { band } from '../player/chartGeometry';
import { PlayerIcon } from '../reports/PlayerName';
import { reportSpellName, rosterIndex } from '../reports/reportData';
import { powerName } from './powerNames';
import { powerColour, resourcePaths } from './resourceGeometry';

export function ResourcesTab({ report }: { report: ResourcesReport }) {
  const openPlayer = useApp((s) => s.openPlayer);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const roster = rosterIndex(report.roster);
  if (report.players.length === 0) {
    return (
      <section className="panel" aria-labelledby="res-empty-title">
        <div className="panel-head panel-head-tight">
          <h2 id="res-empty-title" className="h2">
            {t('tabs.resources')}
          </h2>
        </div>
        <p className="muted pad">{t('resources.none')}</p>
      </section>
    );
  }
  const nameOf = (id: number) => shortName(roster.get(id)?.name ?? '');
  const players = [...report.players].sort(
    (a, b) =>
      ROLE_ORDER.indexOf(roster.get(a.player)?.role ?? null) - ROLE_ORDER.indexOf(roster.get(b.player)?.role ?? null) ||
      nameOf(a.player).localeCompare(nameOf(b.player)),
  );
  const selected = players.find((p) => p.player === selectedId) ?? players[0];
  const selectedRef = roster.get(selected.player);
  const label = t('resources.playersCount', { count: players.length });
  const spellName = (id: number) => reportSpellName(report.spells, id);

  return (
    <div className="res-page">
      <aside className="panel panel-clip res-list" aria-labelledby="res-list-title">
        <div className="panel-head panel-head-tight">
          <div>
            <h2 id="res-list-title" className="h2">
              {label}
            </h2>
            <div className="panel-sub">{t('resources.listHint')}</div>
          </div>
        </div>
        <div role="group" aria-label={label}>
          {players.map((p) => {
            const ref = roster.get(p.player);
            const primary = p.tracks[0];
            const on = p.player === selected.player;
            return (
              <button key={p.player} type="button" className={on ? 'plink plink-on' : 'plink'} aria-pressed={on} onClick={() => setSelectedId(p.player)}>
                <PlayerIcon player={ref} size={22} />
                <span className="plink-text">
                  <span className="plink-name" style={{ color: classColor(ref?.classToken ?? null) }}>
                    {nameOf(p.player)}
                  </span>
                  <span className="plink-sub">{[ref?.specName, p.tracks.map((tr) => powerName(tr.powerType)).join(', ')].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="num plink-value">{primary?.avgPct != null ? formatShare(primary.avgPct) : '—'}</span>
              </button>
            );
          })}
        </div>
      </aside>
      <section className="panel panel-clip res-main" aria-labelledby="res-title">
        <div className="panel-head panel-head-side">
          <PlayerIcon player={selectedRef} size={36} />
          <div className="side-title">
            <h2 id="res-title" className="h2">
              <span style={{ color: classColor(selectedRef?.classToken ?? null) }}>{nameOf(selected.player)}</span>{' '}
              <span className="res-title-suffix">{t('resources.titleSuffix')}</span>
            </h2>
            <span className="side-sub">
              {[selectedRef?.specName, t('resources.trackCount', { count: selected.tracks.length })].filter(Boolean).join(' · ')}
            </span>
          </div>
          <button type="button" className="link-accent" onClick={() => void openPlayer(selected.player)}>
            {t('report.playerDetails')}
          </button>
        </div>
        {selected.tracks.map((track) => (
          <ResourceTrack
            key={track.powerType}
            track={track}
            report={report}
            dead={selected.dead}
            colour={powerColour(track.powerType, selectedRef?.classToken ?? null)}
            spellName={spellName}
          />
        ))}
      </section>
    </div>
  );
}

function ResourceTrack({
  track,
  report,
  dead,
  colour,
  spellName,
}: {
  track: PowerTrack;
  report: ResourcesReport;
  dead: [number, number][];
  colour: string;
  spellName: (id: number) => string;
}) {
  const name = powerName(track.powerType);
  const id = `res-track-${track.powerType}`;
  const paths = resourcePaths(track.series, report.stepMs, report.startMs, report.endMs, dead);
  const bands = dead.flatMap(([a, b]) => {
    const pos = band(a, b, report.startMs, report.endMs);
    return pos ? [pos] : [];
  });
  const pct = (value: number | null) => (value !== null ? formatShare(value) : '—');
  // A minute and more as m:ss like every other duration.
  const capTime = (ms: number) => (ms <= 0 ? '—' : ms < 60_000 ? formatSeconds(ms) : formatDuration(ms));
  const largest = Math.max(1, ...track.gains.map((g) => g.gained));
  return (
    <section className="res-track" aria-labelledby={id}>
      <div className="res-track-head">
        <h3 id={id} className="res-track-title">
          {name}
        </h3>
        <ul className="chart-legend" aria-label={t('recap.legend')}>
          <li className="chart-key">
            <span className="lg-swatch lg-swatch-power" style={{ background: colour }} aria-hidden="true" />
            {t('resources.legendPct', { power: name })}
          </li>
          {bands.length > 0 && (
            <li className="chart-key">
              <span className="lg-swatch lg-swatch-dead" aria-hidden="true" />
              {t('player.dead')}
            </li>
          )}
        </ul>
      </div>
      <div className="res-stats" role="group" aria-label={t('resources.kpis', { power: name })}>
        <Kpi label={t('resources.average')} value={pct(track.avgPct)} sub="" />
        <Kpi label={t('resources.minimum')} value={pct(track.minPct)} sub="" />
        <Kpi label={t('resources.atCap')} value={capTime(track.cappedMs)} sub="" />
        <Kpi label={t('resources.gained')} value={track.gained > 0 ? formatAmount(track.gained) : '—'} sub="" />
        <Kpi
          label={t('resources.wastedCol')}
          value={track.wasted > 0 ? formatAmount(track.wasted) : '—'}
          tone={track.wasted > 0 ? 'warn' : undefined}
          sub=""
        />
      </div>
      <div className="res-chart-wrap">
        <div className="res-chart" role="img" aria-label={t('resources.chartLabel', { power: name, pct: pct(track.avgPct) })} style={{ color: colour }}>
          <div className="res-guide" aria-hidden="true" />
          {bands.map((b, i) => (
            <div key={`dead-${i}`} className="res-dead" style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }} aria-hidden="true" />
          ))}
          <svg viewBox="0 0 1000 160" preserveAspectRatio="none" aria-hidden="true">
            {paths.area && <path d={paths.area} className="res-area" />}
            {paths.line && <path d={paths.line} className="res-line" />}
          </svg>
          <span className="num res-label" aria-hidden="true">
            {formatPercent(100)}
          </span>
          {bands.map((b, i) => (
            <span key={`label-${i}`} className="res-dead-label" style={{ left: `calc(${b.leftPct}% + 6px)` }} aria-hidden="true">
              {t('player.dead')}
            </span>
          ))}
        </div>
        <TimeAxis startMs={report.startMs} endMs={report.endMs} />
      </div>
      {track.gains.length > 0 && (
        <div className="scroll-x">
          <div className="res-gains" role="table" aria-label={t('resources.gainsOf', { power: name })}>
            <div role="row" className="res-gain res-gain-head">
              <span role="columnheader">
                <span className="sr-only">{t('recap.iconColumn')}</span>
              </span>
              <span role="columnheader" className="cap res-cap">
                {t('casts.spell')}
              </span>
              <span role="columnheader" className="cap res-cap">
                {t('resources.gained')}
              </span>
              <span role="columnheader" className="cap res-cap res-cap-end">
                {t('resources.wastedCol')}
              </span>
            </div>
            {track.gains.map((g) => (
              <div key={g.spellId} role="row" className="res-gain">
                <span role="cell">
                  <GameIcon name={spellName(g.spellId)} icon={spellIcon(g.spellId)} size={22} />
                </span>
                <span role="cell" className="res-gain-name">
                  {spellName(g.spellId)}
                </span>
                <span role="cell" className="res-gain-bar">
                  <span className="bar bar-lg" aria-hidden="true">
                    <span style={{ width: `${(g.gained / largest) * 100}%`, background: colour }} />
                  </span>
                  <span className="num res-gain-amount">{formatAmount(g.gained)}</span>
                </span>
                <span role="cell" className={g.wasted > 0 ? 'num res-gain-wasted res-gain-wasted-warn' : 'num res-gain-wasted dash'}>
                  {g.wasted > 0 ? formatAmount(g.wasted) : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
