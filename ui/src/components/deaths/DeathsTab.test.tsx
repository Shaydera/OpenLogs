import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeathRecap, DeathsReport, ReportUnit, UnitRef } from '../../api/types';
import { initialState, useApp } from '../../store';
import { overviewFixture } from '../../test/overviewFixture';
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
  useApp.setState({ ...initialState(), tab: 'deaths', filterOptions: vi.fn(async () => []) });
});

describe('DeathsTab', () => {
  it('selects a death on click, keeps it across range changes and falls back when it is gone', async () => {
    const { rerender } = render(<DeathsTab report={report} />);
    await userEvent.click(screen.getByRole('button', { name: /^6:59Sabrel/ }));
    expect(useApp.getState().focusDeath).toEqual({ player: 7, t: 419_080, fight: null });
    rerender(<DeathsTab report={{ ...report, deaths: [{ ...faelan, t: 100_000 }, faelan, sabrel] }} />);
    expect(within(screen.getByRole('group', { name: 'All deaths · 3' })).getByRole('button', { pressed: true })).toHaveTextContent('6:59');
    rerender(<DeathsTab report={{ ...report, deaths: [faelan] }} />);
    expect(within(screen.getByRole('group', { name: 'All deaths · 1' })).getByRole('button', { pressed: true })).toHaveTextContent('3:59');
  });

  it('leaves the selected player and killing-blow source out of the list', () => {
    useApp.setState({ filters: { ...initialState().filters, own: [{ kind: 'player', actorId: 4 }], other: [{ kind: 'unit', name: "Ula'tek" }] } });
    render(<DeathsTab report={{ ...report, deaths: [faelan] }} />);
    expect(within(screen.getByRole('group', { name: 'Deaths of Faelan' })).getByRole('button')).toHaveTextContent(/^3:59Virulent Spit$/);
  });

  it('names the selected player in the empty state from the overview roster', () => {
    useApp.setState({ overview: overviewFixture, filters: { ...initialState().filters, own: [{ kind: 'player', actorId: 3 }] } });
    render(<DeathsTab report={{ ...report, roster: [], deaths: [] }} />);
    expect(screen.getByRole('heading', { name: /Deaths of Wendel/ })).toBeInTheDocument();
  });

  it('lists enemy kills with their killing blow, killer and time alive', () => {
    useApp.setState({ filters: { ...initialState().filters, perspective: 'enemy' } });
    const rawling: ReportUnit = { unit: { kind: 'instance', actorId: 9 }, name: 'Blightscale Rawling', number: 7 };
    const kill = { t: 61_000, unit: rawling, killingBlow: { ...faelan.killingBlow!, sourceName: 'Faelan-Emberfall-EU' }, killer: { unit: { kind: 'player' as const, actorId: 4 }, name: 'Faelan', number: null }, aliveMs: 12_000 };
    render(<DeathsTab report={{ ...report, deaths: [], kills: [kill] }} />);
    const rows = within(screen.getByRole('table', { name: 'Kills · 1' })).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('1:01Blightscale Rawling #7Virulent SpitFaelan0:12');
  });

  it('keeps the unit column for a selected name group but drops it for a single unit', () => {
    const rawling: ReportUnit = { unit: { kind: 'instance', actorId: 9 }, name: 'Blightscale Rawling', number: 7 };
    const kill = { t: 61_000, unit: rawling, killingBlow: null, killer: null, aliveMs: null };
    const render_ = (target: UnitRef) => {
      useApp.setState({ filters: { ...initialState().filters, perspective: 'enemy', own: [target] } });
      render(<DeathsTab report={{ ...report, deaths: [], kills: [kill] }} />);
      return screen.queryAllByRole('columnheader').map((h) => h.textContent);
    };
    expect(render_({ kind: 'unit', name: 'Blightscale Rawling' })).toContain('Unit');
    cleanup();
    expect(render_({ kind: 'instance', actorId: 9 })).not.toContain('Unit');
  });
});
