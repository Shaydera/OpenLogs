import { Fragment, useState } from 'react';
import type { PowerTrack, ResourcesReport } from '../../api/types';
import { spellIcon } from '../../icons';
import { formatPercent, formatScaled, formatShare } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { TimeAxis } from '../detail/TimeAxis';
import { GameIcon, MonogramTile } from '../GameIcon';
import { Kpi } from '../Kpi';
import { valueLabel } from '../filters/labels';
import { NoMatch } from '../filters/NoMatch';
import { ReportPickers } from '../filters/ReportPickers';
import { classColor, shortName } from '../overview/players';
import { band } from '../player/chartGeometry';
import { PlayerIcon } from '../reports/PlayerName';
import { reportSpellName, rosterIndex } from '../reports/reportData';
import { GroupToggle } from './GroupToggle';
import { formatCapTime, powerName } from './powerNames';
import { powerColour, resourcePaths } from './resourceGeometry';
import { memberLabel, nameGroups, orderUnits, toggled, type UnitFacts } from './unitOrder';

type UnitResources = ResourcesReport['units'][number];

/** Players' (friendlies) or enemy units' power and health; one selected unit is the page. */
export function ResourcesTab({ report }: { report: ResourcesReport }) {
  const openPlayer = useApp((s) => s.openPlayer);
  const scope = useApp((s) => s.scope);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const roster = rosterIndex(report.roster);
  if (report.units.length === 0) {
    return (
      <section className="panel" aria-labelledby="res-empty-title">
        <div className="panel-head panel-head-tight">
          <h2 id="res-empty-title" className="h2">
            {t('tabs.resources')}
          </h2>
          <div className="report-head-tools">
            <ReportPickers tab="resources" />
          </div>
        </div>
        <NoMatch nothing={t('resources.none')} />
      </section>
    );
  }
  const keyOf = (u: UnitResources) => JSON.stringify(u.unit.unit);
  const playerOf = (u: UnitResources) => (u.unit.unit.kind === 'player' ? roster.get(u.unit.unit.actorId) : undefined);
  const nameOf = (u: UnitResources) => {
    const player = playerOf(u);
    return player ? shortName(player.name) : valueLabel(u.unit.unit, u.unit.name, u.unit.number);
  };
  const factsOf = (u: UnitResources): UnitFacts => ({
    boss: u.boss,
    player: u.unit.unit.kind === 'player',
    role: playerOf(u)?.role ?? null,
    label: nameOf(u),
    name: u.unit.name,
  });
  const units = orderUnits(report.units, factsOf);
  const groups = nameGroups(units, factsOf);
  const picked = units.find((u) => keyOf(u) === selectedKey);
  const selected = picked ?? units[0];
  if (!picked) {
    setSelectedKey(keyOf(selected));
    if (groups.has(selected)) setOpenGroups((open) => new Set(open).add(selected.unit.name));
  }
  const selectedRef = playerOf(selected);
  const listed = !(scope.source.length === 1 && units.length === 1);
  const label = t(scope.perspective === 'friendly' ? 'resources.playersCount' : 'resources.enemiesCount', { count: units.length });
  const spellName = (id: number) => reportSpellName(report.spells, id);
  const icon = (u: UnitResources, size: number) => {
    const player = playerOf(u);
    return player ? <PlayerIcon player={player} size={size} /> : <MonogramTile name={valueLabel(u.unit.unit, u.unit.name)} size={size} />;
  };
  const toggleGroup = (name: string) => setOpenGroups((open) => toggled(open, name));
  const unitButton = (u: UnitResources, name: string, className = 'plink') => {
    const ref = playerOf(u);
    const primary = u.tracks[0];
    const on = u === selected;
    return (
      <button key={keyOf(u)} type="button" className={on ? `${className} plink-on` : className} aria-pressed={on} onClick={() => setSelectedKey(keyOf(u))}>
        {icon(u, 22)}
        <span className="plink-text">
          <span className="plink-name" style={ref ? { color: classColor(ref.classToken) } : undefined}>
            {name}
          </span>
          <span className="plink-sub">{[ref?.specName, u.tracks.map((tr) => powerName(tr.powerType)).join(', ')].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="num plink-value">{primary?.avgPct != null ? formatShare(primary.avgPct) : '—'}</span>
      </button>
    );
  };

  return (
    <div className="res-page">
      {listed && (
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
            {units.map((u) => {
              const members = groups.get(u);
              if (!members) return unitButton(u, nameOf(u));
              if (members[0] !== u) return null;
              const name = u.unit.name;
              const open = openGroups.has(name);
              const marked = !open && members.includes(selected);
              const groupName = valueLabel(u.unit.unit, name);
              return (
                <Fragment key={`group-${name}`}>
                  <GroupToggle
                    name={groupName}
                    count={members.length}
                    open={open}
                    current={marked}
                    className={marked ? 'plink plink-group plink-on' : 'plink plink-group'}
                    onToggle={() => toggleGroup(name)}
                  />
                  {open && (
                    <div role="group" aria-label={groupName}>
                      {members.map((u) => unitButton(u, memberLabel(u.unit.number) ?? nameOf(u), 'plink plink-instance'))}
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        </aside>
      )}
      <section className="panel panel-clip res-main" aria-labelledby="res-title">
        <div className="panel-head panel-head-side">
          {icon(selected, 36)}
          <div className="side-title">
            <h2 id="res-title" className="h2">
              <span style={selectedRef ? { color: classColor(selectedRef.classToken) } : undefined}>{nameOf(selected)}</span>{' '}
              <span className="res-title-suffix">{t('resources.titleSuffix')}</span>
            </h2>
            <span className="side-sub">
              {[selectedRef?.specName, t('resources.trackCount', { count: selected.tracks.length })].filter(Boolean).join(' · ')}
            </span>
          </div>
          <div className="report-head-tools">
            <ReportPickers tab="resources" />
          </div>
          {selectedRef && (
            <button type="button" className="link-accent" onClick={() => void openPlayer(selectedRef.actorId)}>
              {t('report.playerDetails')}
            </button>
          )}
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
        <Kpi label={t('resources.atCap')} value={formatCapTime(track.cappedMs)} sub="" />
        <Kpi label={t('resources.gained')} value={track.gained > 0 ? formatScaled(track.gained) : '—'} sub="" />
        <Kpi
          label={t('resources.wastedCol')}
          value={track.wasted > 0 ? formatScaled(track.wasted) : '—'}
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
                  <span className="num res-gain-amount">{formatScaled(g.gained)}</span>
                </span>
                <span role="cell" className={g.wasted > 0 ? 'num res-gain-wasted res-gain-wasted-warn' : 'num res-gain-wasted dash'}>
                  {g.wasted > 0 ? formatScaled(g.wasted) : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
