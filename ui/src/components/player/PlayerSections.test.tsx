import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { playerDetailFixture } from '../../test/reportFixtures';
import { OverTimeChart } from './OverTimeChart';
import { PlayerAbilities } from './PlayerAbilities';

vi.mock('../../api/client', () => ({ api: {} }));

const openAbility = vi.fn(async () => {});

beforeEach(() => {
  useApp.setState({ ...initialState(), attribution: 'reattributed', openAbility });
  openAbility.mockClear();
});

describe('OverTimeChart', () => {
  it('names the legend, the death with its rezzer and the bands for screen readers', () => {
    render(<OverTimeChart detail={playerDetailFixture} />);
    const legend = screen.getByRole('list', { name: 'Chart legend' });
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['DPS (5 s)', 'Mana %', 'Arcane Surge', 'Ebon Might', 'Dead']);
    expect(screen.getByText('Dead · Rebirth by Pyrrin')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'DPS over time, peak 400k' })).toHaveAccessibleDescription(
      'Arcane Surge: 0:00–0:01, 0:13–0:15. Ebon Might: 0:00–0:06, 0:07–0:16. Dead: 0:12–0:16. Mana from 60% to 90%.',
    );
  });
});

describe('PlayerAbilities', () => {
  it('lists the abilities in a grid and formats', () => {
    render(<PlayerAbilities detail={playerDetailFixture} />);
    const table = screen.getByRole('table', { name: 'Abilities of Faelan' });
    const rows = within(table).getAllByRole('row');
    expect(within(rows[0]).getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
      'Icon',
      'Ability',
      'Damage',
      'Share',
      'Casts',
      'Hits',
      'Crit',
      'Avg hit',
      'Max hit',
    ]);
    const cells = (i: number) => within(rows[i]).getAllByRole('cell').map((c) => c.textContent);
    expect(cells(1)).toEqual(['', 'Arcane Missiles', '37.99M', '36.8%', '85', '1325', '25.7%', '28.7k', '242.7k']);
    expect(cells(4)).toEqual(['', 'Mirror Image & other pets', '1.32M', '1.3%', '—', '—', '—', '—', '—']);
    expect(cells(5)).toEqual(['', 'Reattributed to Speronis', '−5.98M', '', '—', '—', '—', '—', '—']);
    expect(rows[5]).toHaveClass('ab-row-negative');
  });

  it('opens the ability page from own rows only', async () => {
    render(<PlayerAbilities detail={playerDetailFixture} />);
    await userEvent.click(screen.getByRole('button', { name: 'Arcane Barrage' }));
    expect(openAbility).toHaveBeenCalledWith(44425, null);
    expect(screen.queryByRole('button', { name: 'Reattributed to Speronis' })).toBeNull();
  });

  it("folds an Evoker's own buff share into his support row on his own page", () => {
    const speronis = playerDetailFixture.roster.find((p) => p.name.startsWith('Speronis'))!;
    const row = { actorId: speronis.actorId, actorName: speronis.name, overheal: 0, hits: 0, crits: 0, maxHit: 0, ticks: 0, casts: null, aug: false, pets: 0 };
    render(
      <PlayerAbilities
        detail={{
          ...playerDetailFixture,
          player: speronis,
          total: 30_000_000,
          abilities: [
            { ...row, spellId: 395152, kind: 'support_given', amount: 30_170_000 },
            { ...row, spellId: 409311, kind: 'support_given', amount: 5_000_000 },
            { ...row, spellId: 409311, kind: 'support_deducted', amount: -78_000 },
          ],
        }}
      />,
    );
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[1].textContent)).toEqual(['Ebon MightSupport', 'PrescienceSupport']);
    expect(within(rows[1]).getAllByRole('cell')[2]).toHaveTextContent('4.92M');
    expect(screen.queryByText(/to Speronis|Own buff share/)).toBeNull();
  });
});
