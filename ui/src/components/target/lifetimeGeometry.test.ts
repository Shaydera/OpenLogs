import { describe, expect, it } from 'vitest';
import { targetDetailFixture } from '../../test/reportFixtures';
import { lifetimeLanes } from './lifetimeGeometry';

describe('lifetimeLanes', () => {
  it('positions lanes, classifies lifetimes and names the unit', () => {
    expect(lifetimeLanes(targetDetailFixture.units, 0, 60_000, 'Rawling')).toEqual([
      { actor: 20, leftPct: 1.67, widthPct: 11.67, kind: 'short', title: 'Rawling #1 · 0:01 → 0:08 · 7.0 s' },
      { actor: 21, leftPct: 5, widthPct: 10, kind: 'alive', title: 'Rawling #2 · 0:03 → despawned 0:09 · 6.0 s' },
      { actor: 22, leftPct: 33.33, widthPct: 26.67, kind: 'long', title: 'Rawling #3 · 0:20 → 0:36 · 16.0 s' },
    ]);
  });
});
