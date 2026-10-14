import type { Breakdown } from '../../api/types';
import { formatInteger, formatScaled } from '../../i18n/format';
import { t } from '../../i18n/i18n';
import { BreakdownPanel, type ExtraColumn } from './BreakdownPanel';

export function DamageTakenTab({ breakdown }: { breakdown: Breakdown }) {
  const columns: ExtraColumn[] = [
    { label: t('report.hits'), render: (row) => <span className="num rrow-end">{formatInteger(row.hits)}</span> },
    { label: t('report.absorbed'), render: (row) => <span className="num rrow-end">{formatScaled(row.absorbed)}</span> },
  ];
  return <BreakdownPanel tab="taken" breakdown={breakdown} title={t('tabs.damageTaken')} unit={t('report.dtps')} hint={t('report.takenHint')} extraColumns={columns} />;
}
