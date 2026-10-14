import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});
