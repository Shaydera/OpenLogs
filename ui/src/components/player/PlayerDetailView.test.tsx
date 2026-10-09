import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { playerDetailFixture } from '../../test/reportFixtures';
import { PlayerDetailView } from './PlayerDetailView';

vi.mock('../../api/client', () => ({ api: {} }));

const openPlayer = vi.fn(async () => {});
const closeDetail = vi.fn(async () => {});

beforeEach(() => {
  useApp.setState({ ...initialState(), attribution: 'reattributed', openPlayer, closeDetail });
  openPlayer.mockClear();
  closeDetail.mockClear();
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

  it('shows the key figures', () => {
    render(<PlayerDetailView detail={playerDetailFixture} />);
    const kpis = screen.getByRole('region', { name: 'Player key figures' });
    expect(within(kpis).getByText('103.23M')).toBeInTheDocument();
    expect(kpis).toHaveTextContent('Augmented: 117.09M');
    expect(kpis).toHaveTextContent('Rank 3 of 3');
    expect(kpis).toHaveTextContent('from Speronis');
    expect(within(kpis).getByText('no potion, no healthstone')).toBeInTheDocument();
    expect(kpis).toHaveTextContent('0:12 · res at 0:16');
  });
});
