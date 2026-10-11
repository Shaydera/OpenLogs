import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { castsReportFixture } from '../../test/reportFixtures';
import { CastsTab } from './CastsTab';

vi.mock('../../api/client', () => ({ api: {} }));

const openPlayer = vi.fn(async () => {});
const openAbilityOf = vi.fn(async () => {});

beforeEach(() => {
  localStorage.clear();
  useApp.setState({ ...initialState(), openPlayer, openAbilityOf });
  openPlayer.mockClear();
  openAbilityOf.mockClear();
});

const list = () => screen.getByRole('group', { name: 'Casts by player' });
const pick = (name: string) => userEvent.click(within(list()).getByRole('button', { name: new RegExp(name) }));
const spellRows = (name: string) => within(screen.getByRole('table', { name: `Spell casts of ${name}` })).getAllByRole('row').slice(1);
const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((cell) => cell.textContent);

describe('CastsTab', () => {
  it("lists players by visible casts and links the selected player's spells to their ability pages", async () => {
    render(<CastsTab report={castsReportFixture} />);
    const rows = within(list()).getAllByRole('button');
    expect(rows.map((row) => row.textContent)).toEqual(['FaelanDPS4020.01', 'PyrrinHeal3618.02']);
    expect(rows[0]).toHaveAttribute('aria-pressed', 'true');
    await pick('Pyrrin');
    await userEvent.click(screen.getByRole('button', { name: 'Rejuvenation' }));
    expect(openAbilityOf).toHaveBeenCalledWith(2, 774, 'healing');
    expect(screen.queryByRole('button', { name: 'Regrowth' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Player details →' }));
    expect(openPlayer).toHaveBeenCalledWith(2);
  });

  it('sorts spells with missing uptimes last in both directions and shows procs on request', async () => {
    render(<CastsTab report={castsReportFixture} />);
    await pick('Pyrrin');
    expect(spellRows('Pyrrin').map(cells)).toEqual([
      ['', 'Rejuvenation', '30', '80.0%', '15.0'],
      ['', 'Regrowth', '6', '—', '3.0'],
    ]);
    const table = screen.getByRole('table', { name: 'Spell casts of Pyrrin' });
    await userEvent.click(within(table).getByRole('button', { name: 'Uptime %' }));
    await userEvent.click(within(table).getByRole('button', { name: 'Uptime % ↓' }));
    expect(within(table).getByRole('button', { name: 'Uptime % ↑' })).toBeInTheDocument();
    expect(spellRows('Pyrrin').map((row) => cells(row)[1])).toEqual(['Rejuvenation', 'Regrowth']);
    act(() => useApp.getState().setHideProcs(false));
    expect(spellRows('Pyrrin').some((row) => row.textContent?.includes('Soul Fragment'))).toBe(true);
  });
});
