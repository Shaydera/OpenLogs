import { Fragment, type ReactNode } from 'react';
import { type InterruptsReport, type KickRow, type PlayerRef, type ReportUnit, type SetInterrupts, type SetKicksPull, isSetReport } from '../../api/types';
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
import { PullHead } from '../set/PullHead';
import { useSetPullViews } from '../set/useSetPullViews';
import { type KickTotals, kickTotals } from './kickTotals';

const KINDS = {
  interrupts: {
    titles: { source: 'kicks.interruptsByPlayer', ability: 'kicks.interruptsBySpell', target: 'kicks.interruptsByTarget' },
    enemyTitle: 'kicks.interruptsByEnemy',
    rows: 'interruptRows',
    head: 'kicks.interrupts',
    word: 'kicks.interruptWord',
    nobody: 'kicks.noInterrupters',
    nobodyInSet: 'kicks.noInterruptersInSet',
  },
  dispels: {
    titles: { source: 'kicks.dispelsByPlayer', ability: 'kicks.dispelsBySpell', target: 'kicks.dispelsByTarget' },
    enemyTitle: 'kicks.dispelsByEnemy',
    rows: 'dispelRows',
    head: 'kicks.dispels',
    word: 'kicks.dispelWord',
    nobody: 'kicks.noDispellers',
    nobodyInSet: 'kicks.noDispellersInSet',
  },
} as const;
type KickKind = keyof typeof KINDS;
const FIRST_COLUMN = { source: 'scope.source', ability: 'casts.spell', target: 'ability.target' } as const;

interface LogColumn<E> {
  head: string;
  cell: (entry: E) => ReactNode;
}

const kickLabel = (row: KickRow) => valueLabel(rowValue(row.key), row.name, row.number);

/** The tab's key figures sit in the fight header. A narrowed dimension has no column in the logs; a set's logs are split by pull. */
export function InterruptsTab({ report }: { report: InterruptsReport | SetInterrupts }) {
  const scope = useApp((s) => s.scope);
  const views = useSetPullViews();
  const pulls = isSetReport(report)
    ? report.pulls.flatMap((part) => {
        const pull = views.get(part.fightIndex);
        return pull ? [{ part, pull }] : [];
      })
    : null;
  const totals = kickTotals(report);
  const roster = rosterIndex(report.roster);
  const spell = (id: number) => reportSpellName(report.spells, id);
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

  const log = <E extends { t: number }>(label: string, columns: LogColumn<E>[], entries: E[], inPull: (part: SetKicksPull) => E[], warn?: boolean) =>
    pulls ? (
      <div className="scroll-box" tabIndex={0}>
        {pulls.map(({ part, pull }) => {
          const listed = inPull(part);
          return (
            listed.length > 0 && (
              <div key={part.fightIndex} role="group" aria-label={t('set.pull', { n: pull.n })}>
                <div className="pull-group-head">
                  <PullHead pull={pull} count={formatInteger(listed.length)} />
                </div>
                <EventLog label={t('set.logInPull', { log: label, n: pull.n })} columns={columns} entries={listed} time={time} warn={warn} ownScroll={false} />
              </div>
            )
          );
        })}
      </div>
    ) : (
      <EventLog label={label} columns={columns} entries={entries} time={time} warn={warn} />
    );

  return (
    <div className="kicks-page">
      <div className="kicks-layout">
        <KickTable kind="interrupts" report={report} totals={totals} roster={roster} />
        <div className="kicks-logs">
          {totals.missed > 0 && (
            <section className="panel panel-clip" aria-labelledby="kicks-missed-title">
              <div className="panel-head panel-head-tight">
                <div>
                  <h2 id="kicks-missed-title" className="h2">
                    {t('kicks.missed')} <span className="num h2-count">{formatInteger(totals.missed)}</span>
                  </h2>
                  <div className="panel-sub">{t('kicks.missedHint')}</div>
                </div>
              </div>
              {log(t('kicks.missed'), missedColumns, report.missed, (part) => part.missed, true)}
            </section>
          )}
          <KickLog id="kicks-interrupts-title" title={t('kicks.interrupts')} count={totals.interrupts} empty={t(pulls ? 'kicks.noInterruptsInSet' : 'kicks.noInterrupts')}>
            {log(t('kicks.interrupts'), kickColumns, report.interrupts, (part) => part.interrupts)}
          </KickLog>
        </div>
      </div>
      <div className="kicks-layout">
        <KickTable kind="dispels" report={report} totals={totals} roster={roster} />
        <div className="kicks-logs">
          <KickLog id="kicks-dispels-title" title={t('kicks.dispels')} count={totals.dispels} empty={t(pulls ? 'kicks.noDispelsInSet' : 'kicks.noDispels')}>
            {log(t('kicks.dispels'), dispelColumns, report.dispels, (part) => part.dispels)}
          </KickLog>
        </div>
      </div>
    </div>
  );
}

