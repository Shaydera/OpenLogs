import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Breakdown, GroupedRow } from '../../api/types';
import { initialState, useApp } from '../../store';
import { breakdownFixture } from '../../test/reportFixtures';
import { DamageTakenTab } from './DamageTakenTab';

vi.mock('../../api/client', () => ({ api: {} }));

beforeEach(() => useApp.setState({ ...initialState(), tab: 'taken' }));

describe('DamageTakenTab', () => {
  it('ranks the breakdown rows and gives the selected one per second in DTPS', () => {
    render(<DamageTakenTab breakdown={breakdownFixture} />);
    const rows = within(screen.getByRole('group', { name: 'Damage Taken rows' })).getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('Wendel'), expect.stringContaining('Speronis')]);
    expect(screen.getByRole('complementary')).toHaveTextContent('2.00M · 200.00k DTPS');
  });

  it('shows how often each row was hit and how much of it was absorbed', () => {
    render(<DamageTakenTab breakdown={breakdownFixture} />);
    const row = within(screen.getByRole('group', { name: 'Damage Taken rows' })).getByRole('button', { name: /Wendel/ });
    expect(within(row).getByText('10')).toBeInTheDocument();
    expect(within(row).getByText('250.00k')).toBeInTheDocument();
  });

  it('splits hits from ticks, shows casts and misses, and leaves out columns no row fills', () => {
    const ability = (name: string, spellId: number, fields: Partial<GroupedRow>): GroupedRow => ({
      key: { kind: 'ability', ability: { kind: 'name', name }, rowKind: 'own', pet: null },
      name,
      number: null,
      spellId,
      amount: 0,
      share: 0,
      absorbed: 0,
      hits: 0,
      crits: 0,
      casts: 0,
      hitAmount: 0,
      ticks: 0,
      tickAmount: 0,
      misses: [],
      pets: [],
      perSecond: 0,
      splits: [],
      ...fields,
    });
    const breakdown: Breakdown = {
      ...breakdownFixture,
      group: 'ability',
      rows: [
        ability('Soulcoil Rite', 5, { amount: 4_017_000, hitAmount: 4_017_000, hits: 94, ticks: 84, tickAmount: 3_444_000, misses: [{ type: 'immune', count: 3 }] }),
        ability('Melee', 0, { amount: 6_680_000, hits: 24, casts: 49, misses: [{ type: 'dodge', count: 5 }, { type: 'parry', count: 20 }] }),
      ],
    };
    render(<DamageTakenTab breakdown={breakdown} />);
    const [rite, melee] = within(screen.getByRole('group', { name: 'Damage Taken rows' })).getAllByRole('button');

    expect(within(rite).getByText('10 (84)')).toBeInTheDocument();
    expect(within(rite).getByText('57.30k (41.00k)')).toBeInTheDocument();
    expect(within(melee).getByText('49')).toBeInTheDocument();
    expect(within(melee).getByText('51.02%')).toHaveAttribute('title', '5 Dodge · 20 Parry');
    expect(screen.queryByText('Absorbed')).toBeNull();
  });
});
