import type { BuffShare, PlayerAmount, PlayerRef } from '../../api/types';
import { spellIcon } from '../../icons';
import { formatScaled, formatShare } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { GameIcon } from '../GameIcon';
import { classColor, shortName } from '../overview/players';
import type { AugMetric } from './augSplit';
import { PlayerIcon } from './PlayerName';
import { barWidth, reportSpellName, type SpellNames } from './reportData';

const classes = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');
const playerLabel = (player: PlayerRef | undefined) => (player ? shortName(player.name) : t('report.unknownPlayer'));

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
                {formatScaled(entry.amount)}
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
                <GameIcon icon={spellIcon(share.buffId)} name={buff} />
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
                {formatScaled(-share.amount)}
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
      <span className="aug-given-amount">{formatScaled(amount)}</span> {t(metric === 'healing' ? 'aug.givenLeadHealing' : 'aug.givenLead')}{' '}
      <span className="aug-given-name">{names}</span>
      {t('aug.givenBuffs')} <span className="aug-given-mode">{t('aug.reattributed')}</span> {t('aug.givenTail')}
    </div>
  );
}
