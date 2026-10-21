import { describe, expect, it } from 'vitest';
import type { OverviewTimeline } from '../../api/types';
import { compareChart } from './compareGeometry';

const base: OverviewTimeline = {
  durationMs: 0,
  cutoffMs: null,
  markers: { deaths: [], bloodlust: [], bossCasts: [] },
  bossHpStepMs: 1_000,
  bossHp: [],
  dpsStepMs: 1_000,
  raidDps: [],
  phases: [],
};

describe('compareChart', () => {
  it('puts both pulls on the axis of the longer one', () => {
    const chart = compareChart({ ...base, durationMs: 2_000, bossHp: [100, 50] }, { ...base, durationMs: 4_000, bossHp: [100, 75, 50, 0] });
    expect(chart.axisMs).toBe(4_000);
    expect(chart.a.bossHp).toBe('M 125 0 L 375 50');
    expect(chart.b.bossHp).toBe('M 125 0 L 375 25 L 625 50 L 875 100');
  });

  it('scales both raid DPS areas to the higher peak', () => {
    const chart = compareChart(
      { ...base, durationMs: 2_000, dpsStepMs: 2_000, raidDps: [10] },
      { ...base, durationMs: 4_000, dpsStepMs: 2_000, raidDps: [20, 10] },
    );
    expect(chart.a.dps).toBe('M 0 100 L 0 50 L 500 50 L 500 100 Z');
    expect(chart.b.dps).toBe('M 250 100 L 250 0 L 750 50 L 750 100 Z');
  });
});
