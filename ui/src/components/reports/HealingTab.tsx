import type { Breakdown, GroupedRow, HealingReport, PlayerHealing } from '../../api/types';
import { formatScaled, formatShare } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import type { AugSplit } from './augSplit';
import { useAugExtras } from './augExtras';
import { BreakdownPanel, type ExtraColumn } from './BreakdownPanel';

const healingSplit = (p: PlayerHealing): AugSplit => ({
  own: p.healing + p.absorbs,
  supportReceived: p.supportReceived,
  supportGiven: p.supportGiven,
  supportSelf: p.supportSelf,
  supportReceivedFrom: p.supportReceivedFrom,
  supportReceivedByBuff: p.supportReceivedByBuff,
  supportCreditedByBuff: p.supportCreditedByBuff,
});

/** Healing through the breakdown panel; absorbs, overheal and the Aug extras of today's report show in the unfiltered source view. */
export function HealingTab({ report, breakdown }: { report: HealingReport; breakdown: Breakdown }) {
  const aug = useAugExtras(report, breakdown, 'healing', healingSplit);
  const absorbs = (row: GroupedRow) => {
    const p = aug.playerOf(row);
    return <span className="num rrow-end">{p ? formatScaled(p.absorbs) : ''}</span>;
  };
  const overheal = (row: GroupedRow) => {
    const p = aug.playerOf(row);
    if (!p) return <span className="num rrow-end" />;
    const healed = p.healing + p.overheal;
    return <span className="num rrow-end">{healed > 0 ? formatShare((p.overheal / healed) * 100) : <span className="dash">—</span>}</span>;
  };
  const columns: ExtraColumn[] = aug.plain
    ? [{ label: t('report.absorbs'), render: absorbs }, { label: t('report.overheal'), render: overheal }, ...aug.deltaColumns]
    : [];
  return <BreakdownPanel tab="healing" breakdown={breakdown} title={t('tabs.healing')} unit={t('report.hps')} extraColumns={columns} {...aug.panel} />;
}
