import { describe, expect, it } from 'vitest';
import type { OverviewTimeline } from '../../api/types';
import { bossHpPath, timelineGeometry } from './timelineGeometry';

const base: OverviewTimeline = {
  durationMs: 0,
  markers: { deaths: [], bloodlust: [], bossCasts: [] },
  bossHpStepMs: 1_000,
  bossHp: [],
  dpsStepMs: 1_000,
  raidDps: [],
  phases: [],
};

describe('timelineGeometry', () => {
  it('bridges boss HP gaps of up to three samples and breaks the line at longer ones', () => {
    const hp = [100, null, 80, null, null, null, 60, null, null, null, null, 40];
    expect(bossHpPath(hp, 1_000, 12_000)).toBe('M 41.7 0 L 208.3 20 L 541.7 40 M 916.7 60 L 1000 60');
    expect(bossHpPath([null, 50, 50, null], 1_000, 4_000)).toBe('M 375 50 L 625 50');
  });

  it('draws raid DPS as an area normalised to its peak, across the pull when it is shorter than a step', () => {
    expect(timelineGeometry({ ...base, dpsStepMs: 2_000, raidDps: [10, 20] }, 4_000).dpsPath).toBe('M 250 120 L 250 85 L 750 50 L 750 120 Z');
    expect(timelineGeometry({ ...base, dpsStepMs: 5_000, raidDps: [10] }, 3_000).dpsPath).toBe('M 0 120 L 0 50 L 1000 50 L 1000 120 Z');
  });

  it('puts a tick on every full minute except the end of the pull', () => {
    const ticks = (durationMs: number) => timelineGeometry(base, durationMs).ticks.map((tick) => [tick.label, Math.round(tick.leftPct)]);
    expect(ticks(150_000)).toEqual([
      ['0:00', 0],
      ['1:00', 40],
      ['2:00', 80],
    ]);
    expect(ticks(120_000)).toEqual([
      ['0:00', 0],
      ['1:00', 50],
    ]);
  });
});
