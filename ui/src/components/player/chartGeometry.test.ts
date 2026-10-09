import { describe, expect, it } from 'vitest';
import { castsCrowd, manaPath, seriesPaths } from './chartGeometry';

describe('seriesPaths', () => {
  it('scales the step middles to a round ceiling', () => {
    expect(seriesPaths([1_000, 2_930], 5_000, 0, 10_000)).toEqual({
      line: 'M 250 130 L 750 14.2',
      area: 'M 250 130 L 750 14.2 L 750 200 L 250 200 Z',
      peak: 2_930,
      ceiling: 3_000,
    });
  });
});

describe('manaPath', () => {
  it('breaks the mana line at missing samples and while the player is dead', () => {
    expect(manaPath([60, 40, null, 90], 5_000, 0, 20_000)).toBe('M 125 82 L 375 118 M 750 28 L 1000 28');
    expect(manaPath([50, 60, 70], 5_000, 0, 15_000, [[5_000, 10_000]])).toBe('M 0 100 L 333.3 100 M 666.7 64 L 1000 64');
  });
});

describe('castsCrowd', () => {
  it('crowds a lane only when two casts in range lie closer than half an icon', () => {
    const len = 478_500;
    expect(castsCrowd([350_500, 366_100, 375_300, 431_400], 0, len, 1000)).toBe(false);
    // 4.4 s at 1000px over 478.5 s: 9.2px.
    expect(castsCrowd([10_000, 14_400, 60_000], 0, len, 1000)).toBe(true);
    expect(castsCrowd([10_000, 14_400], 12_000, len, 1000)).toBe(false);
    expect(castsCrowd([10_000, 14_400], 0, len, 2000)).toBe(false);
  });
});
