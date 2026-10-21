import { Fragment, useState } from 'react';
import { type AuraHolder, type AuraLane, type AuraRow, type AurasReport, type PlayerRef, type Seam, type SetAuras, isSetReport } from '../../api/types';
import { spellIcon } from '../../icons';
import { formatDuration, formatInteger, formatShare } from '../../i18n/format';
import { t, type MessageKey } from '../../i18n/i18n';
import type { PullView } from '../../pulls/groupPulls';
import { useApp } from '../../store';
import { TimeAxis } from '../detail/TimeAxis';
import { GameIcon, MonogramTile } from '../GameIcon';
import { rowValue } from '../filters/labels';
import { NoMatch } from '../filters/NoMatch';
import { ReportHead } from '../filters/ReportHead';
import { classColor, shortName } from '../overview/players';
import { band, intervalList } from '../player/chartGeometry';
import { PlayerIcon } from '../reports/PlayerName';
import { reportSpellName, rosterIndex } from '../reports/reportData';
import { CompactPullHead, SeamRow } from '../set/PullHead';
import { bandIn } from '../set/seams';
import { useSetPullViews } from '../set/useSetPullViews';
import { AURA_ROWS, auraColour, sortAuras, type AuraSort } from './auraModel';
import { AuraKindSwitch } from './AuraKindSwitch';

const SORTS: { key: AuraSort; label: MessageKey; byTarget?: MessageKey }[] = [
  { key: 'uptime', label: 'casts.uptime' },
  { key: 'targets', label: 'auras.targets', byTarget: 'auras.auras' },
  { key: 'applications', label: 'auras.applications' },
];

const keyOf = (row: AuraRow) => `${JSON.stringify(row.key)}#${row.spellId}`;

