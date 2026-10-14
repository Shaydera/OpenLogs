import type { Breakdown, DamageReport, PlayerDamage } from '../../api/types';
import { t } from '../../i18n/i18n';
import { useAugExtras } from './augExtras';
import { BreakdownPanel } from './BreakdownPanel';

const damageSplit = (p: PlayerDamage) => p;

/** Damage Done through the breakdown panel; the Aug extras of today's report show in the unfiltered source view. */
export function DamageDoneTab({ report, breakdown }: { report: DamageReport; breakdown: Breakdown }) {
  const aug = useAugExtras(report, breakdown, 'damage', damageSplit);
  return (
    <BreakdownPanel
      tab="damage"
      breakdown={breakdown}
      title={t('tabs.damageDone')}
      unit={t('report.dps')}
      extraColumns={aug.deltaColumns}
      {...aug.panel}
    />
  );
}
