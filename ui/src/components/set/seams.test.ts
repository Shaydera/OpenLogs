import { describe, expect, it } from 'vitest';
import { bandIn, seamBoxes } from './seams';

const seams = [
  { fightIndex: 3, startMs: 0, endMs: 20_000 },
  { fightIndex: 5, startMs: 20_000, endMs: 60_000 },
];

describe('seams', () => {
  it('an_interval_lands_in_its_own_pull_segment', () => {
    const [first, second] = seamBoxes(seams);
    expect(bandIn(second, [30_000, 40_000])).toEqual({ leftPct: 25, widthPct: 25 });
    expect(bandIn(first, [30_000, 40_000])).toBeNull();
  });

  it('each_segment_is_as_wide_as_its_pull_is_long', () => {
    expect(seamBoxes(seams).map((box) => box.flex)).toEqual([20_000, 40_000]);
  });
});
