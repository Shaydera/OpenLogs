import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FightRow, Kpis, PullSet, SetPull } from '../../api/types';
import { initialState, useApp } from '../../store';
import { compareLogFixture } from '../../test/compareFixture';
import { overviewFixture } from '../../test/overviewFixture';
import { SetOverview } from './SetOverview';
import { setRows } from './setOverviewModel';

vi.mock('../../api/client', () => ({ api: {} }));

const openFight = vi.fn(async () => {});
const [WIPE, , KILL] = compareLogFixture.fights;
const fights: FightRow[] = [
  { ...WIPE, index: 1, durationMs: 120_000, bossHpPercent: 60.4 },
  { ...WIPE, index: 2, durationMs: 80_000, bossHpPercent: 33.8 },
  { ...KILL, index: 3, durationMs: 300_000, bossHpPercent: 0 },
  { ...WIPE, index: 4, durationMs: 100_000, bossHpPercent: 12.5 },
  { ...KILL, index: 5, durationMs: 250_000, bossHpPercent: 0 },
];

const kpis = (overrides: Partial<Kpis>): Kpis => ({ ...overviewFixture.kpis, ...overrides });
const pull = (fightIndex: number, durationMs: number, overrides: Partial<Kpis>): SetPull => ({
  fightIndex,
  kpis: kpis({ durationMs, ...overrides }),
  cutoffMs: null,
  pullDurationMs: durationMs,
  bossHpStepMs: 60_000,
  bossHp: [100, 80],
});

const pulls: SetPull[] = [
  pull(1, 120_000, { raidDamage: 240_000_000, raidDps: 2_000_000, deaths: 3, firstDeathMs: 40_000, combatPotions: 5, playersWithoutCombatPotion: 2 }),
  pull(2, 80_000, { raidDamage: 160_000_000, raidDps: 2_000_000, deaths: 1, firstDeathMs: 120_000, combatPotions: 6, playersWithoutCombatPotion: 0 }),
  pull(3, 300_000, { raidDamage: 900_000_000, raidDps: 3_000_000, deaths: 0, firstDeathMs: null, combatPotions: 8, playersWithoutCombatPotion: 1 }),
  pull(4, 100_000, { raidDamage: 200_000_000, raidDps: 2_000_000, deaths: 2, firstDeathMs: 30_000, combatPotions: 4, playersWithoutCombatPotion: 3 }),
  pull(5, 250_000, { raidDamage: 800_000_000, raidDps: 3_200_000, deaths: 0, firstDeathMs: null, combatPotions: 7, playersWithoutCombatPotion: 0 }),
];
const total = kpis({
  durationMs: 850_000,
  raidDamage: 2_300_000_000,
  raidDps: 2_705_882,
  deaths: 6,
  firstDeathMs: 30_000,
  combatPotions: 30,
  playersWithoutCombatPotion: 6,
});
const set: PullSet = { kind: 'all', encounterId: WIPE.encounterId, difficulty: WIPE.difficulty, fights: [1, 2, 3, 4, 5] };

const rowOrder = () => screen.getAllByRole('button', { name: /^Open pull/ }).map((row) => row.getAttribute('aria-label'));

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ ...initialState(), log: { ...compareLogFixture, fights }, view: { kind: 'set', set }, openFight });
});

describe('set overview', () => {
  it('each_pull_row_shows_its_own_numbers_and_opens_the_pull', async () => {
    render(<SetOverview set={set} rows={setRows(fights, pulls)} kpis={total} />);
    const row = screen.getByRole('button', { name: "Open pull 2 of Ula'tek" });
    expect(row).toHaveTextContent('#2');
    expect(row).toHaveTextContent('Wipe');
    expect(row).toHaveTextContent('1:20');
    expect(row).toHaveTextContent('33.8%');
    expect(row).toHaveTextContent('2:00.0');
    expect(row).toHaveTextContent('2.00M');
    expect(row).toHaveTextContent('6 · 0 without');
    expect(screen.getByRole('button', { name: "Open pull 3 of Ula'tek" })).toHaveTextContent('Kill');
    await userEvent.click(row);
    expect(openFight).toHaveBeenCalledWith(2);
  });

  it('the_total_row_shows_the_summed_duration_and_the_raid_dps_of_the_set', () => {
    render(<SetOverview set={set} rows={setRows(fights, pulls)} kpis={total} />);
    const row = screen.getByRole('group', { name: 'All pulls' });
    expect(row).toHaveTextContent('14:10');
    expect(row).toHaveTextContent('best wipe 12.5% (#4)');
    expect(row).toHaveTextContent('2.71M');
    expect(row).toHaveTextContent('avg 1:03');
    expect(row).toHaveTextContent('30 · 6 without');
  });

  it('best_first_puts_kills_then_lowest_boss_hp', async () => {
    render(<SetOverview set={set} rows={setRows(fights, pulls)} kpis={total} />);
    expect(rowOrder()).toEqual([1, 2, 3, 4, 5].map((n) => `Open pull ${n} of Ula'tek`));
    await userEvent.click(screen.getByRole('button', { name: 'Best first' }));
    expect(rowOrder()).toEqual([5, 3, 4, 2, 1].map((n) => `Open pull ${n} of Ula'tek`));
    await userEvent.click(screen.getByRole('button', { name: 'In order' }));
    expect(rowOrder()[0]).toBe("Open pull 1 of Ula'tek");
  });

  it('cut_pulls_show_analysed_over_whole_and_the_ends_at_column', () => {
    const cutFights: FightRow[] = [
      { ...WIPE, index: 1, durationMs: 169_000, bossHpPercent: 20 },
      { ...WIPE, index: 2, durationMs: 80_000, bossHpPercent: 33.8 },
    ];
    const cut: SetPull = { ...pull(1, 169_000, { durationMs: 130_321 }), cutoffMs: 130_320 };
    const rows = setRows(cutFights, [cut, pull(2, 80_000, {})]);
    useApp.setState({ deathCutoff: 3 });
    render(<SetOverview set={set} rows={rows} kpis={total} />);
    expect(screen.getByRole('button', { name: "Open pull 1 of Ula'tek" })).toHaveTextContent('2:10 / 2:49');
    expect(screen.getByRole('button', { name: "Open pull 1 of Ula'tek" })).toHaveTextContent('3rd death');
    expect(screen.getByRole('button', { name: "Open pull 2 of Ula'tek" })).toHaveTextContent('pull end');
  });

  it('there_is_no_ends_at_column_without_a_cutoff', () => {
    render(<SetOverview set={set} rows={setRows(fights, pulls)} kpis={total} />);
    expect(screen.queryByText('Ends at')).toBeNull();
    expect(screen.queryByText('pull end')).toBeNull();
  });
});