/** Auras by aura (a lane per holder) or by target (a lane per aura); the lens decides whose auras. A set's lanes show its pulls back to back. */
export function AurasTab({ report }: { report: AurasReport | SetAuras }) {
  const kind = useApp((s) => s.auraKind);
  const scope = useApp((s) => s.scope);
  const select = useApp((s) => s.select);
  const loading = useApp((s) => s.reportLoading);
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<AuraSort>('uptime');
  const [all, setAll] = useState(false);
  const views = useSetPullViews();
  const seams = isSetReport(report) ? report.pulls : null;
  const roster = rosterIndex(report.roster);
  const spellName = (id: number) => reportSpellName(report.spells, id);
  const holderName = (holder: AuraHolder) => (holder.player !== null ? shortName(roster.get(holder.player)?.name ?? holder.name) : holder.name);
  const rowName = (row: AuraRow) => (row.holder ? holderName(row.holder) : spellName(row.spellId));
  const byTarget = report.group === 'target';
  const side = scope.perspective;
  const rows = sortAuras(report.rows, sort, rowName);
  const shown = all ? rows : rows.slice(0, AURA_ROWS);
  const count = report.rows.length;
  const narrowable = scope[report.group].length === 0;
  const colour = (sources: number[]) => auraColour(sources, kind, side, roster);

  return (
    <section className="panel panel-clip" aria-labelledby="auras-title">
      <ReportHead
        tab="buffs"
        id="auras-title"
        title={t(`auras.${kind}_on_${side === 'friendly' ? 'players' : 'enemies'}`)}
        group={report.group}
        summary={
          count > 0 &&
          (seams ? (
            <span className="auras-summary">{t('auras.setUptimeOver', { duration: formatDuration(report.endMs - report.startMs), n: formatInteger(seams.length) })}</span>
          ) : (
            <span className="auras-summary">
              <span className="num value-text">{formatInteger(count)}</span> {t(byTarget ? 'kpi.targetWord' : 'auras.auraWord', { count })} ·{' '}
              {t('auras.uptimeOver')} <span className="num value-text">{formatDuration(report.endMs - report.startMs)}</span>
            </span>
          ))
        }
        tools={<AuraKindSwitch />}
      />
      {/* Always mounted: screen readers announce a live region's new text, not a new region. */}
      <p className={loading ? 'muted pad' : 'sr-only'} role="status">
        {loading ? t('report.loading') : ''}
      </p>
      {count === 0 ? (
        <NoMatch nothing={t(seams ? 'auras.noneInSet' : 'auras.none')} />
      ) : (
        <>
          <div className="scroll-x">
            <div className={loading ? 'aura-rows dim' : 'aura-rows'} role="table" aria-label={t('auras.table')} aria-busy={loading}>
              <div className="aura-row aura-row-head" role="row">
                <span role="columnheader">
                  <span className="sr-only">{t('recap.iconColumn')}</span>
                </span>
                <span role="columnheader" className="cap aura-cap">
                  {t(byTarget ? 'ability.target' : 'auras.aura')}
                </span>
                {SORTS.map(({ key, label, byTarget: targetLabel }) => (
                  <span key={key} role="columnheader" aria-sort={sort === key ? 'descending' : 'none'} className={key === 'uptime' ? 'aura-sort' : 'aura-sort aura-sort-end'}>
                    <button type="button" className={sort === key ? 'sort-btn sort-btn-on' : 'sort-btn'} onClick={() => setSort(key)}>
                      {t(byTarget && targetLabel ? targetLabel : label)}
                      {sort === key ? ' ↓' : ''}
                    </button>
                  </span>
                ))}
              </div>
              {shown.map((row) => {
                const id = keyOf(row);
                const expanded = open === id;
                const name = rowName(row);
                const player = row.holder?.player != null ? roster.get(row.holder.player) : undefined;
                return (
                  <Fragment key={id}>
                    <div role="row" className={expanded ? 'aura-row aura-row-sel' : 'aura-row'}>
                      <span role="cell">
                        {row.holder ? player ? <PlayerIcon player={player} size={22} /> : <MonogramTile name={name} size={22} /> : <GameIcon name={name} icon={spellIcon(row.spellId)} size={22} />}
                      </span>
                      <span role="cell" className="aura-name-cell">
                        <button
                          type="button"
                          className="aura-name"
                          style={player ? { color: classColor(player.classToken) } : undefined}
                          aria-expanded={expanded}
                          onClick={() => setOpen(expanded ? null : id)}
                        >
                          {name}
                        </button>
                      </span>
                      <span role="cell" className="aura-bar">
                        <span className="bar bar-lg" aria-hidden="true">
                          <span style={{ width: `${row.uptime * 100}%`, background: colour(row.sources) }} />
                        </span>
                        <span className="num aura-uptime">{formatShare(row.uptime * 100)}</span>
                      </span>
                      <span role="cell" className="num aura-end aura-end-muted">
                        {formatInteger(row.lanes.length)}
                      </span>
                      <span role="cell" className="num aura-end">
                        {formatInteger(row.applications)}
                      </span>
                    </div>
                    {expanded && (
                      <div role="row" className="aura-detail">
                        <div role="cell">
                          {narrowable && (
                            <button type="button" className="link-accent aura-only" onClick={() => void select(report.group, rowValue(row.key))}>
                              {t('breakdown.showOnly', { name })}
                            </button>
                          )}
                          <AuraLanes
                            lanes={row.lanes}
                            byTarget={byTarget}
                            colour={colour}
                            report={report}
                            seams={seams}
                            views={views}
                            roster={roster}
                            spellName={spellName}
                            label={t(byTarget ? 'auras.aurasOf' : 'auras.targetsOf', { name })}
                          />
                        </div>
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          </div>
          <div className="panel-note">
            {rows.length > shown.length && (
              <>
                {t(byTarget ? 'auras.showingTargets' : 'auras.showing', { shown: AURA_ROWS, count: rows.length })} ·{' '}
                <button type="button" className="note-link" onClick={() => setAll(true)}>
                  {t('auras.showAll')}
                </button>
                <br />
              </>
            )}
            {t(byTarget ? (seams ? 'auras.noteTargetsSet' : 'auras.noteTargets') : seams ? 'auras.noteSet' : 'auras.note')}
          </div>
        </>
      )}
    </section>
  );
}

/** One uptime lane per holder (by aura) or per aura (by target); a set's lane has a segment per pull. */
function AuraLanes(props: {
  lanes: AuraLane[];
  byTarget: boolean;
  colour: (sources: number[]) => string;
  report: AurasReport;
  seams: Seam[] | null;
  views: Map<number, PullView>;
  roster: Map<number, PlayerRef>;
  spellName: (id: number) => string;
  label: string;
}) {
  const { lanes, byTarget, colour, report, seams, views, roster, spellName, label } = props;
  const bar = (key: number, pos: { leftPct: number; widthPct: number } | null, fill: string) =>
    pos ? <span key={key} className="atl-bar" style={{ left: `${pos.leftPct}%`, width: `${pos.widthPct}%`, background: fill }} /> : null;
  const segment = (lane: AuraLane, seam: Seam, fill: string) => {
    const pull = views.get(seam.fightIndex);
    const inPull = lane.intervals.map(([a, b]): [number, number] => [a - seam.startMs, b - seam.startMs]);
    const list = intervalList(inPull, 0, seam.endMs - seam.startMs);
    const described = pull && list ? { role: 'img', 'aria-label': t('chart.intervals', { name: t('set.pull', { n: pull.n }), list }) } : { 'aria-hidden': true };
    return (
      <span className="atl-seam" {...described}>
        {lane.intervals.map(([a, b]) => bar(a, bandIn(seam, [a, b]), fill))}
      </span>
    );
  };
  return (
    <>
      <div className="atl-row atl-row-head" aria-hidden="true">
        <span />
        {seams ? (
          <SeamRow seams={seams}>
            {(seam) => {
              const pull = views.get(seam.fightIndex);
              return pull && <div className="atl-seam-head"><CompactPullHead pull={pull} /></div>;
            }}
          </SeamRow>
        ) : (
          <TimeAxis startMs={report.startMs} endMs={report.endMs} flush />
        )}
        <span className="cap atl-cap">{t('auras.uptimeShort')}</span>
      </div>
      <ul className="atl-list" aria-label={label}>
        {lanes.map((lane) => {
          const player = lane.holder.player !== null ? roster.get(lane.holder.player) : undefined;
          const fill = colour(lane.sources);
          return (
            <li key={`${lane.holder.name}-${lane.spellId}`} className="atl-row">
              <span className="atl-name">
                {byTarget ? (
                  <>
                    <GameIcon name={spellName(lane.spellId)} icon={spellIcon(lane.spellId)} size={18} />
                    <span className="atl-player">{spellName(lane.spellId)}</span>
                  </>
                ) : player ? (
                  <>
                    <PlayerIcon player={player} size={18} />
                    <span className="atl-player" style={{ color: classColor(player.classToken) }}>
                      {shortName(player.name)}
                    </span>
                  </>
                ) : (
                  <span className="atl-enemy">{lane.holder.name}</span>
                )}
              </span>
              {seams ? (
                <SeamRow seams={seams}>{(seam) => segment(lane, seam, fill)}</SeamRow>
              ) : (
                <span className="track">{lane.intervals.map(([a, b]) => bar(a, band(a, b, report.startMs, report.endMs), fill))}</span>
              )}
              <span className="num atl-uptime">{formatShare(lane.uptime * 100)}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
