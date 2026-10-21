import { describe, expect, it } from 'vitest';
import { lifetimeRows, windowScaleMs, windowTicksMs } from './lifetimeModel';

const names = new Map([
  [1, 'Arvendil'],
  [2, 'Corvessa'],
]);

describe('lifetime', () => {
  it('averages_skip_pulls_a_player_was_not_in', () => {
    const pulls = [
      { durationMs: 100_000, lifetime: [{ player: 1, firstDeathMs: 50_000 }] },
      {
        durationMs: 200_000,
        lifetime: [
          { player: 1, firstDeathMs: null },
          { player: 2, firstDeathMs: 20_000 },
        ],
      },
    ];
    const [first, second] = lifetimeRows(pulls, (id) => names.get(id) ?? '');
    expect(first.player).toBe(2);
    expect(first.avgPct).toBeCloseTo(10);
    expect(first.cells[0]).toBeNull();
    expect(second.player).toBe(1);
    expect(second.avgPct).toBeCloseTo(75);
    expect(second.avgTimePct).toBeCloseTo(83.33, 1);
  });

  it('long_death_windows_get_wider_ticks', () => {
    const ticks = (longestMs: number) => windowTicksMs(windowScaleMs([longestMs]));
    expect(ticks(42_000)).toEqual([0, 10_000, 20_000, 30_000, 40_000, 50_000]);
    expect(ticks(130_000)).toEqual([0, 30_000, 60_000, 90_000, 120_000, 150_000]);
    expect(ticks(290_000)).toEqual([0, 60_000, 120_000, 180_000, 240_000, 300_000]);
  });
});
