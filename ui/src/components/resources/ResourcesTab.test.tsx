import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { resourcesReportFixture } from '../../test/reportFixtures';
import { ResourcesTab } from './ResourcesTab';

vi.mock('../../api/client', () => ({ api: {} }));

const openPlayer = vi.fn(async () => {});

beforeEach(() => {
  useApp.setState({ ...initialState(), openPlayer });
  openPlayer.mockClear();
});

describe('ResourcesTab', () => {
  it("lists the players with their average and shows the selected player's powers", async () => {
    render(<ResourcesTab report={resourcesReportFixture} />);
    const rows = within(screen.getByRole('group', { name: 'Players · 2' })).getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual(['FaelanArcane Mage · Mana, Arcane Charges82.5%', 'WendelArms Warrior · Rage16.7%']);
    const mana = screen.getByRole('region', { name: 'Mana' });
    expect(within(mana).getByRole('group', { name: 'Mana key figures' })).toHaveTextContent('Average82.5%Minimum50.0%Time at cap10.0 sGained50.0kWasted10.0k');
    expect(within(within(mana).getByRole('table', { name: 'Gains of Mana' })).getAllByRole('row')[1]).toHaveTextContent('Evocation50.0k10.0k');
    await userEvent.click(screen.getByRole('button', { name: 'Player details →' }));
    expect(openPlayer).toHaveBeenCalledWith(4);
    await userEvent.click(rows[1]);
    expect(screen.getByRole('heading', { level: 2, name: 'Wendel · resources' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Rage: average 16.7%' })).toBeInTheDocument();
  });
});
