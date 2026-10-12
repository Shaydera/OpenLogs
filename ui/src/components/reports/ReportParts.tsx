import type { ReactNode } from 'react';
import type { BuffShare, PlayerAmount, PlayerRef } from '../../api/types';
import { spellIconUrl } from '../../icons';
import { formatMillions, formatShare } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { GameIcon } from '../GameIcon';
import { classColor, shortName } from '../overview/players';
import type { AugMetric } from './augSplit';
import type { BreakdownRow, BreakdownTone } from './breakdown';
import { PlayerIcon, PlayerName } from './PlayerName';
import { barWidth, reportSpellName, type SpellNames } from './reportData';

const classes = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');
const playerLabel = (player: PlayerRef | undefined) => (player ? shortName(player.name) : t('report.unknownPlayer'));

/** The head of a report's main panel: title and hint on one baseline, a control on the right. */
export function ReportHead({ id, title, hint, children }: { id: string; title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="panel-head panel-head-report">
      <div className="report-title">
        <h2 className="h2" id={id}>
          {title}
        </h2>
        {hint && <span className="report-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export interface RankedColumn {
  label: string;
  /** Right-aligned (numbers). */
  end?: boolean;
}

/** The caption row of a ranked player list. */
export function RankedHead({ grid, columns }: { grid?: string; columns: RankedColumn[] }) {
  return (
    <div className={classes('rrow', 'rrow-head', grid)} aria-hidden="true">
      {columns.map((column) => (
        <span key={column.label} className={classes('cap', 'rrow-cap', column.end && 'rrow-end')}>
          {column.label}
        </span>
      ))}
    </div>
  );
}

interface RankedRowProps {
  /** Grid modifier, e.g. `rrow-nodelta`. */
  grid?: string;
  rank: number;
  player: PlayerRef | undefined;
  /** 0–100, of the top player. */
  barPct: number;
  total: ReactNode;
  selected: boolean;
  onSelect: () => void;
  /**
   * Hover on the name and focus of the row preview what selecting it shows (the player card); `name`
   * is the anchor, `row` the row; `null` closes it.
   */
  onPreview?: (name: HTMLElement | null, row: HTMLElement | null) => void;
  /** The bar's fill when it is split by target; the class-coloured fill otherwise. */
  fill?: ReactNode;
  describedBy?: string;
  children?: ReactNode;
}

/** A whole-row button: rank, player, a class-coloured bar with the total, then `children`. */
export function RankedRow({ grid, rank, player, barPct, total, selected, onSelect, onPreview, fill, describedBy, children }: RankedRowProps) {
  const rowOf = (element: HTMLElement) => element.closest<HTMLElement>('.rrow');
  return (
    <button
      type="button"
      className={classes('rrow', grid, selected && 'rrow-sel')}
      aria-pressed={selected}
      aria-describedby={describedBy}
      onClick={() => {
        onSelect();
        onPreview?.(null, null);
      }}
      onFocus={onPreview && ((event) => onPreview(event.currentTarget.querySelector<HTMLElement>('.player-name') ?? event.currentTarget, event.currentTarget))}
      onBlur={onPreview && (() => onPreview(null, null))}
      onKeyDown={onPreview && ((event) => event.key === 'Escape' && onPreview(null, null))}
    >
      <span className="num rrow-rank">{rank}</span>
      <span
        className="rrow-name"
        onMouseEnter={onPreview && ((event) => onPreview(event.currentTarget, rowOf(event.currentTarget)))}
        onMouseLeave={onPreview && (() => onPreview(null, null))}
      >
        <PlayerName player={player} />
      </span>
      <span className="rrow-bar">
        <span className="bar bar-lg" aria-hidden="true">
          {fill ?? <span style={{ width: barWidth(barPct), background: classColor(player?.classToken ?? null) }} />}
        </span>
        <span className="rrow-total">{total}</span>
      </span>
      {children}
    </button>
  );
}

/** The side panel's head: icon, name, spec · total · per second, "Player details →". */
export function SideHead(props: { id: string; player: PlayerRef | undefined; total: number; perSecond: number; unit: string; onDetails: () => void }) {
  const { id, player, total, perSecond, unit, onDetails } = props;
  return (
    <div className="panel-head panel-head-side">
      <PlayerIcon player={player} size={36} />
      <div className="side-title">
        <h2 className="h2" id={id}>
          <span className="side-name" style={{ color: classColor(player?.classToken ?? null) }}>
            {playerLabel(player)}
          </span>
        </h2>
        <span className="side-sub">
          {player?.specName && (
            <>
              {player.specName}
              {' · '}
            </>
          )}
          <span className="num value-text">{formatMillions(total)}</span>
          {' · '}
          <span className="num side-rate">
            {formatMillions(perSecond)} {unit}
          </span>
        </span>
      </div>
      <button type="button" className="link-accent" onClick={onDetails}>
        {t('report.playerDetails')}
      </button>
    </div>
  );
}

const LABEL: Record<BreakdownTone, string> = {
  normal: 'side-label',
  other: 'side-label side-label-other',
  support: 'side-label',
  negative: 'side-label side-label-negative',
};
const FILL: Record<BreakdownTone, string> = {
  normal: 'bar-fill-normal',
  other: 'bar-fill-normal',
  support: 'bar-fill-support',
  negative: 'bar-fill-negative',
};

/** The side panel's list: icon, name over a thin bar, amount, share. */
export function SideBreakdown({ caption, amountLabel, rows }: { caption: string; amountLabel: string; rows: BreakdownRow[] }) {
  return (
    <div role="table" aria-label={caption}>
      <div role="row" className="side-row side-row-head">
        <span role="columnheader" />
        <span role="columnheader" className="cap rrow-cap">
          {t('report.ability')}
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
          <span role="cell">
            {row.icon ? (
              <GameIcon src={row.icon} name={row.name} />
            ) : (
              <span className="ph-ico" aria-hidden="true">
                …
              </span>
            )}
          </span>
          <span role="cell" className="side-cell">
            <span className={LABEL[row.tone]}>
              {row.name}
              {row.note && (
                <span className="side-note" style={row.noteColor ? { color: row.noteColor } : undefined}>
                  {row.note}
                </span>
              )}
              {row.tone === 'support' && <span className="rtag rtag-support">{t('report.supportTag')}</span>}
            </span>
            <span className="bar bar-thin" aria-hidden="true">
              <span className={FILL[row.tone]} style={{ width: barWidth(row.barPct) }} />
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

/** How many buffed players "Support by recipient" lists; the player page has them all. */
const TOP_RECIPIENTS = 8;

/** "Support by recipient": the top buffed players with a bar and the share of `base`. */
export function RecipientList({ entries, base, roster }: { entries: PlayerAmount[]; base: number; roster: Map<number, PlayerRef> }) {
  const top = Math.max(0, ...entries.map((entry) => entry.amount));
  return (
    <>
      <div className="side-section">
        <span className="cap">{t('aug.byRecipient')}</span>
      </div>
      <div role="table" aria-label={t('aug.byRecipient')}>
        {entries.slice(0, TOP_RECIPIENTS).map((entry) => {
          const player = roster.get(entry.player);
          return (
            <div role="row" className="side-row" key={entry.player}>
              <span role="cell">
                <PlayerIcon player={player} />
              </span>
              <span role="cell" className="side-cell">
                <span className="side-player" style={{ color: classColor(player?.classToken ?? null) }}>
                  {playerLabel(player)}
                </span>
                <span className="bar bar-thin" aria-hidden="true">
                  <span className="bar-fill-support" style={{ width: barWidth(top > 0 ? (entry.amount * 100) / top : 0) }} />
                </span>
              </span>
              <span role="cell" className="num side-amount">
                {formatMillions(entry.amount)}
              </span>
              <span role="cell" className="num side-share">
                {base > 0 ? formatShare((entry.amount / base) * 100) : ''}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Reattributed, a buffed player: the Aug support credited to Evokers, by buff and Evoker. */
export function AugSupportList({ shares, spells, roster }: { shares: BuffShare[]; spells: SpellNames; roster: Map<number, PlayerRef> }) {
  return (
    <>
      <div className="side-section">
        <span className="cap">{t('aug.movedToEvokers')}</span>
      </div>
      <div role="table" aria-label={t('aug.movedToEvokers')}>
        {shares.map((share) => {
          const buff = reportSpellName(spells, share.buffId);
          const evoker = roster.get(share.evoker);
          return (
            <div role="row" className="side-row" key={`${share.buffId}-${share.evoker}`}>
              <span role="cell">
                <GameIcon src={spellIconUrl(share.buffId)} name={buff} />
              </span>
              <span role="cell" className="side-cell">
                <span className="side-label">
                  {buff}
                  <span className="side-note" style={{ color: classColor(evoker?.classToken ?? null) }}>
                    {playerLabel(evoker)}
                  </span>
                </span>
              </span>
              <span role="cell" className="num side-amount side-amount-negative">
                {formatMillions(-share.amount)}
              </span>
              <span role="cell" className="num side-share" />
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Augmented, a buffed player: how much of the damage or healing came from which Evokers' buffs. */
export function GivenCallout({ amount, from, roster, metric }: { amount: number; from: PlayerAmount[]; roster: Map<number, PlayerRef>; metric: AugMetric }) {
  const names = from.map((entry) => playerLabel(roster.get(entry.player))).join(', ') || t('aug.givenAnEvoker');
  return (
    <div className="aug-given">
      <span className="aug-given-amount">{formatMillions(amount)}</span> {t(metric === 'healing' ? 'aug.givenLeadHealing' : 'aug.givenLead')}{' '}
      <span className="aug-given-name">{names}</span>
      {t('aug.givenBuffs')} <span className="aug-given-mode">{t('aug.reattributed')}</span> {t('aug.givenTail')}
    </div>
  );
}
