import { type ReactNode, useMemo } from 'react';
import type { BreakdownRow, CastExtra, CastsReport, GroupedRow, PlayerRef } from '../../api/types';
import { spellIcon } from '../../icons';
import { formatCpm, formatDuration, formatInteger, formatShare } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { type CastsSortKey, useApp } from '../../store';
import { GameIcon, MonogramTile } from '../GameIcon';
import { rowLabel, rowValue, valueLabel } from '../filters/labels';
import { NoMatch } from '../filters/NoMatch';
import { ReportHead } from '../filters/ReportHead';
import { classColor, playerIndex, shortName } from '../overview/players';
import { PlayerIcon } from '../reports/PlayerName';
import { barWidth, rosterIndex } from '../reports/reportData';
import { SideActions } from '../reports/ReportParts';

/** One spell row of one caster: its casts with what is known of the pair. */
interface SpellLine {
  key: string;
  spellId: number;
  name: string;
  proc: boolean;
  casts: number;
  firstCastMs: number;
  uptime: number | null;
  link: CastExtra['link'];
}

const keyOf = (row: BreakdownRow) => JSON.stringify(row.key);

const extraLine = (extra: CastExtra): SpellLine => ({
  key: JSON.stringify([extra.ability, extra.procTrigger]),
  spellId: extra.spellId,
  name: valueLabel(extra.ability, ''),
  proc: extra.procTrigger,
  casts: extra.casts,
  firstCastMs: extra.firstCastMs,
  uptime: extra.uptime,
  link: extra.link,
});

const rowLine = (row: BreakdownRow): SpellLine => ({
  key: keyOf(row),
  spellId: row.spellId,
  name: rowLabel(row),
  proc: row.key.kind === 'ability' && row.key.rowKind === 'proc',
  casts: row.amount,
  firstCastMs: 0,
  uptime: null,
  link: null,
});

const playerOf = (row: BreakdownRow) => (row.key.kind === 'unit' && row.key.unit.kind === 'player' ? row.key.unit.actorId : null);

/**
 * Casts by the effective grouping: casters with the selected one's spells beside them, abilities with
 * who cast the selected one, or – one player selected – that player's spells as the table.
 */
