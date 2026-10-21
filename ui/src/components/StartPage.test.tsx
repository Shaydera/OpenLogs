import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { api } from '../api/client';
import type { LogSource } from '../api/logSource';
import type { FightRow, LogView, RecentLog } from '../api/types';
import { chooseLog } from '../api/logSource';
import { initialState, useApp } from '../store';
import { overviewFixture } from '../test/overviewFixture';
import { runLogFixture } from '../test/runFixture';

vi.mock('../api/client', () => ({
  api: { openLog: vi.fn(), recentLogs: vi.fn(), reopenRecent: vi.fn(), removeRecent: vi.fn(), quickOverview: vi.fn(), pullSet: vi.fn() },
}));
vi.mock('../api/logSource', () => ({ chooseLog: vi.fn() }));

const LOG_ID = 'WoWCombatLog-100726_185823.txt';
const SOURCE: LogSource = { id: LOG_ID, name: 'WoWCombatLog-100726_185823.txt', size: 230_331_451, lastModified: 0, read: vi.fn() };

const RECENT: RecentLog[] = [
  {
    id: LOG_ID,
    fileName: 'WoWCombatLog-100726_185823.txt',
    sizeBytes: 230_331_451,
    zone: 'The Venomous Abyss',
    startUnixMs: Date.UTC(2026, 9, 7, 19, 3, 2),
    pullCount: 3,
    openedAtUnixMs: 0,
    exists: true,
  },
];

function row(index: number, name: string, encounterId: number, outcome: FightRow['outcome'], durationMs: number, extra: Partial<FightRow> = {}): FightRow {
  return {
    index,
    encounterId,
    name,
    difficulty: 15,
    difficultyLabel: 'Heroic',
    outcome,
    durationMs,
    bossHpPercent: outcome === 'kill' ? 0 : null,
    playerCount: 23,
    startUnixMs: Date.UTC(2026, 9, 7, 19, index * 10),
    zone: 'The Venomous Abyss',
    run: null,
    runIndex: null,
    ...extra,
  };
}

const LOG: LogView = {
  id: LOG_ID,
  fileName: 'WoWCombatLog-100726_185823.txt',
  sizeBytes: 230_331_451,
  cacheHit: false,
  logVersion: 22,
  build: '12.1.0',
  advancedLogging: true,
  brokenLines: 0,
  warnings: [],
  zone: 'The Venomous Abyss',
  startUnixMs: Date.UTC(2026, 9, 7, 19, 3, 2),
  fights: [
    row(1, "Ula'tek", 3492, 'kill', 478_610),
    row(2, 'Nymrissa Wavecaller', 3379, 'wipe', 19, { difficulty: 233, difficultyLabel: null, playerCount: 16 }),
    row(3, 'Nymrissa Wavecaller', 3379, 'kill', 281_817, { difficulty: 233, difficultyLabel: null }),
  ],
};

beforeEach(() => {
  vi.mocked(api.recentLogs).mockReset().mockResolvedValue(RECENT);
  vi.mocked(api.openLog).mockReset().mockResolvedValue(LOG);
  vi.mocked(api.reopenRecent).mockReset().mockResolvedValue(SOURCE);
  vi.mocked(api.quickOverview).mockReset().mockResolvedValue(overviewFixture);
  vi.mocked(api.pullSet).mockReset().mockResolvedValue([{ overview: overviewFixture, pulls: [] }]);
  vi.mocked(chooseLog).mockReset();
  localStorage.clear();
  useApp.setState(initialState());
});

