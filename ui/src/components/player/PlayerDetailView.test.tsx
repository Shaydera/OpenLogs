import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { playerDetailFixture } from '../../test/reportFixtures';
import { PlayerDetailView } from './PlayerDetailView';

vi.mock('../../api/client', () => ({ api: {} }));

const openPlayer = vi.fn(async () => {});
const closeDetail = vi.fn(async () => {});
const openDeathRecap = vi.fn(async () => {});

beforeEach(() => {
  useApp.setState({ ...initialState(), attribution: 'reattributed', openPlayer, closeDetail, openDeathRecap });
  openPlayer.mockClear();
  closeDetail.mockClear();
  openDeathRecap.mockClear();
});

describe('PlayerDetailView', () => {
  it('switches to another player and closes the page', async () => {
    render(<PlayerDetailView detail={playerDetailFixture} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Faelan' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Player' }), 'Wendel');
    expect(openPlayer).toHaveBeenCalledWith(3);
    await userEvent.click(screen.getByRole('button', { name: '← All players' }));
    expect(closeDetail).toHaveBeenCalled();
  });

  it('drops the abilities block for one selected ability and links the page filter to its ability page', async () => {
    const clearPageFilter = vi.fn(async () => {});
    const openAbility = vi.fn(async () => {});
    const filterOptions = vi.fn(async () => []);
    useApp.setState({ clearPageFilter, openAbility, filterOptions, filters: { ...initialState().filters, ability: [{ kind: 'name', name: 'Arcane Barrage' }] } });
    const narrowed = { ...playerDetailFixture, abilities: playerDetailFixture.abilities.filter((row) => row.spellId === 44425), petAbilities: [] };
    render(<PlayerDetailView detail={narrowed} />);
    expect(screen.queryByRole('region', { name: 'Abilities' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Abilities' })).toBeNull();
    const line = screen.getByText('Filtered').parentElement!;
    expect(line).toHaveTextContent('Ability Arcane Barrage');
    await userEvent.click(within(line).getByRole('button', { name: 'Arcane Barrage' }));
    expect(openAbility).toHaveBeenCalledWith(44425, null);
    await userEvent.click(within(line).getByRole('button', { name: 'Clear filters' }));
    expect(clearPageFilter).toHaveBeenCalledWith(['ability']);
  });

  it('shows the key figures and links the death to its recap', async () => {
    render(<PlayerDetailView detail={playerDetailFixture} />);
    const kpis = screen.getByRole('region', { name: 'Player key figures' });
    expect(within(kpis).getByText('103.23M')).toBeInTheDocument();
    expect(kpis).toHaveTextContent('Augmented: 117.09M');
    expect(kpis).toHaveTextContent('Rank 3 of 3');
    expect(kpis).toHaveTextContent('from Speronis');
    expect(within(kpis).getByText('no potion, no healthstone')).toBeInTheDocument();
    await userEvent.click(within(kpis).getByRole('button', { name: '0:12 · res at 0:16 →' }));
    expect(openDeathRecap).toHaveBeenCalledWith(4, 12_000);
  });
});
