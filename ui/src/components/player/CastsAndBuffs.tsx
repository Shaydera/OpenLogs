import { useEffect, useState } from 'react';
import type { AbilityLink, PlayerDetail } from '../../api/types';
import { spellIcon } from '../../icons';
import { formatEventTime, formatShare } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { TimeAxis } from '../detail/TimeAxis';
import { GameIcon } from '../GameIcon';
import { classColor, shortName } from '../overview/players';
import { reportSpellName, rosterIndex } from '../reports/reportData';
import { buffColor } from './buffColors';
import { band, castsCrowd, intervalList } from './chartGeometry';

type Band = { leftPct: number; widthPct: number };
const isBand = (b: Band | null): b is Band => b !== null;

/** Screen-reader props of a lane: an image named by its label, or hidden when nothing is in range. */
function laneProps(label: string | null) {
  return label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
}

/** Label, count and gaps beside a lane in the grid (200px, 64px, 2 × 12px). */
const LANE_SIDES_PX = 288;
/** The lane at the grid's 1000px minimum width, until the grid is measured. */
const MIN_LANE_PX = 1000 - LANE_SIDES_PX;

/** The lane width of the grid set with the returned ref callback. */
function useLaneWidth() {
  const [grid, setGrid] = useState<HTMLDivElement | null>(null);
  const [lanePx, setLanePx] = useState(MIN_LANE_PX);
  useEffect(() => {
    if (!grid || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const width = grid.clientWidth - LANE_SIDES_PX;
      if (width > 0) setLanePx(width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [grid]);
  return [setGrid, lanePx] as const;
}

/** Cooldowns as icons (a crowded rotation lane as dots), buffs as bars, the dead band in every lane. */
export function CastsAndBuffs({ detail }: { detail: PlayerDetail }) {
  const { startMs, endMs } = detail;
  const [setGrid, lanePx] = useLaneWidth();
  const roster = rosterIndex(detail.roster);
  const openAbilityOf = useApp((s) => s.openAbilityOf);
  const name = (spellId: number) => reportSpellName(detail.spells, spellId);
  const classColour = classColor(detail.player.classToken);
  const deadBands = detail.dead.map(([a, b]) => band(a, b, startMs, endMs)).filter(isBand);
  const dead = deadBands.map((b, i) => <span key={`dead-${i}`} className="pcb-dead" style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }} />);
  // Spells without hits of their own (buffs, movement) have no ability page.
  const spellLink = (row: { spellId: number; link: AbilityLink | null }) => {
    const link = row.link;
    if (!link) return <span className="pcb-name">{name(row.spellId)}</span>;
    return (
      <button type="button" className="link-btn pcb-name" onClick={() => void openAbilityOf(detail.player.actorId, link.spellId, link.metric)}>
        {name(row.spellId)}
      </button>
    );
  };
  const empty = detail.castRows.length === 0 && detail.buffRows.length === 0;
  return (
    <section className="panel chart-panel chart-panel-tall" id="p-timeline" aria-labelledby="player-timeline-title">
      <div className="chart-head chart-head-tight">
        <h2 id="player-timeline-title" tabIndex={-1} className="h2">
          {t('player.castsAndBuffs')}
        </h2>
        <span className="chart-hint">{t('player.castsAndBuffsHint')}</span>
      </div>
      {empty ? (
        <p className="muted">{t('player.noCastsOrBuffs')}</p>
      ) : (
        <div className="scroll-x">
          <div className="pcb" ref={setGrid}>
            <div className="pcb-row pcb-row-head" aria-hidden="true">
              <span />
              <TimeAxis startMs={startMs} endMs={endMs} flush />
              <span className="cap pcb-cap">{t('player.uptime')}</span>
            </div>
            {detail.castRows.length > 0 && (
              <>
                <h3 className="cap pcb-group">{t('player.cooldowns')}</h3>
                <ul className="pcb-list" aria-label={t('player.cooldowns')}>
                  {detail.castRows.map((row) => {
                    const dots = row.kind === 'rotation' && castsCrowd(row.times, startMs, endMs, lanePx);
                    const inRange = row.times.filter((time) => time >= startMs && time < endMs);
                    const laneLabel =
                      dots && inRange.length > 0
                        ? t('player.castLane', {
                            spell: name(row.spellId),
                            count: inRange.length,
                            first: formatEventTime(inRange[0]),
                            last: formatEventTime(inRange[inRange.length - 1]),
                          })
                        : null;
                    return (
                      <li key={row.spellId} className="pcb-row">
                        <span className="pcb-label">
                          <GameIcon name={name(row.spellId)} icon={spellIcon(row.spellId)} size={18} />
                          {spellLink(row)}
                        </span>
                        <span className="track" {...(dots ? laneProps(laneLabel) : {})}>
                          {dead}
                          {row.times.map((time, i) => {
                            const at = band(time, time + 1, startMs, endMs);
                            if (!at) return null;
                            const label = t('player.castAt', { spell: name(row.spellId), time: formatEventTime(time) });
                            // Two casts can share a millisecond: the index keeps the keys apart.
                            const key = `${time}-${i}`;
                            if (dots) return <span key={key} className="pcb-dot" style={{ left: `${at.leftPct}%` }} title={label} />;
                            return (
                              <span key={key} className="pcb-cast" style={{ left: `${at.leftPct}%` }} title={label}>
                                <GameIcon name={name(row.spellId)} icon={spellIcon(row.spellId)} label={label} />
                              </span>
                            );
                          })}
                        </span>
                        <span className="num pcb-count">{t('player.castCount', { count: row.times.length })}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {detail.buffRows.length > 0 && (
              <>
                <h3 className="cap pcb-group pcb-group-buffs">{t('player.buffs')}</h3>
                <ul className="pcb-list" aria-label={t('player.buffs')}>
                  {detail.buffRows.map((row) => {
                    const source = roster.get(row.source);
                    const external = row.source !== detail.player.actorId;
                    const list = intervalList(row.intervals, startMs, endMs);
                    const color = buffColor(row.kind, classColour);
                    return (
                      <li key={`${row.spellId}-${row.source}`} className="pcb-row">
                        <span className="pcb-label">
                          <GameIcon name={name(row.spellId)} icon={spellIcon(row.spellId)} size={18} />
                          <span className="pcb-name">{name(row.spellId)}</span>
                          {external && <span className="pcb-source">{t('player.buffFrom', { name: shortName(source?.name ?? '?') })}</span>}
                        </span>
                        <span className="track" {...laneProps(list ? t('chart.intervals', { name: name(row.spellId), list }) : null)}>
                          {dead}
                          {row.intervals.map(([a, b], i) => {
                            const at = band(a, b, startMs, endMs);
                            return at ? <span key={`${a}-${i}`} className="pcb-bar" style={{ left: `${at.leftPct}%`, width: `${at.widthPct}%`, background: color }} /> : null;
                          })}
                        </span>
                        <span className="num pcb-uptime">{formatShare(row.uptime * 100)}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