function KickTable(props: { kind: KickKind; report: InterruptsReport | SetInterrupts; totals: KickTotals; roster: Map<number, PlayerRef> }) {
  const { kind, report, totals, roster } = props;
  const friendly = useApp((s) => s.scope.perspective === 'friendly');
  const spec = KINDS[kind];
  const { group } = report;
  const rows = report[spec.rows];
  const count = totals[kind];
  const nothingMatches = report.interruptRows.length + report.dispelRows.length === 0;
  const max = Math.max(1, ...rows.map((row) => row.count));
  const title = group === 'source' && !friendly ? t(spec.enemyTitle) : t(spec.titles[group]);
  const nobody = t(isSetReport(report) ? spec.nobodyInSet : spec.nobody);
  const id = `kicks-${kind}-table-title`;
  return (
    <section className="panel panel-clip kicks-players" aria-labelledby={id}>
      <ReportHead
        tab="interrupts"
        id={id}
        title={title}
        group={group}
        summary={
          <span className="kicks-summary">
            <span className="num value-text">{formatInteger(count)}</span> {t(spec.word, { count })}
          </span>
        }
      />
      {nothingMatches ? (
        <NoMatch nothing={nobody} />
      ) : rows.length === 0 ? (
        <p className="muted pad">{nobody}</p>
      ) : (
        <div className="scroll-x">
          <div className="kick-prows" role="table" aria-label={title}>
            <div role="row" className="kick-prow kick-prow-head">
              <span role="columnheader">
                <span className="sr-only">{t('recap.iconColumn')}</span>
              </span>
              <span role="columnheader" className="cap kick-cap">
                {t(FIRST_COLUMN[group])}
              </span>
              <span role="columnheader" className="cap kick-cap">
                {group === 'ability' ? '' : t('casts.role')}
              </span>
              <span role="columnheader" className="cap kick-cap">
                {t(spec.head)}
              </span>
            </div>
            {rows.map((row) => (
              <KickRowView key={JSON.stringify(row.key)} row={row} roster={roster} max={max} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function KickRowView({ row, roster, max }: { row: KickRow; roster: Map<number, PlayerRef>; max: number }) {
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
          <span style={{ width: `${(row.count / max) * 100}%`, background: colour }} className={colour ? undefined : 'bar-fill-normal'} />
        </span>
        <span className="num kick-count">{formatInteger(row.count)}</span>
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
  ownScroll?: boolean;
}) {
  const { label, columns, entries, time, warn, ownScroll = true } = props;
  const grid = { gridTemplateColumns: `64px repeat(${columns.length}, minmax(150px, 1fr))` };
  const row = warn ? 'kick-ev kick-ev-warn' : 'kick-ev';
  return (
    <div className="scroll-x">
      <div className={ownScroll ? 'kick-log scroll-box' : 'kick-log'} role="table" aria-label={label} tabIndex={ownScroll ? 0 : undefined}>
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
