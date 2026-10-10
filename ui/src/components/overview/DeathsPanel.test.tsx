import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { overviewFixture } from '../../test/overviewFixture';
import { DeathsPanel } from './DeathsPanel';

vi.mock('../../api/client', () => ({ api: {} }));

beforeEach(() => useApp.setState(initialState()));

describe('DeathsPanel', () => {
  it('lists each death with its killing blow and context and opens the recap from the player', async () => {
    const openDeathRecap = vi.fn(async () => {});
    useApp.setState({ ...initialState(), openDeathRecap });
    render(<DeathsPanel overview={overviewFixture} />);
    const rows = screen.getAllByRole('listitem', { name: /^Death \d/ });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Melee');
    expect(rows[0]).toHaveTextContent('by Gore Rattle');
    expect(within(rows[1]).getByText('Ice Cold')).toBeInTheDocument();
    expect(within(rows[1]).getByText('pre-pull')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Death recap of Faelan' }));
    expect(openDeathRecap).toHaveBeenCalledWith(4, 239_100);
  });
});
