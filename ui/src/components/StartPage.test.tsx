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
  api: { openLog: vi.fn(), recentLogs: vi.fn(), reopenRecent: vi.fn(), removeRecent: vi.fn(), quickOverview: vi.fn(), pullSet: vi.fn(), canFollow: vi.fn(() => false) },
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
    combat: null,
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
  game: { kind: 'retail' },
  advancedLogging: true,
  brokenLines: 0,
  brokenByEvent: {},
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
  vi.mocked(api.removeRecent).mockReset().mockResolvedValue(undefined);
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
    expect(entry).toHaveAttribute('aria-disabled', 'true');
  });

  it('removes a recent log from the list by its × or its context menu', async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: `Remove ${LOG_ID} from the list` }));
    expect(api.removeRecent).toHaveBeenCalledWith(LOG_ID);

    const entry = await screen.findByRole('button', { name: /^WoWCombatLog/ });
    await userEvent.pointer({ keys: '[MouseRight]', target: entry });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove from list' }));
    expect(api.removeRecent).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('names the game of the log and the events most of its unreadable lines belong to', async () => {
    vi.mocked(api.openLog).mockResolvedValue({
      ...LOG,
      game: { kind: 'other', projectId: 7 },
      brokenLines: 1_210,
      brokenByEvent: { SPELL_HEAL: 300, SWING_DAMAGE: 2, SPELL_DAMAGE: 900, SPELL_ENERGIZE: 8 },
    });
    vi.mocked(chooseLog).mockResolvedValue({ name: SOURCE.name, open: async () => SOURCE });
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Open log…' }));
    expect(await screen.findByText(/^Project 7 · /)).toBeInTheDocument();
    const skipped = screen.getByText(/unreadable lines/);
    expect(skipped).toHaveTextContent('SPELL_DAMAGE (900), SPELL_HEAL (300) and SPELL_ENERGIZE (8)');
    expect(skipped).not.toHaveTextContent('SWING_DAMAGE');
  });

  it('opens a log chosen in the file dialog', async () => {
    vi.mocked(chooseLog).mockResolvedValue({ name: SOURCE.name, open: async () => SOURCE });
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Open log…' }));
    expect(api.openLog).toHaveBeenCalledWith(SOURCE, expect.any(Function));
  });

  it('points to dropping the log when the file dialog returns without one, until a log opens', async () => {
    vi.mocked(chooseLog).mockResolvedValue(null);
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Open log…' }));
    expect(await screen.findByRole('status', { name: "Couldn't open the log?" })).toHaveTextContent('Drag the log onto this page');

    await userEvent.click(await screen.findByRole('button', { name: /^WoWCombatLog/ }));
    await screen.findByRole('region', { name: "Ula'tek" });
    expect(screen.queryByRole('status', { name: "Couldn't open the log?" })).not.toBeInTheDocument();
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

describe('combat pulls', () => {
  const trash = (index: number, name: string, more: number, outcome: FightRow['outcome'], durationMs: number) =>
    row(index, name, 0, outcome, durationMs, { bossHpPercent: null, playerCount: 19, combat: { enemyCount: more + 1 } });

  it('combat section lists pulls in order and hides short non-kills when toggled', async () => {
    vi.mocked(api.openLog).mockResolvedValue({
      ...LOG,
      fights: [
        LOG.fights[0],
        trash(4, 'Venomfang Juggernaut', 1, 'kill', 36_200),
        trash(5, "Nek'zali the Soulcoiler", 0, 'ended', 400),
        trash(6, 'Venomfang Juggernaut', 26, 'ended', 74_100),
        trash(7, 'Vigilant Protector', 0, 'kill', 4_000),
      ],
    });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /^WoWCombatLog/ }));
    const section = await screen.findByRole('region', { name: 'Combat pulls' });
    expect(screen.getByRole('heading', { name: 'Raid bosses' })).toBeInTheDocument();
    const labels = () => within(section).getAllByRole('button').map((button) => button.getAttribute('aria-label'));
    expect(labels()).toEqual([
      'Open combat pull Venomfang Juggernaut and 1 more enemy, Kill after 0:36, started 19:40',
      'Open combat pull Venomfang Juggernaut and 26 more enemies, Ended after 1:14, started 20:00',
      'Open combat pull Vigilant Protector, Kill after 0:04, started 20:10',
    ]);
    await userEvent.click(screen.getByLabelText('Hide aborted pulls (< 10 s)'));
    expect(labels()[1]).toBe("Open combat pull Nek'zali the Soulcoiler, Ended after 0.4 s, started 19:50");

    await userEvent.click(within(section).getByRole('button', { name: /^Open combat pull Vigilant Protector/ }));
    expect(api.quickOverview).toHaveBeenLastCalledWith(LOG_ID, 7, { startMs: null, endMs: null, attribution: 'reattributed', includeOverkill: false, deathCutoff: null });
  });

  it('a log with only combat pulls shows them instead of the empty state', async () => {
    vi.mocked(api.openLog).mockResolvedValue({ ...LOG, fights: [trash(1, 'Vile Fin Minor Oracle', 0, 'kill', 11_800)] });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /^WoWCombatLog/ }));
    const section = await screen.findByRole('region', { name: 'Combat pulls' });
    expect(within(section).getByRole('button', { name: /^Open combat pull Vile Fin Minor Oracle/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'No pulls' })).not.toBeInTheDocument();
  });
});
