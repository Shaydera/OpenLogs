import { useRef, useState } from 'react';
import type { PlayerRef } from '../../api/types';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { type TipLine, toneClass } from './augSplit';
import { PlayerName } from './PlayerName';

/** Left edge of the tooltip in its panel: over the damage bar. */
const TIP_LEFT = 262;

export interface OpenTip {
  player: number;
  /** Below the row, in px from the panel's top. */
  top: number;
}

/**
 * The Aug tooltip's state: opened from a hovered or focused row, placed in the row's panel. It
 * belongs to the report and mode it was opened for: a new range or mode closes it, so a focused row
 * never keeps a tooltip with old numbers at an old position.
 */
export function useAugTip(report: object) {
  const attribution = useApp((s) => s.attribution);
  const panel = useRef<HTMLElement>(null);
  const [state, setState] = useState<(OpenTip & { report: object; attribution: string }) | null>(null);
  const open = (player: number, row: HTMLElement | null) => {
    const box = panel.current;
    if (!row || !box) {
      setState(null);
      return;
    }
    setState({ player, top: row.getBoundingClientRect().bottom - box.getBoundingClientRect().top + 2, report, attribution });
  };
  const tip: OpenTip | null =
    state && state.report === report && state.attribution === attribution ? { player: state.player, top: state.top } : null;
  return { panel, tip, open };
}

/** The "Aug attribution" tooltip: player, the split, and the mode the table shows. */
export function AugTip({ id, player, lines, top }: { id: string; player: PlayerRef | undefined; lines: TipLine[]; top: number }) {
  const attribution = useApp((s) => s.attribution);
  return (
    <div role="tooltip" id={id} className="aug-tip" style={{ top, left: TIP_LEFT }}>
      <div className="aug-tip-head">
        <PlayerName player={player} size={18} />
        <span className="cap rrow-cap aug-tip-cap">{t('aug.tipTitle')}</span>
      </div>
      {/* By position: two Evokers can share a short name ("From Speronis's buffs" twice). */}
      {lines.map((line, index) => (
        <div key={index} className={line.total ? 'aug-tip-line aug-tip-line-total' : 'aug-tip-line'}>
          <span className="aug-tip-label">{line.label}</span>
          <span className={['num', toneClass(line.tone)].filter(Boolean).join(' ')}>{line.value}</span>
        </div>
      ))}
      <div className="aug-tip-foot">
        {t('aug.tipShown')} <span className="aug-tip-mode">{t(`aug.${attribution}`)}</span>
      </div>
    </div>
  );
}
