import { type CSSProperties, Fragment, type ReactNode, type Ref, useState } from 'react';
import type { Breakdown, BreakdownRow, Dimension, GroupedRow } from '../../api/types';
import { formatScaled, formatShare } from '../../i18n/format';
import { type MessageKey, t } from '../../i18n/i18n';
import { spellIcon } from '../../icons';
import { type MetricTab, useApp } from '../../store';
import { GameIcon, MonogramTile } from '../GameIcon';
import { rowLabel, rowPet, showOnlyLabel } from '../filters/labels';
import { NoMatch } from '../filters/NoMatch';
import { ReportPickers } from '../filters/ReportPickers';
import { RowsMenu } from '../filters/RowsMenu';
import { captionOf } from '../filters/sides';
import { classColor } from '../overview/players';
import { AbsorbMarks, absorbNote } from './absorbMarks';
import { PlayerIcon } from './PlayerName';
import { RankedHead, SideActions } from './ReportParts';
import { barWidth, rosterIndex } from './reportData';

interface Props {
  tab: MetricTab;
  breakdown: Breakdown;
  title: string;
  unit: string;
  hint?: string;
  sideExtras?: (row: GroupedRow) => ReactNode;
  /** Numeric columns between the per-second column and Share. */
  extraColumns?: ExtraColumn[];
  /** The bar's fill; `undefined` keeps the plain fill (class-coloured for players). */
  fill?: (row: GroupedRow, barPct: number) => ReactNode | undefined;
  /** The total next to the bar; `undefined` keeps the plain number. */
  total?: (row: GroupedRow, text: string) => ReactNode | undefined;
  /**
   * Hover on the name and focus of the row preview what selecting it shows; `name` is the anchor, `row`
   * the row; `null` closes it.
   */
  onPreview?: (row: GroupedRow) => PreviewHandler | undefined;
  /** The id of the open popup that describes `row`. */
  describedBy?: (row: GroupedRow) => string | undefined;
  /** Shown between the head and the rows (the target colour legend). */
  legend?: ReactNode;
  /** The element bar popups are placed in, and the open popup. */
  panelRef?: Ref<HTMLElement>;
  popup?: ReactNode;
}

export interface ExtraColumn {
  label: string;
  render: (row: GroupedRow) => ReactNode;
  /** With it, the column shows only when a row has a value. */
  hasValue?: (row: GroupedRow) => boolean;
  /** In px. */
  width?: number;
}

export type PreviewHandler = (name: HTMLElement | null, row: HTMLElement | null) => void;

const SIDE_ROWS = 7;
const SIDE_ICON = 36;
const COLUMN_WIDTH = 84;

/** The extra columns of the rows' grid, which reports.css lays out around the fixed ones. */
function extraGrid(columns: ExtraColumn[]): CSSProperties | undefined {
  if (columns.length === 0) return undefined;
  const widths = columns.map((column) => column.width ?? COLUMN_WIDTH);
  return {
    '--extra-columns': widths.map((w) => `${w}px`).join(' '),
    '--extra-width': `${widths.reduce((sum, w) => sum + w, 0)}px`,
    '--extra-count': widths.length,
  } as CSSProperties;
}
const NOTHING_LOGGED: Record<MetricTab, MessageKey> = { damage: 'report.noDamage', healing: 'report.noHealing', taken: 'report.noDamageTaken' };

const keyOf = (row: BreakdownRow) => JSON.stringify(row.key);
const playerIdOf = (row: BreakdownRow) => (row.key.kind === 'unit' && row.key.unit.kind === 'player' ? row.key.unit.actorId : null);

