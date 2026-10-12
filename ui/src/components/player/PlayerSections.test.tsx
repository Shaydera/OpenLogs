import { act, render, screen, within } from '@testing-library/react';
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
  const table = () => screen.getByRole('table', { name: /^Abilities of/ });
  const rows = () => within(table()).getAllByRole('row');
  const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((c) => c.textContent);

  it('lists net abilities with the Aug column in Reattributed mode', () => {
    render(<PlayerAbilities detail={playerDetailFixture} />);
    expect(within(rows()[0]).getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
      'Icon',
      'Ability',
      'Damage',
      'Aug',
      'Share',
      'Casts',
      'Hits',
      'Crit',
      'Avg hit',
      'Max hit',
    ]);
    expect(cells(rows()[1])).toEqual(['', 'Arcane Missiles', '37.99M', '—', '36.8%', '85', '1325', '25.7%', '28.7k', '242.7k']);
    // Avg hit as logged: (22.49M net + 5.98M Aug) / 117.
    expect(cells(rows()[2])).toEqual(['', 'Arcane Barrage', '22.49M', '−5.98M', '21.8%', '67', '117', '40.2%', '243.3k', '1.06M']);
    expect(cells(rows()[4])).toEqual(['', 'Mirror Image & other pets', '1.32M', '—', '1.3%', '—', '—', '—', '—', '—']);
    expect(cells(rows()[5])).toEqual(['…', 'Unmatched hits', '−12.0k', '−12.0k', '', '—', '—', '—', '—', '—']);
  });

  it('opens an own row into its targets by group, and the ability page from its name', async () => {
    render(<PlayerAbilities detail={playerDetailFixture} />);
    const toggle = screen.getByRole('button', { name: 'Targets of Arcane Barrage' });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const group = screen.getByRole('rowgroup', { name: 'Targets of Arcane Barrage' });
    expect(within(group).getAllByRole('row').map(cells)).toEqual([
      ['', 'Targets · 3', '', '', 'of ability', '', '', '', '', ''],
      ['', "Ula'tek", '12.00M', '', '53.4%', '', '60', '40.0%', '', ''],
      ['', 'Blightscale Rawling · 58 units', '8.00M', '', '35.6%', '', '40', '40.0%', '', ''],
      ['', 'Doomscale Warden · 2 units', '2.49M', '', '11.1%', '', '17', '41.2%', '', ''],
    ]);
    const strip = within(group).getByRole('img', { name: "Split of Arcane Barrage by target, Ula'tek 53.4%, Blightscale Rawling 35.6%, Other 11.1%" });
    await userEvent.hover(strip.querySelectorAll('.tseg')[1]);
    expect(screen.getByRole('tooltip')).toHaveTextContent('35.6% of Arcane Barrage · 58 units · 40 hits · 40.0% crit');
    await userEvent.click(toggle);
    expect(screen.queryByRole('rowgroup')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Arcane Barrage' }));
    expect(openAbility).toHaveBeenCalledWith(44425, null);
  });

  it("explains a row's Aug value by buff and Evoker on hover and focus", async () => {
    render(<PlayerAbilities detail={playerDetailFixture} />);
    const value = within(rows()[2]).getByRole('button', { name: '−5.98M' });
    await userEvent.hover(value);
    const tip = screen.getByRole('tooltip');
    expect(value).toHaveAttribute('aria-describedby', tip.id);
    expect(tip).toHaveTextContent('As logged28.47MPrescience · Speronis−3.98MEbon Might · Speronis−2.00MShown (Reattributed)22.49M');
    await userEvent.unhover(value);
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => value.focus());
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
