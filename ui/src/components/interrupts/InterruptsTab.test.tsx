import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FightRow, PullSet, SetInterrupts } from '../../api/types';
import { initialState, useApp } from '../../store';
import { compareLogFixture } from '../../test/compareFixture';
import { interruptsReportFixture } from '../../test/reportFixtures';
import { InterruptsTab } from './InterruptsTab';

vi.mock('../../api/client', () => ({ api: {} }));

beforeEach(() => {
  useApp.setState({ ...initialState(), tab: 'interrupts', filterOptions: vi.fn(async () => []) });
});

const head = (name: string) => within(screen.getByRole('table', { name })).getAllByRole('columnheader').map((h) => h.textContent);

describe('InterruptsTab', () => {
  it('lists interrupters and dispellers, and the interrupts and dispels in time order', () => {
    render(<InterruptsTab report={interruptsReportFixture} />);
    const players = within(screen.getByRole('table', { name: 'Interrupts and dispels by player' })).getAllByRole('row').slice(1);
    expect(players.map((r) => r.textContent)).toEqual(['FaelanDPS1—', 'WendelDPS1—', 'PyrrinHeal—1']);
    const kicks = within(screen.getByRole('table', { name: 'Interrupts' })).getAllByRole('row').slice(1);
    expect(kicks.map((r) => r.textContent)).toEqual(["0:12FaelanCounterspellUla'tekVenom Bolt", "0:30WendelPummelUla'tekVenom Bolt"]);
    expect(within(screen.getByRole('table', { name: 'Dispels' })).getAllByRole('row')[1]).toHaveTextContent('0:20PyrrinPurifyWendelToxic Spores');
  });

  it('leaves narrowed dimensions out of the logs', () => {
    useApp.setState({ filters: { ...initialState().filters, own: [{ kind: 'player', actorId: 4 }], ability: [{ kind: 'id', spellId: 5 }] } });
    const faelan = interruptsReportFixture.interrupts.slice(0, 1);
    render(<InterruptsTab report={{ ...interruptsReportFixture, group: 'target', interrupts: faelan, dispels: [], missed: [] }} />);
    expect(head('Interrupts')).toEqual(['Time', 'Spell', 'Target']);
  });

  it('a_sets_kicks_are_listed_under_their_pull', () => {
    const [WIPE] = compareLogFixture.fights;
    const fights: FightRow[] = [1, 2, 3].map((index) => ({ ...WIPE, index, durationMs: 100_000 }));
    const set: PullSet = { kind: 'all', encounterId: WIPE.encounterId, difficulty: WIPE.difficulty, fights: [1, 2, 3] };
    useApp.setState({ log: { ...compareLogFixture, fights }, view: { kind: 'set', set } });
    const [faelan, wendel] = interruptsReportFixture.interrupts;
    const pull = (fightIndex: number, interrupts: SetInterrupts['interrupts']) => ({ fightIndex, durationMs: 100_000, interrupts, dispels: [], missed: [] });
    const report: SetInterrupts = {
      ...interruptsReportFixture,
      interrupts: [],
      dispels: [],
      missed: [],
      pulls: [pull(1, [faelan]), pull(2, []), pull(3, [wendel])],
    };
    render(<InterruptsTab report={report} />);
    const log = within(screen.getByRole('region', { name: /^Interrupts \d/ }));
    expect(log.getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['Pull #1', 'Pull #3']);
    const entries = (n: number) => {
      const group = within(log.getByRole('group', { name: `Pull #${n}` }));
      expect(group.getByText(`#${n}`)).toBeInTheDocument();
      return within(group.getByRole('table', { name: `Interrupts, Pull #${n}` })).getAllByRole('row').slice(1).map((row) => row.textContent);
    };
    expect(entries(1)).toEqual(["0:12FaelanCounterspellUla'tekVenom Bolt"]);
    expect(entries(3)).toEqual(["0:30WendelPummelUla'tekVenom Bolt"]);
  });
});
