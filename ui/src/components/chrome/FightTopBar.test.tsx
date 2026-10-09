import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { logFixture } from '../../test/logFixture';
import { overviewFixture } from '../../test/overviewFixture';
import { abilityDetailFixture } from '../../test/reportFixtures';
import { FightTopBar } from './FightTopBar';

vi.mock('../../api/client', () => ({ api: {} }));

const backToPulls = vi.fn();
const showDetailAt = vi.fn(async () => {});
const setRange = vi.fn(async () => {});
const KILL = logFixture.fights[2];
const FILE = 'WoWCombatLog-100726_185823.txt';

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    ...initialState(),
    log: logFixture,
    view: { kind: 'fight', fightIndex: 3 },
    overview: overviewFixture,
    backToPulls,
    showDetailAt,
    setRange,
  });
});

describe('fight top bar', () => {
  it('walks back down the detail stack and to the pull list', async () => {
    useApp.setState({
      tab: 'damage',
      details: [
        { kind: 'player', player: 4 },
        { kind: 'ability', player: 4, spellId: 44425, pet: null },
      ],
      report: { tab: 'ability', data: abilityDetailFixture },
    });
    render(<FightTopBar row={KILL} />);
    expect(screen.getByText('Arcane Barrage')).toHaveAttribute('aria-current', 'page');
    await userEvent.click(screen.getByRole('button', { name: 'Faelan' }));
    expect(showDetailAt).toHaveBeenCalledWith(0);
    await userEvent.click(screen.getByRole('button', { name: 'OpenLogs – all pulls' }));
    await userEvent.click(screen.getByRole('button', { name: FILE }));
    expect(backToPulls).toHaveBeenCalledTimes(2);
  });

  it('names the active range on a detail page and clears it with ×', async () => {
    useApp.setState({
      tab: 'damage',
      details: [
        { kind: 'player', player: 4 },
        { kind: 'ability', player: 4, spellId: 44425, pet: null, spellName: 'Arcane Barrage' },
      ],
      range: { startMs: 130_000, endMs: 220_000 },
    });
    render(<FightTopBar row={KILL} />);
    expect(screen.getByText('Range 2:10–3:40')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear time range' }));
    expect(setRange).toHaveBeenCalledWith(null);
  });
});
