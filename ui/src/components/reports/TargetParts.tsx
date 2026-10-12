import { type ReactNode, useRef, useState } from 'react';
import type { PlayerRef, TargetShare } from '../../api/types';
import { spellIconUrl } from '../../icons';
import { formatCount, formatMillions, formatShare } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { GameIcon } from '../GameIcon';
import type { BreakdownRow } from './breakdown';
import { PlayerName } from './PlayerName';
import { barWidth, reportSpellName, type SpellNames } from './reportData';
import { type GroupPart, type TargetGroup, type TargetMetric, playerColor, targetName, unitsNote } from './targetGroups';

/** How many targets a list shows before "Other". */
export const TOP_TARGETS = 5;
/** Abilities or healed players a segment popup lists. */
const SEGMENT_ROWS = 4;
const POPUP_WIDTH = 360;
export const CARD_WIDTH = 620;

export interface PopupAnchor {
  top: number;
  left: number;
}

/**
 * A popup placed below its row in the row's panel. It belongs to the report and Aug mode it was opened
 * for, so a new range or mode closes it instead of showing old numbers at an old place.
 */
export function usePanelPopup<T>(owner: object) {
  const attribution = useApp((s) => s.attribution);
  const panel = useRef<HTMLElement>(null);
  const [state, setState] = useState<{ data: T; at: PopupAnchor; owner: object; attribution: string } | null>(null);
  const open = (data: T, anchor: HTMLElement | null, row: HTMLElement | null = anchor, width = POPUP_WIDTH) => {
    const box = panel.current;
    if (!anchor || !row || !box) {
      setState(null);
      return;
    }
    const frame = box.getBoundingClientRect();
    const left = anchor.getBoundingClientRect().left - frame.left;
    setState({
      data,
      owner,
      attribution,
      at: { top: row.getBoundingClientRect().bottom - frame.top + 2, left: Math.max(8, Math.min(left, frame.width - width - 8)) },
    });
  };
  const popup = state && state.owner === owner && state.attribution === attribution ? state : null;
  return { panel, popup, open, close: () => setState(null) };
}

/** "Color by Player | Target" (healing: "Role"), remembered across sessions. */
export function ColorBySwitch({ metric }: { metric: TargetMetric }) {
  const colorByTarget = useApp((s) => s.colorByTarget);
  const setColorByTarget = useApp((s) => s.setColorByTarget);
  const label = t('targets.colorBy');
  return (
    <div className="seg-wrap">
      <span className="cap" aria-hidden="true">
        {label}
      </span>
      <div className="seg seg-sm" role="group" aria-label={label}>
        <button type="button" className={colorByTarget ? undefined : 'on'} aria-pressed={!colorByTarget} onClick={() => setColorByTarget(false)}>
          {t('targets.byPlayer')}
        </button>
        <button type="button" className={colorByTarget ? 'on' : undefined} aria-pressed={colorByTarget} onClick={() => setColorByTarget(true)}>
          {t(metric === 'healing' ? 'targets.byRole' : 'targets.byTarget')}
        </button>
      </div>
    </div>
  );
}

export type SideView = 'abilities' | 'targets';

/** The side panel's "Abilities | Targets" (healing: "Healed players"). */
export function SideViewSwitch({ view, metric, onChange }: { view: SideView; metric: TargetMetric; onChange: (view: SideView) => void }) {
  return (
    <div className="side-switch">
      <div className="seg seg-sm" role="group" aria-label={t('targets.sideView')}>
        <button type="button" className={view === 'abilities' ? 'on' : undefined} aria-pressed={view === 'abilities'} onClick={() => onChange('abilities')}>
          {t('player.abilities')}
        </button>
        <button type="button" className={view === 'targets' ? 'on' : undefined} aria-pressed={view === 'targets'} onClick={() => onChange('targets')}>
          {t(metric === 'healing' ? 'targets.healedPlayers' : 'targets.title')}
        </button>
      </div>
    </div>
  );
}

