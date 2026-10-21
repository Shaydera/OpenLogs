import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AurasReport, FightRow, PullSet, SetAuras } from '../../api/types';
import { initialState, useApp } from '../../store';
import { compareLogFixture } from '../../test/compareFixture';
import { aurasReportFixture } from '../../test/reportFixtures';
import { AurasTab } from './AurasTab';

vi.mock('../../api/client', () => ({ api: {} }));

const setAuraKind = vi.fn(async () => {});

beforeEach(() => {
  useApp.setState({ ...initialState(), tab: 'buffs', setAuraKind, filterOptions: vi.fn(async () => []) });
  setAuraKind.mockClear();
});

const auraRows = () => within(screen.getByRole('table', { name: 'Auras' })).getAllByRole('row').slice(1);

describe('AurasTab', () => {
  it('lists the auras and expands one into per-target lanes', async () => {
    render(<AurasTab report={aurasReportFixture} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Buffs on players' })).toBeInTheDocument();
    expect(auraRows().map((r) => r.textContent)).toEqual(['Arcane Intellect100.00%24', 'Power Infusion75.00%11', 'Bloodlust40.00%22']);
    await userEvent.click(screen.getByRole('button', { name: 'Bloodlust' }));
    expect(screen.getByRole('button', { name: 'Bloodlust' })).toHaveAttribute('aria-expanded', 'true');
    const lanes = screen.getByRole('list', { name: 'Targets of Bloodlust' });
    expect(within(lanes).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Faelan40.00%', 'Wendel40.00%']);
  });

  it('sorts by a column and switches between buffs and debuffs', async () => {
    render(<AurasTab report={aurasReportFixture} />);
    await userEvent.click(screen.getByRole('button', { name: 'Applications' }));
    expect(auraRows().map((r) => within(r).getAllByRole('button')[0].textContent)).toEqual(['Arcane Intellect', 'Bloodlust', 'Power Infusion']);
    await userEvent.click(screen.getByRole('button', { name: 'Debuffs' }));
    expect(setAuraKind).toHaveBeenCalledWith('debuffs');
  });

  it("shows one aura's holders as the rows once grouped by target, without a row uptime and by applications", async () => {
    const [intellect] = aurasReportFixture.rows;
    const byTarget: AurasReport = {
      ...aurasReportFixture,
      group: 'target',
      rows: intellect.lanes.map((lane) => ({
        key: { kind: 'unit', unit: { kind: 'player', actorId: lane.holder.player! } },
        name: lane.holder.name,
        spellId: 0,
        spellIds: [],
        holder: lane.holder,
        sources: lane.sources,
        applications: lane.applications,
        uptime: lane.uptime,
        lanes: [lane],
      })),
    };
    render(<AurasTab report={byTarget} />);
    expect(auraRows().map((r) => r.textContent)).toEqual(['Faelan12', 'Wendel12']);
    expect(screen.getByRole('columnheader', { name: 'Applications ↓' })).toHaveAttribute('aria-sort', 'descending');
    await userEvent.click(screen.getByRole('button', { name: 'Faelan' }));
    expect(within(screen.getByRole('list', { name: 'Auras of Faelan' })).getByRole('listitem')).toHaveTextContent('Arcane Intellect100.00%');
  });

  it('a_lane_in_a_set_draws_each_pull_in_its_own_segment', async () => {
    const [WIPE] = compareLogFixture.fights;
    const fights: FightRow[] = [
      { ...WIPE, index: 1, durationMs: 100_000 },
      { ...WIPE, index: 2, durationMs: 200_000 },
    ];
    const set: PullSet = { kind: 'all', encounterId: WIPE.encounterId, difficulty: WIPE.difficulty, fights: [1, 2] };
    useApp.setState({ log: { ...compareLogFixture, fights }, view: { kind: 'set', set } });
    const bloodlust = aurasReportFixture.rows[1];
    const report: SetAuras = {
      ...aurasReportFixture,
      endMs: 300_000,
      rows: [{ ...bloodlust, lanes: [{ ...bloodlust.lanes[0], intervals: [[105_000, 110_000]] }] }],
      pulls: [
        { fightIndex: 1, startMs: 0, endMs: 100_000 },
        { fightIndex: 2, startMs: 100_000, endMs: 300_000 },
      ],
    };
    render(<AurasTab report={report} />);
    await userEvent.click(screen.getByRole('button', { name: 'Bloodlust' }));
    const lane = within(screen.getByRole('list', { name: 'Targets of Bloodlust' })).getByRole('listitem');
    expect(within(lane).getAllByRole('img').map((segment) => segment.getAttribute('aria-label'))).toEqual(['Pull #2: 0:05–0:10.']);
  });
});