export function CastsTab({ report }: { report: CastsReport }) {
  const { breakdown, extras } = report;
  const scope = useApp((s) => s.scope);
  const range = useApp((s) => s.range);
  const overview = useApp((s) => s.overview);
  const selectedKey = useApp((s) => s.castsRow);
  const selectRow = useApp((s) => s.selectCastsRow);
  const select = useApp((s) => s.select);
  const openPlayer = useApp((s) => s.openPlayer);
  const inSet = useApp((s) => s.view.kind === 'set');
  const openPlayerOf = inSet ? undefined : (player: number) => void openPlayer(player);
  const roster = useMemo(
    () => new Map([...(overview ? playerIndex(overview) : []), ...rosterIndex(breakdown.roster)]),
    [overview, breakdown.roster],
  );
  const minutes = breakdown.durationMs / 60_000;
  const cpm = (casts: number) => (minutes > 0 ? formatCpm(casts / minutes) : '—');
  const one = scope.source.length === 1 ? scope.source[0] : null;
  const onePlayer = one?.kind === 'player' ? one.actorId : null;
  const linesOf = (player: number) => extras.filter((e) => e.player === player).map(extraLine);
  const selected = breakdown.rows.find((r) => keyOf(r) === selectedKey) ?? breakdown.rows[0];
  const split = (row: GroupedRow | undefined, dimension: 'source' | 'ability') => row?.splits.find((s) => s.dimension === dimension)?.rows;
  const nameOf = (player: number) => shortName(roster.get(player)?.name ?? t('report.unknownPlayer'));
  const friendly = scope.perspective === 'friendly';
  const caption = t(friendly ? 'report.player' : 'scope.source');
  const note = <div className="casts-note">{t(inSet ? 'casts.noteSet' : range ? 'casts.noteRange' : 'casts.note', { duration: formatDuration(breakdown.durationMs) })}</div>;

  const title =
    onePlayer !== null ? (
      <>
        <span style={{ color: classColor(roster.get(onePlayer)?.classToken ?? null) }}>{nameOf(onePlayer)}</span>{' '}
        <span className="casts-title-suffix">{t('casts.spellCasts')}</span>
      </>
    ) : breakdown.group === 'ability' ? (
      t('casts.byAbility')
    ) : (
      t(friendly ? 'casts.byPlayer' : 'casts.byEnemy')
    );

  let main: ReactNode;
  let side: ReactNode = null;
  if (breakdown.rows.length === 0) {
    main = <NoMatch nothing={t(inSet ? 'casts.noneInSet' : 'casts.none')} />;
  } else if (onePlayer !== null) {
    main = (
      <>
        <SpellTable lines={linesOf(onePlayer)} player={onePlayer} label={t('casts.tableLabel', { name: nameOf(onePlayer) })} cpm={cpm} roster={roster} />
        {note}
      </>
    );
  } else if (breakdown.group === 'source') {
    const selectable = (split(selected, 'ability')?.length ?? 0) > 0;
    main = (
      <CasterList
        rows={breakdown.rows}
        selected={selected}
        onSelect={selectable ? selectRow : undefined}
        onOpenPlayer={openPlayerOf}
        roster={roster}
        cpm={cpm}
        caption={caption}
        label={t(friendly ? 'casts.byPlayer' : 'casts.byEnemy')}
      />
    );
    const spells = split(selected, 'ability');
    if (selected && spells?.length) {
      const player = playerOf(selected);
      const lines = player !== null ? linesOf(player) : spells.map(rowLine);
      side = (
        <SidePanel
          row={selected}
          roster={roster}
          sub={t('casts.spellCount', { count: lines.length })}
          suffix={t('casts.spellCasts')}
          cpm={cpm}
          onOpenPlayer={player !== null && openPlayerOf ? () => openPlayerOf(player) : undefined}
          onShowOnly={() => void select('source', rowValue(selected.key))}
        >
          <SpellTable lines={lines} player={player} label={t('casts.tableLabel', { name: rowLabel(selected) })} cpm={cpm} roster={roster} />
          {player !== null && note}
        </SidePanel>
      );
    }
  } else {
    const casters = split(selected, 'source');
    main = <AbilityList rows={breakdown.rows} selected={selected} onSelect={casters?.length ? selectRow : undefined} cpm={cpm} />;
    if (selected && casters?.length) {
      side = (
        <SidePanel row={selected} roster={roster} sub="" cpm={cpm} onShowOnly={() => void select('ability', rowValue(selected.key))}>
          <CasterList
            rows={casters}
            onOpenPlayer={openPlayerOf}
            roster={roster}
            cpm={cpm}
            caption={caption}
            label={t('casts.castersOf', { name: rowLabel(selected) })}
          />
        </SidePanel>
      );
    }
  }

  return (
    <div className="casts-layout">
      <section className="panel casts-players" aria-labelledby="casts-title">
        <ReportHead
          tab="casts"
          id="casts-title"
          title={title}
          group={breakdown.group}
          summary={
            <span className="casts-summary">
              {onePlayer !== null && (
                <>
                  <PlayerIcon player={roster.get(onePlayer)} size={20} />{' '}
                  {roster.get(onePlayer)?.specName && <>{roster.get(onePlayer)?.specName}{' · '}</>}
                </>
              )}
              <span className="num value-text">{formatInteger(breakdown.total)}</span> {t('casts.castsUnit', { count: breakdown.total })}
              {' · '}
              <span className="num value-text">{cpm(breakdown.total)}</span>{' '}
              {t(onePlayer === null && friendly && breakdown.group === 'source' ? 'casts.raidCpm' : 'casts.cpm')}
              {onePlayer !== null && openPlayerOf && (
                <>
                  {' · '}
                  <button type="button" className="link-accent" onClick={() => openPlayerOf(onePlayer)}>
                    {t('report.playerDetails')}
                  </button>
                </>
              )}
            </span>
          }
        />
        {main}
      </section>
      {side}
    </div>
  );
}

