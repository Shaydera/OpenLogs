import { Fragment, useState } from 'react';
import type { AuraScope, AurasReport, PlayerRef } from '../../api/types';
import { spellIconUrl } from '../../icons';
import { formatDuration, formatInteger, formatShare } from '../../i18n/format';
import { t, type MessageKey } from '../../i18n/i18n';
import { useApp } from '../../store';
import { TimeAxis } from '../detail/TimeAxis';
import { GameIcon } from '../GameIcon';
import { classColor, shortName } from '../overview/players';
import { band } from '../player/chartGeometry';
import { PlayerIcon } from '../reports/PlayerName';
import { reportSpellName, rosterIndex } from '../reports/reportData';
import { AURA_ROWS, auraColour, sortAuras, type AuraRow, type AuraSort } from './auraModel';

const SCOPES: AuraScope[] = ['buffs_on_players', 'debuffs_on_players', 'debuffs_on_enemies'];
const SORTS: { key: AuraSort; label: MessageKey }[] = [
  { key: 'uptime', label: 'casts.uptime' },
  { key: 'targets', label: 'auras.targets' },
  { key: 'applications', label: 'auras.applications' },
];

export function AurasTab({ report }: { report: AurasReport }) {
  const scope = useApp((s) => s.auraScope);
  const setAuraScope = useApp((s) => s.setAuraScope);
  const loading = useApp((s) => s.reportLoading);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [sort, setSort] = useState<AuraSort>('uptime');
  const [all, setAll] = useState(false);
  const roster = rosterIndex(report.roster);
  const name = (id: number) => reportSpellName(report.spells, id);
  const needle = query.trim().toLowerCase();
  const rows = sortAuras(
    report.rows.filter((row) => name(row.spellId).toLowerCase().includes(needle)),
    sort,
    name,
  );
  const shown = all ? rows : rows.slice(0, AURA_ROWS);
  const count = report.rows.length;

  return (
    <section className="panel panel-clip" aria-labelledby="auras-title">
      <div className="panel-head panel-head-auras">
        <div className="auras-title">
          <h2 id="auras-title" className="h2">
            {t(`auras.${scope}`)}
          </h2>
          {count > 0 && (
            <span className="auras-summary">
              <span className="num value-text">{formatInteger(count)}</span> {t('auras.auraWord', { count })} · {t('auras.uptimeOver')}{' '}
              <span className="num value-text">{formatDuration(report.endMs - report.startMs)}</span>
            </span>
          )}
        </div>
        <div className="auras-controls">
          <div className="filters" role="group" aria-label={t('auras.scope')}>
            {SCOPES.map((option) => (
              <button
                key={option}
                type="button"
                className={option === scope ? 'pill on' : 'pill'}
                aria-pressed={option === scope}
                onClick={() => void setAuraScope(option)}
              >
                {t(`auras.${option}`)}
              </button>
            ))}
          </div>
          <input
            className="input input-sel"
            aria-label={t('auras.filter')}
            placeholder={t('auras.filter')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      {/* Always mounted: screen readers announce a live region's new text, not a new region. */}
      <p className={loading ? 'muted pad' : 'sr-only'} role="status">
        {loading ? t('report.loading') : ''}
      </p>
      {count === 0 ? (
        <p className="muted pad">{t('auras.none')}</p>
      ) : rows.length === 0 ? (
        <p className="muted pad">{t('auras.noMatch', { query: query.trim() })}</p>
      ) : (
        <>
          <div className="scroll-x">
            <div className={loading ? 'aura-rows dim' : 'aura-rows'} role="table" aria-label={t('auras.table')} aria-busy={loading}>
              <div className="aura-row aura-row-head" role="row">
                <span role="columnheader">
                  <span className="sr-only">{t('recap.iconColumn')}</span>
                </span>
                <span role="columnheader" className="cap aura-cap">
                  {t('auras.aura')}
                </span>
                {SORTS.map(({ key, label }) => (
                  <span
                    key={key}
                    role="columnheader"
                    aria-sort={sort === key ? 'descending' : 'none'}
                    className={key === 'uptime' ? 'aura-sort' : 'aura-sort aura-sort-end'}
                  >
                    <button type="button" className={sort === key ? 'sort-btn sort-btn-on' : 'sort-btn'} onClick={() => setSort(key)}>
                      {t(label)}
                      {sort === key ? ' ↓' : ''}
                    </button>
                  </span>
                ))}
              </div>
              {shown.map((row) => {
                const expanded = open === row.spellId;
                const colour = auraColour(row, scope, roster);
                return (
                  <Fragment key={row.spellId}>
                    <div role="row" className={expanded ? 'aura-row aura-row-sel' : 'aura-row'}>
                      <span role="cell">
                        <GameIcon name={name(row.spellId)} src={spellIconUrl(row.spellId)} size={22} />
                      </span>
                      <span role="cell" className="aura-name-cell">
                        <button type="button" className="aura-name" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : row.spellId)}>
                          {name(row.spellId)}
                        </button>
                      </span>
                      <span role="cell" className="aura-bar">
                        <span className="bar bar-lg" aria-hidden="true">
                          <span style={{ width: `${row.uptime * 100}%`, background: colour }} />
                        </span>
                        <span className="num aura-uptime">{formatShare(row.uptime * 100)}</span>
                      </span>
                      <span role="cell" className="num aura-end aura-end-muted">
                        {formatInteger(row.targets.length)}
                      </span>
                      <span role="cell" className="num aura-end">
                        {formatInteger(row.applications)}
                      </span>
                    </div>
                    {expanded && (
                      <div role="row" className="aura-detail">
                        <div role="cell">
                          <AuraLanes row={row} colour={colour} report={report} roster={roster} label={t('auras.targetsOf', { name: name(row.spellId) })} />
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
                {t('auras.showing', { shown: AURA_ROWS, count: rows.length })} ·{' '}
                <button type="button" className="note-link" onClick={() => setAll(true)}>
                  {t('auras.showAll')}
                </button>
                <br />
              </>
            )}
            {t('auras.note')}
          </div>
        </>
      )}
    </section>
  );
}

/** One uptime lane per target of the aura. */
function AuraLanes({
  row,
  colour,
  report,
  roster,
  label,
}: {
  row: AuraRow;
  colour: string;
  report: AurasReport;
  roster: Map<number, PlayerRef>;
  label: string;
}) {
  return (
    <>
      <div className="atl-row atl-row-head" aria-hidden="true">
        <span />
        <TimeAxis startMs={report.startMs} endMs={report.endMs} flush />
        <span className="cap atl-cap">{t('auras.uptimeShort')}</span>
      </div>
      <ul className="atl-list" aria-label={label}>
        {row.targets.map((target) => {
          const player = target.player !== null ? roster.get(target.player) : undefined;
          return (
            <li key={target.name} className="atl-row">
              <span className="atl-name">
                {player ? (
                  <>
                    <PlayerIcon player={player} size={18} />
                    <span className="atl-player" style={{ color: classColor(player.classToken) }}>
                      {shortName(player.name)}
                    </span>
                  </>
                ) : (
                  <span className="atl-enemy">{target.name}</span>
                )}
              </span>
              <span className="track">
                {target.intervals.map(([a, b]) => {
                  const pos = band(a, b, report.startMs, report.endMs);
                  return pos ? (
                    <span key={a} className="atl-bar" style={{ left: `${pos.leftPct}%`, width: `${pos.widthPct}%`, background: colour }} />
                  ) : null;
                })}
              </span>
              <span className="num atl-uptime">{formatShare(target.uptime * 100)}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
