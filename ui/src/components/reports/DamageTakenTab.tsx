import type { Breakdown } from '../../api/types';
import { formatScaled } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { BreakdownPanel, type ExtraColumn } from './BreakdownPanel';
import { hitColumns } from './hitColumns';

export function DamageTakenTab({ breakdown }: { breakdown: Breakdown }) {
  const columns: ExtraColumn[] = [
    ...hitColumns(true),
    { label: t('report.absorbed'), hasValue: (row) => row.absorbed > 0, render: (row) => <span className="num rrow-end">{formatScaled(row.absorbed)}</span> },
  ];
  return <BreakdownPanel tab="taken" breakdown={breakdown} title={t('tabs.damageTaken')} unit={t('report.dtps')} hint={t('report.takenHint')} extraColumns={columns} />;
}
