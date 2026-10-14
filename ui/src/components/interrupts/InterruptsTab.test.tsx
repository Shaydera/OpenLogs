import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useApp } from '../../store';
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
});
