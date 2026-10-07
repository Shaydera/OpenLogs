import { describe, expect, it } from 'vitest';
import type { PlayerRef } from '../../api/types';
import { type AugSplit, augDelta, augTipLines, deltaClass, reattributedTotal } from './augSplit';

const roster = new Map<number, PlayerRef>([
  [4, { actorId: 4, name: 'Faelan-Emberfall-EU', specId: 62, specName: 'Arcane Mage', classId: 8, classToken: 'MAGE', role: 'damage' }],
  [5, { actorId: 5, name: 'Speronis-Stonevale-EU', specId: 1473, specName: 'Augmentation Evoker', classId: 13, classToken: 'EVOKER', role: 'damage' }],
]);
const split = (parts: Partial<AugSplit>): AugSplit => ({ own: 0, supportReceived: 0, supportGiven: 0, supportSelf: 0, supportReceivedFrom: [], ...parts });

describe('augTipLines', () => {
  it("shows a buffed player's logged damage, each Evoker's share and the result", () => {
    const faelan = split({ own: 117_091_704, supportReceived: 13_857_879, supportReceivedFrom: [{ player: 5, amount: 13_857_879 }] });
    expect(augTipLines(faelan, roster, 'damage')).toEqual([
      { label: 'Damage as logged (Augmented)', value: '117.09M', tone: 'plain', total: false },
      { label: 'From Speronis’s buffs', value: '−13.86M', tone: 'loss', total: false },
      { label: 'Reattributed', value: '103.23M', tone: 'plain', total: true },
    ]);
  });

  it("credits the Evoker's support including his own share and deducts that share again", () => {
    const spark = split({ own: 37_995_893, supportGiven: 87_293_624, supportSelf: 177_400 });
    expect(augTipLines(spark, roster, 'damage').map((line) => [line.label, line.value, line.tone])).toEqual([
      ['Own damage (Augmented)', '38.00M', 'plain'],
      ['Support credited from buffed players', '+87.47M', 'gain'],
      ['Own buff share', '−0.18M', 'loss'],
      ['Reattributed', '125.29M', 'plain'],
    ]);
    expect(augDelta(spark)).toBe(87_293_624);
  });

  it('handles an Evoker buffed by another Evoker and saturates at zero', () => {
    const both = split({ own: 1_000_000, supportReceived: 3_000_000, supportGiven: 500_000, supportReceivedFrom: [{ player: 4, amount: 3_000_000 }] });
    expect(augTipLines(both, roster, 'healing').map((line) => [line.label, line.value])).toEqual([
      ['Own healing (Augmented)', '1.00M'],
      ['From Faelan’s buffs', '−3.00M'],
      ['Support credited from buffed players', '+0.50M'],
      ['Reattributed', '0.00M'],
    ]);
    expect(reattributedTotal(both)).toBe(0);
    expect(augDelta(both)).toBe(-1_000_000);
  });

  it('names support whose Evoker is unknown', () => {
    const lines = augTipLines(split({ own: 500, supportReceived: 200 }), roster, 'healing');
    expect(lines.map((line) => line.label)).toEqual(['Healing as logged (Augmented)', 'From Augmentation buffs', 'Reattributed']);
  });

  it('has no difference without support from others', () => {
    expect(augDelta(split({ own: 500, supportSelf: 50 }))).toBe(0);
    expect([deltaClass(0), deltaClass(1), deltaClass(-1)]).toEqual(['delta-none', 'delta-gain', 'delta-loss']);
  });
});
