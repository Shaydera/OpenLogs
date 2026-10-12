import { describe, expect, it } from 'vitest';
import type { PlayerRef } from '../../api/types';
import { type AugSplit, augDelta, augTipLines, deltaClass, reattributedTotal } from './augSplit';

const roster = new Map<number, PlayerRef>([
  [4, { actorId: 4, name: 'Faelan-Emberfall-EU', specId: 62, specName: 'Arcane Mage', classId: 8, classToken: 'MAGE', role: 'damage' }],
  [5, { actorId: 5, name: 'Speronis-Stonevale-EU', specId: 1473, specName: 'Augmentation Evoker', classId: 13, classToken: 'EVOKER', role: 'damage' }],
]);
const spells = { '395152': { name: 'Ebon Might' }, '409311': { name: 'Prescience' } };
const split = (parts: Partial<AugSplit>): AugSplit => ({
  own: 0,
  supportReceived: 0,
  supportGiven: 0,
  supportSelf: 0,
  supportReceivedFrom: [],
  supportReceivedByBuff: [],
  supportCreditedByBuff: [],
  ...parts,
});

describe('augTipLines', () => {
  it("shows a buffed player's logged damage, each Evoker's share by buff and the result", () => {
    const faelan = split({
      own: 117_091_704,
      supportReceived: 13_857_879,
      supportReceivedFrom: [
        { player: 5, amount: 9_857_879 },
        { player: 4, amount: 4_000_000 },
      ],
      supportReceivedByBuff: [
        { buffId: 409311, evoker: 5, amount: 5_978_978 },
        { buffId: 395152, evoker: 4, amount: 4_000_000 },
        { buffId: 395152, evoker: 5, amount: 3_878_901 },
      ],
    });
    expect(augTipLines(faelan, roster, 'damage', spells)).toEqual([
      { label: 'Damage as logged (Augmented)', value: '117.09M', tone: 'plain', total: false },
      { label: 'From Speronis’s buffs', value: '−9.86M', tone: 'loss', total: false },
      { label: 'Prescience', value: '−5.98M', tone: 'loss', total: false, buff: 409311 },
      { label: 'Ebon Might', value: '−3.88M', tone: 'loss', total: false, buff: 395152 },
      { label: 'From Faelan’s buffs', value: '−4.00M', tone: 'loss', total: false },
      { label: 'Ebon Might', value: '−4.00M', tone: 'loss', total: false, buff: 395152 },
      { label: 'Reattributed', value: '103.23M', tone: 'plain', total: true },
    ]);
  });

  it("credits the Evoker's support including his own share and deducts that share again", () => {
    const spark = split({
      own: 37_995_893,
      supportGiven: 87_293_624,
      supportSelf: 177_400,
      supportCreditedByBuff: [
        { buffId: 395152, evoker: 5, amount: 50_177_400 },
        { buffId: 409311, evoker: 5, amount: 37_293_624 },
      ],
    });
    expect(augTipLines(spark, roster, 'damage', spells).map((line) => [line.label, line.value, line.tone])).toEqual([
      ['Own damage (Augmented)', '38.00M', 'plain'],
      ['Support credited from buffed players', '+87.47M', 'gain'],
      ['Ebon Might', '+50.18M', 'gain'],
      ['Prescience', '+37.29M', 'gain'],
      ['Own buff share', '−0.18M', 'loss'],
      ['Reattributed', '125.29M', 'plain'],
    ]);
    expect(augDelta(spark)).toBe(87_293_624);
  });

  it('handles an Evoker buffed by another Evoker and saturates at zero', () => {
    const both = split({
      own: 1_000_000,
      supportReceived: 3_000_000,
      supportGiven: 500_000,
      supportReceivedFrom: [{ player: 4, amount: 3_000_000 }],
      supportReceivedByBuff: [{ buffId: 409311, evoker: 4, amount: 3_000_000 }],
      supportCreditedByBuff: [{ buffId: 395152, evoker: 5, amount: 500_000 }],
    });
    expect(augTipLines(both, roster, 'healing', spells).map((line) => [line.label, line.value])).toEqual([
      ['Own healing (Augmented)', '1.00M'],
      ['From Faelan’s buffs', '−3.00M'],
      ['Prescience', '−3.00M'],
      ['Support credited from buffed players', '+0.50M'],
      ['Ebon Might', '+0.50M'],
      ['Reattributed', '0.00M'],
    ]);
    expect(reattributedTotal(both)).toBe(0);
    expect(augDelta(both)).toBe(-1_000_000);
  });

  it('names support whose Evoker is unknown', () => {
    const lines = augTipLines(split({ own: 500, supportReceived: 200 }), roster, 'healing', spells);
    expect(lines.map((line) => line.label)).toEqual(['Healing as logged (Augmented)', 'From Augmentation buffs', 'Reattributed']);
  });

  it('has no difference without support from others', () => {
    expect(augDelta(split({ own: 500, supportSelf: 50 }))).toBe(0);
    expect([deltaClass(0), deltaClass(1), deltaClass(-1)]).toEqual(['delta-none', 'delta-gain', 'delta-loss']);
  });
});