function rowIcon(row: BreakdownRow, roster: Map<number, PlayerRef>, size?: number) {
  const player = playerOf(row);
  if (player !== null) return <PlayerIcon player={roster.get(player)} size={size} />;
  if (row.key.kind === 'ability') return <GameIcon name={rowLabel(row)} icon={spellIcon(row.spellId)} size={size} />;
  return <MonogramTile name={rowLabel(row)} size={size} />;
}

function rowColor(row: BreakdownRow, roster: Map<number, PlayerRef>): string | undefined {
  const player = playerOf(row);
  return player !== null ? classColor(roster.get(player)?.classToken ?? null) : undefined;
}

/** Casters with their casts; the main table's rows select, a side list's rows only show. */
function CasterList(props: {
  rows: (BreakdownRow | GroupedRow)[];
  selected?: GroupedRow;
  onSelect?: (key: string) => void;
  onOpenPlayer?: (player: number) => void;
  roster: Map<number, PlayerRef>;
  cpm: (casts: number) => string;
  caption: string;
  label: string;
}) {
  const { rows, selected, onSelect, onOpenPlayer, roster, cpm, caption, label } = props;
  const top = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <div className="scroll-x">
      <div className="casts-player-rows" role="group" aria-label={label}>
        <div className="cast-prow cast-prow-head" aria-hidden="true">
          <span />
          <span className="cap rrow-cap">{caption}</span>
          <span className="cap rrow-cap">{t('casts.role')}</span>
          <span className="cap rrow-cap">{t('casts.casts')}</span>
          <span className="cap rrow-cap rrow-end">{t('casts.cpm')}</span>
          <span className="cap rrow-cap rrow-end">{onSelect ? t('casts.spells') : ''}</span>
        </div>
        {rows.map((row) => {
          const player = playerOf(row);
          const info = player !== null ? roster.get(player) : undefined;
          const colour = rowColor(row, roster);
          const spells = 'splits' in row ? row.splits.find((s) => s.dimension === 'ability')?.rows.length : undefined;
          const openOnName = onOpenPlayer && player !== null ? () => onOpenPlayer(player) : undefined;
          const cells = (
            <>
              {rowIcon(row, roster)}
              {/* Mouse only: a control inside the row button would be nested interactive content. */}
              <span
                className={openOnName ? 'cast-name rrow-name-link opens-player' : 'cast-name'}
                style={colour ? { color: colour } : undefined}
                onClick={
                  openOnName
                    ? (event) => {
                        event.stopPropagation();
                        openOnName();
                      }
                    : undefined
                }
              >
                <span className="name-label">{rowLabel(row)}</span>
              </span>
              {info?.role ? <span className="role-pill">{t(`role.short.${info.role}`)}</span> : <span />}
              <span className="cast-bar">
                <span className="bar bar-lg" aria-hidden="true">
                  <span style={{ width: barWidth((row.amount / top) * 100), background: colour }} className={colour ? undefined : 'bar-fill-normal'} />
                </span>
                <span className="num cast-count">{formatInteger(row.amount)}</span>
              </span>
              <span className="num rrow-end">{cpm(row.amount)}</span>
              <span className="num rrow-end text-muted">{spells !== undefined ? formatInteger(spells) : ''}</span>
            </>
          );
          if (!onSelect) {
            return (
              <div key={keyOf(row)} className="cast-prow">
                {cells}
              </div>
            );
          }
          const on = row === selected;
          return (
            <button key={keyOf(row)} type="button" className={on ? 'cast-prow cast-prow-sel' : 'cast-prow'} aria-pressed={on} onClick={() => onSelect(keyOf(row))}>
              {cells}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Abilities with their casts across the casters in scope. */
function AbilityList(props: { rows: GroupedRow[]; selected?: GroupedRow; onSelect?: (key: string) => void; cpm: (casts: number) => string }) {
  const { rows, selected, onSelect, cpm } = props;
  const top = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <div className="scroll-x">
      <div className="casts-player-rows" role="group" aria-label={t('casts.byAbility')}>
        <div className="cast-prow cast-prow-head" aria-hidden="true">
          <span />
          <span className="cap rrow-cap">{t('casts.spell')}</span>
          <span />
          <span className="cap rrow-cap">{t('casts.casts')}</span>
          <span className="cap rrow-cap rrow-end">{t('casts.cpm')}</span>
          <span className="cap rrow-cap rrow-end">{t('casts.casters')}</span>
        </div>
        {rows.map((row) => {
          const on = row === selected;
          const casters = row.splits.find((s) => s.dimension === 'source')?.rows.length;
          const cells = (
            <>
              <GameIcon name={rowLabel(row)} icon={spellIcon(row.spellId)} />
              <span className="cast-spell">
                <span className="cast-name">{rowLabel(row)}</span>
                {row.key.kind === 'ability' && row.key.rowKind === 'proc' && <span className="rtag">{t('casts.proc')}</span>}
              </span>
              <span />
              <span className="cast-bar">
                <span className="bar bar-lg" aria-hidden="true">
                  <span style={{ width: barWidth((row.amount / top) * 100) }} className="bar-fill-normal" />
                </span>
                <span className="num cast-count">{formatInteger(row.amount)}</span>
              </span>
              <span className="num rrow-end">{cpm(row.amount)}</span>
              <span className="num rrow-end text-muted">{casters !== undefined ? formatInteger(casters) : ''}</span>
            </>
          );
          if (!onSelect) {
            return (
              <div key={keyOf(row)} className="cast-prow">
                {cells}
              </div>
            );
          }
          return (
            <button key={keyOf(row)} type="button" className={on ? 'cast-prow cast-prow-sel' : 'cast-prow'} aria-pressed={on} onClick={() => onSelect(keyOf(row))}>
              {cells}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The selected row's breakdown beside the main table. */
function SidePanel(props: {
  row: GroupedRow;
  roster: Map<number, PlayerRef>;
  sub: string;
  suffix?: string;
  cpm: (casts: number) => string;
  onOpenPlayer?: () => void;
  onShowOnly: () => void;
  children: ReactNode;
}) {
  const { row, roster, sub, suffix, cpm, onOpenPlayer, onShowOnly, children } = props;
  const player = playerOf(row);
  const spec = player !== null ? roster.get(player)?.specName : null;
  const colour = rowColor(row, roster);
  return (
    <section className="panel casts-spells" aria-labelledby="casts-side-title">
      <div className="panel-head panel-head-side">
        {rowIcon(row, roster, 36)}
        <div className="side-title">
          <h2 className="h2" id="casts-side-title">
            <span style={colour ? { color: colour } : undefined}>{rowLabel(row)}</span>
            {suffix && (
              <>
                {' '}
                <span className="casts-title-suffix">{suffix}</span>
              </>
            )}
          </h2>
          <span className="side-sub">
            {spec && <>{spec}{' · '}</>}
            <span className="num value-text">{formatInteger(row.amount)}</span> {t('casts.castsUnit', { count: row.amount })}
            {' · '}
            <span className="num value-text">{cpm(row.amount)}</span> {t('casts.cpm')}
            {sub && <>{' · '}{sub}</>}
          </span>
        </div>
      </div>
      <SideActions showOnlyLabel={t('breakdown.showOnly', { name: rowLabel(row) })} onOpenPlayer={onOpenPlayer} onShowOnly={onShowOnly} />
      {children}
    </section>
  );
}

/** One caster's spells, sortable; spells link to the player's ability page where it has hits, outside a set. */
function SpellTable(props: { lines: SpellLine[]; player: number | null; label: string; cpm: (casts: number) => string; roster: Map<number, PlayerRef> }) {
  const { lines, player, label, cpm, roster } = props;
  const sort = useApp((s) => s.castsSort);
  const setCastsSort = useApp((s) => s.setCastsSort);
  const openAbilityOf = useApp((s) => s.openAbilityOf);
  const inSet = useApp((s) => s.view.kind === 'set');
  const colour = player !== null ? classColor(roster.get(player)?.classToken ?? null) : undefined;
  // Only a player's own auras are known: other casters have no uptime column.
  const uptimes = player !== null;
  const grid = uptimes ? 'cast-srow' : 'cast-srow cast-srow-plain';
  // Rows without an uptime ("—") stay last in both directions; equal values in the order of the first cast.
  const compare = (a: SpellLine, b: SpellLine) => {
    if (sort.key === 'uptime' && (a.uptime === null) !== (b.uptime === null)) return a.uptime === null ? 1 : -1;
    const diff = sort.key === 'uptime' ? (a.uptime ?? 0) - (b.uptime ?? 0) : a.casts - b.casts;
    return (sort.desc ? -diff : diff) || a.firstCastMs - b.firstCastMs || a.spellId - b.spellId;
  };
  const rows = [...lines].sort(compare);
  const largest = Math.max(1, ...rows.map((s) => s.casts));
  const sortButton = (key: CastsSortKey, text: string) => {
    const on = sort.key === key;
    return (
      <button type="button" className={on ? 'sort-btn sort-btn-on' : 'sort-btn'} onClick={() => setCastsSort(on ? { key, desc: !sort.desc } : { key, desc: true })}>
        {text}
        {on && ` ${sort.desc ? '↓' : '↑'}`}
      </button>
    );
  };
  return (
    <div className="scroll-x">
      <div className="casts-spell-rows" role="table" aria-label={label}>
        <div role="row" className={`${grid} cast-srow-head`}>
          <span role="columnheader" />
          <span role="columnheader" className="cap rrow-cap">
            {t('casts.spell')}
          </span>
          <span role="columnheader">{sortButton('amount', t('report.amount'))}</span>
          {uptimes && (
            <span role="columnheader" className="rrow-end">
              {sortButton('uptime', t('casts.uptime'))}
            </span>
          )}
          <span role="columnheader" className="rrow-end">
            {sortButton('cpm', t('casts.cpm'))}
          </span>
        </div>
        {rows.map((s) => (
          <div role="row" className={grid} key={s.key}>
            <span role="cell">
              <GameIcon name={s.name} icon={spellIcon(s.spellId)} />
            </span>
            <span role="cell" className="cast-spell">
              {s.link && player !== null && !inSet ? (
                <button type="button" className="link-btn cast-spell-name" onClick={() => s.link && void openAbilityOf(player, s.link.spellId, s.link.metric)}>
                  {s.name}
                </button>
              ) : (
                <span className="cast-spell-name">{s.name}</span>
              )}
              {s.proc && <span className="rtag">{t('casts.proc')}</span>}
            </span>
            <span role="cell" className="cast-spell-bar">
              <span className="bar bar-lg" aria-hidden="true">
                <span style={{ width: barWidth((s.casts / largest) * 100), background: colour }} className={colour ? undefined : 'bar-fill-normal'} />
              </span>
              <span className="num cast-spell-count">{formatInteger(s.casts)}</span>
            </span>
            {uptimes && (
              <span role="cell" className="num rrow-end">
                {s.uptime !== null ? formatShare(s.uptime * 100) : <span className="dash">—</span>}
              </span>
            )}
            <span role="cell" className="num rrow-end">
              {cpm(s.casts)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
