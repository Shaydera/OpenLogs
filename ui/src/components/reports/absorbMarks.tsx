import { formatShare } from '../../i18n/format';
import { type MessageKey, t } from '../../i18n/i18n';
import type { MetricTab } from '../../store';
import { barWidth } from './reportData';

/** An amount with the parts that went into or came from shields and that heal absorbs took. */
export interface AbsorbAmounts {
  amount: number;
  absorbed: number;
  healAbsorbed: number;
}

/** The shielded part and what heal absorbs took, in percent of `amount`; none without a positive amount. */
export function absorbShares({ amount, absorbed, healAbsorbed }: AbsorbAmounts): { shields: number; healAbsorbed: number } {
  if (amount <= 0) return { shields: 0, healAbsorbed: 0 };
  const eaten = Math.min(Math.max(0, healAbsorbed), amount);
  const shielded = Math.min(Math.max(0, absorbed), amount - eaten);
  return { shields: (shielded / amount) * 100, healAbsorbed: (eaten / amount) * 100 };
}

const SHIELDS: Record<MetricTab, MessageKey> = { damage: 'report.intoShieldsShare', healing: 'report.shieldsShare', taken: 'report.shieldsShare' };

/** "Shields 43.20% · Heal absorbed 8.00%"; `undefined` without either part. */
export function absorbNote(amounts: AbsorbAmounts, tab: MetricTab): string | undefined {
  const shares = absorbShares(amounts);
  const notes: string[] = [];
  if (shares.shields > 0) notes.push(t(SHIELDS[tab], { share: formatShare(shares.shields) }));
  if (shares.healAbsorbed > 0) notes.push(t('report.healAbsorbedShare', { share: formatShare(shares.healAbsorbed) }));
  return notes.length > 0 ? notes.join(' · ') : undefined;
}

/** The shielded part, then what heal absorbs took, dimmed at the end of a bar's fill. */
export function AbsorbMarks(amounts: AbsorbAmounts) {
  const { shields, healAbsorbed } = absorbShares(amounts);
  return (
    <>
      {shields > 0 && <span className="absorb-shields" style={{ right: barWidth(healAbsorbed), width: barWidth(shields) }} />}
      {healAbsorbed > 0 && <span className="absorb-heal" style={{ width: barWidth(healAbsorbed) }} />}
    </>
  );
}
