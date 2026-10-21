import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeathRecap, FightRow, PullSet, SetDeaths } from '../../../api/types';
import { initialState, useApp } from '../../../store';
import { compareLogFixture } from '../../../test/compareFixture';
import { recapFixture } from '../../../test/reportFixtures';
import { SetDeathsPage } from './SetDeathsPage';

vi.mock('../../../api/client', () => ({ api: {} }));

const [WIPE, , KILL] = compareLogFixture.fights;
const fights: FightRow[] = [
  { ...WIPE, index: 1, durationMs: 100_000 },
  { ...WIPE, index: 2, durationMs: 200_000 },
  { ...KILL, index: 3, durationMs: 150_000 },
];
const set: PullSet = { kind: 'all', encounterId: WIPE.encounterId, difficulty: WIPE.difficulty, fights: [1, 2, 3] };

const faelan = recapFixture.deaths[0];
const death = (player: number, playerName: string, t: number): DeathRecap => ({ ...faelan, player, playerName, t, windowStartMs: t - 6_000, number: 1 });

const report: SetDeaths = {
  ...recapFixture,
  roster: [
    ...recapFixture.roster,
    { actorId: 8, name: 'Tovric-Emberfall-EU', specId: 71, specName: 'Arms Warrior', classId: 1, classToken: 'WARRIOR', role: 'damage' },
  ],
  deaths: [],
  pulls: [
    {
      fightIndex: 1,
      durationMs: 100_000,
      deaths: [death(4, 'Faelan-Emberfall-EU', 50_000)],
      kills: [],
      lifetime: [
        { player: 4, firstDeathMs: 50_000 },
        { player: 6, firstDeathMs: null },
      ],
    },
    {
      fightIndex: 2,
      durationMs: 200_000,
      deaths: [],
      kills: [],
      lifetime: [
        { player: 4, firstDeathMs: null },
        { player: 6, firstDeathMs: null },
      ],
    },
    {
      fightIndex: 3,
      durationMs: 150_000,
      deaths: [death(8, 'Tovric-Emberfall-EU', 30_000), death(6, 'Serrik-Silverbrook-EU', 61_000)],
      kills: [],
      lifetime: [
        { player: 4, firstDeathMs: null },
        { player: 6, firstDeathMs: 61_000 },
        { player: 8, firstDeathMs: 30_000 },
      ],
    },
  ],
  byKillingBlow: [{ spellId: 1302982, environmental: false, sources: ["Ula'tek"], count: 3 }],
  noLethal: 0,
  byPlayer: [
    { player: 4, pulls: 3, deaths: 1 },
    { player: 6, pulls: 3, deaths: 1 },
    { player: 8, pulls: 1, deaths: 1 },
  ],
};

beforeEach(() => {
  useApp.setState({ ...initialState(), log: { ...compareLogFixture, fights }, view: { kind: 'set', set }, tab: 'deaths', filterOptions: vi.fn(async () => []) });
});

describe('set deaths page', () => {
  it('clicking a death window bar selects that death and its recap', async () => {
    render(<SetDeathsPage report={report} />);
    expect(screen.getByRole('heading', { name: /Faelan/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Pull #3, 1:01\.0, Serrik/ }));
    expect(screen.getByRole('heading', { name: /Serrik/ })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Pull #3' })).getByRole('button', { pressed: true })).toHaveTextContent('Serrik');
  });

  it('the same death time in two pulls selects only the clicked pull', async () => {
    const [first, second, third] = report.pulls;
    const twice = { ...report, pulls: [first, { ...second, deaths: [death(4, 'Faelan-Emberfall-EU', 50_000)] }, third] };
    render(<SetDeathsPage report={twice} />);
    const list = within(screen.getByRole('complementary', { name: /^All deaths/ }));
    await userEvent.click(within(list.getByRole('group', { name: 'Pull #2' })).getByRole('button', { name: /Faelan/ }));
    const pressed = list.getAllByRole('button', { pressed: true });
    expect(pressed).toHaveLength(1);
    expect(within(list.getByRole('group', { name: 'Pull #2' })).getByRole('button', { pressed: true })).toBe(pressed[0]);
    expect(screen.getByText(/Pull #2 \(Wipe\)/)).toBeInTheDocument();
  });

  it('the lifetime table can leave out players who were in fewer pulls', async () => {
    render(<SetDeathsPage report={report} />);
    const lifetime = () => within(screen.getByRole('table', { name: 'Lifetime' }));
    expect(lifetime().getByText('Tovric')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'In ≥ 2 pulls' }));
    expect(lifetime().queryByText('Tovric')).not.toBeInTheDocument();
    expect(lifetime().getByText('Faelan')).toBeInTheDocument();
  });
});
