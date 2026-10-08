import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
import { logFixture } from '../../test/logFixture';
import { FightTopBar } from './FightTopBar';

vi.mock('../../api/client', () => ({ api: {} }));

const backToPulls = vi.fn();
const KILL = logFixture.fights[2];
const FILE = 'WoWCombatLog-100726_185823.txt';

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    ...initialState(),
    log: logFixture,
    view: { kind: 'fight', fightIndex: 3 },
    backToPulls,
  });
});

describe('fight top bar', () => {
  it('returns to the pull list from the app name and the log crumb', async () => {
    useApp.setState({ tab: 'damage' });
    render(<FightTopBar row={KILL} />);
    expect(screen.getByText("Ula'tek · Pull #3 · Kill 7:58")).toHaveAttribute('aria-current', 'page');
    await userEvent.click(screen.getByRole('button', { name: 'OpenLogs – all pulls' }));
    await userEvent.click(screen.getByRole('button', { name: FILE }));
    expect(backToPulls).toHaveBeenCalledTimes(2);
  });
});
