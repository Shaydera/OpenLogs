import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { recapFixture } from '../../test/reportFixtures';
import { DeathRecapView } from './DeathRecapView';

vi.mock('../../api/client', () => ({ api: {} }));

const openPlayer = vi.fn(async () => {});
const faelan = recapFixture.deaths[0];

beforeEach(() => {
  useApp.setState({ ...initialState(), openPlayer });
  openPlayer.mockClear();
});

describe('DeathRecapView', () => {
  it('tells the death, lists the last 3 s and opens the player', async () => {
    render(<DeathRecapView recap={faelan} report={recapFixture} />);
    expect(screen.getByRole('heading', { level: 2, name: /†/ })).toHaveTextContent('Faelan † 3:59');
    expect(screen.getByText('2× Virulent Spit within 1.0 s').closest('p')).toHaveTextContent(
      '355k each (≈ 37% of max HP). The first hit dropped HP from 74% to 36%, the second was lethal.',
    );
    const rows = within(screen.getByRole('table', { name: 'Events · last 3 s' })).getAllByRole('row');
    expect(rows.slice(1).map((r) => r.textContent)).toEqual([
      "−0.00 sVirulent SpitUla'tek−355,265 (4,923 overkill)0%",
      '−0.83 sRune of Self-MendingFaelan+12,552',
      "−1.01 sVirulent SpitUla'tek−355,26536%",
      "−1.11 sNecrotic VaporsUla'tek−35,44474%",
      '−2.37 sStormstream TotemMulgar (Totem)+14,195',
      '−2.63 sDeadly VenomDebuff−45,99968%',
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Faelan' }));
    expect(openPlayer).toHaveBeenCalledWith(4);
  });
});
