import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { breakdownFixture, healingReportFixture } from '../../test/reportFixtures';
import { HealingTab } from './HealingTab';

vi.mock('../../api/client', () => ({ api: {} }));

beforeEach(() => {
  localStorage.clear();
  useApp.setState({ ...initialState(), tab: 'healing', attribution: 'augmented' });
});

describe('HealingTab', () => {
  it("shows the selected healer's absorbs, Aug split and buffing Evoker in the unfiltered view", async () => {
    const healer = {
      ...healingReportFixture.players[0],
      player: 3,
      supportReceived: 3_000_000,
      supportReceivedFrom: [{ player: 5, amount: 3_000_000 }],
    };
    render(<HealingTab report={{ ...healingReportFixture, players: [healer] }} breakdown={breakdownFixture} />);
    expect(screen.getByRole('complementary')).toHaveTextContent("3.00M of this healing came from Speronis's Augmentation buffs.");
    const row = within(screen.getByRole('group', { name: 'Healing rows' })).getByRole('button', { name: /Wendel/ });
    expect(row).toHaveTextContent('5.00M');
    await userEvent.hover(within(row).getByText('2.00M'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('From Speronis’s buffs');
    act(() => useApp.setState({ filters: { ...initialState().filters, perspective: 'enemy' } }));
    expect(screen.getByRole('complementary')).not.toHaveTextContent('Augmentation buffs');
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
