import type { Breakdown, GroupedRow, HealingReport, PlayerHealing } from '../../api/types';
import { formatShare } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import type { AugSplit } from './augSplit';
import { useAugExtras } from './augExtras';
import { BreakdownPanel, type ExtraColumn } from './BreakdownPanel';
import { hitColumns } from './hitColumns';
import { overhealShare } from './overheal';

const healingSplit = (p: PlayerHealing): AugSplit => ({
  own: p.healing + p.absorbs,
  supportReceived: p.supportReceived,
  supportGiven: p.supportGiven,
  supportSelf: p.supportSelf,
  supportReceivedFrom: p.supportReceivedFrom,
  supportReceivedByBuff: p.supportReceivedByBuff,
  supportCreditedByBuff: p.supportCreditedByBuff,
});

const overheal = (row: GroupedRow) => {
  const share = overhealShare(row.overheal, row.healed);
  return <span className="num rrow-end">{share === null ? <span className="dash">—</span> : formatShare(share * 100)}</span>;
};

/**
 * Healing through the breakdown panel with overheal; hits only for a single source, the Aug extras of today's report
 * in the unfiltered source view.
 */
export function HealingTab({ report, breakdown }: { report: HealingReport; breakdown: Breakdown }) {
  const aug = useAugExtras(report, breakdown, 'healing', healingSplit);
  const singleSource = useApp((s) => s.scope.source.length === 1);
  const columns: ExtraColumn[] = [
    ...(singleSource ? hitColumns(false) : []),
    { label: t('report.overheal'), hasValue: (row: GroupedRow) => row.overheal > 0, render: overheal },
    ...aug.deltaColumns,
  ];
  return <BreakdownPanel tab="healing" breakdown={breakdown} title={t('tabs.healing')} unit={t('report.hps')} extraColumns={columns} {...aug.panel} />;
}
