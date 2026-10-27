import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Breakdown, GroupedRow } from '../../api/types';
import { initialState, useApp } from '../../store';
import { breakdownFixture, healingReportFixture } from '../../test/reportFixtures';
import { HealingTab } from './HealingTab';

vi.mock('../../api/client', () => ({ api: {} }));

beforeEach(() => {
  localStorage.clear();
  useApp.setState({ ...initialState(), tab: 'healing', attribution: 'augmented' });
});

describe('HealingTab', () => {
  it("shows the selected healer's Aug split and buffing Evoker in the unfiltered view", async () => {
    const healer = {
      ...healingReportFixture.players[0],
      player: 3,
      supportReceived: 3_000_000,
      supportReceivedFrom: [{ player: 5, amount: 3_000_000 }],
    };
    render(<HealingTab report={{ ...healingReportFixture, players: [healer] }} breakdown={breakdownFixture} />);
    expect(screen.getByRole('complementary')).toHaveTextContent("3.00M of this healing came from Speronis's Augmentation buffs.");
    const row = within(screen.getByRole('group', { name: 'Healing rows' })).getByRole('button', { name: /Wendel/ });
    await userEvent.hover(within(row).getByText('2.00M'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('From Speronis’s buffs');
    act(() => useApp.setState({ filters: { ...initialState().filters, perspective: 'enemy' } }));
    expect(screen.getByRole('complementary')).not.toHaveTextContent('Augmentation buffs');
  });

  it('shows the overheal share in every view and hits only once a single source is filtered', () => {
    const overhealed = { ...breakdownFixture, rows: breakdownFixture.rows.map((row, i) => (i === 0 ? { ...row, overheal: 1_000_000, healed: 3_000_000 } : row)) };
    const { rerender } = render(<HealingTab report={healingReportFixture} breakdown={overhealed} />);
    const wendel = () => within(screen.getByRole('group', { name: 'Healing rows' })).getByRole('button', { name: /Wendel/ });
    expect(wendel()).toHaveTextContent('25.00%');
    expect(screen.queryByText('Hits')).toBeNull();

    const ability = (name: string, spellId: number, fields: Partial<GroupedRow>): GroupedRow => ({
      ...overhealed.rows[0],
      key: { kind: 'ability', ability: { kind: 'name', name }, rowKind: 'own', pet: null },
      name,
      spellId,
      splits: [],
      ...fields,
    });
    const byAbility: Breakdown = {
      ...overhealed,
      group: 'ability',
      side: ['target'],
      rows: [
        ability('Rejuvenation', 774, { amount: 2_000_000, overheal: 1_000_000, healed: 2_000_000, hits: 10, hitAmount: 2_000_000 }),
        ability('Power Word: Shield', 17, { amount: 1_000_000, absorbed: 1_000_000, overheal: 0, healed: 0, hits: 4, hitAmount: 1_000_000 }),
      ],
    };
    act(() => useApp.setState({ filters: { ...initialState().filters, own: [{ kind: 'player', actorId: 3 }] } }));
    rerender(<HealingTab report={healingReportFixture} breakdown={byAbility} />);
    const rows = within(screen.getByRole('group', { name: 'Healing rows' }));
    expect(screen.getByText('Hits')).toBeInTheDocument();
    expect(rows.getByRole('button', { name: /Rejuvenation/ })).toHaveTextContent('33.33%');
    expect(rows.getByRole('button', { name: /Power Word: Shield/ })).toHaveTextContent('—');
  });

  it('keeps a popup inside its panel when the panel is scaled', async () => {
    const healer = { ...healingReportFixture.players[0], player: 3, supportReceived: 3_000_000, supportReceivedFrom: [{ player: 5, amount: 3_000_000 }] };
    render(<HealingTab report={{ ...healingReportFixture, players: [healer] }} breakdown={breakdownFixture} />);
    const panel = screen.getAllByRole('region').find((element) => element.classList.contains('report-main'))!;
    Object.defineProperty(panel, 'currentCSSZoom', { value: 1.6, configurable: true });
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 0, 1_600, 600));
    const anchor = within(within(screen.getByRole('group', { name: 'Healing rows' })).getByRole('button', { name: /Wendel/ })).getByText('2.00M');
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(1_500, 80, 60, 20));
    await userEvent.hover(anchor);
    expect(parseFloat(screen.getByRole('tooltip').style.left)).toBeLessThanOrEqual(1_000 - 360 - 8);
  });
});
