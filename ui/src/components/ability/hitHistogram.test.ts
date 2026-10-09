import { describe, expect, it } from 'vitest';
import { hitHistogram } from './hitHistogram';

const hits = (amounts: number[], critFrom = Infinity) =>
  amounts.map((amount, i) => ({ t: i, target: 1, amount, critical: amount >= critFrom, periodic: false }));

describe('hitHistogram', () => {
  it('bins hits on round edges from the largest hit, a hit on an edge going up, crits counted', () => {
    const bins = hitHistogram(hits([10_000, 50_000, 120_000, 180_000, 250_000, 400_000, 1_056_506], 400_000));
    expect(bins.map((b) => [b.label, b.count, b.crits])).toEqual([
      ['<50k', 1, 0],
      ['50–100k', 1, 0],
      ['100–150k', 1, 0],
      ['150–200k', 1, 0],
      ['200–300k', 1, 0],
      ['300–500k', 1, 1],
      ['>500k', 1, 1],
    ]);
  });

  it('puts all-zero hits (pure overheal) into one bin', () => {
    const zero = [0, 0, 0].map((amount, i) => ({ t: i, target: 1, amount, critical: i === 0, periodic: false }));
    expect(hitHistogram(zero)).toEqual([{ fromAmount: 0, toAmount: 0, label: '0', count: 3, crits: 1 }]);
  });
});