/** The colour legend; a chip highlights its group on every bar. */
export function TargetLegend({ groups, highlight, onToggle }: { groups: TargetGroup[]; highlight: string | null; onToggle: (key: string) => void }) {
  return (
    <div className="tlegend" role="group" aria-label={t('targets.legend')}>
      {groups.map((group) => (
        <button key={group.key} type="button" className={group.key === highlight ? 'legend-chip on' : 'legend-chip'} aria-pressed={group.key === highlight} onClick={() => onToggle(group.key)}>
          <span className="tswatch" style={{ background: group.color }} aria-hidden="true" />
          {group.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A bar's fill split by group, `widthPct` wide; `total` is the player's or ability's amount the parts are
 * shares of.
 */
export function StackedFill({
  parts,
  total,
  widthPct,
  highlight,
  onSegment,
}: {
  parts: GroupPart[];
  total: number;
  widthPct: number;
  highlight?: string | null;
  onSegment?: (part: GroupPart, segment: HTMLElement | null) => void;
}) {
  return (
    <span className="tstack" style={{ width: barWidth(widthPct) }}>
      {parts.map((part) => (
        <span
          key={part.group.key}
          className={highlight && highlight !== part.group.key ? 'tseg tseg-dim' : 'tseg'}
          style={{ width: barWidth(total > 0 ? (part.amount / total) * 100 : 0), background: part.group.color }}
          onMouseEnter={onSegment && ((event) => onSegment(part, event.currentTarget))}
          onMouseLeave={onSegment && (() => onSegment(part, null))}
        />
      ))}
    </span>
  );
}

export interface TargetRow {
  key: string;
  name: string;
  note: string;
  nameColor: string | null;
  swatch: string;
  barColor: string;
  amount: number;
  share: number | null;
  barPct: number;
  hits: number;
  crits: number;
}

/** A target list: the largest targets and "Other". Healed players' bars take their class colour. */
export function targetRows(
  targets: TargetShare[],
  ctx: { total: number; roster: Map<number, PlayerRef>; colorOf: (target: TargetShare['target']) => string; top?: number },
): TargetRow[] {
  const shown = targets.slice(0, ctx.top ?? targets.length);
  const rest = targets.slice(shown.length).reduce((sum, share) => sum + share.amount, 0);
  const max = Math.max(0, ...shown.map((share) => share.amount), rest);
  const rows: TargetRow[] = shown.map((share, i) => {
    const swatch = ctx.colorOf(share.target);
    return {
      key: `${i}:${share.target.kind}:${share.target.name}:${share.target.player}`,
      name: targetName(share.target, ctx.roster),
      note: unitsNote(share.target),
      nameColor: playerColor(share.target, ctx.roster),
      swatch,
      barColor: playerColor(share.target, ctx.roster) ?? swatch,
      amount: share.amount,
      share: ctx.total > 0 && share.amount >= 0 ? share.amount / ctx.total : null,
      barPct: max > 0 ? (Math.max(0, share.amount) * 100) / max : 0,
      hits: share.hits,
      crits: share.crits,
    };
  });
  if (rest > 0)
    rows.push({
      key: 'other',
      name: t('targets.other'),
      note: '',
      nameColor: null,
      swatch: 'var(--target-other)',
      barColor: 'var(--target-other)',
      amount: rest,
      share: ctx.total > 0 ? rest / ctx.total : null,
      barPct: max > 0 ? (rest * 100) / max : 0,
      hits: 0,
      crits: 0,
    });
  return rows;
}

/** The side panel's target list: swatch, name over a thin bar, amount, share. */
export function TargetBreakdown({ caption, amountLabel, nameLabel, rows }: { caption: string; amountLabel: string; nameLabel: string; rows: TargetRow[] }) {
  return (
    <div role="table" aria-label={caption}>
      <div role="row" className="side-row side-row-head">
        <span role="columnheader" />
        <span role="columnheader" className="cap rrow-cap">
          {nameLabel}
        </span>
        <span role="columnheader" className="cap rrow-cap rrow-end">
          {amountLabel}
        </span>
        <span role="columnheader" className="cap rrow-cap rrow-end">
          {t('report.sharePct')}
        </span>
      </div>
      {rows.map((row) => (
        <div role="row" className="side-row" key={row.key}>
          <span role="cell" className="tswatch-cell">
            <span className="tswatch" style={{ background: row.swatch }} aria-hidden="true" />
          </span>
          <span role="cell" className="side-cell">
            <span className={row.key === 'other' ? 'side-label side-label-other' : 'side-label'} style={row.nameColor ? { color: row.nameColor } : undefined}>
              {row.name}
              {row.note && <span className="side-note">{row.note}</span>}
            </span>
            <span className="bar bar-thin" aria-hidden="true">
              <span style={{ width: barWidth(row.barPct), background: row.barColor }} />
            </span>
          </span>
          <span role="cell" className={row.amount < 0 ? 'num side-amount side-amount-negative' : 'num side-amount'}>
            {formatMillions(row.amount)}
          </span>
          <span role="cell" className="num side-share">
            {row.share === null ? '' : formatShare(row.share * 100)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Popup({ id, at, width, children }: { id: string; at: PopupAnchor; width?: number; children: ReactNode }) {
  return (
    <div role="tooltip" id={id} className="rpop" style={{ top: at.top, left: at.left, width: width ?? POPUP_WIDTH }}>
      {children}
    </div>
  );
}

function PopupRow({ icon, name, nameColor, barPct, barColor, amount, share }: { icon: ReactNode; name: string; nameColor?: string | null; barPct: number; barColor: string; amount: number; share: string }) {
  return (
    <div className="rpop-row">
      {icon}
      <span className="rpop-cell">
        <span className="rpop-name" style={nameColor ? { color: nameColor } : undefined}>
          {name}
        </span>
        <span className="bar bar-thin" aria-hidden="true">
          <span style={{ width: barWidth(barPct), background: barColor }} />
        </span>
      </span>
      <span className="num rpop-amount">{formatMillions(amount)}</span>
      <span className="num rpop-share">{share}</span>
    </div>
  );
}

/** Hover or focus on a player's name: the top abilities and targets, as the side panel pins them. */
export function PlayerCard({ id, at, player, total, abilities, targets, targetsLabel }: { id: string; at: PopupAnchor; player: PlayerRef | undefined; total: number; abilities: BreakdownRow[]; targets: TargetRow[]; targetsLabel: string }) {
  return (
    <Popup id={id} at={at} width={CARD_WIDTH}>
      <div className="rpop-head">
        <PlayerName player={player} size={18} />
        <span className="num rpop-total">{formatMillions(total)}</span>
      </div>
      <div className="rpop-cols">
        <div>
          <div className="cap rrow-cap">{t('report.ability')}</div>
          {abilities.map((row) => (
            <PopupRow
              key={row.key}
              icon={row.icon ? <GameIcon src={row.icon} name={row.name} size={18} /> : <span className="ph-ico ph-ico-s" aria-hidden="true">…</span>}
              name={row.name}
              barPct={row.barPct}
              barColor={row.tone === 'support' ? 'var(--class-evoker)' : 'var(--faint)'}
              amount={row.amount}
              share={row.share === null ? '' : formatShare(row.share * 100)}
            />
          ))}
        </div>
        <div>
          <div className="cap rrow-cap">{targetsLabel}</div>
          {targets.map((row) => (
            <PopupRow
              key={row.key}
              icon={<span className="tswatch tswatch-cell" style={{ background: row.swatch }} aria-hidden="true" />}
              name={row.name + row.note}
              nameColor={row.nameColor}
              barPct={row.barPct}
              barColor={row.barColor}
              amount={row.amount}
              share={row.share === null ? '' : formatShare(row.share * 100)}
            />
          ))}
        </div>
      </div>
    </Popup>
  );
}

/**
 * Hover on a bar segment: the group's amount and share, then `abilities` (the largest on it) or its targets;
 * healing always lists the healed players of that role (bars in their class colour). `withHits` adds the
 * group's hits and crit rate, which only mean something for one ability.
 */
export function SegmentPopup({
  id,
  at,
  part,
  ofName,
  total,
  metric,
  spells,
  roster,
  list = metric === 'healing' ? 'targets' : 'abilities',
  abilities = [],
  withHits = false,
}: {
  id: string;
  at: PopupAnchor;
  part: GroupPart;
  ofName: string;
  total: number;
  metric: TargetMetric;
  spells: SpellNames;
  roster: Map<number, PlayerRef>;
  list?: 'abilities' | 'targets';
  abilities?: { spellId: number; amount: number }[];
  withHits?: boolean;
}) {
  const single = part.targets.length === 1 ? unitsNote(part.targets[0].target) : '';
  const hits = part.targets.reduce((sum, share) => sum + share.hits, 0);
  const crits = part.targets.reduce((sum, share) => sum + share.crits, 0);
  const hitsNote = withHits && hits > 0 ? ` · ${t('targets.hitsCrit', { hits: formatCount(hits), crit: formatShare((crits / hits) * 100) })}` : '';
  const sub = t('targets.shareOf', { share: formatShare(total > 0 ? (part.amount / total) * 100 : 0), name: ofName }) + single + hitsNote;
  const listsTargets = list === 'targets' && (metric === 'healing' || part.targets.length > 1);
  const rows: { key: string; icon: ReactNode; name: string; nameColor: string | null; amount: number; barColor: string }[] =
    list === 'targets'
      ? (listsTargets ? part.targets.slice(0, SEGMENT_ROWS) : []).map((share, i) => ({
          key: `${i}`,
          icon: null,
          name: targetName(share.target, roster) + unitsNote(share.target),
          nameColor: playerColor(share.target, roster),
          amount: share.amount,
          barColor: playerColor(share.target, roster) ?? part.group.color,
        }))
      : abilities.map(({ spellId, amount }) => ({
          key: `${spellId}`,
          icon: <GameIcon src={spellIconUrl(spellId)} name={reportSpellName(spells, spellId)} size={18} />,
          name: reportSpellName(spells, spellId),
          nameColor: null,
          amount,
          barColor: part.group.color,
        }));
  const max = Math.max(1, ...rows.map((row) => row.amount));
  return (
    <Popup id={id} at={at} width={320}>
      <div className="rpop-head">
        <span className="tswatch" style={{ background: part.group.color }} aria-hidden="true" />
        <span className="rpop-title">{part.group.label}</span>
        <span className="num rpop-total">{formatMillions(part.amount)}</span>
      </div>
      <div className="rpop-sub">{sub}</div>
      {rows.length > 0 && <div className="cap rrow-cap">{t(list === 'abilities' ? 'targets.topAbilities' : metric === 'healing' ? 'targets.healedPlayers' : 'targets.title')}</div>}
      {rows.map((row) => (
        <PopupRow
          key={row.key}
          icon={row.icon ?? <span className="tswatch tswatch-cell" style={{ background: part.group.color }} aria-hidden="true" />}
          name={row.name}
          nameColor={row.nameColor}
          barPct={(Math.max(0, row.amount) * 100) / max}
          barColor={row.barColor}
          amount={row.amount}
          share={part.amount > 0 ? formatShare((row.amount / part.amount) * 100) : ''}
        />
      ))}
    </Popup>
  );
}
