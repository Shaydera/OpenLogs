import { describe, expect, it } from 'vitest';
import type { FightRow, SetPull } from '../../api/types';
import { compareLogFixture } from '../../test/compareFixture';
import { overviewFixture } from '../../test/overviewFixture';
import { bestPull, hpAtEnd, setRows } from './setOverviewModel';

const [WIPE] = compareLogFixture.fights;

const pull = (fightIndex: number, overrides: Partial<SetPull>): SetPull => ({
  fightIndex,
  kpis: overviewFixture.kpis,
  cutoffMs: null,
  pullDurationMs: 100_000,
  bossHpStepMs: 1_000,
  bossHp: [100, 50],
  ...overrides,
});

describe('set overview model', () => {
  it('reads the boss HP of the last step before the cut, else of the last sample', () => {
    const bossHp = Array.from({ length: 169 }, (_, i) => 100 - (i * 42.3) / 168);
    expect(hpAtEnd(pull(1, { bossHp, cutoffMs: 130_320 }))).toBe(bossHp[129]);
    expect(hpAtEnd(pull(1, { bossHp, cutoffMs: 130_999 }))).toBe(bossHp[130]);
    expect(hpAtEnd(pull(1, { bossHp }))).toBe(bossHp[168]);
  });

  it('falls back to the last known sample before the cut', () => {
    expect(hpAtEnd(pull(1, { bossHp: [100, 80, null, null], cutoffMs: 3_000 }))).toBe(80);
  });

  it('picks the best wipe by its logged boss HP whatever the cutoff', () => {
    const fights: FightRow[] = [
      { ...WIPE, index: 1, durationMs: 140_000, bossHpPercent: 30 },
      { ...WIPE, index: 2, durationMs: 120_000, bossHpPercent: 60 },
      { ...WIPE, index: 3, durationMs: 300_000, outcome: 'kill', bossHpPercent: 0 },
    ];
    const cutEarly = pull(1, { cutoffMs: 2_000, bossHp: [100, 90, 80, 30] });
    const whole = pull(2, { bossHp: [100, 60] });
    const cutKill = pull(3, { cutoffMs: 1_000, bossHp: [100, 95, 0] });
    expect(bestPull(setRows(fights, [cutEarly, whole, cutKill]))?.row.view.n).toBe(1);
  });
});
