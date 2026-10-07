import { describe, expect, it } from 'vitest';
import type { FightTimeline } from '../../api/types';
import { bossHpPath, timelineGeometry } from './timelineGeometry';

const base: FightTimeline = {
  durationMs: 0,
  bossHpStepMs: 1_000,
  bossHp: [],
  dpsStepMs: 1_000,
  raidDps: [],
  phases: [],
  deaths: [],
};

describe('timelineGeometry', () => {
  it('bridges boss HP gaps of up to three samples and breaks the line at longer ones', () => {
    const hp = [100, null, 80, null, null, null, 60, null, null, null, null, 40];
    expect(bossHpPath(hp, 1_000, 12_000)).toBe('M 41.7 12 L 208.3 32 L 541.7 52 M 916.7 72 L 1000 72');
    expect(bossHpPath([null, 50, 50, null], 1_000, 4_000)).toBe('M 375 62 L 625 62');
  });

  it('draws raid DPS as an area normalised to its peak, across the pull when it is shorter than a step', () => {
    expect(timelineGeometry({ ...base, dpsStepMs: 2_000, raidDps: [10, 20] }, 4_000).dpsPath).toBe('M 250 120 L 250 85 L 750 50 L 750 120 Z');
    expect(timelineGeometry({ ...base, dpsStepMs: 5_000, raidDps: [10] }, 3_000).dpsPath).toBe('M 0 120 L 0 50 L 1000 50 L 1000 120 Z');
  });
});
