import type { PlayerRef } from '../../api/types';
import { spellIcon } from '../../icons';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { GameIcon } from '../GameIcon';
import { type TipLine, toneClass } from './augSplit';
import { PlayerName } from './PlayerName';

/** The "Aug attribution" tooltip: player, the split, and the mode the table shows. */
export function AugTip({ id, player, lines, top, left }: { id: string; player: PlayerRef | undefined; lines: TipLine[]; top: number; left: number }) {
  const attribution = useApp((s) => s.attribution);
  return (
    <div role="tooltip" id={id} className="aug-tip" style={{ top, left }}>
      <div className="aug-tip-head">
        <PlayerName player={player} size={18} />
        <span className="cap rrow-cap aug-tip-cap">{t('aug.tipTitle')}</span>
      </div>
      {/* By position: two Evokers can share a short name ("From Speronis's buffs" twice). */}
      {lines.map((line, index) => (
        <div key={index} className={['aug-tip-line', line.total && 'aug-tip-line-total', line.buff !== undefined && 'aug-tip-line-buff'].filter(Boolean).join(' ')}>
          {line.buff !== undefined ? (
            <span className="aug-tip-label aug-tip-buff">
              <GameIcon name={line.label} icon={spellIcon(line.buff)} size={16} />
              <span className="sr-only">{t('aug.tipPartOf')}</span>
              {line.label}
            </span>
          ) : (
            <span className="aug-tip-label">{line.label}</span>
          )}
          <span className={['num', toneClass(line.tone)].filter(Boolean).join(' ')}>{line.value}</span>
        </div>
      ))}
      <div className="aug-tip-foot">
        {t('aug.tipShown')} <span className="aug-tip-mode">{t(`aug.${attribution}`)}</span>
      </div>
    </div>
  );
}
