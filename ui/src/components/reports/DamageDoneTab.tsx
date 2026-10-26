import type { Breakdown, DamageReport, PlayerDamage } from '../../api/types';
import { t } from '../../i18n/i18n';
import { useApp } from '../../store';
import { useAugExtras } from './augExtras';
import { BreakdownPanel } from './BreakdownPanel';
import { castsColumn, hitColumns } from './hitColumns';

const damageSplit = (p: PlayerDamage) => p;

/**
 * Damage Done through the breakdown panel; the Aug extras of today's report show in the unfiltered source view,
 * hits and misses only for a single source.
 */
export function DamageDoneTab({ report, breakdown }: { report: DamageReport; breakdown: Breakdown }) {
  const aug = useAugExtras(report, breakdown, 'damage', damageSplit);
  const singleSource = useApp((s) => s.scope.source.length === 1);
  return (
    <BreakdownPanel
      tab="damage"
      breakdown={breakdown}
      title={t('tabs.damageDone')}
      unit={t('report.dps')}
      extraColumns={[...(singleSource ? hitColumns(true) : [castsColumn()]), ...aug.deltaColumns]}
      {...aug.panel}
    />
  );
}