export function BreakdownPanel(props: Props) {
  const { tab, breakdown, title, unit, hint, sideExtras, extraColumns = [], fill, total, onPreview, describedBy, legend, panelRef, popup } = props;
  const columns = extraColumns.filter((column) => !column.hasValue || breakdown.rows.some(column.hasValue));
  const grid = extraGrid(columns);
  const scope = useApp((s) => s.scope);
  const showOnly = useApp((s) => s.showOnly);
  const openPlayer = useApp((s) => s.openPlayer);
  const hasPlayerPages = useApp((s) => s.view.kind !== 'set');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [splitDimension, setSplitDimension] = useState<Dimension | null>(null);
  const roster = rosterIndex(breakdown.roster);
  const top = Math.max(0, ...breakdown.rows.map((r) => r.amount));
  const selected = breakdown.rows.find((r) => keyOf(r) === selectedKey) ?? breakdown.rows[0];
  const splits = selected?.splits.filter((s) => breakdown.side.includes(s.dimension)) ?? [];
  const split = splits.find((s) => s.dimension === splitDimension) ?? splits[0];
  const playerPageOf = (row: BreakdownRow) => (hasPlayerPages ? playerIdOf(row) : null);
  const selectedPlayer = selected ? playerPageOf(selected) : null;
  const narrowable = (row: BreakdownRow) => scope[breakdown.group].length === 0 && !(row.key.kind === 'ability' && row.key.rowKind === 'unmatched');
  const narrowTo = (row: BreakdownRow) => void showOnly(breakdown.group, row);
  const nameAction = (row: BreakdownRow) => {
    const player = playerPageOf(row);
    if (player !== null) return () => void openPlayer(player);
    return narrowable(row) ? () => narrowTo(row) : undefined;
  };

  const playerOf = (row: BreakdownRow) => {
    const unitRef = row.key.kind === 'unit' ? row.key.unit : null;
    return unitRef?.kind === 'player' ? roster.get(unitRef.actorId) : undefined;
  };

  const icon = (row: BreakdownRow, size?: number) => {
    const player = playerOf(row);
    if (player) return <PlayerIcon player={player} size={size} />;
    if (row.key.kind === 'ability') return <GameIcon name={rowLabel(row)} icon={spellIcon(row.spellId)} size={size} />;
    return <MonogramTile name={rowLabel(row)} size={size} />;
  };

  const plainFill = (row: BreakdownRow, barPct: number) => {
    const player = playerOf(row);
    return (
      <span
        style={player ? { width: barWidth(barPct), background: classColor(player.classToken) } : { width: barWidth(barPct) }}
        className={player ? undefined : 'bar-fill-normal'}
        title={absorbNote(row, tab)}
      >
        <AbsorbMarks amount={row.amount} absorbed={row.absorbed} healAbsorbed={row.healAbsorbed} />
      </span>
    );
  };
  const selectedSpec = selected ? playerOf(selected)?.specName : null;

  const name = (row: BreakdownRow) => {
    const player = playerOf(row);
    const pet = rowPet(row.key);
    return (
      <span className="player-name" style={player ? { color: classColor(player.classToken) } : undefined}>
        <span className="name-label">{rowLabel(row)}</span>
        {pet && <span className="ab-pet">{pet}</span>}
        {row.key.kind === 'ability' && row.key.rowKind === 'support' && <span className="rtag rtag-support">{t('report.supportTag')}</span>}
      </span>
    );
  };

  return (
    <div className="report-layout">
      <section className="panel report-main" aria-labelledby="breakdown-title" ref={panelRef}>
        <div className="panel-head panel-head-report breakdown-head">
          <div className="report-title">
            <h2 className="h2" id="breakdown-title">
              {title}
            </h2>
            {hint && <span className="report-hint">{hint}</span>}
            <ReportPickers tab={tab} />
          </div>
          <RowsMenu tab={tab} group={breakdown.group} />
        </div>
        {legend}
        {breakdown.rows.length === 0 ? (
          <NoMatch nothing={t(NOTHING_LOGGED[tab])} />
        ) : (
          <div className="scroll-x">
            <div className="report-rows" style={grid} role="group" aria-label={t('breakdown.rowsOf', { title })}>
              <RankedHead
                columns={[
                  { label: t('report.rank') },
                  { label: captionOf(tab, breakdown.group) },
                  { label: title },
                  { label: unit, end: true },
                  ...columns.map((column) => ({ label: column.label, end: true })),
                  { label: t('report.share'), end: true },
                ]}
              />
              {breakdown.rows.map((row, index) => {
                const barPct = top > 0 ? (row.amount / top) * 100 : 0;
                const amount = formatScaled(row.amount);
                const preview = onPreview?.(row);
                const onName = nameAction(row);
                const opensPlayer = playerPageOf(row) !== null;
                return (
                  <button
                    key={keyOf(row)}
                    type="button"
                    className={row === selected ? 'rrow rrow-sel' : 'rrow'}
                    aria-pressed={row === selected}
                    aria-describedby={describedBy?.(row)}
                    onClick={() => {
                      setSelectedKey(keyOf(row));
                      preview?.(null, null);
                    }}
                    onFocus={preview && ((event) => preview(event.currentTarget.querySelector<HTMLElement>('.player-name') ?? event.currentTarget, event.currentTarget))}
                    onBlur={preview && (() => preview(null, null))}
                    onKeyDown={preview && ((event) => event.key === 'Escape' && preview(null, null))}
                  >
                    <span className="num rrow-rank">{index + 1}</span>
                    {/* A mouse shortcut for the side panel's buttons: a control inside the row button would be nested interactive content. */}
                    <span
                      className={onName ? (opensPlayer ? 'rrow-name rrow-name-link opens-player' : 'rrow-name rrow-name-link') : 'rrow-name'}
                      onClick={
                        onName
                          ? (event) => {
                              event.stopPropagation();
                              onName();
                            }
                          : undefined
                      }
                      onMouseEnter={preview && ((event) => preview(event.currentTarget, event.currentTarget.closest<HTMLElement>('.rrow')))}
                      onMouseLeave={preview && (() => preview(null, null))}
                    >
                      {icon(row)}
                      {name(row)}
                    </span>
                    <span className="rrow-bar">
                      <span className="bar bar-lg" aria-hidden="true">
                        {fill?.(row, barPct) ?? plainFill(row, barPct)}
                      </span>
                      <span className="rrow-total num">{total?.(row, amount) ?? amount}</span>
                    </span>
                    <span className="num rrow-end">{formatScaled(row.perSecond)}</span>
                    {columns.map((column) => (
                      <Fragment key={column.label}>{column.render(row)}</Fragment>
                    ))}
                    <span className="num rrow-share">{formatShare(row.share * 100)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {popup}
      </section>
      {selected && (
        <aside className="panel report-side" aria-labelledby="breakdown-side-title">
          <div className="panel-head panel-head-side">
            {icon(selected, SIDE_ICON)}
            <div className="side-title">
              <h2 className="h2" id="breakdown-side-title">
                {name(selected)}
              </h2>
              <span className="side-sub">
                {selectedSpec && (
                  <>
                    {selectedSpec}
                    {' · '}
                  </>
                )}
                <span className="num value-text">{formatScaled(selected.amount)}</span>
                {' · '}
                <span className="num side-rate">
                  {formatScaled(selected.perSecond)} {unit}
                </span>
              </span>
            </div>
          </div>
          <SideActions
            showOnlyLabel={showOnlyLabel(selected)}
            onOpenPlayer={selectedPlayer !== null ? () => void openPlayer(selectedPlayer) : undefined}
            onShowOnly={narrowable(selected) ? () => narrowTo(selected) : undefined}
          />
          {splits.length > 1 && (
            <div className="seg side-tabs" role="group" aria-label={t('breakdown.splitBy')}>
              {splits.map((s) => (
                <button key={s.dimension} type="button" className={s === split ? 'on' : undefined} aria-pressed={s === split} onClick={() => setSplitDimension(s.dimension)}>
                  {t(`breakdown.split.${s.dimension}`)}
                </button>
              ))}
            </div>
          )}
          {split ? <SplitList tab={tab} rows={split.rows} icon={icon} name={name} /> : <p className="muted side-empty">{t('breakdown.nothingLeft')}</p>}
          {sideExtras?.(selected)}
        </aside>
      )}
    </div>
  );
}

interface SplitListProps {
  tab: MetricTab;
  rows: BreakdownRow[];
  icon: (row: BreakdownRow) => ReactNode;
  name: (row: BreakdownRow) => ReactNode;
}

function sideFill(row: BreakdownRow): string {
  if (row.amount < 0) return 'bar-fill-negative';
  return row.key.kind === 'ability' && row.key.rowKind === 'support' ? 'bar-fill-support' : 'bar-fill-normal';
}

function SplitList({ tab, rows, icon, name }: SplitListProps) {
  const shown = rows.slice(0, SIDE_ROWS);
  const rest = rows.slice(SIDE_ROWS);
  const restAmount = rest.reduce((sum, r) => sum + r.amount, 0);
  const top = Math.max(1, ...shown.map((r) => Math.abs(r.amount)));
  return (
    <div>
      {shown.map((row) => (
        <div key={keyOf(row)} className="side-row">
          <span>{icon(row)}</span>
          <span className="side-cell">
            <span className="side-label">{name(row)}</span>
            <span className="bar bar-thin" aria-hidden="true">
              <span className={sideFill(row)} style={{ width: barWidth((Math.abs(row.amount) / top) * 100) }} title={absorbNote(row, tab)}>
                <AbsorbMarks amount={row.amount} absorbed={row.absorbed} healAbsorbed={row.healAbsorbed} />
              </span>
            </span>
          </span>
          <span className={row.amount < 0 ? 'num side-amount side-amount-negative' : 'num side-amount'}>{formatScaled(row.amount)}</span>
          <span className="num side-share">{row.amount < 0 ? '' : formatShare(row.share * 100)}</span>
        </div>
      ))}
      {rest.length > 0 && (
        <div className="side-row side-row-other">
          <span />
          <span>{t('breakdown.other', { count: rest.length })}</span>
          <span className="num side-amount">{formatScaled(restAmount)}</span>
          <span />
        </div>
      )}
    </div>
  );
}
