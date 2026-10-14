import { Fragment, type ReactNode } from 'react';
import type { InterruptsReport, KickRow, PlayerRef, ReportUnit } from '../../api/types';
import { spellIcon } from '../../icons';
import { formatEventTime, formatInteger } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { GameIcon, MonogramTile } from '../GameIcon';
import { rowValue, valueLabel } from '../filters/labels';
import { NoMatch } from '../filters/NoMatch';
import { ReportHead } from '../filters/ReportHead';
import { classColor } from '../overview/players';
import { PlayerIcon } from '../reports/PlayerName';
import { reportSpellName, rosterIndex } from '../reports/reportData';

const TITLE = { source: 'kicks.byPlayer', ability: 'kicks.bySpell', target: 'kicks.byTarget' } as const;
const FIRST_COLUMN = { source: 'scope.source', ability: 'casts.spell', target: 'ability.target' } as const;

interface LogColumn<E> {
  head: string;
  cell: (entry: E) => ReactNode;
}

const kickLabel = (row: KickRow) => valueLabel(rowValue(row.key), row.name, row.number);

/** The tab's key figures sit in the fight header. A narrowed dimension has no column in the logs. */
export function InterruptsTab({ report }: { report: InterruptsReport }) {
  const scope = useApp((s) => s.scope);
  const roster = rosterIndex(report.roster);
  const spell = (id: number) => reportSpellName(report.spells, id);
  const maxKicks = Math.max(1, ...report.rows.map((r) => r.interrupts));
  const friendly = scope.perspective === 'friendly';
  const title = report.group === 'source' && !friendly ? t('kicks.byEnemy') : t(TITLE[report.group]);
  const [sourceOpen, targetOpen, abilityOpen] = [scope.source.length === 0, scope.target.length === 0, scope.ability.length === 0];

  const unitCell = (unit: ReportUnit) => {
    const player = unit.unit.kind === 'player' ? roster.get(unit.unit.actorId) : undefined;
    if (player) {
      return (
        <span role="cell" className="kick-cell">
          <PlayerIcon player={player} size={18} />
          <span className="kick-player" style={{ color: classColor(player.classToken) }}>
            {valueLabel(unit.unit, unit.name, unit.number)}
          </span>
        </span>
      );
    }
    return (
      <span role="cell" className="kick-cell">
        <span className="kick-text kick-text-muted">{unit.unit.kind === 'environment' ? t('kicks.unknownUnit') : valueLabel(unit.unit, unit.name, unit.number)}</span>
      </span>
    );
  };
  const spellCell = (id: number, extra: ReactNode = null, warn = false) => (
    <span role="cell" className="kick-cell">
      <GameIcon name={spell(id)} icon={spellIcon(id)} size={18} />
      <span className={warn ? 'kick-text kick-text-warn' : 'kick-text'}>{spell(id)}</span>
      {extra}
    </span>
  );
  const time = (at: number) => (
    <span role="cell" className="num kick-time">
      {formatEventTime(at)}
    </span>
  );

  type Kick = InterruptsReport['interrupts'][number];
  type Dispel = InterruptsReport['dispels'][number];
  type Missed = InterruptsReport['missed'][number];
  const kickColumns: LogColumn<Kick>[] = [
    ...(sourceOpen ? [{ head: t('scope.source'), cell: (k: Kick) => unitCell(k.source) }] : []),
    { head: t('casts.spell'), cell: (k) => spellCell(k.spellId) },
    ...(targetOpen ? [{ head: t('ability.target'), cell: (k: Kick) => unitCell(k.target) }] : []),
    ...(abilityOpen ? [{ head: t('kicks.interrupted'), cell: (k: Kick) => spellCell(k.interruptedId) }] : []),
  ];
  const dispelColumns: LogColumn<Dispel>[] = [
    ...(sourceOpen ? [{ head: t('scope.source'), cell: (d: Dispel) => unitCell(d.source) }] : []),
    { head: t('casts.spell'), cell: (d) => spellCell(d.spellId) },
    ...(targetOpen ? [{ head: t('ability.target'), cell: (d: Dispel) => unitCell(d.target) }] : []),
    ...(abilityOpen
      ? [{ head: t('kicks.removed'), cell: (d: Dispel) => spellCell(d.removedId, d.stolen ? <span className="rtag">{t('kicks.stolen')}</span> : null) }]
      : []),
  ];
  const missedColumns: LogColumn<Missed>[] = [
    ...(targetOpen ? [{ head: t('kicks.caster'), cell: (m: Missed) => unitCell(m.source) }] : []),
    ...(abilityOpen ? [{ head: t('casts.spell'), cell: (m: Missed) => spellCell(m.spellId, null, true) }] : []),
  ];

  return (
    <div className="kicks-page">
      <div className="kicks-layout">
        <section className="panel panel-clip kicks-players" aria-labelledby="kicks-players-title">
          <ReportHead
            tab="interrupts"
            id="kicks-players-title"
            title={title}
            group={report.group}
            summary={
              <span className="kicks-summary">
                <span className="num value-text">{formatInteger(report.interrupts.length)}</span>{' '}
                {t('kicks.interruptWord', { count: report.interrupts.length })} ·{' '}
                <span className="num value-text">{formatInteger(report.dispels.length)}</span>{' '}
                {t('kicks.dispelWord', { count: report.dispels.length })}
              </span>
            }
          />
          {report.rows.length === 0 ? (
            <NoMatch nothing={t('kicks.noneByPlayer')} />
          ) : (
            <div className="scroll-x">
              <div className="kick-prows" role="table" aria-label={title}>
                <div role="row" className="kick-prow kick-prow-head">
                  <span role="columnheader">
                    <span className="sr-only">{t('recap.iconColumn')}</span>
                  </span>
                  <span role="columnheader" className="cap kick-cap">
                    {t(FIRST_COLUMN[report.group])}
                  </span>
                  <span role="columnheader" className="cap kick-cap">
                    {report.group === 'ability' ? '' : t('casts.role')}
                  </span>
                  <span role="columnheader" className="cap kick-cap">
                    {t('kicks.interrupts')}
                  </span>
                  <span role="columnheader" className="cap kick-cap kick-cap-end">
                    {t('kicks.dispels')}
                  </span>
                </div>
                {report.rows.map((row) => (
                  <KickRowView key={JSON.stringify(row.key)} row={row} roster={roster} maxKicks={maxKicks} />
                ))}
              </div>
            </div>
          )}
        </section>
        <div className="kicks-logs">
          {report.missed.length > 0 && (
            <section className="panel panel-clip" aria-labelledby="kicks-missed-title">
              <div className="panel-head panel-head-tight">
                <div>
                  <h2 id="kicks-missed-title" className="h2">
                    {t('kicks.missed')} <span className="num h2-count">{formatInteger(report.missed.length)}</span>
                  </h2>
                  <div className="panel-sub">{t('kicks.missedHint')}</div>
                </div>
              </div>
              <EventLog label={t('kicks.missed')} columns={missedColumns} entries={report.missed} time={time} warn />
            </section>
          )}
          <KickLog id="kicks-interrupts-title" title={t('kicks.interrupts')} count={report.interrupts.length} empty={t('kicks.noInterrupts')}>
            <EventLog label={t('kicks.interrupts')} columns={kickColumns} entries={report.interrupts} time={time} />
          </KickLog>
          <KickLog id="kicks-dispels-title" title={t('kicks.dispels')} count={report.dispels.length} empty={t('kicks.noDispels')}>
            <EventLog label={t('kicks.dispels')} columns={dispelColumns} entries={report.dispels} time={time} />
          </KickLog>
        </div>
      </div>
    </div>
  );
}

