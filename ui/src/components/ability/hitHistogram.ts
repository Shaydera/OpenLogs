import type { AbilityHit } from '../../api/types';
import { formatBinAmount, formatBinRange } from '../../i18n/format';
import { t, type MessageKey } from '../../i18n/i18n';

export interface HistogramBin {
  fromAmount: number;
  /** `null` for the open last bin. */
  toAmount: number | null;
  label: string;
  count: number;
  crits: number;
}

const STEPS = [1, 2, 2.5, 5];
/** Edges in steps: 0, 50k, 100k, 150k, 200k, 300k, 500k for a 50k step. */
const MULTIPLES = [0, 1, 2, 3, 4, 6, 10];

/** The largest of 1, 2, 2.5 or 5 × 10^k that is at most `value` (at least 1). */
function binStep(value: number): number {
  if (value < 1) return 1;
  const power = 10 ** Math.floor(Math.log10(value) + 1e-9);
  return Math.max(...STEPS.map((step) => step * power).filter((step) => step <= value + 1e-9));
}

/**
 * Bins `<50k`, `50–100k`, …, `>500k`: edges 0, s, 2s, 3s, 4s, 6s, 10s with s = binStep(largest hit / 20)
 * and an open last bin; a hit on an edge goes to the upper bin.
 */
export function hitHistogram(hits: AbilityHit[]): HistogramBin[] {
  if (hits.length === 0) return [];
  const max = Math.max(...hits.map((h) => h.amount));
  // Pure overheal: every effective amount is 0, so there is nothing to spread out.
  if (max <= 0) {
    return [{ fromAmount: 0, toAmount: 0, label: formatBinAmount(0), count: hits.length, crits: hits.filter((h) => h.critical).length }];
  }
  const step = binStep(max / 20);
  const edges = MULTIPLES.map((multiple) => multiple * step);
  const bins: HistogramBin[] = edges.map((from, i) => {
    const to = i + 1 < edges.length ? edges[i + 1] : null;
    const label =
      i === 0
        ? t('ability.binBelow', { value: formatBinAmount(edges[1]) })
        : to === null
          ? t('ability.binAbove', { value: formatBinAmount(from) })
          : formatBinRange(from, to);
    return { fromAmount: from, toAmount: to, label, count: 0, crits: 0 };
  });
  for (const hit of hits) {
    const bin = bins[edges.findLastIndex((edge) => hit.amount >= edge)];
    bin.count += 1;
    if (hit.critical) bin.crits += 1;
  }
  return bins;
}

const SCHOOLS: [number, MessageKey][] = [
  [1, 'school.physical'],
  [2, 'school.holy'],
  [4, 'school.fire'],
  [8, 'school.nature'],
  [16, 'school.frost'],
  [32, 'school.shadow'],
  [64, 'school.arcane'],
];

export function schoolName(mask: number): string {
  return SCHOOLS.filter(([bit]) => mask & bit)
    .map(([, key]) => t(key))
    .join(' / ');
}
