import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { damageReportFixture } from '../../test/reportFixtures';
import { DamageDoneTab } from './DamageDoneTab';

vi.mock('../../api/client', () => ({ api: {} }));

beforeEach(() => {
  localStorage.clear();
  useApp.setState({ ...initialState(), attribution: 'reattributed' });
});

const list = () => screen.getByRole('group', { name: 'Damage done by player' });
const rowOf = (name: string) => within(list()).getByRole('button', { name: new RegExp(name) });
const side = () => screen.getByRole('complementary');

describe('DamageDoneTab', () => {
  it('ranks players by damage and breaks the selected one down in the side panel', async () => {
    render(<DamageDoneTab report={damageReportFixture} />);
    expect(within(list()).getAllByRole('button').map((row) => row.textContent)).toEqual([
      expect.stringContaining('Wendel'),
      expect.stringContaining('Speronis'),
      expect.stringContaining('Faelan'),
    ]);
    expect(rowOf('Wendel')).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(rowOf('Speronis'));
    expect(rowOf('Wendel')).toHaveAttribute('aria-pressed', 'false');
    expect(within(side()).getByRole('heading', { name: 'Speronis' })).toBeInTheDocument();
    const abilities = within(side()).getByRole('table', { name: 'Abilities of Speronis' });
    expect(within(abilities).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[2].textContent)).toEqual([
      '50.18M',
      '38.00M',
      '37.29M',
      '−0.18M',
    ]);
  });

  it("opens the selected player's page from the side panel", async () => {
    const openPlayer = vi.fn(async () => {});
    useApp.setState({ openPlayer });
    render(<DamageDoneTab report={damageReportFixture} />);
    await userEvent.click(rowOf('Faelan'));
    await userEvent.click(screen.getByRole('button', { name: 'Player details →' }));
    expect(openPlayer).toHaveBeenCalledWith(4);
  });

  it("moves a buffed player's Aug support to the Evoker only in Reattributed mode", async () => {
    render(<DamageDoneTab report={damageReportFixture} />);
    await userEvent.click(rowOf('Faelan'));
    expect(within(side()).getByRole('table', { name: 'Abilities of Faelan' })).toHaveTextContent('Reattributed to Speronis−13.86M');
    expect(side()).toHaveTextContent("13.86M of this damage came from Speronis's Augmentation buffs.");
    await userEvent.click(rowOf('Speronis'));
    expect(screen.getByRole('table', { name: 'Support by recipient' })).toBeInTheDocument();

    act(() => useApp.setState({ attribution: 'augmented' }));
    expect(screen.queryByRole('table', { name: 'Support by recipient' })).not.toBeInTheDocument();
  });

  it("explains a player's Aug split in a tooltip below the row", async () => {
    render(<DamageDoneTab report={damageReportFixture} />);
    expect(within(rowOf('Faelan')).getByText('103.23M')).toHaveClass('dotted');
    await userEvent.hover(rowOf('Faelan'));
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Damage as logged (Augmented)117.09M');
    expect(tip).toHaveTextContent('From Speronis’s buffs−13.86M');
    expect(tip).toHaveTextContent('Shown in table: Reattributed');
    expect(rowOf('Faelan')).toHaveAttribute('aria-describedby', tip.id);
    await userEvent.unhover(rowOf('Faelan'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows a hint for an empty range', () => {
    render(<DamageDoneTab report={{ ...damageReportFixture, total: 0, players: [] }} />);
    expect(screen.getByText('No damage in this range.')).toBeInTheDocument();
  });
});
