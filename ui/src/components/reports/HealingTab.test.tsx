import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { healingReportFixture } from '../../test/reportFixtures';
import { HealingTab } from './HealingTab';

vi.mock('../../api/client', () => ({ api: {} }));

beforeEach(() => {
  localStorage.clear();
  useApp.setState({ ...initialState(), attribution: 'reattributed' });
});

describe('HealingTab', () => {
  it("saturates a healer's reattributed healing at zero and names the Evoker who buffed it", async () => {
    const healer = {
      ...healingReportFixture.players[0],
      healing: 800_000,
      absorbs: 200_000,
      supportReceived: 3_000_000,
      supportReceivedFrom: [{ player: 5, amount: 3_000_000 }],
      supportReceivedByBuff: [{ buffId: 395152, evoker: 5, amount: 3_000_000 }],
      supportCreditedByBuff: [],
      total: 1_000_000,
    };
    render(<HealingTab report={{ ...healingReportFixture, players: [healer] }} />);
    const row = within(screen.getByRole('group', { name: 'Healing by player' })).getByRole('button', { name: /Pyrrin/ });
    await userEvent.hover(within(row).getByText('1.00M'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('From Speronis’s buffs−3.00M');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Reattributed0.00M');
    expect(screen.getByRole('table', { name: 'Aug support credited to Evokers' })).toHaveTextContent('Speronis');
    act(() => useApp.setState({ attribution: 'augmented' }));
    expect(screen.getByRole('complementary')).toHaveTextContent("3.00M of this healing came from Speronis's Augmentation buffs.");
  });
});
