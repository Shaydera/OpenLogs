import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { abilityDetailFixture } from '../../test/reportFixtures';
import { AbilityDetailView } from './AbilityDetailView';

vi.mock('../../api/client', () => ({ api: {} }));

const back = vi.fn(async () => {});
const openTarget = vi.fn(async () => {});

beforeEach(() => {
  useApp.setState({ ...initialState(), back, openTarget });
  back.mockClear();
  openTarget.mockClear();
});

describe('AbilityDetailView', () => {
  it('shows the key figures and goes back to the player', async () => {
    render(<AbilityDetailView detail={abilityDetailFixture} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Arcane Barrage' })).toBeInTheDocument();
    expect(screen.getByText('Direct damage')).toBeInTheDocument();
    const kpis = screen.getByRole('region', { name: 'Ability key figures' });
    expect(kpis).toHaveTextContent("23.0% of Faelan's damage");
    expect(kpis).toHaveTextContent('1.25 targets per cast');
    expect(kpis).toHaveTextContent('median 343k');
    await userEvent.click(screen.getByRole('button', { name: '← Faelan' }));
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('lists the targets and opens the top target from the footer', async () => {
    render(<AbilityDetailView detail={abilityDetailFixture} />);
    const rows = within(screen.getByRole('group', { name: 'By target' })).getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual(["Ula'tek321.76M", 'Blightscale Rawling20543.5k']);
    await userEvent.click(screen.getByRole('button', { name: "Open target details (Ula'tek) →" }));
    expect(openTarget).toHaveBeenCalledWith("Ula'tek");
  });

  it('filters the hit log by crits and target', async () => {
    render(<AbilityDetailView detail={abilityDetailFixture} />);
    const log = screen.getByRole('table', { name: 'Hit log' });
    expect(screen.getByText('5 of 5')).toBeInTheDocument();
    expect(within(within(log).getAllByRole('row')[3]).getAllByRole('cell').map((c) => c.textContent)).toEqual(['0:06.1', "Ula'tek", '1,056,506', 'Crit']);
    await userEvent.click(screen.getByRole('button', { name: 'Crits only' }));
    expect(screen.getByText('2 of 5')).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('group', { name: 'By target' })).getByRole('button', { name: /^Blightscale Rawling/ }));
    expect(screen.getByRole('button', { name: 'Target: Blightscale Rawling ✕' })).toBeInTheDocument();
    expect(screen.getByText('0 of 5')).toBeInTheDocument();
  });
});
