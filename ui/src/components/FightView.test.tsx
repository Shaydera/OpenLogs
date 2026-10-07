import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import type { LogView } from '../api/types';
import { initialState, useApp } from '../store';
import { damageReportFixture, healingReportFixture, takenReportFixture } from '../test/reportFixtures';
import { timelineFixture } from '../test/timelineFixture';
import { FightView } from './FightView';

vi.mock('../api/client', () => ({
  api: {
    openLog: vi.fn(),
    recentLogs: vi.fn(),
    removeRecent: vi.fn(),
    fightTimeline: vi.fn(),
    damageDoneReport: vi.fn(),
    healingReport: vi.fn(),
    damageTakenReport: vi.fn(),
  },
}));

const LOG = {
  path: 'C:\\Logs\\WoWCombatLog-100726_185823.txt',
  fileName: 'WoWCombatLog-100726_185823.txt',
  fights: [
    {
      index: 1, encounterId: 3492, name: "Ula'tek", difficulty: 15, difficultyLabel: 'Heroic', outcome: 'kill',
      durationMs: 478_610, bossHpPercent: 0, playerCount: 23, startUnixMs: Date.UTC(2026, 9, 7, 19, 3, 2),
      zone: 'The Venomous Abyss',
    },
  ],
} as LogView;

beforeEach(() => {
  useApp.setState({ ...initialState(), log: LOG, view: { kind: 'fight', fightIndex: 1 } });
});

describe('FightView', () => {
  it('moves between tabs with the arrow keys and wraps around', async () => {
    vi.mocked(api.damageDoneReport).mockResolvedValue(damageReportFixture);
    vi.mocked(api.healingReport).mockResolvedValue(healingReportFixture);
    vi.mocked(api.damageTakenReport).mockResolvedValue(takenReportFixture);
    useApp.setState({ timeline: timelineFixture });
    render(<FightView />);
    const damageTab = screen.getByRole('tab', { name: 'Damage Done' });
    const panel = screen.getByRole('tabpanel', { name: 'Damage Done' });
    expect(damageTab).toHaveAttribute('aria-controls', panel.id);
    expect(damageTab).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Healing' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: 'Healing' })).not.toHaveAttribute('aria-controls');

    damageTab.focus();
    await userEvent.keyboard('{ArrowRight}');
    const healing = screen.getByRole('tab', { name: 'Healing' });
    expect(healing).toHaveFocus();
    expect(healing).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Healing' })).toBeInTheDocument();

    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Damage Done' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Damage Taken' })).toHaveFocus();
    expect(useApp.getState().tab).toBe('taken');
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Damage Taken' })).toHaveFocus();
  });

  it('switches to Damage Done and reloads it with the Aug attribution', async () => {
    vi.mocked(api.damageDoneReport).mockResolvedValue(damageReportFixture);
    useApp.setState({ timeline: timelineFixture, tab: 'taken' });
    render(<FightView />);
    await userEvent.click(screen.getByRole('tab', { name: 'Damage Done' }));
    expect(screen.getByRole('tab', { name: 'Damage Done' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Damage Taken' })).toHaveAttribute('aria-selected', 'false');
    const toggle = screen.getByRole('group', { name: 'Aug damage' });
    await userEvent.click(within(toggle).getByRole('button', { name: 'Augmented' }));
    expect(within(toggle).getByRole('button', { name: 'Augmented' })).toHaveAttribute('aria-pressed', 'true');
    expect(api.damageDoneReport).toHaveBeenLastCalledWith(
      'C:\\Logs\\WoWCombatLog-100726_185823.txt',
      1,
      { startMs: null, endMs: null, attribution: 'augmented' },
    );
  });
});
