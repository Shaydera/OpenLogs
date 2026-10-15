import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventRow, EventsPage } from '../../api/types';
import { initialState, useApp } from '../../store';
import { overviewFixture } from '../../test/overviewFixture';
import { eventsPageFixture } from '../../test/viewFixtures';
import { EventsView } from './EventsView';

vi.mock('../../api/client', () => ({ api: {} }));

const showEventsPage = vi.fn(async () => {});

function show(page: EventsPage) {
  useApp.setState({ events: page });
}

beforeEach(() => {
  showEventsPage.mockClear();
  useApp.setState({
    ...initialState(),
    tab: 'damage',
    reportView: 'events',
    overview: overviewFixture,
    events: eventsPageFixture,
    showEventsPage,
    filterOptions: vi.fn(async () => []),
  });
});

const columns = () => screen.getAllByRole('columnheader').map((cell) => cell.textContent);
const rows = () => screen.getAllByRole('row').slice(1);

describe('EventsView', () => {
  it('pages through the range by rows', async () => {
    show({ ...eventsPageFixture, total: 71_536 });
    render(<EventsView tab="damage" />);
    expect(screen.getByText('Rows 1–3 of 71,536')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '‹ Previous' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next ›' }));
    expect(showEventsPage).toHaveBeenCalledWith(60);
    await userEvent.click(screen.getByRole('button', { name: 'Last page' }));
    expect(showEventsPage).toHaveBeenLastCalledWith(71_520);
  });

  it('shows Aug shares and the logged extras inside their hit, next to the amount as logged', () => {
    const [hit, ...rest] = eventsPageFixture.rows;
    show({ ...eventsPageFixture, rows: [{ ...hit, absorbed: 12_000 }, ...rest] });
    render(<EventsView tab="damage" />);
    const share = within(rows()[0]).getByTitle('Ebon Might · Speronis (Aug support, included in this hit)');
    expect(share).toHaveTextContent('62.00k');
    expect(within(rows()[0]).getByText('1.06M')).toBeInTheDocument();
    expect(within(rows()[0]).getByText('critical · absorbed 12.00k')).toBeInTheDocument();
    expect(rows()).toHaveLength(3);
  });

  it("shows the target's HP after a hit taken, when the log names it", () => {
    render(<EventsView tab="taken" />);
    expect(within(rows()[0]).getByText('HP 951.06M / 1.27B')).toBeInTheDocument();
  });

  it("keeps a pet's own name and names its owner", () => {
    render(<EventsView tab="damage" />);
    expect(within(rows()[2]).getByText('Wild Imp')).toBeInTheDocument();
    expect(within(rows()[2]).getByText('(Wendel)')).toBeInTheDocument();
  });

  it('drops the column of a dimension the page marks as narrowed', () => {
    show({ ...eventsPageFixture, narrowed: ['ability'] });
    const { unmount } = render(<EventsView tab="damage" />);
    expect(columns()).toEqual(['Time', 'Event', 'Amount', 'Source → Target']);
    unmount();
    show({ ...eventsPageFixture, narrowed: ['source', 'target'] });
    render(<EventsView tab="damage" />);
    expect(columns()).toEqual(['Time', 'Event', 'Ability', 'Amount']);
  });

  it('puts the units column last, after the value', () => {
    const { unmount } = render(<EventsView tab="damage" />);
    expect(columns()).toEqual(['Time', 'Event', 'Ability', 'Amount', 'Source → Target']);
    unmount();
    render(<EventsView tab="interrupts" />);
    expect(columns().at(-1)).toMatch(/→/);
    expect(columns()).toContain('Spell used');
  });

  it("shows a cast's cast time right after its name, with no column of its own", () => {
    const plain = { ...eventsPageFixture.rows[0], shares: [], critical: false, amount: null, targetHp: null };
    show({ ...eventsPageFixture, total: 1, rows: [{ ...plain, index: 1, t: 1_000, type: 'cast', event: 'SPELL_CAST_SUCCESS', source: 4, target: 9, spellId: 30451, durationMs: 1_070 }] });
    render(<EventsView tab="casts" />);
    expect(columns()).not.toContain('Cast time');
    expect(within(rows()[0]).getByText('Arcane Blast').parentElement).toHaveTextContent(/Arcane Blast\s*1\.07 s/);
  });

  it('opens a row to its logged fields', async () => {
    render(<EventsView tab="damage" />);
    await userEvent.click(within(rows()[0]).getByRole('button', { name: 'Logged fields of Damage at 2:10.007' }));
    expect(screen.getByText('SPELL_DAMAGE')).toBeInTheDocument();
    expect(screen.getByText('951,059,820 / 1,268,079,760')).toBeInTheDocument();
  });

  it('opens only the recap line of its own death when two windows share a line', async () => {
    const base = eventsPageFixture.rows[2];
    const recap = (contextOf: number): EventRow => ({ ...base, index: 500, t: 1_000, type: 'recap', contextOf });
    show({ ...eventsPageFixture, total: 2, rows: [recap(510), recap(520)] });
    render(<EventsView tab="deaths" />);
    await userEvent.click(within(rows()[1]).getByRole('button', { name: /0:01.000/ }));
    expect(within(rows()[0]).getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    expect(within(rows()[1]).getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('tells how a begin cast ended and calls a rejected input what it is', () => {
    const base = eventsPageFixture.rows[0];
    const cast = (row: Partial<EventRow>): EventRow => ({ ...base, shares: [], critical: false, amount: null, targetHp: null, ...row });
    show({
      ...eventsPageFixture,
      total: 2,
      rows: [
        cast({ index: 1, t: 1_000, type: 'beginCast', event: 'SPELL_CAST_START', spellId: 30451, outcome: 'completed', durationMs: 1_200 }),
        cast({ index: 2, t: 2_000, type: 'rejected', event: 'SPELL_CAST_FAILED', spellId: 30451, reason: 'Not yet recovered' }),
      ],
    });
    render(<EventsView tab="casts" />);
    expect(within(rows()[0]).getByText('completed after 1.20 s')).toBeInTheDocument();
    expect(within(rows()[1]).getByText('Cast rejected')).toBeInTheDocument();
    expect(within(rows()[1]).getByText('Not yet recovered · logging player only')).toBeInTheDocument();
  });

  it("shows the view's own failure and keeps the loaded page dimmed, in place and unpageable while it loads", () => {
    useApp.setState({ viewError: 'boom', reportError: null });
    const { unmount } = render(<EventsView tab="damage" />);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
    unmount();
    useApp.setState({ viewError: null, viewLoading: true });
    render(<EventsView tab="damage" />);
    expect(screen.getByRole('status')).toHaveTextContent('Calculating…');
    expect(rows()).toHaveLength(3);
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Next ›' })).toBeDisabled();
  });

  it('says why there is nothing to show when no page loaded', () => {
    useApp.setState({ events: null, viewError: null, viewLoading: false, reportError: 'table failed' });
    const { unmount } = render(<EventsView tab="damage" />);
    expect(screen.getByRole('alert')).toHaveTextContent('table failed');
    unmount();
    useApp.setState({ reportError: null });
    render(<EventsView tab="damage" />);
    expect(screen.getByText('The events are not loaded.')).toBeInTheDocument();
  });

  it('puts the overkill of a death in its note, not under the amount', () => {
    const base = eventsPageFixture.rows[0];
    show({
      ...eventsPageFixture,
      total: 1,
      rows: [{ ...base, type: 'died', event: 'UNIT_DIED', source: 9, target: 4, spellId: 30451, amount: 120_000, shares: [], critical: false, targetHp: null }],
    });
    render(<EventsView tab="deaths" />);
    expect(columns().at(-2)).toBe('Amount');
    expect(within(rows()[0]).getByText('overkill 120.00k')).toBeInTheDocument();
  });

  it('names an aura row a buff or a debuff by the type the log gives', () => {
    const plain = { ...eventsPageFixture.rows[0], shares: [], critical: false, amount: null, targetHp: null };
    show({
      ...eventsPageFixture,
      total: 3,
      rows: [
        { ...plain, index: 1, t: 1_000, type: 'apply', event: 'SPELL_AURA_APPLIED', source: 5, target: 4, spellId: 395152, auraKind: 'buff' },
        { ...plain, index: 2, t: 2_000, type: 'refresh', event: 'SPELL_AURA_REFRESH', source: 9, target: 4, spellId: 1287012, auraKind: 'debuff' },
        { ...plain, index: 3, t: 3_000, type: 'remove', event: 'SPELL_AURA_REMOVED', source: 9, target: 4, spellId: 1287012, auraKind: 'debuff' },
      ],
    });
    render(<EventsView tab="buffs" />);
    expect(rows().map((row) => within(row).getAllByRole('cell')[1].textContent)).toEqual(['Buff applied', 'Debuff refreshed', 'Debuff removed']);
  });

  it('nests a stack row under its aura with the count the log gives', () => {
    const plain = { ...eventsPageFixture.rows[0], shares: [], critical: false, amount: null, targetHp: null, auraKind: 'buff' as const };
    show({
      ...eventsPageFixture,
      total: 2,
      rows: [
        { ...plain, index: 1, t: 1_000, type: 'apply', event: 'SPELL_AURA_APPLIED', source: 5, target: 4, spellId: 395152 },
        { ...plain, index: 2, t: 1_200, type: 'stackGained', event: 'SPELL_AURA_APPLIED_DOSE', source: 5, target: 4, spellId: 395152, stacks: 11 },
      ],
    });
    render(<EventsView tab="buffs" />);
    const stack = within(rows()[1]).getByText('11 stacks').closest('[role="cell"]');
    expect(stack).toHaveTextContent('Ebon Might');
    expect(within(rows()[0]).queryByText(/stack/)).not.toBeInTheDocument();
  });

  it('shows the time once for rows logged in the same millisecond and keeps it for screen readers', () => {
    const plain = { ...eventsPageFixture.rows[0], shares: [], critical: false, amount: null, targetHp: null, auraKind: 'buff' as const };
    show({
      ...eventsPageFixture,
      total: 3,
      rows: [
        { ...plain, index: 1, t: 1_000, type: 'apply', event: 'SPELL_AURA_APPLIED', source: 4, target: 4, spellId: 30451 },
        { ...plain, index: 2, t: 1_000, type: 'remove', event: 'SPELL_AURA_REMOVED', source: 4, target: 4, spellId: 44425 },
        { ...plain, index: 3, t: 1_001, type: 'apply', event: 'SPELL_AURA_APPLIED', source: 5, target: 4, spellId: 395152 },
      ],
    });
    render(<EventsView tab="buffs" />);
    const [first, same, next] = rows().map((row) => within(row).getByRole('button'));
    expect(first).toHaveTextContent('0:01.000');
    expect(same).toHaveTextContent(/^$/);
    expect(same).toHaveAccessibleName('Logged fields of Buff removed at 0:01.000');
    expect(next).toHaveTextContent('0:01.001');
  });

  it('reads each event as a sentence in the text layout', async () => {
    render(<EventsView tab="damage" />);
    await userEvent.click(screen.getByRole('button', { name: 'Text view' }));
    expect(screen.getByText("Faelan hits Ula'tek #1 with Arcane Barrage for 1.06M")).toBeInTheDocument();
    expect(screen.getByText("Wild Imp (Wendel) hits Ula'tek #1 with Arcane Blast for 8.34k")).toBeInTheDocument();
  });

  it("keeps the tab's value in the text layout where the sentence has none", async () => {
    const base = eventsPageFixture.rows[0];
    const plain = { ...base, shares: [], critical: false, amount: null, targetHp: null };
    show({
      ...eventsPageFixture,
      total: 2,
      rows: [
        { ...plain, index: 1, t: 1_000, type: 'cast', event: 'SPELL_CAST_SUCCESS', source: 4, target: 0, spellId: 30451, durationMs: 1_200 },
        { ...plain, index: 2, t: 2_000, type: 'stackGained', event: 'SPELL_AURA_APPLIED_DOSE', source: 4, target: 3, spellId: 395152, stacks: 3 },
      ],
    });
    render(<EventsView tab="casts" />);
    await userEvent.click(screen.getByRole('button', { name: 'Text view' }));
    expect(screen.getByText('Faelan casts Arcane Blast').parentElement).toHaveTextContent('1.20 s');
    cleanup();
    render(<EventsView tab="buffs" />);
    await userEvent.click(screen.getByRole('button', { name: 'Text view' }));
    expect(screen.getByText("Wendel's Ebon Might from Faelan gains a stack").parentElement).toHaveTextContent(/stack\s*3/);
  });

  it('says a logged stack loss is a loss, with the count the log left', async () => {
    const plain = { ...eventsPageFixture.rows[0], shares: [], critical: false, amount: null, targetHp: null };
    show({
      ...eventsPageFixture,
      total: 1,
      rows: [{ ...plain, index: 2, t: 2_000, type: 'stackLost', event: 'SPELL_AURA_REMOVED_DOSE', source: 4, target: 3, spellId: 395152, stacks: 1 }],
    });
    render(<EventsView tab="buffs" />);
    expect(within(rows()[0]).getByText('Stack lost')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Text view' }));
    expect(screen.getByText("Wendel's Ebon Might from Faelan loses a stack").parentElement).toHaveTextContent(/stack\s*1/);
  });
});
