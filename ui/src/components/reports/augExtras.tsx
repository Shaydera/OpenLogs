import { useId } from 'react';
import type { Breakdown, BuffShare, GroupedRow, PlayerAmount, PlayerRef } from '../../api/types';
import { formatSignedScaled } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { type AugMetric, type AugSplit, augDelta, augTipLines, deltaClass } from './augSplit';
import type { ExtraColumn } from './BreakdownPanel';
import { type RankedPlayer, RankedPopupView, useRankedTargets } from './rankedTargets';
import { AugSupportList, GivenCallout, RecipientList } from './ReportParts';
import type { SpellNames } from './reportData';
import { TargetLegend } from './TargetParts';

interface AugPlayer extends RankedPlayer {
  supportGiven: number;
  supportSelf: number;
  supportReceived: number;
  supportByRecipient: PlayerAmount[];
  supportReceivedFrom: PlayerAmount[];
  supportReceivedByBuff: BuffShare[];
}

interface AugReport<P> {
  players: P[];
  spells: SpellNames;
  roster: PlayerRef[];
  colorGroups?: string[];
}

/**
 * The per-player extras of Damage Done and Healing (Aug column and lists, target colours, popups). The report's
 * player entries only equal the breakdown rows in the plain view: by source, Friendlies, nothing selected.
 */
export function useAugExtras<P extends AugPlayer>(report: AugReport<P>, breakdown: Breakdown, metric: AugMetric, splitOf: (p: P) => AugSplit) {
  const attribution = useApp((s) => s.attribution);
  const showAugDelta = useApp((s) => s.showAugDelta);
  const scope = useApp((s) => s.scope);
  const popupId = useId();
  const targets = useRankedTargets(report, metric, report.colorGroups ?? []);
  const { roster, popup } = targets;
  const plain = breakdown.group === 'source' && scope.perspective === 'friendly' && scope.target.length === 0 && scope.ability.length === 0;

  const playerOf = (row: GroupedRow): P | undefined => {
    const unit = row.key.kind === 'unit' ? row.key.unit : null;
    if (!plain || unit?.kind !== 'player') return undefined;
    const id = unit.actorId;
    return report.players.find((p) => p.player === id);
  };

  const sideExtras = (row: GroupedRow) => {
    const p = playerOf(row);
    if (!p) return null;
    if (attribution === 'reattributed') {
      return (
        <>
          {p.supportByRecipient.length > 0 && <RecipientList entries={p.supportByRecipient} base={p.supportGiven + p.supportSelf} roster={roster} />}
          {p.supportReceivedByBuff.length > 0 && <AugSupportList shares={p.supportReceivedByBuff} spells={report.spells} roster={roster} />}
        </>
      );
    }
    return p.supportReceived > 0 ? <GivenCallout amount={p.supportReceived} from={p.supportReceivedFrom} roster={roster} metric={metric} /> : null;
  };

  const deltaColumn: ExtraColumn = {
    label: t('aug.delta'),
    render: (row) => {
      const p = playerOf(row);
      const delta = p ? augDelta(splitOf(p)) : 0;
      return <span className={`num rrow-end ${deltaClass(delta)}`}>{p ? formatSignedScaled(delta) : ''}</span>;
    },
  };

  return {
    deltaColumns: plain && showAugDelta ? [deltaColumn] : [],
    panel: {
      sideExtras,
      fill: (row: GroupedRow, barPct: number) => {
        const p = playerOf(row);
        return p ? targets.fill(p, barPct) : undefined;
      },
      total: (row: GroupedRow, text: string) => {
        const p = playerOf(row);
        return p ? targets.total(p, text, augDelta(splitOf(p)) !== 0) : undefined;
      },
      onPreview: (row: GroupedRow) => {
        const p = playerOf(row);
        return p ? targets.preview(p) : undefined;
      },
      describedBy: (row: GroupedRow) => {
        const p = playerOf(row);
        return p && popup?.data.player === p.player ? popupId : undefined;
      },
      legend: plain && targets.colorByTarget ? <TargetLegend groups={targets.groups} highlight={targets.highlight} onToggle={targets.toggleHighlight} /> : null,
      panelRef: targets.panel,
      popup: (
        <RankedPopupView
          id={popupId}
          popup={popup}
          report={report}
          metric={metric}
          roster={roster}
          colorOf={targets.colorOf}
          augLines={(p) => augTipLines(splitOf(p), roster, metric, report.spells)}
        />
      ),
    },
  };
}
