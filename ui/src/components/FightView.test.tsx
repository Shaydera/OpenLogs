import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import type { LogView } from '../api/types';
import { initialState, useApp } from '../store';
import { compareLogFixture, comparisonFixture } from '../test/compareFixture';
import { overviewFixture } from '../test/overviewFixture';
import { breakdownFixture, damageReportFixture, resourcesReportFixture } from '../test/reportFixtures';
import { FightView } from './FightView';

vi.mock('../api/client', () => ({
  api: {
    openLog: vi.fn(),
    recentLogs: vi.fn(),
    removeRecent: vi.fn(),
    quickOverview: vi.fn(),
    damageDoneReport: vi.fn(),
    healingReport: vi.fn(),
    damageTakenReport: vi.fn(),
    deathsReport: vi.fn(),
    castsReport: vi.fn(),
    aurasReport: vi.fn(),
    interruptsReport: vi.fn(),
    resourcesReport: vi.fn(),
    comparePulls: vi.fn(),
    breakdownReport: vi.fn(),
  },
}));

const LOG = {
  id: 'WoWCombatLog-100726_185823.txt',
  fileName: 'WoWCombatLog-100726_185823.txt',
  fights: [
    {
      index: 1, encounterId: 3492, name: "Ula'tek", difficulty: 15, difficultyLabel: 'Heroic', outcome: 'kill',
      durationMs: 478_610, bossHpPercent: 0, playerCount: 23, startUnixMs: Date.UTC(2026, 9, 7, 19, 3, 2),
      zone: 'The Venomous Abyss', run: null, runIndex: null,
    },
  ],
} as LogView;

beforeEach(() => {
  useApp.setState({ ...initialState(), log: LOG, view: { kind: 'fight', fightIndex: 1 } });
});

describe('FightView', () => {
  it('moves between tabs with the arrow keys and wraps around', async () => {
    vi.mocked(api.damageDoneReport).mockResolvedValue(damageReportFixture);
    vi.mocked(api.resourcesReport).mockResolvedValue(resourcesReportFixture);
    useApp.setState({ overview: overviewFixture });
    render(<FightView />);
    const overviewTab = screen.getByRole('tab', { name: 'Overview' });
    const panel = screen.getByRole('tabpanel', { name: 'Overview' });
    expect(overviewTab).toHaveAttribute('aria-controls', panel.id);
    expect(overviewTab).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Damage Done' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: 'Damage Done' })).not.toHaveAttribute('aria-controls');

    overviewTab.focus();
    await userEvent.keyboard('{ArrowRight}');
    const damage = screen.getByRole('tab', { name: 'Damage Done' });
    expect(damage).toHaveFocus();
    expect(damage).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Damage Done' })).toBeInTheDocument();

    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Resources' })).toHaveFocus();
    expect(useApp.getState().tab).toBe('resources');
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Resources' })).toHaveFocus();
  });

  it('switches to Damage Done and reloads it with the Aug attribution', async () => {
    vi.mocked(api.damageDoneReport).mockResolvedValue(damageReportFixture);
    vi.mocked(api.breakdownReport).mockResolvedValue(breakdownFixture);
    useApp.setState({ overview: overviewFixture });
    render(<FightView />);
    await userEvent.click(screen.getByRole('tab', { name: 'Damage Done' }));
    expect(screen.getByRole('tab', { name: 'Damage Done' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Options' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Credit Aug support to the Evoker/ }));
    expect(screen.getByRole('button', { name: /Aug support stays with the buffed player/ })).toBeInTheDocument();
    const augmented = { startMs: null, endMs: null, attribution: 'augmented' };
    expect(api.damageDoneReport).toHaveBeenLastCalledWith('WoWCombatLog-100726_185823.txt', 1, augmented);
    expect(api.breakdownReport).toHaveBeenLastCalledWith(
      'WoWCombatLog-100726_185823.txt',
      1,
      augmented,
      { perspective: 'friendly', source: [], target: [], ability: [] },
      'damageDone',
      'source',
    );
  });

  it('navigates by breadcrumb: the pull crumb back to the Overview with focus on its title, the log crumb to the pull list', async () => {
    useApp.setState({ overview: overviewFixture, tab: 'casts' });
    render(<FightView />);
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    await userEvent.click(within(crumbs).getByRole('button', { name: "Ula'tek · Pull #1" }));
    expect(useApp.getState().tab).toBe('overview');
    expect(screen.getByRole('heading', { level: 1, name: "Ula'tek" })).toHaveFocus();
    await userEvent.click(within(crumbs).getByRole('button', { name: 'WoWCombatLog-100726_185823.txt' }));
    expect(useApp.getState().view).toEqual({ kind: 'start' });
  });

  it('offers a way back when a detail page fails', async () => {
    const back = vi.fn(async () => {});
    useApp.setState({ overview: overviewFixture, tab: 'damage', details: [{ kind: 'player', player: 99 }], reportError: 'Actor 99 is not a player of this pull', back });
    render(<FightView />);
    expect(screen.getByText('The report could not be calculated: Actor 99 is not a player of this pull')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '← Back' }));
    expect(back).toHaveBeenCalled();
  });
});

describe('compare with…', () => {
  const first = compareLogFixture.fights[0];
  const PULLS: LogView = {
    ...compareLogFixture,
    fights: [
      ...compareLogFixture.fights,
      { ...first, index: 4, encounterId: 3420, name: 'Sszorak' },
      { ...first, index: 5, difficulty: 16, difficultyLabel: 'Mythic' },
      { ...first, index: 6, durationMs: 247_029, bossHpPercent: 33.8 },
    ],
  };

  beforeEach(() => {
    vi.mocked(api.comparePulls).mockReset().mockResolvedValue(comparisonFixture);
    useApp.setState({ log: PULLS, view: { kind: 'fight', fightIndex: 3 }, overview: overviewFixture });
  });

  it('opens a comparison with another pull of the boss and comes back to the tabs', async () => {
    render(<FightView />);
    await userEvent.click(screen.getByRole('button', { name: 'Compare with…' }));
    const list = screen.getByRole('list', { name: 'Compare this pull with' });
    expect(within(list).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Pull #1 · Wipe · 2:22 · 60.4%',
      'Pull #4 · Wipe · 4:07 · 33.8%',
    ]);
    await userEvent.click(within(list).getByRole('button', { name: 'Pull #1 · Wipe · 2:22 · 60.4%' }));
    expect(api.comparePulls).toHaveBeenLastCalledWith(PULLS.id, 1, 3, 'reattributed');
    expect(await screen.findByRole('table', { name: 'Key figures' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '← Back to pull #3' }));
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });
});
