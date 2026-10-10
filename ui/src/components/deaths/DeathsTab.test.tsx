import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeathRecap, DeathsReport } from '../../api/types';
import { initialState, useApp } from '../../store';
import { recapFixture } from '../../test/reportFixtures';
import { DeathsTab } from './DeathsTab';

vi.mock('../../api/client', () => ({ api: {} }));

const faelan = recapFixture.deaths[0];
const sabrel: DeathRecap = {
  ...faelan,
  player: 7,
  playerName: 'Sabrel-Emberfall-EU',
  t: 419_080,
  number: 5,
  specName: 'Windwalker Monk',
  killingBlow: { t: 419_066, spellId: 1297338, sourceName: null, amount: 175_421, overkill: 30_091, environmental: false, periodic: true },
  resurrectedAt: null,
  resurrectedBy: null,
  lethalBurst: null,
  events: [],
  hp: [],
  context: [],
};
const report: DeathsReport = {
  ...recapFixture,
  roster: [
    ...recapFixture.roster,
    { actorId: 7, name: 'Sabrel-Emberfall-EU', specId: 269, specName: 'Windwalker Monk', classId: 10, classToken: 'MONK', role: 'damage' },
  ],
  deaths: [faelan, sabrel],
};

beforeEach(() => {
  useApp.setState(initialState());
});

describe('DeathsTab', () => {
  it('selects a death on click, keeps it across range changes and falls back when it is gone', async () => {
    const { rerender } = render(<DeathsTab report={report} />);
    await userEvent.click(screen.getByRole('button', { name: /^6:59Sabrel/ }));
    expect(useApp.getState().focusDeath).toEqual({ player: 7, t: 419_080 });
    rerender(<DeathsTab report={{ ...report, deaths: [{ ...faelan, t: 100_000 }, faelan, sabrel] }} />);
    expect(within(screen.getByRole('group', { name: 'All deaths · 3' })).getByRole('button', { pressed: true })).toHaveTextContent('6:59');
    rerender(<DeathsTab report={{ ...report, deaths: [faelan] }} />);
    expect(within(screen.getByRole('group', { name: 'All deaths · 1' })).getByRole('button', { pressed: true })).toHaveTextContent('3:59');
  });
});