function KickRowView({ row, roster, maxKicks }: { row: KickRow; roster: Map<number, PlayerRef>; maxKicks: number }) {
  const unit = row.key.kind === 'unit' ? row.key.unit : null;
  const player = unit?.kind === 'player' ? roster.get(unit.actorId) : undefined;
  const colour = player ? classColor(player.classToken) : undefined;
  const label = kickLabel(row);
  const icon = player ? (
    <PlayerIcon player={player} size={22} />
  ) : row.key.kind === 'ability' ? (
    <GameIcon name={label} icon={spellIcon(row.spellId)} size={22} />
  ) : (
    <MonogramTile name={label} size={22} />
  );
  return (
    <div role="row" className="kick-prow">
      <span role="cell">{icon}</span>
      <span role="cell" className="kick-name" style={colour ? { color: colour } : undefined} title={label}>
        {label}
      </span>
      <span role="cell">{player?.role ? <span className="role-pill">{t(`role.short.${player.role}`)}</span> : null}</span>
      <span role="cell" className="kick-bar">
        <span className="bar bar-lg" aria-hidden="true">
          <span style={{ width: `${(row.interrupts / maxKicks) * 100}%`, background: colour }} className={colour ? undefined : 'bar-fill-normal'} />
        </span>
        <span className={row.interrupts > 0 ? 'num kick-count' : 'num kick-count dash'}>{row.interrupts > 0 ? formatInteger(row.interrupts) : '—'}</span>
      </span>
      <span role="cell" className={row.dispels > 0 ? 'num kick-end' : 'num kick-end dash'}>
        {row.dispels > 0 ? formatInteger(row.dispels) : '—'}
      </span>
    </div>
  );
}

function EventLog<E extends { t: number }>(props: {
  label: string;
  columns: LogColumn<E>[];
  entries: E[];
  time: (at: number) => ReactNode;
  warn?: boolean;
}) {
  const { label, columns, entries, time, warn } = props;
  const grid = { gridTemplateColumns: `64px repeat(${columns.length}, minmax(150px, 1fr))` };
  const row = warn ? 'kick-ev kick-ev-warn' : 'kick-ev';
  return (
    <div className="scroll-x">
      <div className="kick-log scroll-box" role="table" aria-label={label} tabIndex={0}>
        <div role="row" className="kick-ev kick-ev-head" style={grid}>
          {[t('ability.time'), ...columns.map((c) => c.head)].map((h) => (
            <span key={h} role="columnheader" className="cap kick-cap">
              {h}
            </span>
          ))}
        </div>
        {entries.map((entry, i) => (
          <div key={`${entry.t}-${i}`} role="row" className={row} style={grid}>
            {time(entry.t)}
            {columns.map((column) => (
              <Fragment key={column.head}>{column.cell(entry)}</Fragment>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function KickLog({ id, title, count, empty, children }: { id: string; title: string; count: number; empty: string; children: ReactNode }) {
  return (
    <section className="panel panel-clip" aria-labelledby={id}>
      <div className="panel-head panel-head-tight">
        <h2 id={id} className="h2">
          {title} <span className="num h2-count">{formatInteger(count)}</span>
        </h2>
      </div>
      {count === 0 ? <p className="muted pad">{empty}</p> : children}
    </section>
  );
}
