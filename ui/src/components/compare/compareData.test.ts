import { describe, expect, it } from 'vitest';
import { t } from '../../i18n/i18n';
import { comparisonFixture } from '../../test/compareFixture';
import { durationDelta, kpiRows, phaseRows } from './compareData';

const { a, b } = comparisonFixture;

describe('kpiRows', () => {
  it('lists both pulls and the difference B − A', () => {
    expect(kpiRows(a.overview.kpis, b.overview.kpis).map((row) => [t(row.label), row.a, row.b, row.delta])).toEqual([
      ['Duration', '2:22', '7:58', '+5:36'],
      ['Raid DPS', '1.95M', '3.96M', '+2.01M'],
      ['Raid damage', '278.30M', '1.894B', '+1.616B'],
      ['Deaths', '1', '2', '+1'],
      ['First death', '0:47', '0:33', '−0:14'],
      ['Combat potions', '3', '13', '+10'],
      ['Healthstones', '1', '3', '+2'],
      ['Health potions', '0', '5', '+5'],
    ]);
  });
});

describe('durationDelta', () => {
  it('is the difference of the shown whole seconds', () => {
    // 2:22.550 and 5:09.124 show as 2:22 and 5:09, so the difference must read +2:47.
    expect(durationDelta(142_550, 309_124)).toBe('+2:47');
    expect(durationDelta(309_124, 142_550)).toBe('−2:47');
    expect(durationDelta(2_100, 2_900)).toBe('0:00');
  });
});

describe('phaseRows', () => {
  it('matches phases by name, keeps configured names and orders them by their first start', () => {
    expect(phaseRows(a.overview.timeline.phases, b.overview.timeline.phases)).toEqual([
      { label: 'Phase 1', a: 0, b: 0 },
      { label: 'Intermission 1', a: null, b: 120_000 },
      { label: 'Phase 2', a: null, b: 240_000 },
    ]);
    const burn = { kind: 'boss' as const, number: 2, startMs: 90_000, endMs: 140_000, name: 'Burn' };
    const p1 = { kind: 'boss' as const, number: 1, startMs: 0, endMs: 90_000, name: null };
    expect(phaseRows([p1, burn], [p1])).toEqual([
      { label: 'Phase 1', a: 0, b: 0 },
      { label: 'Burn', a: 90_000, b: null },
    ]);
  });
});
