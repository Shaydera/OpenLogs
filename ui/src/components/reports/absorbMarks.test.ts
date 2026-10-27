import { describe, expect, it } from 'vitest';
import { absorbShares } from './absorbMarks';

describe('absorbShares', () => {
  it('gives the shielded part and what heal absorbs took in percent of the amount', () => {
    expect(absorbShares({ amount: 1_000, absorbed: 430, healAbsorbed: 80 })).toEqual({ shields: 43, healAbsorbed: 8 });
  });

  it('never lets both parts outgrow the amount an Aug deduction left', () => {
    expect(absorbShares({ amount: 1_000, absorbed: 900, healAbsorbed: 200 })).toEqual({ shields: 80, healAbsorbed: 20 });
    expect(absorbShares({ amount: -50, absorbed: 10, healAbsorbed: 0 })).toEqual({ shields: 0, healAbsorbed: 0 });
  });
});