describe('start page', () => {
  it('lists recent logs and opens one', async () => {
    render(<App />);
    const entry = await screen.findByRole('button', { name: /^WoWCombatLog-100726_185823\.txt/ });
    expect(entry).toHaveTextContent('3 pulls');
    await userEvent.click(entry);
    expect(api.reopenRecent).toHaveBeenCalledWith(LOG_ID);
    expect(api.openLog).toHaveBeenCalledWith(SOURCE, expect.any(Function));
    expect(await screen.findByRole('region', { name: "Ula'tek" })).toBeInTheDocument();
  });

  it('flags recent logs that cannot be opened without choosing them again', async () => {
    vi.mocked(api.recentLogs).mockResolvedValue([{ ...RECENT[0], exists: false }]);
    render(<App />);
    const entry = await screen.findByRole('button', { name: /^WoWCombatLog/ });
    expect(entry).toHaveTextContent('Choose the file again to open it');
    expect(entry).toBeDisabled();
  });

  it('opens a log chosen in the file dialog', async () => {
    vi.mocked(chooseLog).mockResolvedValue({ name: SOURCE.name, open: async () => SOURCE });
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Open log…' }));
    expect(api.openLog).toHaveBeenCalledWith(SOURCE, expect.any(Function));
  });

  it('groups pulls and hides aborted ones until the toggle is cleared', async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /^WoWCombatLog/ }));
    const nymrissa = await screen.findByRole('region', { name: 'Nymrissa Wavecaller' });
    expect(nymrissa).toHaveTextContent('Difficulty 233 · 2 pulls · killed on pull #2');
    expect(within(nymrissa).queryByText('Aborted')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Hide aborted pulls (< 10 s)'));
    expect(within(nymrissa).getByText('Aborted')).toBeInTheDocument();
    expect(within(nymrissa).getByText('0.0 s')).toBeInTheDocument();
  });

  it('opens a pull', async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /^WoWCombatLog/ }));
    await userEvent.click(await screen.findByRole('button', { name: "Open pull 1 of Ula'tek" }));
    expect(api.quickOverview).toHaveBeenCalledWith(LOG_ID, 1, { startMs: null, endMs: null, attribution: 'reattributed', includeOverkill: false, deathCutoff: null });
  });

  it('opens a pull set of a boss', async () => {
    vi.mocked(api.openLog).mockResolvedValue({
      ...LOG,
      fights: [row(1, "Ula'tek", 3492, 'wipe', 201_000), row(2, "Ula'tek", 3492, 'wipe', 254_000), row(3, "Ula'tek", 3492, 'kill', 478_610)],
    });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /^WoWCombatLog/ }));
    await userEvent.click(await screen.findByRole('button', { name: "Open All wipes of Ula'tek (2 pulls)" }));
    expect(useApp.getState().view).toMatchObject({ kind: 'set', set: { kind: 'wipes', fights: [1, 2] } });
    expect(api.pullSet).toHaveBeenCalledWith(LOG_ID, [1, 2], expect.anything(), expect.anything());
  });
});

describe('Mythic+ runs', () => {
  it('shows each run above the raid bosses and opens the run or one of its boss pulls', async () => {
    vi.mocked(api.openLog).mockResolvedValue(runLogFixture);
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /^WoWCombatLog/ }));
    const run = await screen.findByRole('region', { name: 'Priory of the Sacred Flame +12' });
    const regions = screen.getAllByRole('region');
    expect(regions.indexOf(run)).toBeLessThan(regions.indexOf(screen.getByRole('region', { name: "Ula'tek" })));
    expect(within(run).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Open run Priory of the Sacred Flame +12',
      'Open Captain Dailcry, pull 1 of the run',
      'Open Baron Braunpyke, pull 3 of the run',
      'Open Baron Braunpyke, pull 4 of the run',
      'Open Prioress Murrpray, pull 5 of the run',
    ]);
    await userEvent.click(within(run).getByRole('button', { name: 'Open Baron Braunpyke, pull 4 of the run' }));
    expect(api.quickOverview).toHaveBeenLastCalledWith(runLogFixture.id, 5, { startMs: null, endMs: null, attribution: 'reattributed', includeOverkill: false, deathCutoff: null });
    useApp.setState({ view: { kind: 'start' } });
    await userEvent.click(await screen.findByRole('button', { name: 'Open run Priory of the Sacred Flame +12' }));
    expect(api.quickOverview).toHaveBeenLastCalledWith(runLogFixture.id, 1, { startMs: null, endMs: null, attribution: 'reattributed', includeOverkill: false, deathCutoff: null });
  });
});
